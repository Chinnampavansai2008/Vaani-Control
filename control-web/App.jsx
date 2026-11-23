import React, {useEffect, useRef, useState} from 'react';
import {createSarvamRecording} from './recording.js';
import {filterHistory} from './history.js';
import {downloadHistoryCsv} from './historyCsv.js';
import StoreConnection from './StoreConnection.jsx';
import {validateReadOnlyAnswer} from './readOnlyAnswer.js';
import ReadAloud from './ReadAloud.jsx';

const rupees = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', maximumFractionDigits: 0});
function displayValue(field, value) {
  return field === 'price' ? rupees.format(value) : Number(value).toLocaleString('en-IN') + ' units';
}
function displayTime(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
}

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
  const [answer, setAnswer] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState('browser');
  const [language, setLanguage] = useState('en-IN');
  const [sarvamConfigured, setSarvamConfigured] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [speechNote, setSpeechNote] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const filteredHistory = filterHistory(history, {search, type: typeFilter, status: statusFilter});
  const speech = useRef(null);
  const playback = useRef(null);
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
    return () => { controller.abort(); session.current++; speech.current?.cancel(); };
  }, []);

  async function run(action, {refreshHistory = true} = {}) {
    playback.current?.stop();
    setBusy(true); setError('');
    try { await action(); if (refreshHistory) setHistory(await api('history')); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function cancelSpeech() {
    session.current++; speech.current?.cancel(); speech.current = null;
    setPhase('idle'); setSpeechNote('Recording cancelled. Late transcript results will be discarded.');
  }

  function startSpeech() {
    playback.current?.stop();
    setError(''); setPreview(null); setAnswer(null); setSpeechNote('');
    const id = ++session.current;
    const current = () => id === session.current;
    const onTranscript = transcript => {
      if (!current()) return;
      setText(transcript); setPreview(null); setAnswer(null);
      setSpeechNote('Transcript ready. Review it, then use Ask store for a question or Preview for a change.');
    };
    if (provider === 'sarvam') {
      speech.current = createSarvamRecording({
        language,
        onPhase: value => { if (current()) setPhase(value); },
        onTranscript,
        onError: message => { if (current()) setError(message); },
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
    <header className="page-header">
      <div><p className="eyebrow">YOUR VOICE. YOUR STORE.</p><h1>VaaniControl<span className="brand-dot">.</span></h1>
        <p className="page-description">Speak a change. Review the details. Stay in control.</p></div>
      <span className="language-badge">English <span aria-hidden="true">·</span> తెలుగు</span>
    </header>
    <StoreConnection />
    {error && <div role="alert" className="error"><strong>Let’s check that.</strong> {error}</div>}
    <div className="workspace-grid">
    <section className="command-panel" aria-labelledby="command-heading">
      <div className="panel-heading"><span className="step-number" aria-hidden="true">01</span><div><p className="eyebrow">COMMAND WORKSPACE</p><h2 id="command-heading">Speak a change</h2></div></div>
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
      {sarvamConfigured === null && <p className="helper">Checking speech configuration…</p>}
      {sarvamConfigured === false && <p className="helper">Sarvam is unavailable. Browser speech and typing are available. To enable Sarvam, configure your private key and restart the backend.</p>}
      <div className={'recording-area' + (active ? ' recording-area--active' : '')}>
        <p className="recording-hint">{provider === 'sarvam' ? 'Record up to 30 seconds. Sarvam transcribes your audio.' : 'Try: “Make the black hoodie cost 999 rupees.”'}</p>
        <div className="button-row">
          {!active && <button className="record-button" disabled={busy} onClick={startSpeech}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>{provider === 'sarvam' ? 'Record with Sarvam' : 'Speak command'}</button>}
          {phase === 'recording' && <button className="stop-button" onClick={() => speech.current?.stop()}><span className="stop-icon" aria-hidden="true"/>Stop {provider === 'sarvam' ? 'and transcribe' : 'listening'}</button>}
          {active && <button className="secondary" onClick={cancelSpeech}>Cancel recording</button>}
        </div>
        <p role="status" aria-live="polite" className={'speech-status' + (active ? ' speech-status--active' : '')}>{phaseMessage || 'Your transcript will appear below. You can edit it before asking or preparing a change.'}</p>
      </div>
      <label className="transcript-label" htmlFor="command">Review transcript or type a command or question</label>
      <textarea id="command" rows="3" value={text} disabled={active || busy} onChange={e => { setText(e.target.value); setPreview(null); setAnswer(null); }} />
      <div className="preview-row"><p className="helper">Ask store to read a value. Preview to prepare a change.</p><div className="command-actions">
        <button className="secondary" disabled={active || busy || !text.trim()} onClick={() => {
          setPreview(null); setAnswer(null);
          run(async () => setAnswer(validateReadOnlyAnswer(await api('query', {text}))), {refreshHistory: false});
        }}>Ask store</button>
        <button disabled={active || busy || !text.trim()} onClick={() => {
          setAnswer(null); setPreview(null);
          run(async () => setPreview(await api('preview', {text})));
        }}>{busy ? 'Working…' : 'Preview'}</button>
      </div></div>
    </section>
    <section className="review-panel" aria-labelledby="review-heading">
      <div className="panel-heading"><span className="step-number" aria-hidden="true">02</span><div><p className="eyebrow">{answer ? 'CATALOG LOOKUP' : 'YOU MAKE THE CALL'}</p><h2 id="review-heading">{answer ? 'Store answer' : 'Review & confirm'}</h2></div></div>
      {answer ? <div className="store-answer" role="status" aria-live="polite">
        <p className="product-name">{answer.product}</p>
        <span className="field-label">{answer.field === 'price' ? 'Current price' : 'Current stock'}</span>
        <p className="answer-value">{displayValue(answer.field, answer.value)}</p>
        <p className="helper">Read-only answer. No store change was made, and nothing was added to action history.</p>
        <ReadAloud data={answer} kind="answer" language={language} disabled={active || busy} controllerRef={playback} />
        <button className="secondary" onClick={() => setAnswer(null)}>Dismiss answer</button>
      </div> : preview ? <>
      <p className="product-name">{preview.product}</p>
      <span className="field-label">{preview.field === 'price' ? 'Price update' : 'Stock update'}</span>
      <dl className="value-comparison"><div><dt>Current</dt><dd>{displayValue(preview.field, preview.previous)}</dd></div><div><dt>Proposed</dt><dd>{displayValue(preview.field, preview.value)}</dd></div></dl>
      {preview.field === 'price' && <p className="helper">Percentage changes round to the nearest rupee; half a rupee rounds up.</p>}
      <p className="helper">Confirm to apply this change to your store. It will be recorded in history.</p>
      <ReadAloud data={preview} kind="preview" language={language} disabled={active || busy} controllerRef={playback} />
      <div className="button-row">
      <button disabled={busy || active} onClick={() => run(async () => { await api('confirm/' + preview.id, {}); setPreview(null); })}>Confirm</button>
      <button className="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel change</button>
      </div>
      </> : <div className="review-placeholder">
        <div className="review-symbol" aria-hidden="true">✓</div>
        <h3>Your answer or next change appears here</h3>
        <p>Select Ask store for a current price or stock. Select Preview to review a proposed change.</p>
        <div className="confirmation-note">Nothing changes until you click Confirm.</div>
      </div>}
    </section>
    </div>
    <section className="history-section" aria-labelledby="history-heading">
      <div className="history-heading"><div><p className="eyebrow">A CLEAR RECORD</p><h2 id="history-heading">Action history</h2></div><span className="history-count" role="status" aria-live="polite">{filteredHistory.length} of {history.length} actions</span></div>
      <div className="history-controls">
        <div><label htmlFor="history-search">Search product</label><input id="history-search" type="search" placeholder="Product name" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div><label htmlFor="history-type">Action type</label><select id="history-type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="all">All types</option><option value="price">Price</option><option value="stock">Stock</option></select></div>
        <div><label htmlFor="history-status">Action status</label><select id="history-status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="all">All statuses</option><option value="applied">Applied</option><option value="undone">Undone</option></select></div>
        <div className="history-buttons">
          <button className="secondary" onClick={() => { setSearch(''); setTypeFilter('all'); setStatusFilter('all'); }}>Clear filters</button>
          <button className="secondary" disabled={busy || filteredHistory.length === 0} onClick={() => {
            try { downloadHistoryCsv(filteredHistory); }
            catch { setError('The CSV download could not start. Please try again in your browser.'); }
          }}>Download CSV</button>
        </div>
      </div>
      {history.length === 0 ? <p className="empty-history">No confirmed changes yet. Your first action will appear here.</p> : filteredHistory.length === 0 ? <p className="empty-history">No matching actions. Try another search or clear the filters.</p> : null}
      <div className="history-list">{filteredHistory.map(action => <article key={action.id} className="history-item">
        <div className="history-main"><h3>{action.product}</h3><p><span className="history-field">{action.field === 'price' ? 'Price' : 'Stock'}</span> {displayValue(action.field, action.previous)} <span className="value-arrow" aria-label="changed to">→</span> {displayValue(action.field, action.value)}</p><time dateTime={action.timestamp}>{displayTime(action.timestamp)}</time></div>
        <div className="history-actions"><span className={'status-pill status-pill--' + action.status}>{action.status === 'applied' ? 'Applied' : action.status === 'undone' ? 'Undone' : action.status}</span>
        {action.status === 'applied' && <button className="secondary" disabled={busy || active} onClick={() => run(() => api('undo/' + action.id, {}))}>Undo</button>}</div>
      </article>)}</div>
    </section>
  </main>;
}
