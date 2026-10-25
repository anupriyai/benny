#!/usr/bin/env python3
"""Benny+ hosted shopping browser (for Mana accounts that can't run their own sandbox yet).

Runs in the Benny+ host's Mana sandbox. Every signed-in Benny+ user gets a PRIVATE session: their own isolated
browser context (separate cookies, sign-ins and storage, closed after 15 idle minutes), never the host's own
browser profile and never CDP access. Identity = X-Sender-Uid (Mana forward-auth). Only users who already have
Benny+ records may use it. Requests to loopback, private, link-local or internal hosts are blocked, including
WebSockets, and service workers are disabled. Saved autofill cards are encrypted per user at rest on this host and
are never returned to any browser. Nothing here ever clicks Place order or pays.
"""
import asyncio, hashlib, ipaddress, json, os, re, socket, sqlite3, time, urllib.parse, urllib.request
from aiohttp import web
from playwright.async_api import async_playwright
from cryptography.fernet import Fernet

PORT = int(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "port")).read().strip())
ROOT = "/workspace/benny-shop-hosted"
CARDDIR = ROOT + "/state/cards"; KEYF = ROOT + "/state/cards.key"
BENNY_DB = "/workspace/benny-plus-api/state/benny.db"
EXTRA_ALLOWED = set(filter(None, os.environ.get("BENNY_SHOP_ALLOW", "").split(",")))
CDP = "http://127.0.0.1:9222"
MAX_TEXT = 24000; VW, VH = 1280, 800; MAX_SESSIONS = 6; IDLE_S = 15 * 60
KEYS = {"Enter", "Backspace", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete", "Home", "End", "PageUp", "PageDown", "Space"}
os.makedirs(CARDDIR, exist_ok=True); os.chmod(ROOT + "/state", 0o700); os.chmod(CARDDIR, 0o700)
_pw = None; _browser = None; _blk = asyncio.Lock()
SESS = {}   # uid -> {"ctx", "page", "lock", "last", "lastLoad", "mouse"}

def allowed(uid):
    if uid in EXTRA_ALLOWED: return True
    try:
        c = sqlite3.connect("file:%s?mode=ro" % BENNY_DB, uri=True, timeout=2)
        try: return c.execute("SELECT 1 FROM users WHERE owner=? UNION SELECT 1 FROM card_accounts WHERE owner=? LIMIT 1", (uid, uid)).fetchone() is not None
        finally: c.close()
    except Exception as e:
        print("allow check:", repr(e)[:120], flush=True); return False

# ---------- cards (encrypted at rest per user, never returned) ----------
def fernet():
    if not os.path.exists(KEYF):
        fd = os.open(KEYF, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f: f.write(Fernet.generate_key())
    with open(KEYF, "rb") as f: return Fernet(f.read())
def cfile(uid): return CARDDIR + "/" + hashlib.sha256(uid.encode()).hexdigest()[:32] + ".enc"
def cards_load(uid):
    p = cfile(uid)
    if not os.path.exists(p): return {}
    with open(p, "rb") as f: return json.loads(fernet().decrypt(f.read()).decode())
def cards_save(uid, c):
    p = cfile(uid); t = p + ".tmp"
    fd = os.open(t, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f: f.write(fernet().encrypt(json.dumps(c).encode()))
    os.replace(t, p)
def luhn(n):
    s = 0
    for i, d in enumerate(reversed(n)):
        x = int(d) * (2 if i % 2 else 1); s += x - 9 if x > 9 else x
    return s % 10 == 0
def brand(n):
    if re.match(r"^3[47]", n): return "American Express"
    if re.match(r"^4", n): return "Visa"
    if re.match(r"^(5[1-5]|2[2-7])", n): return "Mastercard"
    if re.match(r"^(6011|65|64[4-9])", n): return "Discover"
    return "Card"
def public(k, c): return {"key": k, "label": c.get("label", ""), "last4": c["number"][-4:], "brand": brand(c["number"]), "exp": "%02d/%02d" % (c["exp_month"], c["exp_year"] % 100), "hasName": bool(c.get("name")), "hasZip": bool(c.get("zip")), "savedAt": c.get("savedAt")}

# ---------- network guard: no loopback / private / internal destinations ----------
_dns = {}
def _ip_bad(ip):
    a = ipaddress.ip_address(ip)
    return a.is_private or a.is_loopback or a.is_link_local or a.is_multicast or a.is_reserved or a.is_unspecified or (a.version == 6 and a.ipv4_mapped and _ip_bad(str(a.ipv4_mapped)))
def host_bad(host):
    host = (host or "").strip("[]").lower().rstrip(".")
    if not host or host == "localhost" or host.endswith(".localhost") or host.endswith(".internal") or host.endswith(".local"): return True
    try: return _ip_bad(host)
    except ValueError: pass
    hit = _dns.get(host)
    if hit and hit[1] > time.time(): return hit[0]
    try: bad = any(_ip_bad(x[4][0]) for x in socket.getaddrinfo(host, None))
    except Exception: bad = False   # unresolvable: Chrome will fail on its own
    _dns[host] = (bad, time.time() + 300); return bad
async def url_bad(u):
    p = urllib.parse.urlsplit(u)
    if p.scheme in ("data", "blob", "about"): return False
    if p.scheme not in ("http", "https", "ws", "wss"): return True
    return await asyncio.to_thread(host_bad, p.hostname or "")
async def guard_route(route):
    try:
        if await url_bad(route.request.url): return await route.abort("blockedbyclient")
        await route.continue_()
    except Exception: pass
async def guard_ws(ws):
    if await url_bad(ws.url): await ws.close(code=1008, reason="blocked")
    else: ws.connect_to_server()


# ---------- egress proxy: every hosted-context connection (including redirects and WebSockets) goes through here ----------
PROXY_PORT = int(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxy_port")).read().strip())
async def _resolve_public(host, port):
    host = (host or "").strip("[]").lower().rstrip(".")
    if not host or host == "localhost" or host.endswith((".localhost", ".internal", ".local")): return None
    try: infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except Exception: return None
    ips = [i[4][0] for i in infos]
    if not ips or any(_ip_bad(ip) for ip in ips): return None
    return ips[0]
async def _pipe(r, w):
    try:
        while True:
            d = await r.read(65536)
            if not d: break
            w.write(d); await w.drain()
    except Exception: pass
    finally:
        try: w.close()
        except Exception: pass
async def _deny(w, code=403):
    try: w.write(b"HTTP/1.1 %d Blocked\r\nContent-Length: 0\r\nConnection: close\r\n\r\n" % code); await w.drain(); w.close()
    except Exception: pass
async def _proxy_client(cr, cw):
    try:
        head = await asyncio.wait_for(cr.readuntil(b"\r\n\r\n"), 20)
        lines = head.decode("latin-1").split("\r\n"); method, target, ver = lines[0].split(" ", 2)
        if method.upper() == "CONNECT":
            host, _, port = target.rpartition(":"); port = int(port or 443)
            ip = await _resolve_public(host, port)
            if not ip: return await _deny(cw)
            ur, uw = await asyncio.wait_for(asyncio.open_connection(ip, port), 20)
            cw.write(b"HTTP/1.1 200 Connection Established\r\n\r\n"); await cw.drain()
            await asyncio.gather(_pipe(cr, uw), _pipe(ur, cw)); return
        u = urllib.parse.urlsplit(target)
        if u.scheme != "http" or not u.hostname: return await _deny(cw, 400)
        port = u.port or 80; ip = await _resolve_public(u.hostname, port)
        if not ip: return await _deny(cw)
        hdrs = [l for l in lines[1:] if l and not l.lower().startswith(("connection:", "proxy-connection:", "keep-alive:", "proxy-authorization:"))]
        path = (u.path or "/") + ("?" + u.query if u.query else "")
        ur, uw = await asyncio.wait_for(asyncio.open_connection(ip, port), 20)
        uw.write(("%s %s %s\r\n" % (method, path, ver) + "\r\n".join(hdrs) + "\r\nConnection: close\r\n\r\n").encode("latin-1")); await uw.drain()
        await asyncio.gather(_pipe(cr, uw), _pipe(ur, cw))   # one request per connection: Chrome can't reuse it for another host
    except Exception:
        try: cw.close()
        except Exception: pass

# ---------- browser sessions ----------
def ensure_chrome():
    try: urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:19222/ensure-up", method="POST"), timeout=60).close()
    except Exception as e: print("ensure-up failed:", e, flush=True)
async def browser():
    global _pw, _browser
    async with _blk:
        if _browser is not None and _browser.is_connected(): return _browser
        await asyncio.to_thread(ensure_chrome)
        if _pw is None: _pw = await async_playwright().start()
        _browser = await _pw.chromium.connect_over_cdp(CDP)
        SESS.clear()   # contexts died with the old connection
        return _browser
def sess(uid):
    s = SESS.get(uid)
    if s is None: s = SESS[uid] = {"ctx": None, "page": None, "lock": asyncio.Lock(), "last": time.time(), "lastLoad": None, "mouse": [VW / 2, VH / 2]}
    s["last"] = time.time(); return s
def alive(s): return s["page"] is not None and not s["page"].is_closed()
async def page_of(uid, create=False):
    s = sess(uid)
    if alive(s):
        try:
            if s["page"].context.browser and s["page"].context.browser.is_connected(): return s["page"]
        except Exception: pass
    if not create: return None
    open_n = sum(1 for k, v in SESS.items() if k != uid and alive(v))
    if open_n >= MAX_SESSIONS: raise web.HTTPServiceUnavailable(text=json.dumps({"error": "The shared shopping browser is busy right now. Try again in a few minutes."}), content_type="application/json")
    b = await browser(); s = sess(uid)
    if s["ctx"] is not None:
        try: await s["ctx"].close()
        except Exception: pass
    ctx = await b.new_context(viewport={"width": VW, "height": VH}, service_workers="block", accept_downloads=False,
                              proxy={"server": "http://127.0.0.1:%d" % PROXY_PORT, "bypass": "<-loopback>"})
    await ctx.route("**/*", guard_route)
    try: await ctx.route_web_socket(re.compile(".*"), guard_ws)
    except Exception as e: print("ws guard unavailable:", repr(e)[:120], flush=True)
    s["ctx"] = ctx; s["page"] = await ctx.new_page(); s["lastLoad"] = None
    return s["page"]
async def tid_of(page):
    cs = await page.context.new_cdp_session(page)
    try: return (await cs.send("Target.getTargetInfo"))["targetInfo"]["targetId"]
    finally:
        try: await cs.detach()
        except Exception: pass
async def tab_info(uid):
    s = SESS.get(uid)
    if not s or not alive(s): return {"targetId": None, "hosted": True}
    p = s["page"]
    try: tid = await tid_of(p)
    except Exception: tid = "hosted-" + hashlib.sha256(uid.encode()).hexdigest()[:12]
    try: title = await p.title()
    except Exception: title = ""
    info = {"targetId": tid, "url": p.url, "title": title, "alive": True, "hosted": True}
    ll = s.get("lastLoad")
    if ll and p.url in (ll.get("url"), ll.get("finalUrl")): info["load"] = ll
    return info
async def reaper():
    while True:
        await asyncio.sleep(60)
        for uid, s in list(SESS.items()):
            if time.time() - s["last"] > IDLE_S:
                try:
                    if s["ctx"] is not None: await s["ctx"].close()
                except Exception: pass
                SESS.pop(uid, None)

# ---------- load verdicts ----------
BROKEN_RE = re.compile(r"service unavailable|dns failure|access denied|403 forbidden|404 not found|page not found|bad gateway|gateway time-?out|this site can.t be reached|pardon our interruption|request blocked|reference #?\d{1,3}\.[0-9a-f]{4,}", re.I)
CHALLENGE_RE = re.compile(r"just a moment|verify (you are|you.re) human|are you a robot|captcha|before you continue|unusual traffic|consent", re.I)
async def navigate(page, url):
    """goto + classify how the main document loaded. Never raises."""
    load = {"url": url, "ok": True, "kind": "ok", "httpStatus": None, "error": None, "title": "", "finalUrl": url, "at": int(time.time() * 1000)}
    try:
        resp = await page.goto(url, wait_until="commit", timeout=20000)
        if resp is not None: load["httpStatus"] = resp.status
    except Exception as e:
        msg = str(e); load["error"] = msg[:200]
        if "Timeout" in msg or "timeout" in msg: load["kind"] = "timeout"
        else: load["ok"] = False; load["kind"] = "network"
    try: await page.wait_for_load_state("domcontentloaded", timeout=2500)
    except Exception: pass
    try:
        load["finalUrl"] = page.url
        d = await page.evaluate("() => ({ t: document.title || '', b: ((document.body && document.body.innerText) || '').slice(0, 600), n: ((document.body && document.body.innerText) || '').length })")
        load["title"] = d.get("t", "")
        if not load["ok"]: pass  # navigation already failed (DNS, connection): keep kind "network"
        elif load["finalUrl"].startswith("chrome-error://"): load["ok"] = False; load["kind"] = "network"
        elif load["httpStatus"] is not None and load["httpStatus"] >= 400: load["ok"] = False; load["kind"] = "http"
        elif CHALLENGE_RE.search(d.get("t", "")) or (CHALLENGE_RE.search(d.get("b", "")) and d.get("n", 0) < 2500): load["kind"] = "challenge"
        elif BROKEN_RE.search(d.get("t", "")) or (BROKEN_RE.search(d.get("b", "")) and d.get("n", 0) < 1500): load["ok"] = False; load["kind"] = "errorpage"
    except Exception as e:
        print("classify:", repr(e)[:160], flush=True)
    return load
# ---------- card filling ----------
SEL = {
 "number": ['input[autocomplete="cc-number"]', 'input[name*="cardnumber" i]', 'input[id*="cardnumber" i]', 'input[name*="card_number" i]', 'input[name*="card-number" i]', 'input[id*="card-number" i]', 'input[id*="card_number" i]', 'input[name="addCreditCardNumber"]', 'input[data-elements-stable-field-name="cardNumber"]', 'input[aria-label*="card number" i]', 'input[placeholder*="card number" i]', 'input[name="number"][inputmode="numeric"]'],
 "exp": ['input[autocomplete="cc-exp"]', 'input[name*="expiry" i]:not([name*="month" i]):not([name*="year" i])', 'input[name*="expiration" i]:not([name*="month" i]):not([name*="year" i])', 'input[id*="expir" i]:not([id*="month" i]):not([id*="year" i])', 'input[name="exp-date"]', 'input[data-elements-stable-field-name="cardExpiry"]', 'input[placeholder*="MM / YY" i]', 'input[placeholder*="MM/YY" i]', 'input[aria-label*="expiration date" i]', 'input[aria-label*="expiry" i]'],
 "month": ['select[autocomplete="cc-exp-month"]', 'input[autocomplete="cc-exp-month"]', 'select[name*="month" i]', 'select[id*="month" i]', 'input[name*="expmonth" i]', 'input[name*="exp_month" i]'],
 "year": ['select[autocomplete="cc-exp-year"]', 'input[autocomplete="cc-exp-year"]', 'select[name*="year" i]', 'select[id*="year" i]', 'input[name*="expyear" i]', 'input[name*="exp_year" i]'],
 "name": ['input[autocomplete="cc-name"]', 'input[name*="nameoncard" i]', 'input[name*="cardholder" i]', 'input[id*="cardholder" i]', 'input[name*="name_on_card" i]', 'input[name*="ccname" i]', 'input[aria-label*="name on card" i]', 'input[placeholder*="name on card" i]', 'input[placeholder*="cardholder" i]'],
}
async def first_visible(frame, sels):
    for s in sels:
        try:
            loc = frame.locator(s)
            n = await loc.count()
            for i in range(min(n, 4)):
                el = loc.nth(i)
                if await el.is_visible() and await el.is_enabled(): return el
        except Exception: continue
    return None
async def type_into(el, text):
    await el.click(timeout=4000)
    try: await el.fill("", timeout=2000)
    except Exception: pass
    await el.press_sequentially(text, delay=35, timeout=15000)
async def pick_option(el, values):
    for v in values:
        for how in ("value", "label"):
            try:
                await el.select_option(**{how: v}, timeout=2000); return True
            except Exception: continue
    return False
async def autofill(page, c):
    mm, yy = c["exp_month"], c["exp_year"]; done = []
    for frame in page.frames:
        try:
            if "number" not in done:
                el = await first_visible(frame, SEL["number"])
                if el: await type_into(el, c["number"]); done.append("number")
            if "exp" not in done:
                el = await first_visible(frame, SEL["exp"])
                if el:
                    ml = await el.get_attribute("maxlength"); ph = (await el.get_attribute("placeholder") or "")
                    four = "YYYY" in ph.upper() or (ml and ml.isdigit() and int(ml) >= 7)
                    await type_into(el, "%02d/%s" % (mm, str(yy) if four else "%02d" % (yy % 100))); done.append("exp")
                else:
                    em = await first_visible(frame, SEL["month"]); ey = await first_visible(frame, SEL["year"])
                    if em and ey:
                        ok1 = await pick_option(em, ["%02d" % mm, str(mm)]) if await em.evaluate("e => e.tagName") == "SELECT" else (await type_into(em, "%02d" % mm) or True)
                        ok2 = await pick_option(ey, [str(yy), "%02d" % (yy % 100)]) if await ey.evaluate("e => e.tagName") == "SELECT" else (await type_into(ey, str(yy)) or True)
                        if ok1 and ok2: done.append("exp")
            if "name" not in done and c.get("name"):
                el = await first_visible(frame, SEL["name"])
                if el: await type_into(el, c["name"]); done.append("name")
        except Exception as e:
            print("fill frame:", repr(e)[:200], flush=True)
    return done


# ---------- HTTP ----------
def cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"; resp.headers["Access-Control-Allow-Headers"] = "authorization, content-type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"; resp.headers["Cache-Control"] = "no-store"
    return resp
def j(d, status=200): return cors(web.json_response(d, status=status))
@web.middleware
async def guard(request, handler):
    if request.method == "OPTIONS": return cors(web.Response(status=204))
    if request.path in ("/healthz", "/"): return await handler(request)
    uid = request.headers.get("X-Sender-Uid") or ""
    if not uid: return j({"error": "Sign in to Mana to use the shopping browser."}, 401)
    if not await asyncio.to_thread(allowed, uid): return j({"error": "Set up Benny+ first, then open Shop again."}, 403)
    request["uid"] = uid
    try: return await handler(request)
    except web.HTTPException as e: return cors(web.Response(status=e.status, text=e.text or json.dumps({"error": e.reason}), content_type="application/json"))
    except Exception as e:
        print("error", request.path, repr(e)[:300], flush=True)   # never logs bodies (card data)
        return j({"error": str(e)[:300]}, 500)
async def healthz(r): return j({"ok": True, "service": "benny-shop-hosted", "version": 2, "sessions": sum(1 for v in SESS.values() if alive(v))})
def clean_url(u):
    u = (u or "").strip()
    if not u: return "https://www.google.com/"
    if not re.match(r"^https?://", u, re.I): u = "https://" + u
    return u
async def get_tab(r): return j(await tab_info(r["uid"]))
async def open_tab(r):
    uid = r["uid"]; body = await r.json() if r.can_read_body else {}; url = clean_url(body.get("url"))
    if await url_bad(url): return j({"error": "That address can’t be opened here."}, 400)
    s = sess(uid)
    async with s["lock"]:
        page = await page_of(uid, create=True)
        load = await navigate(page, url); s["lastLoad"] = load
    info = await tab_info(uid); info["load"] = load
    return j(info)
async def nav(r):
    uid = r["uid"]; body = await r.json() if r.can_read_body else {}
    page = await page_of(uid)
    if page is None: return j({"error": "no shop tab"}, 404)
    a = body.get("action")
    try:
        if a == "back": await page.go_back(wait_until="commit", timeout=15000)
        elif a == "forward": await page.go_forward(wait_until="commit", timeout=15000)
        elif a == "reload": await page.reload(wait_until="commit", timeout=20000)
    except Exception as e: print("nav:", repr(e)[:200], flush=True)
    return j(await tab_info(uid))
READ_JS = """() => { const t = (document.body && document.body.innerText) || '';
  return { url: location.href, title: document.title, host: location.hostname, text: t.replace(/[ \\t]+/g, ' ').replace(/\\n\\s*\\n+/g, '\\n') }; }"""
async def read_page(r):
    page = await page_of(r["uid"])
    if page is None: return j({"error": "no shop tab"}, 404)
    try: await page.wait_for_load_state("domcontentloaded", timeout=8000)
    except Exception: pass
    d = await page.evaluate(READ_JS); t = d.get("text") or ""
    d["truncated"] = len(t) > MAX_TEXT; d["text"] = t[:MAX_TEXT]; d["readAt"] = int(time.time() * 1000)
    return j(d)
async def shot(r):
    page = await page_of(r["uid"])
    if page is None: return j({"error": "no shop tab"}, 404)
    img = await page.screenshot(type="jpeg", quality=60, timeout=8000)
    resp = web.Response(body=img, content_type="image/jpeg"); resp.headers["X-Page-Url"] = page.url[:500]
    return cors(resp)
async def do_input(r):
    uid = r["uid"]; page = await page_of(uid)
    if page is None: return j({"error": "no shop tab"}, 404)
    s = sess(uid); b = await r.json() if r.can_read_body else {}; k = b.get("kind")
    try:
        if k == "click":
            x = min(1, max(0, float(b.get("x", 0)))) * VW; y = min(1, max(0, float(b.get("y", 0)))) * VH
            await page.mouse.click(x, y); s["mouse"] = [x, y]
        elif k == "type":
            t = str(b.get("text", ""))[:2000]
            if t: await page.keyboard.type(t)
        elif k == "key":
            key = str(b.get("key", ""))
            if key not in KEYS: return j({"error": "key not allowed"}, 400)
            await page.keyboard.press(" " if key == "Space" else key)
        elif k == "scroll":
            dy = max(-2400, min(2400, float(b.get("dy", 0))))
            await page.mouse.move(*s["mouse"]); await page.mouse.wheel(0, dy)
        else: return j({"error": "unknown input"}, 400)
    except Exception as e: print("input:", repr(e)[:200], flush=True)
    return j(await tab_info(uid))
async def close_tab(r):
    s = SESS.pop(r["uid"], None)
    if s and s["ctx"] is not None:
        try: await s["ctx"].close()
        except Exception: pass
    return j({"targetId": None, "hosted": True})
async def list_cards(r):
    c = await asyncio.to_thread(cards_load, r["uid"])
    return j({"cards": [public(k, v) for k, v in c.items()]})
async def save_card(r):
    uid = r["uid"]; b = await r.json()
    key = str(b.get("key") or "").strip()[:80]
    num = re.sub(r"\D", "", str(b.get("number") or ""))
    try: mm = int(b.get("exp_month")); yy = int(b.get("exp_year"))
    except Exception: return j({"error": "Enter the expiry as MM/YY."}, 400)
    if yy < 100: yy += 2000
    if not key: return j({"error": "missing card key"}, 400)
    if not (12 <= len(num) <= 19) or not luhn(num): return j({"error": "That card number doesn’t look right. Check the digits."}, 400)
    if not (1 <= mm <= 12) or yy < 2000 or yy > 2100: return j({"error": "Enter the expiry as MM/YY."}, 400)
    c = await asyncio.to_thread(cards_load, uid)
    c[key] = {"number": num, "exp_month": mm, "exp_year": yy, "name": str(b.get("name") or "").strip()[:80], "zip": re.sub(r"[^0-9A-Za-z -]", "", str(b.get("zip") or ""))[:12], "label": str(b.get("label") or "")[:80], "savedAt": int(time.time() * 1000)}
    await asyncio.to_thread(cards_save, uid, c)
    return j({"card": public(key, c[key])})
async def delete_card(r):
    uid = r["uid"]; key = r.match_info["key"]; c = await asyncio.to_thread(cards_load, uid)
    c.pop(key, None); await asyncio.to_thread(cards_save, uid, c); return j({"ok": True})
async def fill(r):
    uid = r["uid"]; b = await r.json(); c = (await asyncio.to_thread(cards_load, uid)).get(str(b.get("key") or ""))
    if not c: return j({"error": "No payment details saved for this card yet."}, 404)
    page = await page_of(uid)
    if page is None: return j({"error": "Open a store first."}, 404)
    field = b.get("field") or "auto"
    if field == "auto":
        done = await autofill(page, c)
        return j({"filled": done, "message": ("Filled " + ", ".join({"number": "card number", "exp": "expiry", "name": "name on card"}[x] for x in done) + ". Type the security code yourself.") if done else "Couldn’t find the card form on this page. Click the card number field, then use the field buttons."})
    vals = {"number": c["number"], "exp": "%02d/%02d" % (c["exp_month"], c["exp_year"] % 100), "month": "%02d" % c["exp_month"], "year": str(c["exp_year"]), "name": c.get("name", ""), "zip": c.get("zip", "")}
    v = vals.get(field)
    if not v: return j({"error": "Nothing saved for that field."}, 400)
    await page.keyboard.type(v, delay=30)
    return j({"filled": [field], "message": "Typed into the field you selected."})

async def on_start(app):
    app["reaper"] = asyncio.create_task(reaper())
    app["proxy"] = await asyncio.start_server(_proxy_client, "127.0.0.1", PROXY_PORT)
app = web.Application(middlewares=[guard], client_max_size=64 * 1024)
app.on_startup.append(on_start)
app.add_routes([web.get("/healthz", healthz), web.get("/", healthz), web.get("/tab", get_tab), web.post("/open", open_tab), web.post("/nav", nav),
                web.get("/read", read_page), web.get("/shot", shot), web.post("/input", do_input), web.post("/close", close_tab),
                web.get("/cards", list_cards), web.post("/cards", save_card), web.delete("/cards/{key}", delete_card), web.post("/fill", fill)])
app.router.add_route("OPTIONS", "/{tail:.*}", lambda r: cors(web.Response(status=204)))
if __name__ == "__main__":
    print("benny-shop-hosted listening on", PORT, flush=True)
    web.run_app(app, host="127.0.0.1", port=PORT, print=None, access_log=None)
