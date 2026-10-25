#!/usr/bin/env python3
"""Benny iPhone feed. An iOS Shortcut 'Transaction' automation POSTs {merchant, amount, card} to /tx?k=<key>;
we store the purchase for the key's user and answer with one notification-sized coaching line.
The Benny engine (app/engine/code) makes every money decision; it is loaded live from Firebase, so app and feed agree.
Gemini (Mana router) is used only to classify a merchant Benny's table doesn't know. Runs in Anupriya's sandbox (daemon benny-feed)."""
import json, os, re, time, hashlib, subprocess, datetime, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from zoneinfo import ZoneInfo
from firebase_helper import firebase

APP = "VwgamtqxM2cvND2ygrLKnkVCS4n1/file-system/apps/benny/app"
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(open(os.path.join(HERE, "port")).read().strip())
TZ = ZoneInfo("America/Los_Angeles")
DURABLE = {"electronics", "home_improvement", "department", "wholesale", "online", "home"}
_cache, _lock = {}, threading.Lock()

def cached(key, fn, ttl):
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < ttl: return hit[1]
    val = fn()
    with _lock: _cache[key] = (time.time(), val)
    return val

def rules(): return cached("rules", lambda: json.loads(firebase.read(APP + "/rules/json")), 60)
def engine(): return cached("engine", lambda: firebase.read(APP + "/engine/code"), 60)
def uid_for(key):
    h = hashlib.sha256(key.encode()).hexdigest()
    rec = cached("k:" + h, lambda: firebase.read(APP + "/shortcutKeys/" + h), 20)
    return (rec or {}).get("uid"), h

def node(payload):
    r = subprocess.run(["node", os.path.join(HERE, "coach.js")], input=json.dumps(payload), capture_output=True, text=True, timeout=15)
    if r.returncode: raise RuntimeError(r.stderr[-400:])
    return json.loads(r.stdout)

def ai_merchant(name):
    """Gemini reads; it doesn't decide. Returns a merchant record or None."""
    try:
        import mana_router, requests
        g = mana_router.provider("gemini")
        schema = {"type": "OBJECT", "properties": {"merchantName": {"type": "STRING"}, "categories": {"type": "ARRAY", "items": {"type": "STRING", "enum": ["dining", "grocery", "online_grocery", "gas", "ev_charging", "travel", "airline", "hotel_direct", "rideshare", "streaming", "drugstore", "department", "wholesale", "electronics", "home_improvement", "online", "other"]}}, "mcc": {"type": "STRING", "nullable": True}, "confidence": {"type": "NUMBER"}}, "required": ["merchantName", "categories", "mcc", "confidence"]}
        body = {"contents": [{"role": "user", "parts": [{"text": f'A card transaction shows the merchant "{name}". Identify the merchant and the Visa merchant category it most likely codes as. Categories from the allowed list, 4-digit MCC if known, confidence 0-1.'}]}],
                "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema, "temperature": 0}}
        r = requests.post(g.url + "/models/gemini-3.8-flash:generateContent", headers=dict(g.headers, **{"content-type": "application/json"}), json=body, timeout=12, allow_redirects=False)
        if r.status_code != 200: return None
        o = json.loads("".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"]))
        cats = [c for c in o.get("categories") or [] if isinstance(c, str)]
        if not cats: return None
        if "airline" in cats and "travel" not in cats: cats.append("travel")
        slug = re.sub(r"[^a-z0-9]+", "-", o["merchantName"].lower()).strip("-")[:40] or "unknown"
        return {"id": "ai-" + slug, "name": o["merchantName"], "categories": cats, "mcc": o.get("mcc") or "????", "confidence": "medium" if o.get("confidence", 0) >= 0.8 else "low", "aiResolved": True}
    except Exception:
        return None

def parse_amount(v):
    if isinstance(v, (int, float)): return abs(float(v))
    m = re.search(r"\d[\d,]*(?:\.\d+)?", str(v or ""))
    return abs(float(m.group(0).replace(",", ""))) if m else None

def handle_tx(body, key):
    if not key: return 401, "Benny: this Shortcut has no key. Copy your link again from Benny › You › iPhone feed."
    uid, kh = uid_for(key)
    if not uid: return 401, "Benny: this Shortcut link isn’t connected anymore. Copy a new link from Benny › You › iPhone feed."
    merchant_raw = str(body.get("merchant") or body.get("name") or "").strip()[:120]
    card_raw = str(body.get("card") or body.get("cardOrPass") or "").strip()[:120]
    amount = parse_amount(body.get("amount"))
    if not merchant_raw or amount is None: return 400, "Benny got the tap but not the merchant or amount. Check the Shortcut’s request body."
    R, src = rules(), engine()
    raw = firebase.read(f"{APP}/users/{uid}") or {}
    st = {"wallet": raw.get("wallet") or {}, "purchases": list((raw.get("purchases") or {}).values()), "certificates": list((raw.get("certificates") or {}).values()), "creditUses": raw.get("creditUses") or {}}
    settings = raw.get("settings") or {}
    today = (datetime.datetime.now(TZ).date() + datetime.timedelta(days=int(settings.get("demoDays") or 0))).isoformat()
    base = {"engineSrc": src, "rules": R, "state": st, "todayIso": today, "mode": "travel" if settings.get("valueMode") == "travel" else "cash"}
    res = node(dict(base, stage="resolve", merchant=merchant_raw, card=card_raw))
    m = res["merchant"] or ai_merchant(merchant_raw)
    card_id = res["card"]["cardId"]
    aliases = settings.get("cardAliases") or {}
    slug = re.sub(r"[^a-z0-9]+", "-", card_raw.lower()).strip("-")[:60]
    if not card_id and slug and aliases.get(slug) in st["wallet"]: card_id = aliases[slug]
    minute = datetime.datetime.now(TZ).strftime("%Y%m%d%H%M")
    pid = "s-" + hashlib.sha1(f"{uid}|{merchant_raw}|{amount}|{card_raw}|{minute}".encode()).hexdigest()[:10]
    cats = (m or {}).get("categories") or ["other"]
    p = {"id": pid, "merchant": (m or {}).get("name", merchant_raw).replace(" (booked direct)", "").replace(" warehouse", ""), "merchantId": (m or {}).get("id", "unknown"),
         "categories": cats, "date": today, "total": round(amount, 2), "cardId": card_id, "items": [], "durable": bool(set(cats) & DURABLE) and amount >= 50,
         "source": "shortcut", "raw": {"merchant": merchant_raw, "card": card_raw}, "createdAt": int(time.time() * 1000)}
    if card_id:
        out = node(dict(base, stage="coach", purchase=p))
        lines = out["lines"] or ["Logged in Benny."]
    else:
        cands = [R["cards"][c]["short"] for c in res["card"]["candidates"]]
        lines = [f"Logged {p['merchant']} ${amount:.2f}. Which card is “{card_raw or 'unknown'}”?" + (f" Could be {' or '.join(cands)}." if cands else "") + " Pick it in Benny once and it’ll remember."]
    reply = " ".join(lines[:3])
    firebase.update(f"{APP}/users/{uid}", {f"purchases/{pid}": p, "shortcut/lastSeen": p["createdAt"], "shortcut/lastReply": reply, "shortcut/lastPurchaseId": pid})
    return 200, reply

class H(BaseHTTPRequestHandler):
    def _send(self, code, text, ctype="text/plain; charset=utf-8"):
        b = text.encode("utf-8"); self.send_response(code)
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b)))
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "content-type"); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): self._send(204, "")
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/healthz", "/"): return self._send(200, "ok")
        self._send(404, "not found")
    def do_POST(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path != "/tx": return self._send(404, "not found")
        n = int(self.headers.get("Content-Length") or 0)
        if n > 8192: return self._send(413, "too large")
        raw = self.rfile.read(n).decode("utf-8", "replace") if n else ""
        try: body = json.loads(raw) if raw.strip().startswith("{") else {k: v[0] for k, v in parse_qs(raw).items()}
        except Exception: body = {}
        key = (q.get("k") or [None])[0] or body.get("key")
        try: code, text = handle_tx(body, key)
        except Exception as e:
            print("tx error", repr(e), flush=True); code, text = 200, "Benny logged nothing: something went wrong on the server. Try again."
        if (q.get("format") or [""])[0] == "json": return self._send(code, json.dumps({"reply": text, "ok": code == 200}), "application/json")
        self._send(code, text)
    def log_message(self, fmt, *a): print("%s %s" % (self.command, urlparse(self.path).path), flush=True)

if __name__ == "__main__":
    print(f"benny-feed on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
