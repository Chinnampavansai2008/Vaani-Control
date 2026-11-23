# Connected Store check

The dashboard checks `GET /api/store/status` on load and when Check connection is
selected. This endpoint calls only the configured store's `GET /api/products`,
using the existing store helper and its 10-second timeout. It accepts no URL from
the browser, changes no products, and writes no action history.

The response contains `status` (ok, incompatible, unavailable), `host`
(hostname and port only), `product_count` (only for a compatible catalog),
`message` (a safe explanation), and `update_permissions_checked: false`.
Operational failures are returned as a successful status-check response with an
unavailable/incompatible result. They do not disable the other dashboard controls.

A compatible catalog is a list of products with unique integer IDs, nonempty
string names and nonnegative integer price/stock values. Booleans and string IDs
are incompatible with this build. A valid empty list is reachable with zero
products. Extra product fields are ignored. Only a count is returned, not the
product list or credentials. URL credentials, paths, query strings and fragments
are not included in the displayed host, and upstream error bodies are not echoed.

This does not certify update authorization. Store update credentials and expected
values are still checked by the store when the user confirms a change.

Restart the existing project once to load the new backend route:

```powershell
python run_dev.py
```

If it is already running, stop that instance first with Ctrl+C. Do not launch a
second copy. Refresh http://127.0.0.1:5174 afterward. No new keys or dependencies
are needed. If the new panel is unavailable before the restart, that does not
mean the other tested voice and store operations have stopped working.

Verification during delivery: 27 backend tests and 29 frontend tests passed,
and the frontend production build passed. Status route tests used mocked store
responses, including ASGI HTTP. A direct invocation of the new handler read the
actual running demo store and returned a compatible catalog of three products.
The existing server returned 404 for the new route before restart; browser
verification against the restarted backend remains pending.
