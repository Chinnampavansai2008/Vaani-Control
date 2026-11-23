# Sarvam backend setup

The new `POST /api/transcribe` accepts multipart `file` and `language_code`
(`unknown`, `te-IN` or `en-IN`). It returns an editable transcript only. It does
not call Preview, Confirm, Gemini or the store, and does not write action history.
Browser speech and Gemini command interpretation remain separate.

From the project root install the updated backend dependencies:

```powershell
python -m pip install -r control-api/requirements.txt
```

Add `SARVAM_API_KEY=your_private_key` on a new line in `control-api/.env`.
Preserve GEMINI_API_KEY and GEMINI_MODEL. Never enter credentials in chat or
`.env.example`. Restart the existing backend/project instance after saving.
Do not start duplicate services. The backend port remains 8002, and Vite forwards
dashboard `/api` requests to it.

## Record from the dashboard

Open http://127.0.0.1:5174 in Chrome or Edge after restarting the project.
Choose Speech provider: Sarvam, then English, Telugu or Detect automatically.
The selector is enabled when GET /api/speech/status reports that a key is present;
this flag does not verify account access, quota or the key's validity.
Click Record with Sarvam, allow microphone access, speak and click Stop and transcribe.
The recording stops automatically at 30 seconds. Cancel recording discards late
transcript results and releases the microphone; an upload already sent may still
be processed by the provider. Your transcript remains editable. Preview and Confirm
are still separate deliberate actions. Browser speech remains available.

The provider request uses `https://api.sarvam.ai/speech-to-text`, the
`api-subscription-key` header, `language_code`, `model=saaras:v4` and
`mode=transcribe`. Limits: 5 MiB per upload; 5-second connect and 30-second
read/write/pool timeouts; no automatic transport retries. These are HTTP phase
timeouts, not a strict wall-clock deadline. The later recording UI must enforce
Sarvam's 30-second clip limit. Supported MIME types and size are checked locally;
Sarvam validates whether the actual media can be decoded.

## Verification

`python -m unittest discover -s control-api -p 'test_*.py' -v`

16 backend tests passed: eight existing command/Gemini-mock tests and eight
transcription/configuration tests. Transcription tests include an in-process ASGI HTTP
multipart upload and mocked Sarvam responses. They cover request field names,
Telugu/English language values, missing keys, invalid/empty/oversized uploads,
provider errors, timeouts, malformed responses and no store/history side effects.
10 frontend recording tests passed (`npm --prefix control-web test`). These cover
upload formatting, cancellation before permission and during upload, microphone
cleanup, empty/oversized audio, automatic stop, permission failures, unsupported
recording APIs, timeouts and provider errors. The frontend production build passed.

No live Sarvam audio request or real microphone test was performed during these
automated checks. User verification of real Telugu speech remains pending.
