import test from 'node:test';
import assert from 'node:assert/strict';
import {groupProducts,productType,proposeGroups} from '../public/product-groups.js';

test('recognizes supplier product types with spelling and whitespace variants',()=>{
  for(const name of ['Чехол конверт MacBook','Чехол-конверт WIWU','  ЧЕХОЛ\u00a0КОНВЕРТ Air','Чехол‑конверт Pro'])assert.equal(productType(name),'Чехол конверт');
  assert.equal(productType('Защитный чехол MacBook'),'Защитный чехол');
  assert.equal(productType('Защитная пленка iPad'),'Защитная плёнка');
  assert.equal(productType('Защитная плёнка iPhone'),'Защитная плёнка');
  assert.equal(productType('Набор для чистки'),'Набор');
  assert.equal(productType('Чехолок'),'Чехолок');
});

test('gathers interleaved rows without losing images, stock, identity or within-group order',()=>{
  const products=['Чехол конверт Air','Защитный чехол Pro','Защитная пленка iPad','Чехол конверт Pro','Защитная плёнка Air'].map((name,i)=>Object.freeze({id:String(i),name,image:`photo-${i}`,stock:i,price:100*i}));
  Object.freeze(products);
  const groups=groupProducts(products);
  assert.deepEqual(groups.map(g=>[g.name,g.products.map(p=>p.id)]),[
    ['Чехол конверт',['0','3']],['Защитный чехол',['1']],['Защитная плёнка',['2','4']]
  ]);
  for(const p of groups.flatMap(g=>g.products))assert.equal(p,products[Number(p.id)]);
  assert.deepEqual(groupProducts([]),[]);
});

const named=names=>names.map((name,i)=>({id:String(i),sku:String(i),name,stock:10,price:15000}));
test('analyzes unseen families and unifies wires, cables and power banks',()=>{
  const result=proposeGroups(named(['Провод USB-C 1м','Кабель USB-C 2м','Power Bank WiWU 10000mAh Black','Аккумулятор WiWU 20000mAh White','Зубная щетка электрическая Sonic X1','Зубная щетка дорожная Sonic X2']));
  assert.deepEqual(result.map(p=>p.group),['Кабель','Кабель','Аккумулятор','Аккумулятор','Зубная щетка','Зубная щетка']);
  assert.equal(result[2].subgroup,result[3].subgroup);
  assert(result[4].groupingNeedsReview);
});
test('proposes four glass subtypes without grouping by iPhone versions or colours',()=>{
  const result=proposeGroups(named(['Защитное стекло iPhone 15 матовое Black','Защитное стекло iPhone 16 антишпион White','Защитное стекло iPhone 15 керамическое','Защитное стекло iPhone 16 глянцевое']));
  assert(result.every(p=>p.group==='Защитное стекло'));
  assert.deepEqual(result.map(p=>p.subgroup),['Матовое','Антишпион','Керамическое','Глянцевое']);
});
test('series evidence separates glass model codes and repeated product signatures',()=>{
  const result=proposeGroups(named(['Защитное стекло Remax GL-27 iPhone 15 Black','Защитное стекло Remax GL-28 iPhone 16 White','Защитное стекло Gurdini Premium iPhone 15 Black','Защитное стекло Gurdini Premium iPhone 16 White','Защитное стекло Gurdini Basic iPhone 15','Защитное стекло Gurdini Basic iPhone 16']));
  assert.deepEqual(result.map(p=>p.subgroup),['GL-27','GL-28','Gurdini premium','Gurdini premium','Gurdini basic','Gurdini basic']);
});
test('ambiguous names remain reviewable, explicit edits survive reimport by ID',()=>{
  const items=named(['Товар 1','Товар 2','Защитное стекло iPhone 15']);
  const suggestions=proposeGroups(items);
  assert(suggestions.every(p=>p.groupingNeedsReview));
  assert(suggestions.every(p=>p.subgroup===''));
  const saved=suggestions.map(p=>({...p,group:'Моя группа',subgroup:'Мой тип'}));
  assert(proposeGroups(items,saved).every(p=>p.group==='Моя группа'&&p.subgroup==='Мой тип'));
  const single=proposeGroups([items[0]],saved)[0];assert.equal(single.group,'Моя группа');
  const blank=proposeGroups(items,[{...saved[0],subgroup:''}])[0];assert.equal(blank.subgroup,'');
  assert.equal(groupProducts([{...items[0],group:'Стёкла',subgroup:'Матовые'},{...items[1],group:'стекла',subgroup:'матовые'}]).length,1);
});

test('suggests distinct series from shared brand signatures even for a single item of each type',()=>{
  const products=proposeGroups(named(['Защитное стекло Gurdini Basic iPhone 15','Защитное стекло Gurdini Premium iPhone 16','Защитное стекло Gurdini Privacy iPhone 15','Защитное стекло Gurdini Matte iPhone 16']));
  assert.deepEqual(products.map(p=>p.subgroup),['Gurdini basic','Gurdini premium','Антишпион','Матовое']);
  assert(products[0].groupingNeedsReview);
});
