
"""Benny+ acceptance tests against the live API (plan section 7). Runs on the signed-in account and cleans up after itself.
Usage: python tests/test_acceptance.py <ingress_url>"""
import sys, os, json, time, datetime, requests, subprocess
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import auth, build_snapshot as bs
URL = sys.argv[1].rstrip('/'); RES = []
def api(m, p, **k):
    r = requests.request(m, URL + p, headers={'Authorization': 'Bearer ' + auth._get_firebase_token()}, timeout=180, **k)
    try: return r.status_code, r.json()
    except Exception: return r.status_code, r.text
def check(name, ok, detail=''): RES.append((name, bool(ok))); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + str(detail)[:300]))
today = datetime.date.today(); d = lambda n: (today - datetime.timedelta(days=n)).isoformat()
made = {'accounts': [], 'docs': [], 'items': []}
def acct(pid, mask):
    _, a = api('POST', '/v1/accounts', json={'product_id': pid, 'mask': mask}); made['accounts'].append(a['id']); return a['id']
def csv(aid, rows): return api('POST', '/v1/imports/csv', json={'account_id': aid, 'currency_confirmed': 'USD', 'file_name': 'acceptance.csv', 'rows': rows})[1]
def state(): return api('GET', '/v1/state')[1]
try:
    # 2. $400 Best Buy, no item evidence -> Possibly covered, no claim packet; email + confirmed link + confirmed item -> claim packet
    sap = acct('chase-sapphire-preferred', '4821')
    csv(sap, [{'date': d(10), 'desc': 'BEST BUY 00011', 'amount_cents': 40000, 'kind': 'purchase'}])
    st = state(); bb = next(p for p in st['purchases'] if p['merchant_raw'] == 'BEST BUY 00011')
    f = next((x for x in st['findings'] if x['purchase_id'] == bb['id']), None)
    check('Best Buy $400 without item evidence: possibly covered (needs info), no claim packet', f and f['tier'] == 'needs_info' and not f['claim_packet'], f)
    eml = ("From: Best Buy <orders@bestbuy.com>\nTo: customer@example.com\nSubject: Thanks for your order #BBY01-80641\nDate: " + datetime.datetime.combine(today - datetime.timedelta(days=10), datetime.time(12)).strftime('%a, %d %b %Y %H:%M:%S -0700') +
           "\nContent-Type: text/plain; charset=utf-8\n\nThanks for shopping at Best Buy.\nOrder number: BBY01-80641\nOrder date: " + d(10) + "\n\nItem: KitchenAid K400 Variable Speed Blender\nModel: KSB4027\nQty: 1\nPrice: $399.00\n"
           "Recycling fee: $1.00\nOrder total: $400.00\nPaid with Visa ending in 4821\n\nReturns: most products can be returned within 15 days.\n")
    c, r = api('POST', '/v1/documents', json={'kind': 'eml', 'content': eml, 'file_name': 'bestbuy.eml'}); made['docs'].append(r.get('document_id'))
    check('Intake agent reads the email (items extracted)', c == 200 and r.get('items', 0) >= 1 and r['extracted']['total_cents'] == 40000, r)
    check('Linker proposes the Best Buy purchase and the checker confirms the link', r.get('link', {}).get('proposed') == bb['id'] and r['link'].get('confirmed'), r.get('link'))
    st = state(); f = next(x for x in st['findings'] if x['purchase_id'] == bb['id'])
    check('With the link confirmed but item only likely: still no claim packet', not f['claim_packet'] and f['tier'] == 'possible', f)
    item = next(e for e in st['evidence'] if e['subject_type'] == 'item' and e['strength'] == 'likely' and json.loads(e['data'])['document_id'] == r['document_id'])
    check('Item read as KitchenAid blender at $399', 'kitchenaid' in json.loads(item['data'])['name'].lower() and json.loads(item['data'])['price_cents'] == 39900, item['data'])
    api('POST', '/v1/review/confirm', json={'evidence_id': item['id']})
    st = state(); f = next(x for x in st['findings'] if x['purchase_id'] == bb['id'])
    check('After you confirm the item: claim packet available', f['claim_packet'] == 1 and f['tier'] == 'confirmed', f)
    c, pk = api('GET', '/v1/claims/' + f['id'])
    check('Claim packet has confirmed facts, the quoted clause and documents', c == 200 and pk['items'] and pk['benefit']['quote'] and any(x['id'] == 'receipt' for x in pk['documents']), pk if c != 200 else '')
    # 3. DoorDash: purchase seen -> "Looks like you used it", not recovered; matching credit imported -> "Credit posted"
    cfu = acct('chase-freedom-unlimited', '7777')
    csv(cfu, [{'date': d(3), 'desc': 'DOORDASH*WALGREENS', 'amount_cents': 4000, 'kind': 'purchase'}])
    cs = [x for x in state()['credit_status'] if x['account_id'] == cfu and x['credit_id'] == 'doordash-non-restaurant-discount']
    cur = max(cs, key=lambda x: x['period_start'])
    check('DoorDash purchase without posted credit: "Looks like you used it" (qualifying_purchase_seen), $0 recovered', cur['state'] == 'qualifying_purchase_seen' and json.loads(cur['data'])['observed_cents'] == 0, cur)
    csv(cfu, [{'date': d(1), 'desc': 'DOORDASH DASHPASS CREDIT', 'amount_cents': 1000, 'kind': 'credit'}])
    st = state(); cur = max([x for x in st['credit_status'] if x['account_id'] == cfu and x['credit_id'] == 'doordash-non-restaurant-discount'], key=lambda x: x['period_start'])
    fd = next(x for x in st['findings'] if x['type'] == 'credit' and json.loads(x['data'])['status_key'].startswith(cfu + ':doordash'))
    check('Matching credit transaction imported: "Credit posted" (issuer_credit_observed), counted as recovered', cur['state'] == 'issuer_credit_observed' and json.loads(cur['data'])['observed_cents'] == 1000 and fd['tier'] == 'confirmed', cur)
    # 5. Two Sapphire accounts: separate credit statuses and totals
    sap2 = acct('chase-sapphire-preferred', '9090')
    st = state(); k1 = next(x for x in st['credit_status'] if x['account_id'] == sap and x['credit_id'] == 'hotel-credit')
    api('POST', '/v1/evidence/user', json={'subject_type': 'credit', 'subject_id': f"{sap}:hotel-credit:{k1['period_start']}", 'reason': 'You said you used this credit'})
    st = state(); s1 = next(x for x in st['credit_status'] if x['account_id'] == sap and x['credit_id'] == 'hotel-credit'); s2 = next(x for x in st['credit_status'] if x['account_id'] == sap2 and x['credit_id'] == 'hotel-credit')
    t1 = sum(p['amount_cents'] for p in st['purchases'] if p['account_id'] == sap); t2 = sum(p['amount_cents'] for p in st['purchases'] if p['account_id'] == sap2)
    check('Two Sapphire accounts keep separate credit statuses and totals', s1['state'] == 'user_confirmed' and s2['state'] == 'unknown' and t1 == 40000 and t2 == 0, (s1['state'], s2['state'], t1, t2))
    # 6. CSV + Plaid same month: one record each; undoing CSV removes nothing from Plaid
    c, it = api('POST', '/v1/plaid/sandbox_item'); made['items'].append(it.get('item'))
    for _ in range(8):
        api('POST', '/v1/plaid/sync'); st = state(); pp = [p for p in st['purchases'] if p['source'] == 'plaid']
        if pp: break
        time.sleep(5)
    pa = pp[0]['account_id']; api('PATCH', '/v1/accounts/' + pa, json={'product_id': 'chase-sapphire-preferred'})
    mine = [p for p in state()['purchases'] if p['account_id'] == pa and p['source'] == 'plaid' and not p['pending']]
    r1 = csv(pa, [{'date': p['posted_on'], 'desc': p['merchant_raw'].upper() + ' 0042 SAN FRANCISCO CA', 'amount_cents': abs(p['amount_cents']), 'kind': p['kind']} for p in mine])
    after = [p for p in state()['purchases'] if p['account_id'] == pa]
    api('DELETE', '/v1/imports/' + r1['batch_id']); undone = [p for p in state()['purchases'] if p['account_id'] == pa]
    check('Same month by CSV and Plaid: one record per transaction; undoing the CSV removes nothing from Plaid', r1['added'] == 0 and len(after) == len(mine) and len(undone) == len(mine) and all(p['source'] == 'plaid' for p in undone), (r1, len(after), len(undone), len(mine)))
    # 7. A rule whose quote is not in the saved page is rejected
    snap, rej, _, _ = bs.build({'cards': {'t': {'earn': [{'id': 'real', 'source': {'url': 'U', 'quote': '3% on restaurants'}}, {'id': 'fake', 'source': {'url': 'U', 'quote': '9% on restaurants'}}]}}}, {'U': {'text': '3 % on restaurants and travel', 'sha256': 'x'}})
    check('Rule whose quote is not in the saved page is rejected', [x['id'] for x in rej] == ['fake'] and [r['id'] for r in snap['cards']['t']['earn']] == ['real'])
    # 9. Invariant check passes on the full demo dataset
    c, inv = api('GET', '/v1/invariants'); check('Invariant check passes on the full dataset', c == 200 and inv['failures'] == [], inv)
finally:
    for i in made['items']:
        if i: api('DELETE', '/v1/plaid/items/' + i)
    for dd in made['docs']:
        if dd: api('DELETE', '/v1/documents/' + dd)
    for a in made['accounts']: api('DELETE', '/v1/accounts/' + a)
    st = state(); print('cleanup:', len(st['accounts']), 'accounts,', len(st['purchases']), 'purchases left')
failed = [n for n, ok in RES if not ok]; print(f'\n{len(RES) - len(failed)}/{len(RES)} passed'); sys.exit(1 if failed else 0)
