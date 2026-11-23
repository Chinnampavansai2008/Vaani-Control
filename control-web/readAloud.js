// Playback only. This module never reads a microphone or calls an application API.
export function readAloudLanguage(language) {
  return language === 'te-IN' ? 'te-IN' : 'en-IN';
}

export function selectReadAloudVoice(voices, language) {
  const locale = value => String(value || '').replaceAll('_', '-').toLowerCase();
  const wanted = locale(language);
  const matches = voices.filter(voice => locale(voice.lang).split('-')[0] === wanted.split('-')[0]);
  return matches.find(voice => locale(voice.lang) === wanted) || matches.find(voice => voice.default) || matches[0] || null;
}

export function buildReadAloudText(data, kind, language = 'en-IN') {
  const number = value => Number.isSafeInteger(value) && value >= 0;
  if (!data || typeof data.product !== 'string' || !data.product.trim() || data.product.length > 500 ||
      !['price', 'stock'].includes(data.field) || !number(data.value) ||
      !['answer', 'preview'].includes(kind) ||
      (kind === 'answer' ? data.read_only !== true : !number(data.previous))) {
    throw new Error('A valid store answer or proposed change is needed before reading aloud.');
  }
  const product = data.product.trim(), telugu = readAloudLanguage(language) === 'te-IN';
  if (kind === 'answer') {
    if (telugu) return data.field === 'price' ? `${product}. ప్రస్తుత ధర ${data.value} రూపాయలు.` :
      `${product}. ప్రస్తుతం స్టాక్‌లో ${data.value} యూనిట్లు ఉన్నాయి.`;
    return data.field === 'price' ? `${product}. The current price is ${data.value} rupees.` :
      `${product}. There ${data.value === 1 ? 'is 1 unit' : `are ${data.value} units`} in stock.`;
  }
  if (telugu) return data.field === 'price' ?
    `${product}. ధరను ${data.previous} రూపాయల నుంచి ${data.value} రూపాయలకు మార్చడం ప్రతిపాదించబడింది. ఈ మార్పు ఇంకా అమలు కాలేదు. అమలు చేయడానికి కన్ఫర్మ్ ఎంచుకోండి.` :
    `${product}. స్టాక్‌ను ${data.previous} యూనిట్ల నుంచి ${data.value} యూనిట్లకు మార్చడం ప్రతిపాదించబడింది. ఈ మార్పు ఇంకా అమలు కాలేదు. అమలు చేయడానికి కన్ఫర్మ్ ఎంచుకోండి.`;
  const units = data.field === 'price' ? 'rupees' : 'units';
  return `Proposed change for ${product}. Change the ${data.field} from ${data.previous} ${units} to ${data.value} ${units}. This change has not been applied. Select Confirm to apply it.`;
}

export function speechPlaybackSupported(synthesis = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance) {
  return !!synthesis && ['speak', 'cancel', 'getVoices'].every(name => typeof synthesis[name] === 'function') && typeof Utterance === 'function';
}

export function createSpeechPlayback({
  synthesis = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance,
  onState = () => {}, onError = () => {},
  voiceWaitMs = 2500, startTimeoutMs = 8000, maxPlaybackMs = 45000,
} = {}) {
  let generation = 0, disposed = false, utterance = null, timer, voiceListener;
  const emit = state => { if (!disposed) onState(state); };
  function removeVoiceListener() {
    if (voiceListener) synthesis?.removeEventListener?.('voiceschanged', voiceListener);
    voiceListener = null;
  }
  function reset(cancel) {
    generation++; clearTimeout(timer); removeVoiceListener();
    const owned = utterance; utterance = null;
    if (owned) {
      owned.onstart = owned.onend = owned.onerror = null;
      if (cancel) { try { synthesis.cancel(); } catch { /* Already unavailable. */ } }
    }
  }
  function stop() { reset(true); emit('idle'); }
  function fail(message) { reset(true); emit('idle'); if (!disposed) onError(message); }
  function play(text, language = 'en-IN') {
    if (disposed) return;
    stop();
    if (!speechPlaybackSupported(synthesis, Utterance)) return fail('Read aloud is unavailable in this browser. The written answer is still available.');
    if (typeof text !== 'string' || !text.trim() || text.length > 1500 || !['en-IN', 'te-IN'].includes(language)) {
      return fail('Could not prepare the readout. Choose English or Telugu and try again.');
    }
    const token = generation, current = () => !disposed && generation === token;
    const languageName = language === 'te-IN' ? 'Telugu' : 'English';
    function findVoice() {
      try { return selectReadAloudVoice(synthesis.getVoices(), language); }
      catch { return null; }
    }
    function begin(voice) {
      if (!current()) return;
      clearTimeout(timer); removeVoiceListener();
      try {
        utterance = new Utterance(text);
        utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 1; utterance.pitch = 1;
        utterance.onstart = () => {
          if (!current()) return;
          clearTimeout(timer); emit('speaking');
          timer = setTimeout(() => { if (current()) fail('Reading stopped after its time limit. You can read the details on screen.'); }, maxPlaybackMs);
        };
        utterance.onend = () => { if (current()) { reset(false); emit('idle'); } };
        utterance.onerror = event => {
          if (!current()) return;
          if (['canceled', 'interrupted'].includes(event.error)) { reset(false); emit('idle'); }
          else fail('The browser could not play the readout. Check your sound settings or use the written details.');
        };
        emit('starting');
        timer = setTimeout(() => { if (current()) fail('The browser did not start speaking. Try again or use the written details.'); }, startTimeoutMs);
        synthesis.speak(utterance);
      } catch { fail('The browser could not play the readout. Check your sound settings or use the written details.'); }
    }
    const voice = findVoice();
    if (voice) return begin(voice);
    emit('loading');
    voiceListener = () => { const found = findVoice(); if (current() && found) begin(found); };
    synthesis.addEventListener?.('voiceschanged', voiceListener);
    timer = setTimeout(() => {
      if (!current()) return;
      const found = findVoice();
      if (found) begin(found);
      else fail(`Your browser does not currently provide a ${languageName} voice. ${language === 'te-IN' ? 'Choose English above or use the written details.' : 'Use the written details or try another browser.'}`);
    }, voiceWaitMs);
  }
  function dispose() { disposed = true; reset(true); }
  return {play, stop, dispose};
}
