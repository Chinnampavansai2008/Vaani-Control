import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReadAloudText, createSpeechPlayback, readAloudLanguage, selectReadAloudVoice, speechPlaybackSupported} from './readAloud.js';

const english = {name: 'English India', lang: 'en-IN'};
const telugu = {name: 'Telugu', lang: 'te-IN'};
const answer = {product: 'Black Hoodie', field: 'price', value: 999, read_only: true};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(options = {}) {
  let voices = [english, telugu];
  const listeners = new Set(), spoken = [], states = [], errors = [];
  let cancelled = 0;
  class Utterance { constructor(text) { this.text = text; } }
  const synthesis = {
    getVoices: () => voices,
    speak: utterance => spoken.push(utterance),
    cancel: () => cancelled++,
    addEventListener: (name, callback) => { assert.equal(name, 'voiceschanged'); listeners.add(callback); },
    removeEventListener: (name, callback) => { assert.equal(name, 'voiceschanged'); listeners.delete(callback); },
  };
  const player = createSpeechPlayback({synthesis, Utterance, onState: value => states.push(value), onError: value => errors.push(value), ...options});
  return {player, synthesis, Utterance, spoken, states, errors, listeners,
    get cancelled() { return cancelled; },
    setVoices(value, notify = true) { voices = value; if (notify) [...listeners].forEach(callback => callback()); },
  };
}

test('answer readouts state the actual price or stock, including zero and one', () => {
  assert.equal(buildReadAloudText(answer, 'answer'), 'Black Hoodie. The current price is 999 rupees.');
  assert.match(buildReadAloudText({...answer, field: 'stock', value: 0}, 'answer'), /are 0 units in stock/);
  assert.match(buildReadAloudText({...answer, field: 'stock', value: 1}, 'answer'), /is 1 unit in stock/);
});

test('proposed changes identify both values and explicitly say they have not been applied', () => {
  const text = buildReadAloudText({...answer, previous: 1299}, 'preview');
  assert.match(text, /from 1299 rupees to 999 rupees/);
  assert.match(text, /has not been applied/);
  assert.match(text, /Select Confirm/);
  const stock = buildReadAloudText({...answer, field: 'stock', previous: 20, value: 0}, 'preview');
  assert.match(stock, /from 20 units to 0 units/);
});

test('Telugu readouts preserve the product and numeric values and explain pending changes', () => {
  assert.match(buildReadAloudText(answer, 'answer', 'te-IN'), /Black Hoodie.*999 రూపాయలు/);
  assert.match(buildReadAloudText({...answer, field: 'stock', value: 30}, 'answer', 'te-IN'), /స్టాక్‌లో 30 యూనిట్లు/);
  assert.match(buildReadAloudText({...answer, previous: 1299}, 'preview', 'te-IN'), /1299 రూపాయల నుంచి 999 రూపాయలకు/);
  assert.match(buildReadAloudText({...answer, field: 'stock', previous: 20}, 'preview', 'te-IN'), /ఇంకా అమలు కాలేదు/);
});

test('invalid or unsafe data cannot become a misleading readout', () => {
  for (const data of [null, {...answer, read_only: false}, {...answer, product: ''}, {...answer, field: 'orders'},
    {...answer, value: true}, {...answer, value: '999'}, {...answer, value: -1}, {...answer, value: 1.5},
    {...answer, value: Number.MAX_SAFE_INTEGER + 1}]) {
    assert.throws(() => buildReadAloudText(data, 'answer'));
  }
  assert.throws(() => buildReadAloudText(answer, 'preview'));
  assert.throws(() => buildReadAloudText(answer, 'confirm'));
});

test('voice selection prefers the requested region and never substitutes a different language', () => {
  const otherEnglish = {lang: 'en-US', default: true};
  assert.equal(selectReadAloudVoice([otherEnglish, english, telugu], 'en-IN'), english);
  assert.equal(selectReadAloudVoice([otherEnglish], 'en-IN'), otherEnglish);
  assert.equal(selectReadAloudVoice([otherEnglish], 'te-IN'), null);
  assert.equal(selectReadAloudVoice([{lang: 'te_IN'}], 'te-IN').lang, 'te_IN');
  assert.equal(readAloudLanguage('unknown'), 'en-IN');
  assert.equal(readAloudLanguage('te-IN'), 'te-IN');
});

test('explicit playback creates only a speech utterance, and completion returns to idle', t => {
  const f = fixture(); t.after(() => f.player.dispose());
  assert.equal(f.spoken.length, 0);
  f.player.play('Current price: 999 rupees.', 'en-IN');
  assert.equal(f.spoken.length, 1);
  assert.equal(f.spoken[0].text, 'Current price: 999 rupees.');
  assert.equal(f.spoken[0].voice, english);
  assert.equal(f.spoken[0].lang, 'en-IN');
  f.spoken[0].onstart(); assert.equal(f.states.at(-1), 'speaking');
  f.spoken[0].onend(); assert.equal(f.states.at(-1), 'idle');
  assert.equal(f.cancelled, 0);
  assert.deepEqual(f.errors, []);
});

test('stop cancels owned playback and ignores delayed events', t => {
  const f = fixture(); t.after(() => f.player.dispose());
  f.player.play('Read an answer.');
  const start = f.spoken[0].onstart, error = f.spoken[0].onerror;
  f.player.stop();
  assert.equal(f.cancelled, 1);
  const states = [...f.states];
  start(); error({error: 'private-error'});
  assert.deepEqual(f.states, states);
  assert.deepEqual(f.errors, []);
});

test('a second readout replaces the first without allowing its late events to change state', t => {
  const f = fixture(); t.after(() => f.player.dispose());
  f.player.play('First.'); const end = f.spoken[0].onend;
  f.player.play('Second.', 'te-IN');
  assert.equal(f.cancelled, 1);
  assert.equal(f.spoken[1].voice, telugu);
  f.spoken[1].onstart(); end();
  assert.equal(f.states.at(-1), 'speaking');
});

test('voices loaded after the click can start playback without another click', t => {
  const f = fixture(); t.after(() => f.player.dispose());
  f.setVoices([]);
  f.player.play('A Telugu answer.', 'te-IN');
  assert.equal(f.states.at(-1), 'loading');
  f.setVoices([telugu]);
  assert.equal(f.spoken.length, 1);
  assert.equal(f.spoken[0].voice, telugu);
  assert.equal(f.listeners.size, 0);
});

test('stopping during voice discovery prevents later automatic playback', async t => {
  const f = fixture({voiceWaitMs: 10}); t.after(() => f.player.dispose());
  f.setVoices([]); f.player.play('Answer.');
  f.player.stop(); f.setVoices([english]);
  await delay(25);
  assert.equal(f.spoken.length, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.states.at(-1), 'idle');
  assert.deepEqual(f.errors, []);
});

test('missing Telugu voices produce a clear fallback message without reading through an English voice', async t => {
  const f = fixture({voiceWaitMs: 10}); t.after(() => f.player.dispose());
  f.setVoices([english]); f.player.play('సమాధానం.', 'te-IN');
  await delay(25);
  assert.equal(f.spoken.length, 0);
  assert.match(f.errors[0], /Telugu voice.*Choose English/);
  assert.equal(f.states.at(-1), 'idle');
  assert.equal(f.listeners.size, 0);
});

test('a browser that never starts speaking cannot leave the controls stuck', async t => {
  const f = fixture({startTimeoutMs: 10}); t.after(() => f.player.dispose());
  f.player.play('Answer.'); await delay(25);
  assert.equal(f.states.at(-1), 'idle');
  assert.match(f.errors[0], /did not start speaking/);
  assert.equal(f.cancelled, 1);
});

test('playback has a bounded duration even when the browser never sends an end event', async t => {
  const f = fixture({maxPlaybackMs: 10}); t.after(() => f.player.dispose());
  f.player.play('Answer.'); f.spoken[0].onstart(); await delay(25);
  assert.equal(f.states.at(-1), 'idle');
  assert.match(f.errors[0], /time limit/);
  assert.equal(f.cancelled, 1);
});

test('browser errors are sanitized and intentional interruptions do not report a failure', t => {
  const f = fixture(); t.after(() => f.player.dispose());
  f.player.play('Answer.'); f.spoken[0].onerror({error: 'private-platform-detail'});
  assert.match(f.errors[0], /could not play/);
  assert.doesNotMatch(f.errors[0], /private-platform-detail/);
  f.errors.length = 0;
  f.player.play('Another answer.'); f.spoken[1].onerror({error: 'interrupted'});
  assert.equal(f.states.at(-1), 'idle'); assert.deepEqual(f.errors, []);
});

test('dispose releases pending voice listeners and never invokes callbacks again', async () => {
  const f = fixture({voiceWaitMs: 10});
  f.setVoices([]); f.player.play('Answer.'); f.player.dispose();
  const states = [...f.states];
  f.setVoices([english]); f.player.play('Do not play.'); await delay(25);
  assert.equal(f.spoken.length, 0);
  assert.equal(f.listeners.size, 0);
  assert.deepEqual(f.states, states);
  assert.deepEqual(f.errors, []);
});

test('unsupported playback APIs fail gracefully without attempting to speak', () => {
  assert.equal(speechPlaybackSupported(null, undefined), false);
  const errors = [], player = createSpeechPlayback({synthesis: null, Utterance: undefined, onError: message => errors.push(message)});
  player.play('Answer.'); player.dispose();
  assert.match(errors[0], /unavailable in this browser/);
});

test('empty, oversized or unsupported-language playback requests are rejected', t => {
  const f = fixture(); t.after(() => f.player.dispose());
  for (const [text, language] of [['', 'en-IN'], ['x'.repeat(1501), 'en-IN'], ['Answer.', 'xx-XX']]) {
    f.player.play(text, language);
  }
  assert.equal(f.spoken.length, 0);
  assert.equal(f.errors.length, 3);
});
