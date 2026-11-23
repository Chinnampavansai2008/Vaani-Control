# VaaniControl + Vaani Fashion

Local hackathon prototype: an independent clothing store connected to a voice administration dashboard. Voice becomes an editable transcript, then a validated preview. Only Confirm changes the store; history and conditional Undo record the result. Checkout is a demo and collects no real payment.

## Windows setup

Use Python 3.10+ and a current Node.js LTS release. The store uses Vite 7, requiring Node.js 20.19+, 22.12+, or a newer supported LTS version. Open a terminal in the repository root containing all four application folders.

```powershell
python -m pip install -r store-api/requirements.txt -r control-api/requirements.txt
npm --prefix store-web ci
npm --prefix control-web ci
```

## Private configuration

Keep `.env` files local; never put real credentials in `.env.example` or Git. Preserve existing working configuration. If a `.env` file does not exist, create it from the example in that same folder. Do not overwrite an existing `.env`.

- `control-api/.env`: set your private `GEMINI_API_KEY`, optionally an available `GEMINI_MODEL`, and `SARVAM_API_KEY`. For this combined local demo, set `STORE_API_URL=http://127.0.0.1:8001` and `STORE_API_KEY=local-demo-key`.
- `store-api/.env`: the `STORE_API_KEY` must match the control backend. The example uses `local-demo-key` and `STORE_ADMIN_KEY=local-admin-key`, both public local-demo values. Seller studio accepts the admin key; it is different from the voice integration key and the AI keys.
- `store-web/.env`: optional; use `VITE_STORE_API_URL=http://127.0.0.1:8001` to select the local store backend.

The launcher does not generate, overwrite or print keys. Exact typed commands and browser speech work without Gemini/Sarvam credentials. Flexible commands and Ask store require Gemini; Sarvam transcription requires its own key. Read aloud uses available browser voices, with Telugu playback dependent on an available Telugu voice.

## Existing databases

This fresh integration copy creates its own `store-api/store.db` on first startup. Do not copy the older starter database into it: its products table lacks the newer store fields. The launcher checks existing schemas without modifying them and refuses to start with an incompatible database.

Preserve your previous project and database. If you need existing customer/order data, arrange a reviewed migration before using it; no automatic migration or deletion is performed. For a separate fresh demo database, you can set `STORE_DB_PATH=integration-demo.db` in `store-api/.env`. Relative database paths are resolved from `store-api/`. Existing data is not transferred by selecting a new database.

## Check, start and stop

Stop previous project instances from their own terminals with Ctrl+C. The launcher checks all four fixed ports and never terminates their existing owners.

```powershell
python run_dev.py --check
```

Only after preflight passes:

```powershell
python run_dev.py
```

Wait for the **Ready** message. Keep that terminal open.

- Clothing store: http://127.0.0.1:5173/
- VaaniControl: http://127.0.0.1:5174/
- Store API: http://127.0.0.1:8001/docs
- Control API: http://127.0.0.1:8002/docs

Press Ctrl+C in the launcher terminal to stop its child processes. If a service exits or startup fails, the launcher stops the other processes it started. Use a single launcher instance. A browser tab alone does not keep the services running.

## Validation

```powershell
python -m pytest -q tests control-api
npm --prefix store-web test
npm --prefix control-web test
npm --prefix store-web run build
npm --prefix control-web run build
```

For the final manual demo, test English/Telugu voice, price and stock Preview/Confirm, the updated storefront, history, Undo, Ask store and Read aloud. Add a product to the shopping bag, change its price, and check the bag subtotal refreshes. Checkout sends expected unit prices and rejects stale values before changing inventory or creating an order; review the refreshed total before retrying.

This is a local prototype. It has demo credentials and no production customer accounts, real payment processing, or production deployment hardening. Keep Gemini/Sarvam credentials on the backend. API availability, credits and microphone permissions affect live voice tests.
