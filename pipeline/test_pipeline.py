"""Unit tests for the deterministic stages: python test_pipeline.py"""
import pipeline as P
page = {"ok": True, "kind": "issuer", "url": "u", "text": "Earn 4X Membership Rewards®\npoints per dollar spent at US supermarkets, on up to $25,000 per year. Up to $10 in Uber Cash each month."}
rev = {"ok": True, "kind": "review", "url": "r", "text": "The card earns 3X at US supermarkets."}
rej = []
ok = lambda c, m: (print("ok  " if c else "FAIL", m), c)[1]
r = P.verify_rule("earn", {"label": "groceries", "categories": ["grocery"], "rate": 4, "quote": "4X Membership Rewards points per dollar spent at US supermarkets", "source": 0}, [page], rej, "x")
ok(r and r["_match"] == "exact", "quote found despite ® and line break")
ok(P.verify_rule("earn", {"label": "g", "categories": ["grocery"], "rate": 5, "quote": "4X Membership Rewards points per dollar spent at US supermarkets", "source": 0}, [page], rej, "x") is None, "rate not in quote -> rejected")
ok(P.verify_rule("earn", {"label": "g", "categories": ["grocery"], "rate": 4, "quote": "4X points on groceries and also on gas stations forever", "source": 0}, [page], rej, "x") is None, "invented quote -> rejected")
ok(P.verify_rule("credits", {"label": "Uber", "amountUsd": 10, "period": "monthly", "requiresActivation": False, "merchantNames": ["Uber"], "quote": "Up to $10 in Uber Cash each month", "source": 0}, [page], rej, "x") is not None, "credit verified")
ok(P.verify_rule("earn", {"label": "g", "categories": ["grocery"], "rate": 4, "quote": "4X Membership Rewards points per dollar", "source": 3}, [page], rej, "x") is None, "bad source index -> rejected")
i = dict(r); v = P.verify_rule("earn", {"label": "g", "categories": ["grocery"], "rate": 3, "quote": "The card earns 3X at US supermarkets.", "source": 1}, [page, rev], rej, "x")
conf = []; out = P.resolve("earn", [i, v], conf, "x")
ok(len(out) == 1 and out[0]["rate"] == 4 and out[0].get("_conflict") and len(conf) == 1, "issuer beats review, conflict recorded")
a = dict(i, label="hotels", rate=5, quote="x"); b = dict(i, label="cars", rate=2, quote="y")
ok(len(P.resolve("earn", [a, b], [], "x")) == 2, "two issuer rules with same key are both kept")
ok(P.number_in_quote(120, "within one hundred twenty (120) days"), "number in parenthetical")
ok(P.map_merchants(["Uber", "Uber Eats"], [{"id": "uber", "name": "Uber", "aliases": ["uber"]}, {"id": "uber-eats", "name": "Uber Eats", "aliases": ["uber eats"]}]) == ["uber", "uber-eats"], "merchant mapping")
print(f"{len(rej)} rejections recorded")
