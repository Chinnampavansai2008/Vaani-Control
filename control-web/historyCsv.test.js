import test from 'node:test';
import assert from 'node:assert/strict';
import {filterHistory} from './history.js';
import {generateHistoryCsv, historyCsvFilename, downloadHistoryCsv} from './historyCsv.js';

const action = Object.freeze({id: 'original-id', timestamp: '2026-11-23T08:27:00+00:00', product: 'White T-Shirt', field: 'stock', previous: 40, value: 30, status: 'undone', undone_at: '2026-11-23T08:28:00+00:00'});
const header = '\uFEFF"Timestamp","Product","Action","Previous value","New value","Status","Undone at"\r\n';

test('CSV has a BOM, fixed columns and ISO timestamps, preserving numeric cells', () => {
  assert.equal(generateHistoryCsv([action]), header + '"2026-11-23T08:27:00+00:00","White T-Shirt","stock",40,30,"undone","2026-11-23T08:28:00+00:00"\r\n');
});

test('CSV exports only supplied filtered actions, retaining their order and source data', () => {
  const actions = Object.freeze([action, Object.freeze({...action, product: 'Black Hoodie', field: 'price'}), Object.freeze({...action, product: 'Blue Jeans'})]);
  const filtered = filterHistory(actions, {type: 'stock'});
  const csv = generateHistoryCsv(filtered);
  assert.ok(csv.indexOf('White T-Shirt') < csv.indexOf('Blue Jeans'));
  assert.equal(csv.includes('Black Hoodie'), false);
  assert.equal(filtered[0], action);
  assert.equal(actions.length, 3);
});

test('CSV escapes quotation marks, commas and line breaks inside a product name', () => {
  const csv = generateHistoryCsv([{...action, product: 'Blue, "Soft"\nT-Shirt'}]);
  assert.ok(csv.includes('"Blue, ""Soft""\nT-Shirt"'));
});

test('Telugu is preserved and optional missing values are blank', () => {
  const csv = generateHistoryCsv([{...action, product: 'తెల్ల టీ షర్ట్', status: 'applied', undone_at: undefined}]);
  assert.ok(csv.includes('"తెల్ల టీ షర్ట్"'));
  assert.ok(csv.endsWith(',"applied",""\r\n'));
});

test('formula-like text is neutralized, including leading whitespace and controls', () => {
  for (const product of ['=1+1', '+SUM(1)', '-SUM(1)', '@SUM(1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1']) {
    const csv = generateHistoryCsv([{...action, product, previous: 0, value: 999}]);
    assert.ok(csv.includes('"\'' + product + '"'), JSON.stringify(product));
    assert.ok(csv.includes(',0,999,'), 'Numeric columns must remain numeric');
  }
});

test('empty generation is header only; download refuses empty results', () => {
  assert.equal(generateHistoryCsv([]), header);
  assert.equal(downloadHistoryCsv([], {doc: null, urls: null}), false);
});

test('filename uses local calendar date, with padded month and day', () => {
  assert.equal(historyCsvFilename(new Date(2026, 0, 2, 0, 1)), 'vaanicontrol-history-2026-01-02.csv');
  assert.equal(historyCsvFilename(new Date(2026, 11, 31, 23, 59)), 'vaanicontrol-history-2026-12-31.csv');
});

test('download creates a UTF-8 CSV and cleans up its link and object URL', async () => {
  const events = [];
  let savedBlob, scheduled;
  const link = {click() { events.push('click'); }, remove() { events.push('remove'); }};
  const urls = {createObjectURL(blob) { savedBlob = blob; return 'blob:test-download'; }, revokeObjectURL(url) { events.push(url); }};
  const doc = {createElement(tag) { assert.equal(tag, 'a'); return link; }, body: {appendChild(el) { assert.equal(el, link); events.push('append'); }}};
  assert.equal(downloadHistoryCsv([action], {date: new Date(2026, 10, 23), doc, urls, schedule(fn, ms) { scheduled = fn; assert.equal(ms, 1000); }}), true);
  assert.deepEqual(events, ['append', 'click', 'remove']);
  assert.equal(link.download, 'vaanicontrol-history-2026-11-23.csv');
  assert.equal(savedBlob.type, 'text/csv;charset=utf-8');
  const bytes = new Uint8Array(await savedBlob.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 3)), [239, 187, 191]);
  scheduled();
  assert.equal(events.at(-1), 'blob:test-download');
});

test('failed clicks still clean up the temporary link and schedule URL release', () => {
  let removed = false, release;
  const link = {click() { throw new Error('download blocked'); }, remove() { removed = true; }};
  assert.throws(() => downloadHistoryCsv([action], {
    doc: {createElement: () => link, body: {appendChild() {}}},
    urls: {createObjectURL: () => 'blob:test', revokeObjectURL() {}},
    schedule(fn) { release = fn; },
  }), /download blocked/);
  assert.equal(removed, true);
  assert.equal(typeof release, 'function');
});
