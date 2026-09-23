// Runs only with development dependencies installed (see GitHub Checks workflow).
import {chromium} from 'playwright';
import JSZip from 'jszip';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {legacyFixture} from './excel-fixtures.mjs';
import {NewsletterStore} from '../server/worker.mjs';

const token='local-test-only',db=new DatabaseSync(':memory:');
const sql={exec(q,...args){const s=db.prepare(q);if(/^SELECT/i.test(q))return s.all(...args);s.run(...args);return [];}};
let alarm=null;
const ctx={storage:{sql,getAlarm:async()=>alarm,setAlarm:async x=>alarm=x,transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},waitUntil:()=>{}};
const store=new NewsletterStore(ctx,{BOT_TOKEN:token,ADMIN_IDS:'123',ORDER_CHAT_ID:'test-only'});
// Integration test must never send Telegram messages.
store.flush=async()=>{};
const source=JSON.parse(await readFile('public/data/catalog.json','utf8'));
for(const s of source.shipments)store.inventory.importShipment({...s,status:'arrived',publishedAt:'2026-09-22',eta:'2026-10-01'});
const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:123,first_name:'Test'})});
const check=[...params.entries()].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}=${v}`).join('\n');
params.set('hash',createHmac('sha256',createHmac('sha256','WebAppData').update(token).digest()).update(check).digest('hex'));
const initData=params.toString(),root=resolve('public');
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const response=await store.fetch(new Request('http://localhost:4174'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
    }
    const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
    if(!path.startsWith(root+sep))throw Error();
    const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'}[extname(path)];
    res.writeHead(200,{'Content-Type':type||'application/octet-stream'});res.end(await readFile(path));
  }catch{res.writeHead(500);res.end('Test server error');}
});
await new Promise(r=>server.listen(4174,'127.0.0.1',r));
await mkdir('test-results',{recursive:true});
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://telegram.org/js/telegram-web-app.js',route=>route.fulfill({contentType:'text/javascript',body:`window.Telegram={WebApp:{initData:${JSON.stringify(initData)},ready(){},expand(){},BackButton:{show(){},hide(){},onClick(){}}}};`}));
  await page.goto('http://localhost:4174');await page.waitForSelector('.shipment-card');
  assert.equal(await page.locator('.shipment-card').count(),1);
  await page.locator('#shipment-search').fill('Demo');
  await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('#shipment-search').inputValue(),'Demo');
  await page.locator('#shipment-search').fill('');await page.waitForSelector('.shipment-card');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'test-results/mobile.png',fullPage:true});
  await page.locator('#admin-tab').click();await page.locator('#managers').click();
  await page.waitForSelector('[data-manager-name]');
  await page.locator('[data-manager-name]').first().fill('Анна');await page.locator('[data-manager-username]').first().fill('@anna_test');
  await page.locator('#add-manager').click();
  await page.locator('[data-manager-name]').last().fill('Иван');await page.locator('[data-manager-username]').last().fill('@ivan_test');
  await page.locator('#managers-form button[type="submit"]').click();await page.waitForSelector('#managers-form',{state:'hidden'});
  assert.equal(store.inventory.managers().length,2);
  await page.locator('[data-view="shipments"]').click();
  await page.locator('[data-shipment="demo"]').click();await page.locator('[data-step="1"]').first().click();await page.locator('#open-cart').click();await page.waitForSelector('#placeOrder-manager');
  assert.equal(await page.locator('#submit-placeOrder').isDisabled(),true);
  await page.locator('#placeOrder-manager').selectOption({label:'Иван'});await page.locator('#submit-placeOrder').click();
  await page.waitForSelector('.order');
  assert.equal(store.inventory.orders({id:'123'})[0].manager.username,'ivan_test');
  assert.match(JSON.parse(store.inventory.rows('SELECT data FROM outbox')[0].data).text,/Менеджер: Иван @ivan_test/);
  assert.equal(store.inventory.catalog().find(s=>s.id==='demo').products[0].stock,9);
  await page.locator('[data-edit-order]').click();await page.waitForSelector('[data-edit-qty]');
  const firstProduct=store.inventory.catalog()[0].products[0],secondProduct=store.inventory.catalog()[0].products[1];
  await page.locator('[data-edit-qty]').first().fill('3');
  await page.locator('#add-order-product').selectOption(secondProduct.id);
  await page.locator(`[data-edit-qty="${secondProduct.id}"]`).fill('2');
  await page.locator('#edit-order-comment').fill('Изменённый заказ');
  await page.screenshot({path:'test-results/edit-order.png',fullPage:true});
  await page.locator('#save-order').click();await page.waitForSelector('#edit-order-form',{state:'hidden'});await page.waitForSelector('[data-edit-order]');
  assert.deepEqual(store.inventory.catalog()[0].products.map(p=>p.stock),[7,3]);
  const changed=store.inventory.orders({id:'123'})[0];assert.equal(changed.comment,'Изменённый заказ');assert.equal(changed.revision,2);
  await page.locator('[data-edit-order]').click();await page.waitForSelector('[data-edit-qty]');
  await page.locator(`[data-edit-qty="${firstProduct.id}"]`).fill('0');await page.locator(`[data-edit-qty="${secondProduct.id}"]`).fill('1');
  await page.locator('#save-order').click();await page.waitForSelector('#edit-order-form',{state:'hidden'});await page.waitForSelector('[data-cancel]');
  assert.deepEqual(store.inventory.catalog()[0].products.map(p=>p.stock),[10,4]);
  await page.locator('[data-cancel]').click();await page.locator('#confirm-action').click();await page.waitForSelector('#orders .empty strong');assert.equal(await page.locator('.order').count(),0);
  assert.deepEqual(store.inventory.catalog()[0].products.map(p=>p.stock),[10,5]);
  await page.locator('#admin-tab').click();await page.locator('#new-shipment').click();
  // A minimal XLSX with inline strings verifies the same import UI used for supplier files.
  const z=new JSZip();
  z.file('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Test" sheetId="1" r:id="rId1"/></sheets></workbook>');
  z.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');
  const values=[['Наименование','Артикул','Кол-во','Опт.'],['Тестовый товар','test-1','5','150']];
  z.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${values.map((r,i)=>`<row r="${i+1}">${r.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`);
  await page.locator('#xlsx-file').setInputFiles({name:'Test.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await z.generateAsync({type:'nodebuffer'})});
  await page.waitForSelector('#accept-warnings');await page.locator('#accept-warnings').check();await page.locator('#save-shipment').click();
  await page.waitForSelector('.admin-row:nth-child(2)');assert.equal(store.inventory.catalog(true).length,2);
  // Binary XLS goes through the worker. Empty prices must be filled before Save.
  await page.locator('#new-shipment').click();
  await page.locator('#xlsx-file').setInputFiles({name:'Legacy.xls',mimeType:'application/vnd.ms-excel',buffer:legacyFixture()});
  await page.waitForSelector('[data-import-price="xls-1"]');
  await page.locator('#accept-warnings').check();await page.locator('#save-shipment').click();
  assert.equal(store.inventory.catalog(true).length,2);
  await page.locator('[data-import-price="xls-1"]').fill('199.90');await page.locator('#save-shipment').click();
  await page.waitForSelector('.admin-row:nth-child(3)');
  const legacy=store.inventory.catalog(true).find(s=>s.title==='Legacy');assert.equal(legacy.products[0].price,19990);
  await page.locator(`[data-delete-shipment="${legacy.id}"]`).click();await page.locator('#delete-shipment').click();
  await page.waitForSelector('.admin-row:nth-child(3)',{state:'detached'});
  assert.equal(store.inventory.catalog(true).length,2);
  await page.locator('#all-orders').click();await page.waitForSelector('.badge.cancelled');
  await page.locator('#refresh').click();await page.waitForSelector('.badge.cancelled');
  assert.equal(await page.locator('h1').textContent(),'Все заказы');
  const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise;await download.saveAs('test-results/orders.xlsx');
  const exported=await JSZip.loadAsync(await readFile('test-results/orders.xlsx'));assert(exported.file('xl/worksheets/sheet1.xml'));assert.match(await exported.file('xl/worksheets/sheet1.xml').async('text'),/@ivan_test/);
  await page.setViewportSize({width:1440,height:1000});await page.locator('[data-view="shipments"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'test-results/desktop.png',fullPage:true});
  await page.locator('#back').click();await page.waitForSelector('.shipment-card');
  // Existing arrivals are grouped on display, with a shared cart across type filters.
  store.inventory.importShipment({id:'grouped',title:'Смешанный файл',brand:'WIWU',status:'arrived',products:[
    {id:'g1',sku:'g1',name:'Чехол конверт Air',stock:5,price:10000},
    {id:'g2',sku:'g2',name:'Защитный чехол Pro',stock:3,price:20000},
    {id:'g3',sku:'g3',name:'Защитная пленка iPad',stock:8,price:30000},
    {id:'g4',sku:'g4',name:'Чехол конверт Pro',stock:4,price:40000}
  ]});
  await page.locator('#refresh').click();await page.waitForSelector('[data-shipment="grouped"]');
  await page.locator('[data-shipment="grouped"]').click();
  assert.deepEqual(await page.locator('.group-heading h2').allTextContents(),['Чехол конверт','Защитный чехол','Защитная плёнка']);
  assert.deepEqual(await page.locator('[data-product]').evaluateAll(nodes=>nodes.map(n=>n.dataset.product)),['g1','g4','g2','g3']);
  await page.locator('[data-step="1"][data-id="g1"]').click();
  await page.locator('#product-group').selectOption('Защитная плёнка');
  assert.equal(await page.locator('[data-product]').count(),1);
  await page.locator('[data-step="1"][data-id="g3"]').click();
  await page.locator('#product-search').fill('no-match');await page.waitForSelector('#products .empty');
  await page.locator('#product-search').fill('');await page.waitForSelector('[data-product="g3"]');
  await page.locator('#product-group').selectOption('');
  assert.equal(await page.locator('[data-qty="g1"]').inputValue(),'1');
  assert.equal(await page.locator('[data-qty="g3"]').inputValue(),'1');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'test-results/grouped-products.png',fullPage:true});
  await page.locator('#open-cart').click();
  assert.equal(await page.locator('.cart-line').count(),2);
  assert.match(await page.locator('.cart-total').textContent(),/2 шт/);
  await page.locator('#close-dialog').click();
  assert.deepEqual(errors,[]);console.log('Browser checks passed: mobile, order, cancellation, Excel import/export, desktop.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
