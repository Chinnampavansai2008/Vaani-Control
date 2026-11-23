import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCartPrices, buildOrderItems} from './cartPricing.js';

const line = Object.freeze({key:'1/M/Black',product_id:1,name:'Black Hoodie',price:1299,quantity:2,size:'M',color:'Black'});

test('a voice discount updates bag unit price and subtotal without changing selected options', () => {
  const source=Object.freeze([line]);
  const result=reconcileCartPrices(source,[{id:1,price:999}]);
  assert.deepEqual(result.items,[{...line,price:999}]);
  assert.equal(result.items.reduce((total,item)=>total+item.price*item.quantity,0),1998);
  assert.equal(result.changed,true);
  assert.equal(line.price,1299);
});

test('price increases and free products are reflected for every size and colour line', () => {
  const cart=[line,{...line,key:'1/L/Blue',size:'L',color:'Blue',quantity:1}];
  for (const price of [1499,0]) {
    const result=reconcileCartPrices(cart,[{id:1,price}]);
    assert.deepEqual(result.items,cart.map(item=>({...item,price})));
    assert.equal(result.items.reduce((sum,item)=>sum+item.quantity*item.price,0),price*3);
  }
});

test('unchanged and empty carts do not produce a price-change notice', () => {
  const cart=[line];
  assert.equal(reconcileCartPrices(cart,[{id:1,price:1299}]).items,cart);
  assert.equal(reconcileCartPrices(cart,[{id:1,price:1299}]).changed,false);
  assert.deepEqual(reconcileCartPrices([],[]),{items:[],changed:false,unavailable:[]});
});

test('missing products stay visible and are flagged to block checkout', () => {
  const result=reconcileCartPrices([line],[]);
  assert.deepEqual(result.unavailable,['Black Hoodie']);
  assert.deepEqual(result.items,[line]);
});

test('invalid catalog prices are unavailable instead of creating an incorrect subtotal', () => {
  for (const price of [-1,true,'999',1.5,NaN,Infinity]) {
    assert.deepEqual(reconcileCartPrices([line],[{id:1,price}]).unavailable,['Black Hoodie']);
  }
});

test('checkout carries the displayed unit price and retains quantity, size and colour', () => {
  const result=reconcileCartPrices([line],[{id:1,price:999}]);
  assert.deepEqual(buildOrderItems(result.items),[{product_id:1,quantity:2,size:'M',color:'Black',expected_unit_price:999}]);
  assert.equal(line.price,1299);
});

test('invalid displayed prices cannot become checkout expectations', () => {
  for (const price of [-1,true,'999',1.5,NaN,Infinity]) assert.throws(()=>buildOrderItems([{...line,price}]));
});
