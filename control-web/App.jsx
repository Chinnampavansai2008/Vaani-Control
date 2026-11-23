import React, {useEffect, useRef, useState} from 'react';
import {createSarvamRecording} from './recording.js';

async function api(path, body, signal) {
  let response;
  try {
    response = await fetch('/api/' + path, {
      method: body === undefined ? 'GET' : 'POST', signal,
      headers: {'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Could not reach the backend. Check that the project is running.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) throw new Error(typeof data?.detail === 'string' ? data.detail : 'The backend request failed. Please try again.');
  return data;
}

export default function App() {
  const [text, setText] = useState('Change black hoodie price to 899');
  const [preview, setPreview] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState('browser');
  const [language, setLanguage] = useState('en-IN');
  const [sarvamConfigured, setSarvamConfigured] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [speechNote, setSpeechNote] = useState('');
  const speech = useRef(null);
  const session = useRef(0);
  const active = phase !== 'idle';

  useEffect(() => {
    const controller = new AbortController();
    api('history', undefined, controller.signal).then(setHistory).catch(e => {
      if (e.name !== 'AbortError') setError(e.message);
    });
    api('speech/status', undefined, controller.signal).then(data => setSarvamConfigured(data.sarvam_configured === true)).catch(e => {
      if (e.name !== 'AbortError') { setSarvamConfigured(false); setError(e.message); }
    });
    return () => {
      controller.abort(); session.current++; speech.current?.cancel();
    };
  }, []);

  async function run(action) {
    setBusy(true); setError('');
    try { await action(); setHistory(await api('history')); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function cancelSpeech() {
    session.current++; speech.current?.cancel(); speech.current = null;
    setPhase('idle'); setSpeechNote('Recording cancelled. Late transcript results will be discarded.');
  }

  function startSpeech() {
    setError(''); setPreview(null); setSpeechNote('');
    const id = ++session.current;
    const current = () => id === session.current;
    const onTranscript = transcript => {
      if (!current()) return;
      setText(transcript); setPreview(null);
      setSpeechNote('Transcript ready. Review or edit it, then click Preview.');
    };
    if (provider === 'sarvam') {
      speech.current = createSarvamRecording({
        language,
        onPhase: value => { if (current()) setPhase(value); },
        onTranscript, onError: message => { if (current()) setError(message); },
      });
      return;
    }
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { setError('Browser speech recognition is unavailable. Choose Sarvam, try Chrome or Edge, or type instead.'); return; }
    const recognition = new Speech();
    recognition.lang = language === 'unknown' ? 'en-IN' : language;
    recognition.interimResults = false; recognition.maxAlternatives = 1;
    let timer;
    recognition.onstart = () => {
      if (!current()) { recognition.abort(); return; }
      setPhase('recording'); timer = setTimeout(() => recognition.stop(), 30000);
    };
    recognition.onend = () => { clearTimeout(timer); if (current()) setPhase('idle'); };
    recognition.onerror = event => {
      if (current()) setError(event.error === 'not-allowed' ? 'Microphone permission was denied. Allow access in your browser.' : 'Browser speech: ' + event.error + '. Try again or type your command.');
    };
    recognition.onresult = event => onTranscript(event.results[0][0].transcript.replace(/[.!?]+$/, '').trim());
    speech.current = {stop: () => { setPhase('stopping'); recognition.stop(); }, cancel: () => { clearTimeout(timer); recognition.abort(); }};
    setPhase('requesting');
    try { recognition.start(); }
    catch { setPhase('idle'); setError('Could not start Browser speech. Try again or type your command.'); }
  }

  const phaseMessage = phase === 'requesting' ? 'Waiting for microphone access…' :
    phase === 'recording' ? 'Listening… Stop when finished. Recording ends automatically after 30 seconds.' :
    phase === 'transcribing' ? 'Transcribing your recording with Sarvam…' :
    phase === 'stopping' ? 'Finishing speech recognition…' : speechNote;

  return <main>
    <h1>VaaniControl</h1>
    <p>Speak, review and confirm changes to your connected store.</p>
    <section aria-labelledby="command-heading">
      <h2 id="command-heading">What would you like to change?</h2>
      <div className="speech-options">
        <label>Speech provider
          <select value={provider} disabled={active || busy} onChange={e => { setProvider(e.target.value); if(e.target.value === 'browser' && language === 'unknown') setLanguage('en-IN'); setSpeechNote(''); setError(''); }}>
            <option value="browser">Browser</option>
            <option value="sarvam" disabled={sarvamConfigured !== true}>Sarvam</option>
          </select>
        </label>
        <label>Language
          <select value={language} disabled={active || busy} onChange={e => setLanguage(e.target.value)}>
            <option value="en-IN">English</option>
            <option value="te-IN">Telugu</option>
            {provider === 'sarvam' && <option value="unknown">Detect automatically</option>}
          </select>
        </label>
      </div>
      {sarvamConfigured === null && <p>Checking speech configuration…</p>}
      {sarvamConfigured === false && <p>Sarvam is unavailable. Check SARVAM_API_KEY in your private control-api/.env and restart the backend. Browser speech and typing are available.</p>}
      <p>{provider === 'sarvam' ? 'Record up to 30 seconds. Your audio is sent to Sarvam for transcription.' : 'Use your browser’s speech recognition. Try: “Make the black hoodie cost 999 rupees.”'}</p>
      {!active && <button disabled={busy} onClick={startSpeech}>{provider === 'sarvam' ? 'Record with Sarvam' : 'Speak command'}</button>}
      {phase === 'recording' && <button onClick={() => speech.current?.stop()}>Stop {provider === 'sarvam' ? 'and transcribe' : 'listening'}</button>}
      {active && <button className="secondary" onClick={cancelSpeech}>Cancel recording</button>}
      <p role="status" aria-live="polite">{phaseMessage}</p>
      <label className="transcript-label" htmlFor="command">Review transcript or type a command</label>
      <textarea id="command" rows="3" value={text} disabled={active || busy} onChange={e => { setText(e.target.value); setPreview(null); }} />
      <button disabled={active || busy || !text.trim()} onClick={() => run(async () => setPreview(await api('preview', {text})))}>{busy ? 'Working…' : 'Preview'}</button>
      <p>Nothing changes until you review the proposed action and click Confirm.</p>
    </section>
    {error && <p role="alert" className="error">{error}</p>}
    {preview && <section>
      <h2>Confirm change</h2>
      <p>{preview.product}: {preview.field} {preview.previous} → {preview.value}</p>
      <button disabled={busy || active} onClick={() => run(async () => { await api('confirm/' + preview.id, {}); setPreview(null); })}>Confirm</button>
      <button className="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel change</button>
    </section>}
    <h2>Action history</h2>
    {!history.length && <p>No confirmed changes yet.</p>}
    {history.map(action => <article key={action.id}>
      <b>{action.product}</b>
      <p>{action.field}: {action.previous} → {action.value} · {action.status}</p>
      <small>{action.timestamp}</small>
      {action.status === 'applied' && <button disabled={busy || active} onClick={() => run(() => api('undo/' + action.id, {}))}>Undo</button>}
    </article>)}
  </main>;
}
