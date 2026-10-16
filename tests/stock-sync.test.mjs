import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Inventory} from '../server/store.mjs';
import {parseStockRows} from '../public/stock-rows.js';

function fixture(){
  const db=new DatabaseSync(':memory:');
  const sql={exec(query,...args){const s=db.prepare(query);if(/^SELECT/i.test(query))return s.all(...args);s.run(...args);return [];}};
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  const inv=new Inventory(sql,transaction);
  inv.saveManagers({managers:[{id:'m1',name:'Тест',username:'stock_manager'}]});
  const items=[
    {id:'article-01',sku:'0001',name:'Товар',stock:10,price:10000,group:'Телефоны'},
    {id:'b',sku:'x9',name:'Другой товар',stock:4,price:22000}
  ];
  inv.importShipment({id:'s1',title:'Категория 1',status:'arrived',groupingMode:'manual',groups:['Телефоны'],products:items});
  inv.importShipment({id:'s2',title:'Категория 2',status:'arrived',products:[
    {id:'mirror',sku:'0001',name:'Вторая карточка',stock:8,price:9000}
  ]});
  return {inv,db};
}
test('stock-only spreadsheet supports headers and preserves displayed leading zeroes',()=>{
  const rows=new Map([
    [1,{0:'Отчёт остатка'}],
    [3,{0:'Артикул',1:'Наименование',2:'Остаток',3:'Цена'}],
    [4,{0:'0001',1:'Товар',2:'0',3:'999999'}],
    [5,{0:'x9',1:'Ещё',2:'1 200',3:'1'}],
    [6,{0:'unknown',1:'Другой',2:'',3:'5'}],
    [7,{0:'0001',2:0}],
    [8,{0:'',1:'Итого',2:'1200'}]
  ]);
  const output=parseStockRows(rows);
  assert.deepEqual(output.items,[{sku:'0001',stock:0},{sku:'x9',stock:1200}]);
  assert.equal(output.skipped,1);
  assert.equal(output.warnings.length,1);
});
test('stock-only parser rejects ambiguous duplicates, bad headers and invalid numbers',()=>{
  assert.throws(()=>parseStockRows(new Map([[1,{0:'Код',1:'Цена'}],[2,{0:'0001',1:3}]])),/столбцы/);
  assert.throws(()=>parseStockRows(new Map([[1,{0:'Код',1:'Доступно'}],[2,{0:'A',1:3}],[3,{0:'A',1:4}]])),/разными остатками/);
  assert.throws(()=>parseStockRows(new Map([[1,{0:'Код',1:'Доступно'}],[2,{0:'A',1:'-1'}]])),/не найдено корректных/);
});
test('preview makes no mutations; apply updates all existing categories by SKU, never creates products',()=>{
  const {inv}=fixture();
  const entries={items:[{sku:'0001',stock:3},{sku:'x9',stock:0},{sku:'missing',stock:999}]};
  const before=JSON.stringify(inv.catalog(true));
  const preview=inv.stockSync(entries);
  assert.equal(preview.source,3);
  assert.equal(preview.matched,2);
  assert.equal(preview.matchedPositions,3);
  assert.equal(preview.changed,3);
  assert.equal(preview.missing,1);
  assert.equal(JSON.stringify(inv.catalog(true)),before);
  const saved=inv.stockSync(entries,true);
  assert.equal(saved.applied,true);
  const current=inv.catalog(true);
  assert.deepEqual(current[0].products.map(p=>p.stock),[3,0]);
  assert.deepEqual(current[1].products.map(p=>p.stock),[3]);
  assert.deepEqual(current[0].products.map(p=>p.price),[10000,22000]);
  assert.equal(current[0].products[0].group,'Телефоны');
  assert.equal(current[0].products.length,2);
  assert.equal(current[1].products.length,1);
  assert.equal(inv.stockSync(entries,true).changed,0);
});
test('active orders are preserved and stock sync sets exact available quantity without double subtraction',()=>{
  const {inv}=fixture();
  const order=inv.placeOrder({id:'123',name:'Покупатель'},{
    shipmentId:'s1',requestKey:'test-reservation',managerId:'m1',
    lines:[{id:'article-01',quantity:6}]
  });
  assert.equal(inv.catalog(true)[0].products[0].stock,4);
  const preview=inv.stockSync({items:[{sku:'0001',stock:2}]});
  assert.equal(preview.changed,2);
  inv.stockSync({items:[{sku:'0001',stock:2}]},true);
  const listing=inv.catalog(true)[0].products[0];
  assert.equal(listing.stock,2);
  assert.equal(listing.total,8);
  assert.equal(listing.placed,6);
  assert.equal(inv.orders({id:'123'})[0].id,order.id);
  inv.changeOrder({id:'123'},order.id,'cancelled');
  assert.equal(inv.catalog(true)[0].products[0].stock,8);
});
test('stock update validates all input before writing and rolls back on errors',()=>{
  const {inv}=fixture();
  const initial=JSON.stringify(inv.catalog(true));
  assert.throws(()=>inv.stockSync({items:[{sku:'0001',stock:0},{sku:'x9',stock:-2}]},true),/Некорректный/);
  assert.throws(()=>inv.stockSync({items:[{sku:'0001',stock:0},{sku:'0001',stock:1}]},true),/Повтор/);
  assert.throws(()=>inv.stockSync({items:[{sku:'absent',stock:0}]},true),/Не найдено совпадающих/);
  assert.equal(JSON.stringify(inv.catalog(true)),initial);
});
