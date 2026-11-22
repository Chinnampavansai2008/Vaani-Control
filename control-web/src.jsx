import React,{useState,useEffect,useRef} from 'react';import{createRoot}from'react-dom/client';import './style.css';
function App(){const[text,T]=useState('Change black hoodie price to 899'),[preview,P]=useState(null),[history,H]=useState([]),[error,E]=useState(''),[busy,B]=useState(false);
const recognition=useRef(null),[listening,L]=useState(false);
useEffect(()=>()=>recognition.current?.abort(),[]);
function listen(){
 const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Speech){E('Speech recognition unavailable. Try Chrome or Edge, or type instead.');return;}
 const rec=new Speech();recognition.current=rec;rec.lang='en-IN';rec.interimResults=false;
 rec.onstart=()=>L(true);rec.onend=()=>L(false);
 rec.onerror=e=>{E('Microphone: '+e.error);L(false)};
 rec.onresult=e=>{T(e.results[0][0].transcript.replace(/[.!?]+$/,'').trim());P(null);E('')};
 try{rec.start()}catch(e){E(e.message)}
}
async function api(path,data){let r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});let j=await r.json();if(!r.ok)throw Error(typeof j.detail==='string'?j.detail:JSON.stringify(j.detail));return j}
async function run(fn){B(true);E('');try{await fn();H(await api('history'))}catch(e){E(e.message)}finally{B(false)}}useEffect(()=>{run(async()=>{})},[]);
return <main><h1>VaaniControl</h1><p>Connected demo clothing store · Person 2 workspace</p><section><h2>What would you like to change?</h2><p>Speak, review the transcript, then preview and confirm.</p><button disabled={busy} onClick={()=>listening?recognition.current?.stop():listen()}>{listening?"Stop listening":"Speak command"}</button><p>Say: Change black hoodie price to 899. Allow microphone access.</p><input aria-label="Command" size="60" value={text} onChange={e=>{T(e.target.value);P(null)}}/><button disabled={busy} onClick={()=>run(async()=>P(await api('preview',{text})))}>Preview</button><p>Browser voice capture is included. Gemini and Sarvam are future integrations. Review or edit your transcript before Preview.</p></section><p role="alert" className="error">{error}</p>{preview&&<section><h2>Confirm change</h2><p>{preview.product}: {preview.field} {preview.previous} → {preview.value}</p><button disabled={busy} onClick={()=>run(async()=>{await api('confirm/'+preview.id,{});P(null)})}>Confirm</button><button onClick={()=>P(null)}>Cancel</button></section>}<h2>Action history</h2>{history.map(a=><article key={a.id}><b>{a.product}</b><p>{a.field}: {a.previous} → {a.value} · {a.status}</p><small>{a.timestamp}</small>{a.status==='applied'&&<button disabled={busy} onClick={()=>run(()=>api('undo/'+a.id,{}))}>Undo</button>}</article>)}</main>}
createRoot(document.getElementById('root')).render(<App/>);
