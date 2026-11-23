import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchStoreStatus} from './storeConnection.js';

const good = {status: 'ok', host: '127.0.0.1:8001', product_count: 3, message: 'Catalog reachable and compatible.', update_permissions_checked: false};

test('connection check uses a fixed read-only endpoint without credentials or request body', async () => {
  const signal = new AbortController().signal;
  const result = await fetchStoreStatus({signal, fetcher: async (url, options) => {
    assert.equal(url, '/api/store/status');
    assert.deepEqual(options, {signal});
    return {ok: true, json: async () => good};
  }});
  assert.equal(result, good);
});

test('valid states include a reachable empty store and operational failures', async () => {
  for (const data of [{...good, product_count: 0},
    {...good, status: 'incompatible', product_count: null},
    {...good, status: 'unavailable', host: null, product_count: null}]) {
    const result = await fetchStoreStatus({fetcher: async () => ({ok: true, json: async () => data})});
    assert.equal(result, data);
  }
});

test('malformed status responses cannot produce a false connected label', async () => {
  for (const data of [null, {}, {...good, status: 'unknown'}, {...good, product_count: -1},
    {...good, product_count: '3'}, {...good, product_count: true}, {...good, host: 4},
    {...good, status: 'incompatible'}, {...good, update_permissions_checked: true}]) {
    await assert.rejects(fetchStoreStatus({fetcher: async () => ({ok: true, json: async () => data})}), /valid store check/);
  }
});

test('HTTP errors are rejected without echoing their private detail', async () => {
  await assert.rejects(fetchStoreStatus({fetcher: async () => ({ok: false, json: async () => ({detail: 'private-upstream-value'})})}), error =>
    error.message.includes('valid store check') && !error.message.includes('private-upstream-value'));
});

test('network errors and cancellation propagate for the panel to handle independently', async () => {
  const error = new Error('network error');
  await assert.rejects(fetchStoreStatus({fetcher: async () => { throw error; }}), e => e === error);
});
