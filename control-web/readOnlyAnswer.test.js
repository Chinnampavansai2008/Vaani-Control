import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReadOnlyAnswer} from './readOnlyAnswer.js';

const answer = {product_id: 1, product: 'Black Hoodie', field: 'price', value: 1299, read_only: true};

test('valid price and stock answers preserve real numeric values including zero', () => {
  assert.deepEqual(validateReadOnlyAnswer(answer), answer);
  assert.deepEqual(validateReadOnlyAnswer({...answer, field: 'stock', value: 0}), {...answer, field: 'stock', value: 0});
});
test('answers whitelist display fields without mutating the source', () => {
  const source = Object.freeze({...answer, extra: 'must-not-display'});
  assert.deepEqual(validateReadOnlyAnswer(source), answer);
});
test('missing or false read-only flags cannot display a successful answer', () => {
  for (const data of [null, {}, {...answer, read_only: false}, {...answer, read_only: undefined}]) {
    assert.throws(() => validateReadOnlyAnswer(data), /valid read-only answer/);
  }
});
test('invalid fields and product names are rejected', () => {
  for (const data of [{...answer, field: 'orders'}, {...answer, product: ''}, {...answer, product: '  '}, {...answer, product: 7}]) {
    assert.throws(() => validateReadOnlyAnswer(data));
  }
});
test('invalid and unsafe numeric values are rejected rather than misrepresented', () => {
  for (const value of [true, '1299', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateReadOnlyAnswer({...answer, value}));
  }
  for (const product_id of [true, '1', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validateReadOnlyAnswer({...answer, product_id}));
  }
});
