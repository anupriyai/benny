# Benny+ architecture

Everything that makes a decision is in this repository. Only two things are kept off GitHub: **user records** (each person's cards,
transactions, receipts; they live in the server's SQLite database, `state/`) and **credentials** (Plaid keys, the encryption key, Mana tokens).
"Private" in this project always means *per-user data is private*, never that code is hidden.

**Principle: agents propose, evidence decides.** AI reads messy inputs and proposes facts with a reason. Deterministic code is the only
path to "confirmed", and every number shown traces back to stored evidence (`confirmed | likely | inferred | unknown`).

```
 issuer pages ──► rules pipeline ──► rules.json ──► pinned bundle (hash-checked) ─┐
 (Bright Data)    fetch/extract/verify            build_snapshot.py               │
                                                                                  ▼
 Plaid / CSV / PDF / receipts / Gmail ──► API intake + agents ──► evidence ──► decision layer ──► UI
                                          (server.py)             (SQLite)     engine.js + decisions/feed.js
```

## 1. Card rules pipeline: `pipeline/`
| Stage | Where | What |
|---|---|---|
| fetch | `pipeline/pipeline.py` | Issuer pages listed in `pipeline/cards.json`; plain fetch, Bright Data Web Unlocker when blocked. |
| extract | `pipeline.py` (Gemini, JSON schema) | One call per card; every rule carries a verbatim quote and its source. |
| verify | `pipeline.py`, `pipeline/test_pipeline.py` | Rule rejected (never patched) if the quote isn't in the page or its numbers aren't in the quote. |
| resolve / merge | `pipeline.py` | Issuer beats review sites; hand-checked cards are never overwritten. Output `rules/rules.json`. |
| pin | `benny-plus/api/build_snapshot.py` | Re-checks every quote against saved pages (`api/sources/`), writes `bundle/` with SHA-256 hashes. The app refuses to show results if the hashes don't match. |

Hand-checked source texts for the three original cards: `pipeline/sources/`.

## 2. Ingestion and agents: `benny-plus/api/server.py`
All agents run through `agent()` (Gemini via Mana's router, structured JSON output, schema-validated by `valid()`; invalid output is rejected).
Agents may only write evidence as `likely` or `inferred`, always with a reason and a source reference. They never write totals, credit
status or finding tiers. Inputs are masked (`redact()`, `statement_redact()`) before any model call.

| Agent | Prompt / schema | Entry point | Writes |
|---|---|---|---|
| Statement reader | `STMT_SYS`, `STMT_SCHEMA` | `statement_pdf()` `POST /v1/statements/pdf` | Proposed rows; printed totals must match before import |
| Intake (receipts, emails) | `INTAKE_SYS`, `INTAKE_SCHEMA` | `add_document()` `POST /v1/documents` | Purchase facts + item evidence |
| Linker | `LINK_SYS`, `LINK_SCHEMA` | `run_linker()` | Receipt ↔ transaction proposals (ambiguous cases only) |
| Categorizer | `CAT_SCHEMA` | `categorize()` `POST /v1/agents/categorize` | Category evidence (`inferred`) from a fixed category list |
| Credit reader | `CREDIT_SCHEMA` | `credit_reader()` `POST /v1/agents/credits` | "This statement credit is the X credit" (`likely`) |
| Claim writer | `CLAIM_SCHEMA` | `claim_packet()` `GET /v1/claims/{id}` | Narrative text only, from already-confirmed facts |

Non-AI ingestion: Plaid (`link_token`, `exchange`, `apply_sync`; access tokens Fernet-encrypted), CSV (`import_csv` with preview and undo),
bulk Gmail (`discard_non_purchase`: emails with no amount skip the model; skipped hashes are remembered in `doc_skips`).
Gmail is read in the user's own browser session: `benny-plus/gmail/`.

## 3. Deterministic checkers: `server.py`
| Checker | Function | Rule |
|---|---|---|
| Dedupe | `find_dupe()`, `merchant_match()` | account + amount + merchant + posted ±3 days; Plaid is primary, other copies become evidence |
| Auto-match | `auto_match()` | receipt ↔ transaction: posted −1..+3 days, printed last four must match, exact amount / same merchant within $1 / up to 30% more (tip), unique best only, user rejections respected |
| Account merge | `merge_manual()`, `auto_merge_new()` | one card = one account (same last four, distinctive name, or sole issuer match) |
| Credits | `recompute()` | per-account credit state machine; only an observed issuer credit counts as recovered |
| Protections / claims | `recompute()`, `goods_status()` | findings need confirmed item + link evidence |
| Invariants | `invariants()`, `check_optimal_message()` | run after every change; e.g. never "all optimal" while anything is undetermined |
| Ownership | `owner_of()`, `owned()` | every query scoped to the verified caller; other users' ids return 404 (`api/tests/test_privacy.py`) |

## 4. Rewards decision layer
| File | What |
|---|---|
| `engine/engine.js` (= `bundle/engine.js`) | Per-purchase money math: `findMerchant`, `earnRule`, `scoreCard`, `recommend` (conditional rates shown, never counted), credits, protections, `evaluateClaim`. Tests: `engine/engine.test.js`. |
| `benny-plus/decisions/feed.js` | Everything the app totals: `computeFeed` (earned, missed, per category / card), `cardRole` (cards you have vs trying), receipt estimates (`receiptView`, `resolvePaid`), what-if for trying cards, fees, coverage text. Extracted verbatim from the app by `scripts/extract_decisions.py`. Tests: `decisions/feed.test.js` (synthetic data, also fails if the module drifts from the app). |

Key rules, all estimates (never posted rewards):
- Only cards you **have** count: connected through Plaid, has purchases or receipts, or marked "I have it". A picked card with nothing is **trying**: scored as a what-if, never added to a total, never cited as a missed reward.
- Unknown stores earn the card's everyday rate. Points with no fixed cash value count $0 in dollars and are shown as points.
- A receipt with no bank transaction counts once, on the card it names, or on your only card unless it prints a different last four. Trades, shipping notices, cancellations and receipts already on a bank statement are excluded.

## 5. UI: `benny-plus/app/benny-plus.jsx`
One Mana `user_div` (React). Loads the bundle, verifies hashes, calls the API with the user's Firebase ID token, and renders
`computeFeed` results. No private data is stored in Firebase.

## Running the tests
```
node engine/engine.test.js
node benny-plus/decisions/feed.test.js
python pipeline/test_pipeline.py
python benny-plus/api/tests/test_privacy.py <api-url>      # needs a running server
python benny-plus/api/tests/test_acceptance.py <api-url>
```
