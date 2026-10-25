# Benny: natural real-account walkthrough

## Recording script: Eden's already-connected account

Target: 2:40–2:55. Narrator/driver: Anupriya; Eden owns and approves the personal data shown. Do not reconnect or delete anything for the recording. Show setup as an explanation, then continue with the existing connected wallet. Pause or cut loading honestly. Blur personal identifiers and unrelated records.

### 0:00–0:15 | Start on the populated Benefits screen
I know what my credit card costs me. What I don't always know is whether I'm getting its benefits back. That's what we built Benny for. This is Eden's real account, with his permission, not sample data.

### 0:15–0:35 | Add my cards → card selection; then return to existing Wallet
You start by picking your cards. You can connect a card through Plaid for transaction history, or just compare its benefits. Eden already connected his Robinhood Gold Card, so I'll use that existing connection rather than make him log in again.

### 0:35–0:55 | Wallet: connected source, card face, open card details
Plaid brings in the account's transactions, and we associate that account with the card product. That gives Benny the payment history and the rules to evaluate it. Access to these private records is checked on the server for the signed-in user.

### 0:55–1:25 | Open one already-imported real receipt or email and its comparison
But a bank transaction doesn't tell us exactly what was in the bag. Receipts and order emails fill in that detail. We support Gmail import and individual uploads; here's one we've already processed.

Gemini reads the purchase details, and separate checks try to match them to a bank transaction. If the paying card is unclear, Benny asks instead of treating a guess as proof.

Even without a match, we can compare estimated rewards across selected cards.

### 1:25–1:55 | Dashboard: earned estimate, categories; then a trying-card comparison if populated
Now those purchases become something useful: estimated rewards earned, spending by category, and opportunities to earn more.

Cards Eden owns count toward his results. A card he's only trying stays a what-if comparison, so we don't mix hypothetical rewards into what his cards earned.

These totals are estimates from the imported data, not a promise of posted cashback.

### 1:55–2:20 | Benefits, then a card's policy/source detail
Benny also surfaces credits, activation requirements, and supported protections. Here I can open a benefit and inspect the issuer's wording and conditions.

Our core technical decision is simple: AI reads the messy documents; a deterministic rules engine does the reward math and supported checks. A source quote explains a rule, but doesn't guarantee eligibility.

### 2:20–2:45 | Return to the strongest populated result
We built the React interface and Python backend with private SQLite records, and used Mana throughout to brainstorm, build, and refine the same working app.

One change was making receipts useful before bank matching. We described the problem in Mana and changed both the flow and the logic.

Benny helps you get more from what you already spend, with less fine print.

## Exact rehearsal route
Benefits → Add my cards (view only, no Continue/save required) → Wallet → connected Robinhood card/source → existing receipt/email → Dashboard → Cards you're trying if populated → Benefits → policy source → strongest result.

Only narrate what appears: say a receipt matched only if its UI confirms it; if it is unmatched explain the missing link. If there are no what-if cards, omit that passage rather than adding records just for the video. Do not claim unused credits/protections exist on Eden's card unless the screen shows them. A comparison-only card's benefits are hypothetical. Do not show Claim draft or Shop unless separately verified and there is time.

## 30-second version
This is Benny using Eden's real card activity. Plaid supplies transaction history, receipts add item details, and Benny turns them into estimated rewards and card comparisons. AI reads the documents; a rules engine does the math. Benefits link back to issuer terms, and anything uncertain stays labeled. We built it end to end with Mana to help people get more from existing spending, not spend more.

## Judge Q&A
1. Real data? Yes: a real Robinhood Gold Card connected via Plaid production, with the cardholder's consent.
2. Built vs used: we built the interface, evidence model, matching, rewards engine, and rules pipeline; Plaid, Gemini, and Mana provide connectivity, document reading, and infrastructure.
3. Mocked: card rules are a pinned snapshot; claim drafts aren't submitted anywhere.
4. Hardest problem: keeping AI reading separate from payment proof and money math.
5. vs CardPointers/MaxRewards: card recommendation is an existing category; our prototype combines receipt-first estimates, retrospective insights, and source-linked benefit information. We do not claim competitors lack all these features.
6. 1,000 users: not load-tested. SQLite on one service, model latency, and Plaid limits break first.
7. Next week: more cards, better matching for refunds and split payments, deadline reminders.
8. Mana track: built, hosted, and shared entirely in Mana.

## If something fails
Plaid or sync stalls: cut to the already-connected wallet and say it was connected earlier. Receipt doesn't match: show it unmatched and say Benny asks rather than guesses. Never claim a result that didn't appear.
