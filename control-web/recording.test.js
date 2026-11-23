import test from 'node:test';
import assert from 'node:assert/strict';
import {createSarvamRecording, MAX_AUDIO_BYTES} from './recording.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t, overrides = {}) {
  const events = {phases: [], transcripts: [], errors: [], requests: [], tracksStopped: 0};
  const stream = {getTracks: () => [{stop() { events.tracksStopped++; }}]};
  class Recorder {
    static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
    constructor(input, options) { this.mimeType = options.mimeType; this.state = 'inactive'; events.recorder = this; }
    start() { this.state = 'recording'; }
    stop() {
      assert.equal(this.state, 'recording');
      this.state = 'inactive';
      this.ondataavailable?.({data: new Blob(['audio-frames'], {type: this.mimeType})});
      queueMicrotask(() => this.onstop?.());
    }
  }
  const options = {
    language: 'te-IN', Recorder,
    mediaDevices: {getUserMedia: async () => stream},
    onPhase: phase => events.phases.push(phase),
    onTranscript: text => events.transcripts.push(text),
    onError: message => events.errors.push(message),
    fetcher: async (url, options) => {
      events.requests.push({url, ...options});
      return {ok: true, json: async () => ({transcript: 'హూడీ ధర 999 చేయి'})};
    },
    ...overrides,
  };
  const controller = createSarvamRecording(options);
  t.after(() => controller.cancel());
  return {events, controller, stream};
}

test('stop uploads the complete recording; transcript does not execute an action', async t => {
  const {events, controller} = setup(t);
  await tick();
  assert.equal(events.requests.length, 0);
  assert.equal(events.phases.at(-1), 'recording');
  controller.stop(); controller.stop();
  await tick();
  assert.equal(events.requests.length, 1);
  const request = events.requests[0];
  assert.equal(request.url, '/api/transcribe');
  assert.equal(request.body.get('language_code'), 'te-IN');
  assert.equal(await request.body.get('file').text(), 'audio-frames');
  assert.equal(request.headers, undefined, 'Browser must supply the multipart boundary');
  assert.equal(events.transcripts[0], 'హూడీ ధర 999 చేయి');
  assert.equal(events.phases.at(-1), 'idle');
  assert.ok(events.tracksStopped);
});

test('cancel while waiting for permission releases a late microphone stream', async t => {
  let resolvePermission;
  const permission = new Promise(resolve => { resolvePermission = resolve; });
  const {events, controller, stream} = setup(t, {mediaDevices: {getUserMedia: () => permission}});
  controller.cancel(); resolvePermission(stream);
  await tick();
  assert.equal(events.requests.length, 0);
  assert.equal(events.transcripts.length, 0);
  assert.ok(events.tracksStopped);
});

test('cancel during upload aborts and ignores late results', async t => {
  let resolveResponse, signal;
  const {events, controller} = setup(t, {fetcher: async (_url, options) => {
    signal = options.signal;
    return new Promise(resolve => { resolveResponse = resolve; });
  }});
  await tick(); controller.stop(); await tick();
  controller.cancel();
  assert.equal(signal.aborted, true);
  resolveResponse({ok: true, json: async () => ({transcript: 'late result'})});
  await tick();
  assert.equal(events.transcripts.length, 0);
  assert.equal(events.errors.length, 0);
});

test('microphone permission errors are actionable', async t => {
  const {events} = setup(t, {mediaDevices: {getUserMedia: async () => { throw {name: 'NotAllowedError'}; }}});
  await tick();
  assert.match(events.errors[0], /permission was denied/);
  assert.equal(events.phases.at(-1), 'idle');
});

test('oversized recording is discarded before upload', async t => {
  const {events} = setup(t);
  await tick();
  events.recorder.ondataavailable({data: new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)])});
  await tick();
  assert.match(events.errors[0], /exceeds 5 MiB/);
  assert.equal(events.requests.length, 0);
  assert.ok(events.tracksStopped);
});

test('empty recordings are not uploaded', async t => {
  const {events, controller} = setup(t);
  await tick();
  events.recorder.stop = function() { this.state = 'inactive'; queueMicrotask(() => this.onstop()); };
  controller.stop(); await tick();
  assert.equal(events.requests.length, 0);
  assert.match(events.errors[0], /No audio/);
});

test('recording automatically stops at its duration limit', async t => {
  const {events} = setup(t, {maxDurationMs: 5});
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(events.requests.length, 1);
  assert.ok(events.tracksStopped);
});

test('upload timeout aborts and returns to idle', async t => {
  const {events, controller} = setup(t, {requestTimeoutMs: 5, fetcher: (_url, options) =>
    new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))))});
  await tick(); controller.stop();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.match(events.errors[0], /timed out/);
  assert.equal(events.phases.at(-1), 'idle');
});

test('provider errors show the backend message without changing the transcript', async t => {
  const {events, controller} = setup(t, {fetcher: async () => ({ok: false, json: async () => ({detail: 'Sarvam quota is unavailable.'})})});
  await tick(); controller.stop(); await tick();
  assert.equal(events.errors[0], 'Sarvam quota is unavailable.');
  assert.equal(events.transcripts.length, 0);
});

test('unsupported recording APIs fail without requesting microphone access', async t => {
  const {events} = setup(t, {Recorder: undefined});
  await tick();
  assert.match(events.errors[0], /recording is unavailable/);
  assert.equal(events.recorder, undefined);
});
