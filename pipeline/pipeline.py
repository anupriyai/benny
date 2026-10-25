#!/usr/bin/env python3
"""Benny rules pipeline: card benefit pages -> verified rules JSON for the Benny engine.

    python pipeline.py                         # fetch (auto), extract, verify, merge -> out/rules.json + out/report.md
    python pipeline.py --fetcher brightdata    # every page through Bright Data Web Unlocker (needs BRIGHTDATA_API_TOKEN)
    python pipeline.py --only amex-gold,apple-card --refetch
    python pipeline.py --publish               # also write the result into the Benny app (Mana only)

Stages (each one deterministic except extract):
  1. fetch     pages per card (cards.json), cached in out/pages/. Fetchers: plain | brightdata | auto (plain, then
               Bright Data when a page is blocked or empty). PDFs are read with pdfplumber.
  2. extract   Gemini, structured JSON output with a schema, one call per card over all its sources. Every rule
               must carry a verbatim quote and the index of the source it came from. Gemini never sets art,
               ids, or anything the engine computes.
  3. verify    reject (never patch) any rule whose quote is not in the fetched text, or whose numbers are not in
               its quote, or whose fields fail the schema. Rejections are listed in the report.
  4. resolve   when an issuer page and a review site disagree on the same rule, the issuer wins and the conflict
               is recorded on the rule. Review-only rules are kept and labelled kind=review.
  5. merge     hand-checked cards in the base rules file (handChecked: true) are never overwritten. Pipeline cards
               get verified=false and a note saying they were not checked by hand.
Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE (default web_unlocker1), GEMINI_API_KEY (else Mana's Gemini router).
"""
import argparse, concurrent.futures as cf, datetime, difflib, hashlib, io, json, os, re, sys, time
import requests
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
TODAY = datetime.date.today().isoformat()
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html,application/xhtml+xml,application/pdf"}
# Must match the categories used by Benny's merchant (MCC) table and engine.
CATEGORIES = ["*", "dining", "grocery", "online_grocery", "gas", "ev_charging", "travel", "airline", "hotel", "hotel_direct", "car_rental",
              "rideshare", "transit", "streaming", "drugstore", "department", "wholesale", "electronics", "home_improvement", "online",
              "entertainment", "phone", "issuer_travel", "chase_travel"]
PROTECTIONS = ["extended_warranty", "purchase_protection", "trip_delay", "trip_cancellation", "cell_phone", "return_protection", "baggage_delay", "rental_car"]
DEFAULT_DOCS = {"extended_warranty": ["receipt", "statement", "warranty", "repair_estimate"], "purchase_protection": ["receipt", "statement", "repair_estimate"],
                "trip_delay": ["itinerary", "statement", "carrier_statement", "expense_receipts"]}
LABEL = {"extended_warranty": "Extended warranty", "purchase_protection": "Purchase protection", "trip_delay": "Trip delay reimbursement",
         "trip_cancellation": "Trip cancellation/interruption", "cell_phone": "Cell phone protection", "return_protection": "Return protection",
         "baggage_delay": "Baggage delay", "rental_car": "Rental car coverage"}

def log(*a): print(*a, file=sys.stderr, flush=True)

# ---------------------------------------------------------------- 1. fetch
def secret(name):
    if os.environ.get(name): return os.environ[name]
    try:
        from sandbox_runtime_context import get_api_keys  # Mana: saved keys, in chat/MPM runs
        return (get_api_keys() or {}).get(name)
    except Exception:
        return None

class PlainFetcher:
    name = "plain"
    def get(self, url):
        r = requests.get(url, headers=UA, timeout=40)
        return r.status_code, r.headers.get("content-type", ""), r.content

class BrightDataFetcher:
    """Bright Data Web Unlocker REST API: POST https://api.brightdata.com/request {zone, url, format: raw}."""
    name = "brightdata"
    def __init__(self):
        self.token = secret("BRIGHTDATA_API_TOKEN"); self.zone = os.environ.get("BRIGHTDATA_ZONE") or secret("BRIGHTDATA_ZONE") or "web_unlocker1"
    def available(self): return bool(self.token)
    def get(self, url):
        if not self.token: raise RuntimeError("BRIGHTDATA_API_TOKEN not set")
        r = requests.post("https://api.brightdata.com/request", headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
                          json={"zone": self.zone, "url": url, "format": "raw"}, timeout=120)
        return r.status_code, r.headers.get("content-type", ""), r.content

def to_text(ctype, content, url):
    if "pdf" in ctype or url.lower().endswith(".pdf") or content[:4] == b"%PDF":
        import pdfplumber
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            return "\n".join((p.extract_text() or "") for p in pdf.pages)
    soup = BeautifulSoup(content, "html.parser")
    for t in soup(["script", "style", "noscript", "svg", "template"]): t.decompose()
    text = soup.get_text("\n", strip=True)
    return re.sub(r"\n{2,}", "\n", text)

def looks_blocked(status, text):
    return status != 200 or len(text) < 1500 or re.search(r"access denied|captcha|unusual traffic|enable javascript to", text[:3000], re.I)

def fetch_source(card_id, i, src, mode, refetch):
    path = os.path.join(OUT, "pages", f"{card_id}__{i}.json")
    if os.path.exists(path) and not refetch:
        return json.load(open(path))
    order = {"plain": [PlainFetcher()], "brightdata": [BrightDataFetcher()], "auto": [PlainFetcher(), BrightDataFetcher()]}[mode]
    rec = {"url": src["url"], "kind": src["kind"], "fetchedAt": TODAY, "ok": False, "attempts": []}
    for f in order:
        if isinstance(f, BrightDataFetcher) and not f.available():
            rec["attempts"].append({"fetcher": f.name, "error": "no BRIGHTDATA_API_TOKEN"}); continue
        try:
            status, ctype, content = f.get(src["url"]); text = to_text(ctype, content, src["url"])
            blocked = looks_blocked(status, text)
            rec["attempts"].append({"fetcher": f.name, "status": status, "chars": len(text), "blocked": bool(blocked)})
            if not blocked:
                rec.update(ok=True, fetcher=f.name, text=text, sha256=hashlib.sha256(text.encode()).hexdigest()); break
        except Exception as e:
            rec["attempts"].append({"fetcher": f.name, "error": str(e)[:200]})
    json.dump(rec, open(path, "w"), ensure_ascii=False)
    return rec

# ---------------------------------------------------------------- 2. extract (Gemini reads; it never decides)
SRC = {"type": "INTEGER"}; Q = {"type": "STRING"}
def nnum(t="NUMBER"): return {"type": t, "nullable": True}
SCHEMA = {"type": "OBJECT", "properties": {
  "annualFee": {"type": "OBJECT", "properties": {"usd": nnum(), "quote": {"type": "STRING", "nullable": True}, "source": {"type": "INTEGER", "nullable": True}}, "required": ["usd", "quote", "source"]},
  "currency": {"type": "OBJECT", "properties": {"unit": {"type": "STRING", "enum": ["points", "miles", "cashback"]}, "cashCentsPerUnit": nnum(), "quote": {"type": "STRING", "nullable": True}, "source": {"type": "INTEGER", "nullable": True}}, "required": ["unit", "cashCentsPerUnit", "quote", "source"]},
  "earn": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
      "label": {"type": "STRING"}, "categories": {"type": "ARRAY", "items": {"type": "STRING", "enum": CATEGORIES}}, "rate": {"type": "NUMBER"},
      "conditional": {"type": "BOOLEAN"}, "condition": {"type": "STRING", "nullable": True}, "spendCap": {"type": "STRING", "nullable": True},
      "excludes": {"type": "STRING", "nullable": True}, "quote": Q, "source": SRC},
      "required": ["label", "categories", "rate", "conditional", "condition", "spendCap", "excludes", "quote", "source"]}},
  "credits": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
      "label": {"type": "STRING"}, "amountUsd": {"type": "NUMBER"}, "period": {"type": "STRING", "enum": ["monthly", "quarterly", "semiannual", "annual", "every_4_years", "one_time"]},
      "requiresActivation": {"type": "BOOLEAN"}, "merchantNames": {"type": "ARRAY", "items": {"type": "STRING"}}, "quote": Q, "source": SRC},
      "required": ["label", "amountUsd", "period", "requiresActivation", "merchantNames", "quote", "source"]}},
  "perks": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {"label": {"type": "STRING"}, "requiresActivation": {"type": "BOOLEAN"}, "quote": Q, "source": SRC}, "required": ["label", "requiresActivation", "quote", "source"]}},
  "protections": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
      "type": {"type": "STRING", "enum": PROTECTIONS}, "windowDays": nnum("INTEGER"), "perItemCapUsd": nnum(), "addsMonths": nnum("INTEGER"),
      "maxOriginalWarrantyMonths": nnum("INTEGER"), "minDelayHours": nnum(), "perTravelerCapUsd": nnum(), "quote": Q, "source": SRC},
      "required": ["type", "windowDays", "perItemCapUsd", "addsMonths", "maxOriginalWarrantyMonths", "minDelayHours", "perTravelerCapUsd", "quote", "source"]}},
}, "required": ["annualFee", "currency", "earn", "credits", "perks", "protections"]}

PROMPT = """You extract credit card benefit rules for {name} ({issuer}) from the numbered sources below. Use ONLY these sources; never outside knowledge.
Rules:
- Every rule needs "quote": a short passage copied EXACTLY, character for character, from ONE source (max 300 characters, one contiguous span, no ellipses), and "source": that source's number. If you cannot quote it, leave the rule out.
- Every number in a rule (rate, amount, days, caps) must appear in its quote.
- earn: one rule per rate. categories from the allowed list; "*" means all other purchases. rate is the multiplier for points/miles (3 for 3x) or the percent for cash back (2 for 2%).
  conditional=true when the rate only applies to a category the cardholder chooses, rotating/quarterly activated categories, a "top spend category", only through a specific booking portal you can't map, or only for a limited time/first year; put the condition in "condition". Put spending caps in "spendCap" and exclusions (e.g. superstores) in "excludes".
  Booking-portal rates go in "issuer_travel" (or "chase_travel" for Chase Travel). Flights booked directly with airlines -> "airline". U.S. supermarkets -> "grocery".
- credits: statement credits with a dollar amount and a period. merchantNames: the merchants where it applies (e.g. ["Uber", "Uber Eats"]).
- perks: things the cardholder must enroll in or activate (memberships, enrollment-required credits), with requiresActivation.
- protections: only the listed types, only if the source describes the benefit; numeric fields null unless stated.
- annualFee and currency: cashCentsPerUnit only if the source states a cash redemption value (e.g. 1 cent per point); for cash back cards unit=cashback.
- Ignore welcome bonuses, APRs, intro offers, and authorized-user details.

{sources}"""

def gemini_endpoint():
    key = os.environ.get("GEMINI_API_KEY")
    if key: return "https://generativelanguage.googleapis.com/v1beta", {"x-goog-api-key": key}
    import mana_router  # Mana's Gemini route (no key needed inside Mana)
    g = mana_router.provider("gemini"); return g.url, dict(g.headers)

def extract(card, pages, model):
    key = hashlib.sha256(json.dumps([model, PROMPT, SCHEMA, card["name"], [p.get("sha256") for p in pages]]).encode()).hexdigest()[:16]
    cpath = os.path.join(OUT, "extract", f"{card['cardId']}__{key}.json")
    if os.path.exists(cpath): return json.load(open(cpath)), None
    ext, err = _extract(card, pages, model)
    if ext is not None:
        os.makedirs(os.path.dirname(cpath), exist_ok=True); json.dump(ext, open(cpath, "w"), ensure_ascii=False)
    return ext, err

def _extract(card, pages, model):
    srcs = "\n\n".join(f"=== SOURCE {i} ({p['kind']}: {p['url']}) ===\n{trim(p['text'])}" for i, p in enumerate(pages) if p.get("ok"))
    if not srcs: return None, "no source text"
    url, headers = gemini_endpoint()
    body = {"contents": [{"role": "user", "parts": [{"text": PROMPT.format(name=card["name"], issuer=card["issuer"], sources=srcs)}]}],
            "generationConfig": {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0}}
    for attempt in range(3):
        r = requests.post(f"{url}/models/{model}:generateContent", headers=dict(headers, **{"content-type": "application/json"}), json=body, timeout=240, allow_redirects=False)
        if r.status_code == 200: break
        if r.status_code == 402: return None, "out of credits"
        time.sleep(3 * (attempt + 1))
    else:
        return None, f"gemini {r.status_code}: {r.text[:200]}"
    try:
        txt = "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
        return json.loads(txt), None
    except Exception as e:
        return None, f"malformed output rejected: {e}"

KEYWORDS = re.compile(r"(points?|miles|cash back|%|\bx\b|\dx|credit|annual fee|warranty|protection|insurance|delay|statement|membership|enroll|activate)", re.I)
def trim(text, limit=90000):
    if len(text) <= limit: return text
    lines = text.split("\n"); keep = set()
    for i, l in enumerate(lines):
        if KEYWORDS.search(l):
            keep.update(range(max(0, i - 2), min(len(lines), i + 3)))
    out = "\n".join(lines[i] for i in sorted(keep))
    return out[:limit]

# ---------------------------------------------------------------- 3. verify (reject, never patch)
def norm(s):
    s = (s or "").replace("\u00a0", " ")
    s = re.sub(r"[®™℠*†‡§¹²³⁴⁵⁶⁷⁸⁹⁰]", "", s)
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", s).strip().lower()

def quote_found(quote, text):
    q, t = norm(quote), norm(text)
    if len(q) < 12: return None
    if q in t: return "exact"
    sm = difflib.SequenceMatcher(None, t, q, autojunk=False)
    # cheap prefilter: locate the quote's first 24 chars, then compare the window
    anchor = q[:24]; idx = t.find(anchor)
    if idx >= 0:
        win = t[idx: idx + len(q) + 40]
        if difflib.SequenceMatcher(None, win[:len(q)], q).ratio() >= 0.93: return "fuzzy"
    return None

def nums_in(s):
    out = set()
    for m in re.finditer(r"\d[\d,]*(?:\.\d+)?", s or ""):
        v = float(m.group(0).replace(",", "")); out.add(v)
    return out

WORDNUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "ten": 10, "twelve": 12}
def number_in_quote(v, quote):
    if v is None: return True
    ns = nums_in(quote)
    for w, n in WORDNUM.items():
        if re.search(r"\b" + w + r"\b", quote or "", re.I): ns.add(float(n))
    return float(v) in ns

def verify_rule(kind, rule, pages, rejected, card_id):
    src = rule.get("source")
    def reject(why): rejected.append({"card": card_id, "kind": kind, "rule": rule.get("label") or rule.get("type"), "why": why, "quote": (rule.get("quote") or "")[:160]}); return None
    if not isinstance(src, int) or src < 0 or src >= len(pages) or not pages[src].get("ok"): return reject("bad source index")
    how = quote_found(rule.get("quote"), pages[src]["text"])
    if not how: return reject("quote not found in source text")
    fields = {"earn": ["rate"], "credits": ["amountUsd"], "protections": ["windowDays", "perItemCapUsd", "addsMonths", "maxOriginalWarrantyMonths", "minDelayHours", "perTravelerCapUsd"]}.get(kind, [])
    for f in fields:
        if rule.get(f) is not None and not number_in_quote(rule[f], rule["quote"]): return reject(f"{f}={rule[f]} not in quote")
    if kind == "earn" and not (0 < float(rule["rate"]) <= 20): return reject("rate out of range")
    if kind == "earn" and not rule.get("categories"): return reject("no categories")
    return dict(rule, _match=how, _kind=pages[src]["kind"], _url=pages[src]["url"])

# ---------------------------------------------------------------- 4. resolve conflicts (issuer wins)
def rule_key(kind, r):
    if kind == "earn": return ("earn", tuple(sorted(r["categories"])), bool(r.get("conditional")))
    if kind == "credits": return ("credit", round(float(r["amountUsd"]), 2), r["period"], norm(" ".join(r.get("merchantNames") or []) or r["label"])[:20])
    if kind == "protections": return ("prot", r["type"])
    return (kind, norm(r.get("label"))[:30])

def value_of(kind, r):
    if kind == "earn": return r["rate"]
    if kind == "credits": return r["amountUsd"]
    if kind == "protections": return {k: r.get(k) for k in ["windowDays", "perItemCapUsd", "addsMonths", "maxOriginalWarrantyMonths", "minDelayHours", "perTravelerCapUsd"] if r.get(k) is not None}
    return None

def resolve(kind, rules, conflicts, card_id):
    """Issuer rules are all kept (distinct rules on one page are not conflicts). A review-site rule is dropped when the
    issuer covers the same key; if its value differs from every issuer value, that's a recorded conflict (issuer wins)."""
    issuer = [r for r in rules if r["_kind"] == "issuer"]; review = [r for r in rules if r["_kind"] != "issuer"]
    out = list(issuer); ikeys = {}
    for r in issuer: ikeys.setdefault(rule_key(kind, r), []).append(r)
    for r in review:
        same = ikeys.get(rule_key(kind, r))
        if not same: out.append(r); continue
        if all(value_of(kind, r) != value_of(kind, i) for i in same):
            win = same[0]
            conflicts.append({"card": card_id, "rule": win.get("label") or win.get("type"), "issuer": value_of(kind, win), "review": value_of(kind, r),
                              "issuerQuote": win["quote"][:200], "reviewQuote": r["quote"][:200], "reviewUrl": r["_url"]})
            idx = out.index(win); out[idx] = dict(win, _conflict={"url": r["_url"], "quote": r["quote"], "kind": r["_kind"], "value": value_of(kind, r)})
            ikeys[rule_key(kind, r)][0] = out[idx]
    return out

# ---------------------------------------------------------------- 5. build Benny card objects + merge
def source_obj(r):
    s = {"url": r["_url"], "quote": re.sub(r"\s+", " ", r["quote"]).replace(" ®", "®").strip(), "kind": r["_kind"], "asOf": TODAY}
    notes = []
    if r["_match"] == "fuzzy": notes.append("Quote matched the page with minor differences.")
    if r["_kind"] == "review": notes.append("Review site, not the issuer.")
    if r.get("_conflict"): notes.append(f"Conflict: {r['_conflict']['kind']} source says {r['_conflict']['value']}; issuer page wins.")
    notes.append("Extracted by the rules pipeline; not checked by hand.")
    s["note"] = " ".join(notes)
    return s

def slug(s): return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:40]

def map_merchants(names, mcc):
    ids = []
    for n in names or []:
        q = norm(n); best, score = None, 0
        for m in mcc:
            for a in [m["name"]] + (m.get("aliases") or []):
                a = norm(a)
                s = 1000 if a == q else (len(a) if len(a) > 3 and re.search(r"\b" + re.escape(a) + r"\b", q) else 0)
                if s > score: best, score = m["id"], s
        if best: ids.append(best)
    return sorted(set(ids))

def build_card(meta, ext, pages, mcc, report):
    rej, conf = report["rejected"], report["conflicts"]
    cid = meta["cardId"]
    earn = resolve("earn", [x for x in (verify_rule("earn", r, pages, rej, cid) for r in ext.get("earn") or []) if x], conf, cid)
    credits = resolve("credits", [x for x in (verify_rule("credits", r, pages, rej, cid) for r in ext.get("credits") or []) if x], conf, cid)
    perks = [x for x in (verify_rule("perks", r, pages, rej, cid) for r in ext.get("perks") or []) if x]
    prots = resolve("protections", [x for x in (verify_rule("protections", r, pages, rej, cid) for r in ext.get("protections") or []) if x], conf, cid)
    cur = ext.get("currency") or {}; fee = ext.get("annualFee") or {}
    card = {"cardId": cid, "name": meta["name"], "short": meta["short"], "issuer": meta["issuer"], "network": meta["network"], "art": meta["art"],
            "verified": False, "handChecked": False, "pipeline": {"generatedAt": TODAY, "sources": [{"url": p["url"], "kind": p["kind"], "ok": p.get("ok"), "fetcher": p.get("fetcher")} for p in pages]},
            "verifiedNote": f"Auto-extracted on {TODAY} from {sum(1 for p in pages if p.get('ok'))} source(s). Every quote was found in the fetched page; not checked by hand.",
            "earn": [], "credits": [], "perks": [], "protections": []}
    # annual fee / currency: verified like rules, else left null
    if fee.get("usd") is not None and isinstance(fee.get("source"), int) and fee["source"] < len(pages) and pages[fee["source"]].get("ok") and quote_found(fee.get("quote"), pages[fee["source"]]["text"]) and number_in_quote(fee["usd"], fee["quote"]):
        card["annualFee"] = fee["usd"]; card["annualFeeSource"] = {"url": pages[fee["source"]]["url"], "quote": fee["quote"], "kind": pages[fee["source"]]["kind"], "asOf": TODAY}
    unit = cur.get("unit") or "points"
    c = {"unit": unit, "unitLabel": {"points": "points", "miles": "miles", "cashback": "cash back"}[unit], "valueCents": {}}
    if unit != "cashback" and cur.get("cashCentsPerUnit") is not None and isinstance(cur.get("source"), int) and cur["source"] < len(pages) and pages[cur["source"]].get("ok") and quote_found(cur.get("quote"), pages[cur["source"]]["text"]):
        c["valueCents"]["cash"] = cur["cashCentsPerUnit"]; c["source"] = {"url": pages[cur["source"]]["url"], "quote": cur["quote"], "kind": pages[cur["source"]]["kind"], "asOf": TODAY}
    elif unit != "cashback":
        c["source"] = {"url": None, "quote": None, "kind": "estimate", "note": "No cash value stated in the sources; Benny counts 0 in cash mode."}
    card["currency"] = c
    for r in earn:
        e = {"id": slug(r["label"]) or "rule", "label": r["label"], "categories": r["categories"], "rate": r["rate"], "source": source_obj(r)}
        if r.get("conditional"): e["conditional"] = True; e["condition"] = r.get("condition") or "conditional"
        if r.get("spendCap"): e["cap"] = {"note": r["spendCap"]}
        if r.get("excludes"): e["excludesText"] = r["excludes"]
        card["earn"].append(e)
    for r in credits:
        card["credits"].append({"id": slug(r["label"]), "label": r["label"], "short": r["label"][:40], "amountUsd": r["amountUsd"],
                                "period": r["period"] if r["period"] in ("monthly", "quarterly", "semiannual", "annual") else "annual",
                                "periodNote": None if r["period"] in ("monthly", "quarterly", "semiannual", "annual") else f"Issuer period: {r['period'].replace('_', ' ')}.",
                                "requiresActivation": bool(r["requiresActivation"]), "match": {"merchants": map_merchants(r.get("merchantNames"), mcc)},
                                "merchantNames": r.get("merchantNames") or [], "source": source_obj(r)})
    for r in perks:
        if r.get("requiresActivation"): card["perks"].append({"id": slug(r["label"]), "label": r["label"], "requiresActivation": True, "source": source_obj(r)})
    for r in prots:
        p = {"type": r["type"], "label": LABEL[r["type"]], "source": source_obj(r), "claim": {}, "requiredDocs": DEFAULT_DOCS.get(r["type"], ["receipt", "statement"])}
        for k in ["windowDays", "perItemCapUsd", "addsMonths", "maxOriginalWarrantyMonths", "minDelayHours", "perTravelerCapUsd"]:
            if r.get(k) is not None: p[k] = r[k]
        # the engine needs these to decide; without them the protection is listed but never used for a coverage decision
        need = {"extended_warranty": ["addsMonths", "maxOriginalWarrantyMonths"], "purchase_protection": ["windowDays"], "trip_delay": ["minDelayHours", "perTravelerCapUsd"]}.get(r["type"], [])
        missing = [k for k in need if p.get(k) is None]
        if r["type"] == "extended_warranty" and not missing: p.setdefault("maxTotalMonths", p["maxOriginalWarrantyMonths"] + p["addsMonths"])
        if missing: p["incomplete"] = missing
        card["protections"].append(p)
    if c["unit"] != "cashback" and "cash" not in c["valueCents"]:
        report["warnings"].append(f"{cid}: no cash value per {c['unitLabel'][:-1] if c['unitLabel'].endswith('s') else c['unitLabel']} stated in its sources; counts $0 in cash mode until a sourced value is added")
    if not any("*" in e["categories"] and not e.get("conditional") for e in card["earn"]):
        report["warnings"].append(f"{cid}: no base rate for all other purchases was verified")
    return card

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetcher", default="auto", choices=["auto", "plain", "brightdata"])
    ap.add_argument("--only", default=""); ap.add_argument("--refetch", action="store_true")
    ap.add_argument("--model", default="gemini-3.8-flash"); ap.add_argument("--base", default=os.path.join(HERE, "..", "rules.json"))
    ap.add_argument("--publish", action="store_true", help="write out/rules.json into the Benny app (Mana)")
    a = ap.parse_args()
    cards = json.load(open(os.path.join(HERE, "cards.json")))["cards"]
    if a.only: cards = [c for c in cards if c["cardId"] in a.only.split(",")]
    base = json.load(open(a.base))
    report = {"generatedAt": TODAY, "fetcher": a.fetcher, "model": a.model, "cards": {}, "rejected": [], "conflicts": [], "warnings": []}
    log(f"fetching {sum(len(c['sources']) for c in cards)} pages ({a.fetcher})")
    with cf.ThreadPoolExecutor(8) as ex:
        futs = {(c["cardId"], i): ex.submit(fetch_source, c["cardId"], i, s, a.fetcher, a.refetch) for c in cards for i, s in enumerate(c["sources"])}
        pages = {k: f.result() for k, f in futs.items()}
    def run(c):
        ps = [pages[(c["cardId"], i)] for i in range(len(c["sources"]))]
        ext, err = extract(c, ps, a.model)
        return c, ps, ext, err
    built = {}
    with cf.ThreadPoolExecutor(4) as ex:
        for c, ps, ext, err in ex.map(run, cards):
            rec = {"sources": [{"url": p["url"], "kind": p["kind"], "ok": p.get("ok"), "fetcher": p.get("fetcher"), "attempts": p.get("attempts")} for p in ps]}
            if err: rec["error"] = err; log(f"  {c['cardId']}: {err}")
            else:
                card = build_card(c, ext, ps, base.get("mcc", []), report); built[c["cardId"]] = card
                rec.update(earn=len(card["earn"]), credits=len(card["credits"]), perks=len(card["perks"]), protections=len(card["protections"]),
                           extracted={k: len(ext.get(k) or []) for k in ["earn", "credits", "perks", "protections"]})
                log(f"  {c['cardId']}: {rec['earn']} earn, {rec['credits']} credits, {rec['protections']} protections")
            report["cards"][c["cardId"]] = rec
    merged = json.loads(json.dumps(base)); merged.setdefault("cards", {})
    for cid, card in merged["cards"].items():
        if card.get("verified"): card["handChecked"] = True
    for cid, card in built.items():
        if merged["cards"].get(cid, {}).get("handChecked"): report["warnings"].append(f"{cid}: hand-checked card kept; pipeline output ignored"); continue
        merged["cards"][cid] = card
    merged.update(version=f"0.2.0-{TODAY}", generatedAt=TODAY, note=f"{sum(1 for c in merged['cards'].values() if c.get('handChecked'))} hand-checked cards plus {len(built)} pipeline cards. Every rule has a source quote found in the fetched page; null means not confirmed.")
    json.dump(merged, open(os.path.join(OUT, "rules.json"), "w"), indent=1, ensure_ascii=False)
    json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1, ensure_ascii=False)
    open(os.path.join(OUT, "report.md"), "w").write(markdown_report(report, merged))
    log(f"wrote out/rules.json ({len(merged['cards'])} cards), {len(report['rejected'])} rejected rules, {len(report['conflicts'])} conflicts")
    if a.publish: publish(merged, report)

def markdown_report(rep, merged):
    L = [f"# Benny rules pipeline report ({rep['generatedAt']})", "", f"Fetcher: {rep['fetcher']} · model: {rep['model']} · cards: {len(merged['cards'])}", "",
         "| Card | Sources ok | Earn | Credits | Protections | Notes |", "|---|---|---|---|---|---|"]
    for cid, r in rep["cards"].items():
        ok = sum(1 for s in r["sources"] if s["ok"]); L.append(f"| {cid} | {ok}/{len(r['sources'])} | {r.get('earn', '-')} | {r.get('credits', '-')} | {r.get('protections', '-')} | {r.get('error', '')} |")
    L += ["", f"## Conflicts ({len(rep['conflicts'])}) — issuer wins", ""] + [f"- **{c['card']}** {c['rule']}: {json.dumps({k: v for k, v in c.items() if k in ('issuer', 'review', 'kept')})}" for c in rep["conflicts"]]
    L += ["", f"## Rejected rules ({len(rep['rejected'])})", ""] + [f"- {r['card']} · {r['kind']} · {r['rule']}: {r['why']}" for r in rep["rejected"]]
    L += ["", "## Warnings", ""] + [f"- {w}" for w in rep["warnings"]]
    return "\n".join(L) + "\n"

def publish(merged, report):
    from firebase_helper import firebase
    app = os.environ.get("BENNY_APP", "VwgamtqxM2cvND2ygrLKnkVCS4n1/file-system/apps/benny/app")
    prev = firebase.read(app + "/rules/json")
    now = int(time.time() * 1000)
    firebase.update(app + "/rules", {"json": json.dumps(merged, ensure_ascii=False), "previousJson": prev, "version": merged["version"], "cards": len(merged["cards"]),
                                     "merchants": len(merged.get("mcc", [])), "report": open(os.path.join(OUT, "report.md")).read(), "metadata/updatedAt": now})
    log(f"published {merged['version']} to {app}/rules (previous kept at rules/previousJson)")

if __name__ == "__main__":
    main()
