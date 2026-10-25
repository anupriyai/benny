# Benny+

Benny and Perks Claimer combined: pick your cards, bring in purchases (bank, CSV or PDF statement, receipts and order emails),
and see estimated earned rewards, credits, hypothetical card comparisons, purchase protections and claim packets.
Built at Cal Hacks (Oct 24–25, 2026) on Mana.

**Principle: agents propose, evidence decides.** AI reads and matches; deterministic checks decide what is true.
Every number traces back to stored evidence (`confirmed | likely | inferred | unknown`).

## Layout
| Path | What |
|---|---|
| `app/benny-plus.jsx` | The whole UI (one Mana `user_div`, React). Dollar-bill palette, light + dark. |
| `api/server.py` | Backend (aiohttp + SQLite): ingestion, all AI agents and their prompts, deterministic checkers. User records stay per-user: every query is scoped to the caller's verified uid. |
| `decisions/` | Rewards decision layer (`feed.js`, extracted from the app) with tests on synthetic data. |
| `ARCHITECTURE.md` | How the pipeline, agents, checkers and decision layer fit together, with function names. |
| `scripts/extract_decisions.py` | Regenerates `decisions/feed.js` from the app. |
| `api/tests/` | `test_privacy.py <url>` (15 A/B privacy checks), `test_acceptance.py <url>` (13 plan checks). |
| `api/build_snapshot.py` | Builds the pinned rules snapshot: a rule is kept only if its quote appears word for word in a saved source page. |
| `api/sources/` | Saved source pages used by the snapshot check. |
| `bundle/` | The pinned snapshot the app ships with (`rules.snapshot.json`, `engine.js`, `manifest.json` with SHA-256 hashes the client verifies). |
| `gmail/helper.jsx` | Browser-based, per-user Gmail receipt import helper. |
| `shop/install_shop_browser.py` | Per-user shopping browser installer (runs in each user's own Mana sandbox). |
| `docs/` | Build plan, agent notes (running log), email-evidence, perks and policy-research plans, brand notes. |

Shared with the original Benny: `../engine/engine.js` (all money and coverage decisions, pure functions),
`../rules/rules.json` (21 cards incl. Robinhood Gold Card), `../pipeline/` (fetch → extract → verify → publish card rules).

## Backend highlights
- Plaid: production for real connections, Sandbox only in demo mode; access tokens Fernet-encrypted server-side.
- Imports: CSV with column preview, PDF statements (`POST /v1/statements/pdf`, read in memory, PII masked, totals checked), dedupe and undo.
- Receipts/emails: Gemini intake (schema-validated) → deterministic auto-match to card transactions (`auto_match`: amount/date/merchant/tip rules,
  unique-best only, user rejections respected) → linker agent for the ambiguous rest → Review.
- Categories: curated merchant table first, then automatic categorization from the fixed category list; users can change any merchant's category.
- `recompute()` rebuilds credit status and protection/claim findings after every mutation; invariants are checked after every change.

## Running
The server runs inside a Mana sandbox (it uses Mana's `firebase_helper`, `mana_router` and `symbolic_proxy`).
Saved keys used: `PLAID_CLIENT_ID`, `PLAID_SECRET_SANDBOX`, `PLAID_SECRET_PRODUCTION`. All code is in this repo. Only user records (`state/` database) and credentials (keys, tokens) are never committed. See `ARCHITECTURE.md`.

## Recent updates

Unconnected, manually picked cards default to **trying**. Connected cards and cards with purchase evidence count as held; users can correct the role on the card page. Earned-benefit totals use held cards only; trying cards show separate what-if estimates. All reward calculations remain estimates, not issuer-posted balances.

Gmail import runs through the user’s own connection in the browser, without requiring their own sandbox. See `gmail/README.md`.
