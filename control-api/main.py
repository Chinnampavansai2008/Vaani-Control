import os,json,re,uuid,threading
from dotenv import load_dotenv
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from fastapi import FastAPI,HTTPException,UploadFile,File,Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Load environment variables (including GEMINI_API_KEY and SARVAM_API_KEY if present)
load_dotenv(dotenv_path=Path(__file__).with_name(".env"))
from gemini_parser import interpret
from sarvam_transcriber import transcribe_audio
from store_status import StoreStatus, inspect_store
from product_queries import ProductAnswer, answer_query

app=FastAPI(title="VaaniControl")
app.add_middleware(CORSMiddleware,allow_origins=["http://localhost:5174"],allow_methods=["*"],allow_headers=["*"])
lock=threading.Lock()
path=Path(__file__).with_name("history.json")
history=json.loads(path.read_text()) if path.exists() else []
pending={}
def store(route,method="GET",data=None):
 req=Request(os.getenv("STORE_API_URL","http://127.0.0.1:8001")+route,data=json.dumps(data).encode() if data is not None else None,method=method,headers={"Content-Type":"application/json","X-API-Key":os.getenv("STORE_API_KEY","local-demo-key")})
 try:
  with urlopen(req,timeout=10) as f:return json.load(f)
 except HTTPError as e: raise HTTPException(e.code,e.read().decode())
 except URLError: raise HTTPException(502,"Store unavailable. Start store-api.")
@app.get("/api/store/status", response_model=StoreStatus)
def store_status():
 return inspect_store(store, os.getenv("STORE_API_URL", "http://127.0.0.1:8001"))

def save():
 temp=path.with_suffix(".tmp"); temp.write_text(json.dumps(history,indent=2)); temp.replace(path)
class Command(BaseModel):
 text:str

@app.post("/api/query", response_model=ProductAnswer)
def query(c:Command):
 text=c.text.strip()
 if not text or len(text)>2000: raise HTTPException(422,"Enter a question of 1–2000 characters.")
 try:
  products=store("/api/products")
 except Exception:
  raise HTTPException(502,"Could not read the store catalog. Check the Connected Store panel.") from None
 return answer_query(text,products)

@app.post("/api/preview")
def preview(c:Command):
 text=c.text.lower().strip().rstrip(".!?").strip()
 if not text or len(text)>2000: raise HTTPException(422,"Enter a command of 1–2000 characters.")
 m=re.fullmatch(r"(?:change|set|update) (.+?) (price|stock) to [₹$]?(\d+)",text)
 products=store("/api/products")
 if m:
  name,field,value=m.groups()
  matches=[p for p in products if p["name"].lower()==name]
  if len(matches)!=1: raise HTTPException(422,"Use an exact product name")
  p=matches[0]; value=int(value)
 else:
  p,field,value=interpret(c.text.strip(),products)
 a={"id":str(uuid.uuid4()),"product_id":p["id"],"product":p["name"],"field":field,"previous":p[field],"value":value,"status":"pending"}
 with lock: pending[a["id"]]=a
 return a
@app.post("/api/confirm/{aid}")
def confirm(aid:str):
 with lock:
  if aid not in pending: raise HTTPException(404,"Preview missing or already confirmed")
  a=pending[aid]
  store(f"/api/integrations/products/{a['product_id']}","PATCH",{"field":a["field"],"value":a["value"],"expected":a["previous"]})
  a.update(status="applied",timestamp=datetime.now(timezone.utc).isoformat()); history.append(a); del pending[aid]; save(); return a
@app.get("/api/history")
def get_history():
 with lock:return list(reversed(history))
@app.post("/api/undo/{aid}")
def undo(aid:str):
    with lock:
        a=next((x for x in history if x["id"]==aid),None)
        if not a or a["status"]!="applied": raise HTTPException(409,"Action unavailable for undo")
        store(f"/api/integrations/products/{a['product_id']}","PATCH",{"field":a["field"],"value":a["previous"],"expected":a["value"]})
        a.update(status="undone",undone_at=datetime.now(timezone.utc).isoformat()); save(); return a

# Sarvam transcription endpoint
@app.get("/api/speech/status")
async def speech_status():
    return {"sarvam_configured": bool(os.getenv("SARVAM_API_KEY", "").strip())}

@app.post("/api/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language_code: str = Form(default="unknown")
):
    return await transcribe_audio(file, language_code)
