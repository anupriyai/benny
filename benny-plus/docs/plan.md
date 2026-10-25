# Benny — final plan for the remaining gaps

## Principle: agents propose, evidence decides
Agents do the messy reading and matching. A deterministic evidence model
decides what is true. Every number, status and claim shown to the user
traces back to stored evidence.

## 1. Data model
CardProduct  { id, name, issuer, rules }        // from pinned rules snapshot
CardAccount  { id, product_id, mask, nickname, owner (primary|authorized_user),
               opened_on, anniversary_month, source (plaid|csv|manual),
               source_account_id }
Purchase     { id, account_id, amount_cents, currency, posted_on,
               authorized_on, merchant_raw, merchant_normalized, pending,
               source (plaid|csv), source_txn_id, import_batch_id }
Evidence     { id, subject_type (purchase|item|category|credit|protection|link),
               subject_id, strength (confirmed|likely|inferred|unknown),
               source (plaid|csv|email|receipt|user|rules|mcc_table|agent),
               producer (agent name | checker name | "user"),
               reason (one line), source_ref, observed_at }
CreditStatus { account_id, credit_id, period_start, period_end,
               state (unknown|qualifying_purchase_seen|user_confirmed|
                      issuer_credit_observed|expired|not_applicable),
               evidence_ids[] }
Finding      { id, type (better_card|protection|credit|claim),
               account_id, purchase_id?, tier (confirmed|possible|needs_info),
               amount_low_cents, amount_high_cents, rule_ref, evidence_ids[] }
ImportBatch  { id, source (csv|plaid|email), created_at, row_count }

## 2. Agents (Gemini, structured JSON output with a schema; invalid output rejected)
Agents may write evidence only as "likely" or "inferred", always with a
reason and source_ref. Agents never write CreditStatus, Finding tiers,
or totals. Send each agent only the fields it needs; never tokens,
never full transaction history.

| Agent | Input | Writes |
|---|---|---|
| Intake | .eml upload, pasted email, receipt photo | item evidence (name, price, qty, return policy text), likely |
| Linker | one email/receipt + candidate purchases (±5 days, same amount ±$1) | link evidence (receipt ↔ purchase), likely |
| Credit reader | statement-credit transactions with unclear descriptions | credit evidence ("this is the DoorDash credit"), likely |
| Categorizer | unrecognized merchants | category evidence, inferred |
| Rules extractor (offline pipeline) | saved Bright Data HTML | rules + verbatim quotes |
| Claim writer | confirmed claim facts | narrative text only |

## 3. Deterministic checkers (no AI; these are the only paths to "confirmed")
- **Link confirm:** same account, exact amount, merchant_normalized match,
  posted within ±3 days → link confirmed. Otherwise stays likely and goes to
  the Review queue.
- **Credit confirm:** a credit transaction on the same account, amount equal
  to the credit (or ≤ remaining credit), 0–45 days after a qualifying
  purchase, description matching the credit's pattern or a confirmed
  Credit-reader result → issuer_credit_observed.
- **Category confirm:** merchant on the curated MCC table with high
  confidence → confirmed. A Plaid category is at most "likely" and is never
  labelled an MCC.
- **Quote verify:** a rule is accepted only if its quote appears word for
  word in the saved source HTML (after whitespace normalization). Failed
  rules are rejected and logged.
- **User taps:** "Looks right", "I used it", "Pick category" → confirmed,
  producer "user".
- **Dedupe:** key = account + amount_cents + merchant_normalized + posted
  date ±3 days. Plaid is the main record; a CSV duplicate becomes evidence
  on it. A Plaid pending transaction is replaced by its posted version via
  pending_transaction_id.
- **Invariant check:** runs after every import and every agent run. Fails
  loudly (banner in dev, error log) if any of these hold:
  - a confirmed Finding without confirmed evidence for each fact it uses
  - a claim packet without confirmed item and link evidence
  - "Credit posted" without issuer_credit_observed
  - an "all optimal" message while any purchase is undetermined

## 4. How each gap is closed
1. **Credits:** CreditStatus state machine. Labels: "Looks like you used it" /
   "You confirmed" / "Credit posted ✓". Only "Credit posted" counts as
   Recovered. Alert only on unknown in the final 7 days of the period, or on
   "purchase seen, no credit after 30 days".
2. **Merchant ≠ item ≠ MCC:** reward findings below confirmed category show a
   range ("$0.60–$1.20 depending on how the merchant codes it"), and the
   total uses the low end. Protection findings need confirmed item + link
   evidence. Otherwise "Possibly covered: add item details".
3. **Empty state:** each purchase is best_card_used | better_card_available |
   undetermined. Text is generated from counts: "Checked 42 purchases. 30
   recognized: no better card found. 12 not recognized ($380): review →".
   Never say "optimal" while anything is undetermined.
4. **Multiple accounts:** every purchase, credit, cap and finding is per
   CardAccount. Recommendations name the account when caps differ
   ("Costco Visa ••1234 has $200 of gas cap left; use ••5678").
   Authorized-user cap sharing is "unknown" unless the rule states it.
5. **CSV:** preview and column mapping before saving; confirm USD when no
   currency column; exclude non-USD rows from reward math; detect sign
   convention and show 3 sample rows; one ImportBatch per file with "Undo
   import"; all CSV categories inferred; dedupe as in section 3.
6. **Privacy:** treat hidden folders as public. Server-side ownership check
   on every endpoint (row-level security if Supabase). The Plaid
   access_token stays on the server, encrypted, never sent to the browser
   or logged. Logs contain no amounts, merchants or tokens. Plaid Sandbox
   and seeded data only until the A/B test passes.
7. **Benny+ sharing:** bundle a pinned rules snapshot and calculator inside
   Benny+ (rules_version + hash). On startup, a self-check is shown in
   Settings: "Rules v2026-10-25 · 23 cards · engine OK". On failure show a
   clear error, never empty results.

## 5. What the user sees
- Home: "Recovered $X · Likely $Y · Needs info: N". X = confirmed only.
  Never add X and Y together.
- Every finding has "Why?" listing its evidence: source, strength, producer
  and the rule's quoted clause.
- Review queue, one tap per item: unlinked receipts, unknown categories,
  likely credits, missing item details.

## 6. Build order (each step ends in a demo)
1. Data model + server-side auth + A/B privacy test script
2. Plaid Sandbox + CSV import (preview, dedupe, undo) + CardAccount
3. Intake agent (email/receipt → items) + Linker agent + link confirm
4. Review queue + coverage-based empty state + invariant check
5. Pinned rules snapshot from cached Bright Data HTML + quote verify
6. Findings tiers + CreditStatus + Credit reader agent + claim packet
7. Benny+ bundling and self-check
8. Shopping/location advice (stretch)

## 7. Acceptance tests (all must pass before the demo)
- [ ] User B requesting user A's records by URL or API gets 403/404.
- [ ] A $400 Best Buy purchase with no item evidence shows "Possibly covered"
      and no claim button. After an email listing "KitchenAid Blender $399"
      is attached and the link is confirmed, the claim packet appears.
- [ ] A DoorDash purchase with no posted credit shows "Looks like you used
      it" and is not in Recovered. It changes to "Credit posted ✓" when a
      matching credit transaction is imported.
- [ ] An import containing an unrecognized merchant never shows "all
      optimal".
- [ ] Two Sapphire accounts show separate credit statuses and totals.
- [ ] Importing the same month by CSV and Plaid gives one record per
      transaction; undoing the CSV batch removes nothing from Plaid.
- [ ] A rule whose quote is not in the saved HTML is rejected.
- [ ] The Benny+ share link works from a fresh account with no access to
      Benny.
- [ ] The invariant check passes on the full demo dataset.

## 8. The demo loop
Connect Plaid Sandbox → purchase appears → attach email → Intake agent
extracts items → Linker proposes, checker confirms → benefit matched with
its clause quoted → status shown (confirmed / likely / needs info) → next
action (claim packet, "snap receipt", or "confirm you used it").
