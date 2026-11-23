# Percentage price commands

Examples (one product per command):
- Reduce the black hoodie price by 10 percent.
- Increase the white t-shirt price by 5 percent.
- బ్లాక్ హూడీ ధర 10 శాతం తగ్గించు

Gemini identifies the product, direction and percentage. It does not receive
catalog prices or calculate the final value. The backend uses the fetched
catalog price and Decimal arithmetic to calculate a proposed whole-rupee value.
Percentages must be greater than zero and no greater than 100, with at most two
decimal places. Values with extra decimal places are rejected, not silently
rounded. Results round to the nearest rupee with halves rounded up.

Examples: 1299 reduced by 10% becomes 1169; 499 increased by 5% becomes 524.
An unchanged result requires clarification. Percentage stock changes, fixed-amount
relative changes, multiple-product changes and incomplete commands are unsupported.
Existing absolute price and stock commands remain available.

The existing Preview -> Confirm -> history -> Undo flow is unchanged. Preview
does not update the store. History and CSV export record the original and final
whole-number values. Undo restores the recorded original price; it does not try
to reverse the percentage mathematically. The store's expected-value conflict
checks still apply, and its API contract is unchanged.

Restart the existing project once to load the updated parser (Ctrl+C, then
`python run_dev.py` from the root). No new dependencies or API keys are required.
Review the proposed value before confirming a live change.

Verification: 41 backend tests, 29 frontend tests and the frontend build passed.
Live Gemini proposals were checked for the English decrease/increase examples
and the Telugu decrease example without sending store updates. A live stock-
percentage request returned a clarification error. Confirmation, history, conflict
rejection and Undo were tested with isolated temporary state, not live mutations.
