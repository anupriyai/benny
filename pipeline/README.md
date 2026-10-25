# Benny rules pipeline

Turns card benefit pages into the rules JSON the Benny engine reads. Runs once before the demo; the live app never scrapes.

```
pip install requests beautifulsoup4 pdfplumber
python pipeline.py                        # auto: plain fetch, Bright Data when a page is blocked
python pipeline.py --fetcher brightdata   # every page through Bright Data
python pipeline.py --only amex-gold --refetch
python test_pipeline.py                   # verifier / conflict tests
```

Env: `BRIGHTDATA_API_TOKEN`, `BRIGHTDATA_ZONE` (default `web_unlocker1`), `GEMINI_API_KEY` (inside Mana, the Gemini router is used and no key is needed).

## Stages
1. **fetch**: `cards.json` lists each card's sources (issuer page first, review sites as backup). Pages are cached in `out/pages/`.
   Bright Data uses the Web Unlocker API: `POST https://api.brightdata.com/request {zone, url, format: "raw"}`.
2. **extract**: one Gemini call per card, JSON output against a schema. Each rule carries a verbatim quote and the number of the source it came from.
   Cached in `out/extract/`, keyed by page hashes, model and prompt.
3. **verify**: a rule is **rejected, never patched**, if its quote isn't in the fetched text, if its numbers aren't in its quote, or if it fails the schema.
4. **resolve**: issuer page vs review site on the same rule → issuer wins, conflict recorded on the rule and in the report.
5. **merge**: cards with `handChecked: true` in the base rules are never overwritten. Pipeline cards are `verified: false`.

Engine contract: rates marked `conditional` (chosen, rotating, top-category, limited-time) are never counted, only shown. Protections missing the
numbers the engine needs are marked `incomplete`; the engine then answers "needs the terms" instead of deciding.
Output: `out/rules.json`, `out/report.md`, `out/report.json`. `--publish` writes into the Benny app (keeps the previous version at `rules/previousJson`).

## Known gaps (2026-10-24 run)
- Amex Gold/Platinum, Venture X, Strata Premier pages state no cash value per point, so they count $0 in cash mode. Add a sourced value per program.
- Product pages rarely give full protection terms; Guides to Benefits (PDFs) do. Add them as sources per card.
