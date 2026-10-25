# Benny

**Your cards owe you money. Benny finds it, tells you which card to tap, and builds the claim, with the fine print behind every answer.**

Cal Hacks 2026 · team of 2 · built and hosted in [Mana](https://mana.space).

## What it does
- **Home:** "Your cards owe you $X": unused credits and certificates, soonest deadline first, plus protected purchases.
- **Which card here?** Store name or location → best card in its real colours and the dollar difference, with merchant-code (MCC) uncertainty shown openly.
- **Snap receipt:** Gemini reads the photo; low-confidence fields must be confirmed; the engine adds protections and credits, each with its source clause. Photos never leave the device (IndexedDB).
- **Plain-language claims:** "my blender stopped working" → coverage decision with the quoted clause, document checklist, deadlines, pre-filled answers, link to the issuer's claims site. Benny never submits claims.
- **iPhone coaching:** an iOS Shortcut "Transaction" automation posts each Apple Pay tap; Benny replies with a notification ("Sapphire would've earned $2.40 more").
- **What we know about you:** everything stored, with Export and Delete everything.

## The rule: Gemini reads, the engine decides
Gemini extracts receipt fields, classifies claims, writes narratives and resolves unknown merchants, always with structured JSON output and validation (bad output is rejected, not patched). **Every dollar amount and coverage decision comes from `engine/engine.js`**, a plain JavaScript module with no framework, running the rules in `rules/rules.json`. Every rule carries a source URL and a verbatim quote.

## Layout
| Path | What |
|---|---|
| `app/benny.jsx` | The app UI (a Mana generated-React component; Mana injects React, Tailwind and Firebase). |
| `engine/engine.js` | Calculator: earn rates, credits, protections, claims. `node engine/engine.test.js` |
| `rules/rules.json` | 20 cards (3 hand-checked, 17 from the pipeline) + ~50-merchant MCC table. |
| `rules/demo.json` | Demo wallet (all items tagged demo). |
| `pipeline/` | Rules pipeline: fetch (plain or Bright Data) → Gemini extraction → quote verification → conflicts → merge. See `pipeline/README.md`. |
| `feed/` | iPhone Shortcut endpoint: stores the tap, runs the same engine, replies with one coaching line. |

## Run the checks
```
node engine/engine.test.js            # 38 engine tests
cd pipeline && python test_pipeline.py
python pipeline.py --help
```

## Honest limits
- Auto-extracted cards are labelled and not hand-checked; rates that depend on a choice or rotation are never counted.
- Some points cards have no sourced cash value yet, so they count $0 in cash mode.
- Benny is not affiliated with any issuer. Check your Guide to Benefits before filing.

## Benny+

The combined app (Benny + Perks Claimer) with a private backend, Plaid, PDF statements, receipt matching and a pinned,
quote-verified rules snapshot lives in [`benny-plus/`](benny-plus/README.md). The card catalog now has 21 cards (Robinhood Gold Card added Oct 25).
