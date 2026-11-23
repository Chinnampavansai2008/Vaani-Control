import React, {useEffect, useRef, useState} from 'react';
import {buildReadAloudText, createSpeechPlayback, readAloudLanguage, speechPlaybackSupported} from './readAloud.js';

export default function ReadAloud({data, kind, language, disabled, controllerRef}) {
  const player = useRef(null);
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const supported = speechPlaybackSupported();
  const spokenLanguage = readAloudLanguage(language);
  const languageName = spokenLanguage === 'te-IN' ? 'Telugu' : 'English';
  const playing = state !== 'idle';

  useEffect(() => {
    const controller = createSpeechPlayback({onState: setState, onError: setMessage});
    player.current = controller; controllerRef.current = controller;
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      player.current = null;
    };
  }, [controllerRef]);
  useEffect(() => { player.current?.stop(); setMessage(''); }, [data, spokenLanguage, disabled]);

  const note = !supported ? 'Browser playback is unavailable. You can still read the details above.' : message ||
    (state === 'loading' ? `Looking for a ${languageName} voice…` : state === 'starting' ? 'Starting readout…' :
      state === 'speaking' ? 'Reading aloud…' : `Reads in ${languageName} using your browser’s voice service. Nothing is confirmed.`);
  return <div className="read-aloud">
    <button className="secondary" disabled={disabled || !supported} onClick={() => {
      setMessage('');
      if (playing) player.current?.stop();
      else {
        try { player.current?.play(buildReadAloudText(data, kind, spokenLanguage), spokenLanguage); }
        catch (error) { setMessage(error.message); }
      }
    }}>{playing ? 'Stop reading' : 'Read aloud'}</button>
    <p className="helper" role="status" aria-live="polite">{note}</p>
  </div>;
}
