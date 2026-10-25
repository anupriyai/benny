#!/usr/bin/env python3
"""Regenerate decisions/feed.js from app/benny-plus.jsx (the app is one Mana user_div; this keeps its decision layer testable)."""
import pathlib, re
ROOT = pathlib.Path(__file__).resolve().parents[1]
NAMES = ['jparse', 'mnorm', 'categoryMap', 'cardRole', 'NOT_CARD_SPEND', 'BROKERS', 'BASE_MERCHANT', 'computeFeed', 'coverageLine', 'walletAccts', 'NET_ALIAS', 'docFacts', 'resolvePaid', 'receiptView']
src = (ROOT / "app/benny-plus.jsx").read_text()
def decl(name):
    for pfx in ("function " + name + "(", "const " + name + " ="):
        k = src.find("\n" + pfx)
        if k >= 0:
            k += 1; m = re.search(r"\n(function |const |/\*|let |class )", src[k + 1:])
            return src[k:k + 1 + m.start()] if m else src[k:]
    raise SystemExit("missing " + name)
HEAD = "/* Benny+ rewards decision layer: turns a user's records + the pinned rules into every number the app shows\n   (earned rewards, missed rewards, cards you have vs trying, receipt estimates, what-if comparisons, fees).\n   Pure functions, no I/O, no AI. GENERATED from app/benny-plus.jsx by scripts/extract_decisions.py; the test fails if they drift.\n   Money math per purchase comes from the shared engine (engine.recommend / scoreCard). */\n'use strict';\nconst DAYMS = 86400000;"
body = "\n".join(decl(n).rstrip() + "\n" for n in NAMES)
(ROOT / "decisions/feed.js").write_text(HEAD + "\n\n" + body + "\nmodule.exports = { " + ", ".join(NAMES) + " };\n")
print("wrote decisions/feed.js")
