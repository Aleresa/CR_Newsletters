import test from 'node:test';
import assert from 'node:assert/strict';
import {groupProducts,productType} from '../public/product-groups.js';

test('recognizes supplier product types with spelling and whitespace variants',()=>{
  for(const name of ['Чехол конверт MacBook','Чехол-конверт WIWU','  ЧЕХОЛ\u00a0КОНВЕРТ Air','Чехол‑конверт Pro'])assert.equal(productType(name),'Чехол конверт');
  assert.equal(productType('Защитный чехол MacBook'),'Защитный чехол');
  assert.equal(productType('Защитная пленка iPad'),'Защитная плёнка');
  assert.equal(productType('Защитная плёнка iPhone'),'Защитная плёнка');
  assert.equal(productType('Набор для чистки'),'Прочие товары');
  assert.equal(productType('Чехолок'),'Прочие товары');
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
