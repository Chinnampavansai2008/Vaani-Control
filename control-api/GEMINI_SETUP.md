# Gemini setup for this project

The existing microphone and exact-command flow still works without an API key.
Gemini is used only when the exact-command parser cannot interpret a command.

1. Stop any unfinished Antigravity edit task and reload changed files from disk.
2. Open `control-api/.env` privately. Set `GEMINI_API_KEY=` to your key and save.
   Never enter real keys in chat or `.env.example`.
3. Leave `GEMINI_MODEL=` blank for discovery of an advertised Flash text model.
   Alternatively set an exact model ID available to your account. The backend
   verifies that configured model before generating an action.
4. Stop the terminal running this project's `python run_dev.py` with Ctrl+C.
   From the project root, run:

   ```powershell
   python -m pip install -r control-api/requirements.txt
   python run_dev.py
   ```

   Run only one copy; keep its terminal open. If a port is occupied, identify the
   existing project instance rather than repeatedly launching copies.
5. Open http://127.0.0.1:5174. Speak or type “Make the black hoodie cost 999 rupees”.
   Click Preview and inspect the product, field and value before confirming.
   Check the store and Undo to restore the original value.

Each Gemini HTTP request times out after 15 seconds with automatic retries disabled.
Model discovery/verification and generation are separate requests, so a failed
attempt can take around 30 seconds overall plus local processing/network overhead.
Model access, quota and network errors do not disable the exact-command parser.

## Checks performed during repair

Run `python -m unittest discover -s control-api -p test_commands.py -v`.
Seven local handler/SDK-mock tests passed. They exercise the real command and
execution functions with isolated temporary history and simulated store responses.
They do not certify HTTP/browser transport, microphone recognition or live Gemini
access. Live Gemini testing was pending because this project had no configured key.

Only control-api files were changed. No Git commit/push or store changes were made.
