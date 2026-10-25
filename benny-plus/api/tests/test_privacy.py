
"""A/B privacy test for the Benny+ API, run against the PUBLIC ingress URL.
User A = the signed-in account running this script. User B = a second owner seeded directly in the server database
(a second real Firebase account is not available to this script). Exits non-zero on any leak.
Usage: python tests/test_privacy.py <ingress_url>"""
import sys, json, sqlite3, os, time, uuid, requests
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import auth
URL = sys.argv[1].rstrip('/'); DB = os.path.join(os.path.dirname(__file__), '..', 'state', 'benny.db')
TOK = auth._get_firebase_token(); A = {'Authorization': 'Bearer ' + TOK}
B = 'privacy_test_user_B_' + uuid.uuid4().hex[:8]
results = []
def check(name, ok, detail=''):
    results.append((name, ok)); print(('PASS ' if ok else 'FAIL ') + name + (('  ' + detail) if not ok else ''))
c = sqlite3.connect(DB); now = int(time.time() * 1000)
bacct, bpur, bimp = 'acct_B_' + uuid.uuid4().hex[:8], 'pur_B_' + uuid.uuid4().hex[:8], 'imp_B_' + uuid.uuid4().hex[:8]
c.execute("INSERT INTO card_accounts(id, owner, product_id, source, product_confirmed, created_at) VALUES (?,?,?,?,?,?)", (bacct, B, 'chase-sapphire-preferred', 'manual', 1, now))
c.execute("INSERT INTO purchases(id, owner, account_id, amount_cents, currency, posted_on, merchant_raw, merchant_normalized, kind, source, import_batch_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (bpur, B, bacct, 12345, 'USD', '2026-10-01', 'SECRET MERCHANT B', 'secret merchant b', 'purchase', 'csv', bimp, now))
c.execute("INSERT INTO import_batches VALUES (?,?,?,?,?,?,?,?,?)", (bimp, B, 'csv', now, 1, 1, 0, bacct, 'b.csv')); c.commit()
try:
    r = requests.get(URL + '/v1/state'); check('no sign-in -> 401', r.status_code == 401, str(r.status_code))
    r = requests.get(URL + '/v1/state', headers={'X-Sender-Uid': B}); check('forged X-Sender-Uid without sign-in -> 401', r.status_code == 401, str(r.status_code))
    r = requests.get(URL + '/v1/me', headers={**A, 'X-Sender-Uid': B}); me = r.json().get('uid')
    check('forged X-Sender-Uid with A sign-in is ignored', r.status_code == 200 and me != B, str(r.status_code) + ' ' + str(me))
    for kind, rid in (('accounts', bacct), ('purchases', bpur), ('imports', bimp)):
        r = requests.get(f'{URL}/v1/records/{kind}/{rid}', headers=A); check(f'A reading B {kind} by id -> 404', r.status_code == 404, str(r.status_code))
    st = requests.get(URL + '/v1/state', headers=A).text
    check("A's state contains none of B's ids or data", all(x not in st for x in (bacct, bpur, bimp, 'SECRET MERCHANT B')))
    r = requests.patch(f'{URL}/v1/accounts/{bacct}', headers=A, json={'nickname': 'x'}); check('A editing B account -> 404', r.status_code == 404, str(r.status_code))
    r = requests.delete(f'{URL}/v1/accounts/{bacct}', headers=A); check('A deleting B account -> 404', r.status_code == 404, str(r.status_code))
    r = requests.post(f'{URL}/v1/imports/csv', headers=A, json={'account_id': bacct, 'currency_confirmed': 'USD', 'rows': [{'date': '2026-10-02', 'desc': 'X', 'amount_cents': 100, 'kind': 'purchase'}]}); check('A importing into B account -> 404', r.status_code == 404, str(r.status_code))
    r = requests.delete(f'{URL}/v1/imports/{bimp}', headers=A); check('A undoing B import -> 404', r.status_code == 404, str(r.status_code))
    r = requests.post(f'{URL}/v1/evidence/user', headers=A, json={'subject_type': 'purchase', 'subject_id': bpur}); check('A attaching evidence to B purchase -> 404', r.status_code == 404, str(r.status_code))
    still = c.execute('SELECT COUNT(*) FROM purchases WHERE id=? AND owner=?', (bpur, B)).fetchone()[0] == 1 and c.execute('SELECT nickname FROM card_accounts WHERE id=?', (bacct,)).fetchone()[0] is None
    check("B's records unchanged after A's attempts", still)
    plain = [r for r in c.execute('SELECT access_token_enc FROM plaid_items') if bytes(r[0]).startswith(b'access-')]
    check('no plaintext Plaid tokens at rest', not plain)
    logs = ''.join(open(p).read() for p in ('/workspace/.mana/supervisord/logs/benny-plus-api.out.log', '/workspace/.mana/supervisord/logs/benny-plus-api.err.log') if os.path.exists(p))
    check('logs contain no merchants, amounts or tokens', 'SECRET MERCHANT' not in logs and '12345' not in logs and 'access-' not in logs and TOK[:20] not in logs)
finally:
    c.execute('DELETE FROM purchases WHERE owner=?', (B,)); c.execute('DELETE FROM card_accounts WHERE owner=?', (B,)); c.execute('DELETE FROM import_batches WHERE owner=?', (B,)); c.commit()
failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
sys.exit(1 if failed else 0)
