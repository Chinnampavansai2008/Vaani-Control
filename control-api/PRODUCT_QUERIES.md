# Read-only product questions

Use the existing speech provider and language controls, or type a question. Review the transcript, then click **Ask store**. **Preview** remains the button for preparing updates.

Examples:

- What is the black hoodie price?
- How many white T-shirts are in stock?
- బ్లాక్ హూడీ ధర ఎంత?
- వైట్ టీ షర్ట్ స్టాక్ ఎంత ఉంది?

The answer panel shows the selected product and its catalog price in rupees or stock in units. No confirmation is needed. Editing the transcript, starting a new recording, or choosing Preview clears the answer. Asking a question clears any prior confirmation panel.

`POST /api/query` accepts `{"text":"What is the black hoodie price?"}` and returns:

```json
{"product_id":1,"product":"Black Hoodie","field":"price","value":1299,"read_only":true}
```

The example value above is illustrative. The server reads the actual value from `GET /api/products`; Gemini only identifies the product ID and field. Model-provided values are ignored. The query route cannot create pending actions, confirm updates, write history, or send PATCH requests.

Only one product and either its current price or stock are supported per question. Unknown or ambiguous products and update commands receive a clarification error. Store and provider failures return sanitized errors. Queries use the existing private Gemini configuration; no new key or dependency is required. Missing Gemini configuration leaves the existing exact update commands available.

After changing backend code, stop the running development stack with Ctrl+C, then run `python run_dev.py` once from the project root and refresh the dashboard. Keep private keys in `control-api/.env` and leave `.env.example` with placeholders only.

Validation: 52 backend tests, 34 frontend tests, and the production build passed. Live English price/stock and Telugu price questions returned catalog values using GET-only store access. A live update command submitted as a question returned 422; history and pending actions stayed unchanged. Microphone transcription uses the existing recording flow and should also be checked manually with Ask store.
