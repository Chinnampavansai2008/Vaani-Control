"""Transcription only: this module never changes products or executes commands."""
import os

import httpx
from fastapi import HTTPException, UploadFile

MAX_BYTES = 5 * 1024 * 1024
ALLOWED_TYPES = {"audio/webm", "video/webm", "audio/wav", "audio/x-wav", "audio/mpeg",
                 "audio/mp3", "audio/ogg", "audio/mp4", "audio/x-m4a", "audio/flac"}


async def transcribe_audio(file: UploadFile, language_code: str):
    if language_code not in {"unknown", "te-IN", "en-IN"}:
        raise HTTPException(422, "Choose Telugu, English or automatic language detection.")
    key = os.getenv("SARVAM_API_KEY", "").strip()
    if not key:
        raise HTTPException(503, "Sarvam is not configured. Add SARVAM_API_KEY privately to control-api/.env and restart the backend. Browser speech still works.")
    media_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if media_type not in ALLOWED_TYPES:
        raise HTTPException(415, "Unsupported recording format. Use WebM, WAV, MP3, OGG, M4A or FLAC.")
    content = await file.read(MAX_BYTES + 1)
    if not content:
        raise HTTPException(422, "The recording is empty. Record again before uploading.")
    if len(content) > MAX_BYTES:
        raise HTTPException(413, "Recording exceeds the 5 MiB upload limit.")
    suffix = {"audio/webm": "webm", "video/webm": "webm", "audio/wav": "wav",
              "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3",
              "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/flac": "flac"}[media_type]
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0),
                                     transport=httpx.AsyncHTTPTransport(retries=0)) as client:
            response = await client.post(
                "https://api.sarvam.ai/speech-to-text",
                headers={"api-subscription-key": key},
                files={"file": ("recording." + suffix, content, media_type)},
                data={"language_code": language_code, "model": "saaras:v4", "mode": "transcribe"},
            )
    except httpx.TimeoutException:
        raise HTTPException(504, "Sarvam timed out. Your store has not been changed; try recording again.") from None
    except httpx.RequestError:
        raise HTTPException(502, "Could not connect to Sarvam. Check your connection or use Browser speech.") from None
    if response.status_code in (401, 403):
        raise HTTPException(503, "Sarvam rejected the credentials. Check your private key and account access.")
    if response.status_code == 429:
        raise HTTPException(503, "Sarvam quota is unavailable. Try later or use Browser speech.")
    if response.status_code in (400, 413, 415, 422):
        raise HTTPException(422, "Sarvam could not read this recording. Record a shorter clip in a supported format.")
    if response.status_code != 200:
        raise HTTPException(502, "Sarvam transcription is unavailable. Try later or use Browser speech.")
    try:
        data = response.json()
    except ValueError:
        raise HTTPException(502, "Sarvam returned an unreadable response.") from None
    if not isinstance(data, dict) or not isinstance(data.get("transcript"), str):
        raise HTTPException(502, "Sarvam returned an invalid transcript.")
    transcript = data["transcript"].strip()
    if not transcript:
        raise HTTPException(422, "No speech was recognized. Record again or type your command.")
    detected = data.get("language_code")
    return {"transcript": transcript, "language_code": detected if isinstance(detected, str) else None}
