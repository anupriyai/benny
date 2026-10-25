# Benny+ Gmail receipt import (v1). Runs in the signed-in user's OWN Mana sandbox, started by Benny+ (POST /run).
# Reads the user's own Google connection (read-only search of their Gmail), finds receipt / order-confirmation emails from the
# chosen window, and sends each one to the user's own Benny+ records through the Benny+ API, where the same receipt reader,
# auto-matching to card transactions and reward estimates run as for an uploaded email. Nothing is sent anywhere else;
# the Google token stays in this sandbox (passed to the worker in memory only). Progress: <this folder>/status.
import json, os, subprocess, sys, time
from env import get_user_id
from firebase_helper import firebase
from sandbox_runtime_context import get_api_keys, get_current_working_path

uid = get_user_id(); seg = list(get_current_working_path())
base = "/".join(seg[:-1]) if seg and seg[0] == uid else f"{uid}/file-system/" + "/".join(seg[:-1])
req = firebase.read(base + "/request") or {}
def status(**k):
    k["updatedAt"] = int(time.time() * 1000); firebase.update(base + "/status", k)
keys = get_api_keys()
tok = keys.get("GOOGLE_OAUTH_TOKEN") or next((v for k, v in keys.items() if k.startswith("GOOGLE_OAUTH_TOKEN")), None)
if not tok:
    status(state="error", error="not_connected", message="Connect your Google account first."); print("DONE not_connected"); sys.exit(0)
if not req.get("api"):
    status(state="error", error="no_api", message="Benny+ didn't say where to send the receipts."); print("DONE no_api"); sys.exit(0)
WORKER = r"""
import base64, json, os, re, sys, time, concurrent.futures as cf, email, requests
from email import policy
from firebase_helper import firebase
import auth
base, api, days, limit = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
tok = os.environ.pop("BP_GTOKEN"); G = "https://gmail.googleapis.com/gmail/v1/users/me"; GH = {"Authorization": "Bearer " + tok}
st = {"state": "running", "found": 0, "processed": 0, "imported": 0, "matched": 0, "duplicates": 0, "skipped": 0, "failed": 0, "days": days}
def push(**k):
    st.update(k); st["updatedAt"] = int(time.time() * 1000); firebase.write(base + "/status", st)
Q = ("newer_than:%dd -category:promotions -category:social -in:spam -in:trash "
     "(subject:(receipt OR order OR invoice OR \"order confirmation\" OR \"your purchase\" OR \"payment received\" OR \"thanks for your order\" "
     "OR \"thank you for your order\" OR \"you paid\" OR \"purchase confirmation\" OR \"e-receipt\" OR \"your trip\" OR \"booking confirmation\") "
     "OR from:(auto-confirm@amazon.com OR receipts OR receipt OR orders OR order-update))") % days
try:
    ids, page = [], None
    while len(ids) < limit:
        p = {"q": Q, "maxResults": min(100, limit - len(ids))}
        if page: p["pageToken"] = page
        r = requests.get(G + "/messages", headers=GH, params=p, timeout=30)
        if r.status_code in (401, 403):
            push(state="error", error="no_gmail_access", message="Your Google connection doesn't allow reading Gmail (" + str(r.status_code) + "). Reconnect Google and allow Gmail access."); sys.exit(0)
        r.raise_for_status(); d = r.json(); ids += [m["id"] for m in d.get("messages", [])]; page = d.get("nextPageToken")
        if not page: break
    push(found=len(ids))
    def slim(raw):
        m = email.message_from_bytes(raw, policy=policy.default)
        body = m.get_body(preferencelist=("html", "plain")); text = body.get_content() if body else ""
        ctype = body.get_content_type() if body else "text/plain"
        return ("Subject: %s\nFrom: %s\nDate: %s\nMIME-Version: 1.0\nContent-Type: %s; charset=utf-8\n\n%s" % (
            str(m.get("subject") or "").replace("\n", " "), str(m.get("from") or ""), str(m.get("date") or ""), ctype, text[:350000]))
    def one(mid):
        r = requests.get(G + "/messages/" + mid, headers=GH, params={"format": "raw"}, timeout=30)
        if r.status_code != 200: return "failed"
        d = r.json()
        if d.get("sizeEstimate", 0) > 8_000_000: return "skipped"
        eml = slim(base64.urlsafe_b64decode(d["raw"] + "=" * (-len(d["raw"]) % 4)))
        H = {"Authorization": "Bearer " + auth._get_firebase_token(), "Content-Type": "application/json"}
        x = requests.post(api + "/v1/documents", headers=H, json={"kind": "eml", "content": eml, "file_name": "Gmail"}, timeout=120)
        if x.status_code != 200: return "failed"
        x = x.json()
        if x.get("duplicate"): return "duplicate"
        if not (x.get("extracted") or {}).get("is_purchase_document"):
            requests.delete(api + "/v1/documents/" + x["document_id"], headers=H, timeout=30); return "skipped"
        return "matched" if (x.get("link") or {}).get("confirmed") else "imported"
    with cf.ThreadPoolExecutor(4) as ex:
        for res in ex.map(one, ids):
            st["processed"] += 1
            if res == "matched": st["imported"] += 1; st["matched"] += 1
            elif res == "imported": st["imported"] += 1
            elif res == "duplicate": st["duplicates"] += 1
            elif res == "skipped": st["skipped"] += 1
            else: st["failed"] += 1
            push()
    push(state="done", finishedAt=int(time.time() * 1000))
except Exception as e:
    push(state="error", error="failed", message=str(e)[:200])
"""
os.makedirs("/workspace/benny-gmail", exist_ok=True)
with open("/workspace/benny-gmail/worker.py", "w") as f: f.write(WORKER)
days = max(7, min(int(req.get("days") or 90), 365)); limit = max(1, min(int(req.get("max") or 40), 100))
status(state="running", found=0, processed=0, imported=0, matched=0, duplicates=0, skipped=0, failed=0, days=days, error=None, message=None, startedAt=int(time.time() * 1000))
envv = dict(os.environ, BP_GTOKEN=tok)
subprocess.Popen([sys.executable, "/workspace/benny-gmail/worker.py", base, req["api"], str(days), str(limit)], env=envv, start_new_session=True,
                 stdout=open("/workspace/benny-gmail/worker.log", "a"), stderr=subprocess.STDOUT, cwd="/workspace/benny-gmail")
print("DONE started")
