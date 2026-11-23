import test from 'node:test';
import assert from 'node:assert/strict';
import {filterHistory} from './history.js';

const history = Object.freeze([
  Object.freeze({id: 'latest-stock', product: 'White T-Shirt', field: 'stock', status: 'undone'}),
  Object.freeze({id: 'applied-price', product: 'Black Hoodie', field: 'price', status: 'applied'}),
  Object.freeze({id: 'older-price', product: 'Black Hoodie', field: 'price', status: 'undone'}),
  Object.freeze({id: 'older-stock', product: 'Blue Jeans', field: 'stock', status: 'applied'}),
]);

test('no filters preserve order and original action identities without mutation', () => {
  const result = filterHistory(history);
  assert.deepEqual(result, history);
  assert.notEqual(result, history);
  result.forEach((action, i) => assert.equal(action, history[i]));
});
test('product search ignores capitalization and surrounding whitespace', () => {
  assert.deepEqual(filterHistory(history, {search: '  BLACK hooDIE  '}).map(a => a.id), ['applied-price', 'older-price']);
});
test('type and status filters work separately', () => {
  assert.deepEqual(filterHistory(history, {type: 'stock'}).map(a => a.id), ['latest-stock', 'older-stock']);
  assert.deepEqual(filterHistory(history, {status: 'applied'}).map(a => a.id), ['applied-price', 'older-stock']);
});
test('search, type and status must all match', () => {
  assert.deepEqual(filterHistory(history, {search: 'hoodie', type: 'price', status: 'undone'}).map(a => a.id), ['older-price']);
  assert.deepEqual(filterHistory(history, {search: 'hoodie', type: 'stock'}), []);
});
test('no matches and empty history return empty lists', () => {
  assert.deepEqual(filterHistory(history, {search: 'not-a-product'}), []);
  assert.deepEqual(filterHistory([], {type: 'stock', status: 'applied'}), []);
});
