# iPhone feed

An iOS Shortcut **Transaction** automation (iOS 17+, Apple Pay taps) does `POST <feed url>/tx?k=<per-user key>` with JSON `{merchant, amount, card}` and shows the response with **Show Notification**.

- `server.py`: stdlib HTTP server. Looks up the user by `sha256(key)`, stores the purchase, and returns plain text. Gemini is used only to classify merchants missing from the MCC table.
- `coach.js`: loads the live engine source and runs it, so the phone and the app always agree.

In the hackathon build it runs as a Mana sandbox daemon behind Mana ingress and reads and writes the app's Firebase data. Keys are generated in the app (You › iPhone purchase feed); only their hashes are stored.
