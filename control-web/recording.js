export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

// Each recording owns its stream and upload. Cancel discards late results too.
export function createSarvamRecording({
  language, onPhase, onTranscript, onError,
  mediaDevices = globalThis.navigator?.mediaDevices,
  Recorder = globalThis.MediaRecorder,
  fetcher = globalThis.fetch?.bind(globalThis),
  maxDurationMs = 30000, requestTimeoutMs = 40000,
}) {
  let stream, recorder, durationTimer, requestTimer;
  let cancelled = false, stopping = false, totalBytes = 0, chunks = [];
  const upload = new AbortController();
  function release() {
    clearTimeout(durationTimer);
    stream?.getTracks().forEach(track => track.stop());
  }
  function cancel() {
    cancelled = true;
    clearTimeout(requestTimer);
    if (recorder?.state === 'recording') recorder.stop();
    upload.abort(); release(); chunks = [];
  }
  function fail(message) {
    if (cancelled) return;
    cancel(); onError(message); onPhase('idle');
  }
  function stop() {
    if (!cancelled && !stopping && recorder?.state === 'recording') {
      stopping = true;
      recorder.stop();
    }
  }
  async function finish() {
    release();
    if (cancelled) return;
    const mime = recorder.mimeType || chunks[0]?.type || '';
    const audio = new Blob(chunks, {type: mime}); chunks = [];
    if (!audio.size) return fail('No audio was recorded. Please try again.');
    if (audio.size > MAX_AUDIO_BYTES) return fail('Recording exceeds 5 MiB. Record a shorter command.');
    onPhase('transcribing');
    const form = new FormData();
    form.append('file', audio, mime.includes('mp4') ? 'voice.m4a' : 'voice.webm');
    form.append('language_code', language);
    let timedOut = false;
    requestTimer = setTimeout(() => { timedOut = true; upload.abort(); }, requestTimeoutMs);
    try {
      const response = await fetcher('/api/transcribe', {method: 'POST', body: form, signal: upload.signal});
      const data = await response.json().catch(() => null);
      if (cancelled) return;
      if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Transcription failed. Please try again.');
      if (typeof data?.transcript !== 'string' || !data.transcript.trim()) throw new Error('No speech was recognized. Please try again.');
      onTranscript(data.transcript.trim()); onPhase('idle');
    } catch (error) {
      if (!cancelled) fail(timedOut ? 'Transcription timed out. Try a shorter recording or Browser speech.' :
        error instanceof TypeError ? 'Could not reach the backend. Check that the project is running.' : error.message);
    } finally { clearTimeout(requestTimer); }
  }
  async function begin() {
    onPhase('requesting');
    if (!mediaDevices?.getUserMedia || !Recorder?.isTypeSupported) {
      return fail('Audio recording is unavailable. Try Chrome or Edge on localhost, or use Browser speech.');
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => Recorder.isTypeSupported(type));
    if (!mime) return fail('No supported recording format is available. Use Browser speech or another browser.');
    try {
      stream = await mediaDevices.getUserMedia({audio: true});
      if (cancelled) { release(); return; }
      recorder = new Recorder(stream, {mimeType: mime});
      recorder.ondataavailable = event => {
        if (cancelled || !event.data.size) return;
        totalBytes += event.data.size;
        if (totalBytes > MAX_AUDIO_BYTES) return fail('Recording exceeds 5 MiB. Record a shorter command.');
        chunks.push(event.data);
      };
      recorder.onerror = () => fail('The microphone recording failed. Try again or use Browser speech.');
      recorder.onstop = () => { void finish(); };
      recorder.start(1000); onPhase('recording');
      durationTimer = setTimeout(stop, maxDurationMs);
    } catch (error) {
      fail(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow access in your browser and try again.' :
        error.name === 'NotFoundError' ? 'No microphone was found. Connect one or type your command.' :
        'Could not start the microphone. Check that it is available and try again.');
    }
  }
  void begin();
  return {stop, cancel};
}
