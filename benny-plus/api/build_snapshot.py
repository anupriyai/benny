
"""Pinned rules snapshot for Benny+ (plan step 5). Every list rule (earn, credits, perks, protections) is accepted only
if each segment of its quote ("…" separates omitted text) appears word for word, in order, in the saved source page after
whitespace and typography normalization. Rules without a quote, or whose page was not saved, are rejected and logged.
Pages come from the Benny pipeline cache (out/pages) and sources/ here (fetched plain, Bright Data fallback).
Usage: python build_snapshot.py [--publish]"""
import json, os, re, sys, hashlib, datetime, copy
HERE = os.path.dirname(os.path.abspath(__file__))
PIPE = '/workspace/benny/pipeline/out/pages'
APP = 'VwgamtqxM2cvND2ygrLKnkVCS4n1/file-system/apps/benny-plus/app'
BENNY = 'VwgamtqxM2cvND2ygrLKnkVCS4n1/file-system/apps/benny/app'

def norm(s):
    s = (s or '').replace('\u00a0', ' ')
    s = re.sub(r'[®™℠*†‡§¹²³⁴⁵⁶⁷⁸⁹⁰]', '', s)
    s = s.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"').replace('–', '-').replace('—', '-')
    return re.sub(r'\s+', ' ', s).strip().lower()

def quote_in(quote, text):
    """Word for word after normalization. '…' or '...' marks omitted text; every segment must appear, in order."""
    # whitespace is ignored entirely: page HTML often splits tokens ("5 %" for "5%"); every other character must match in order
    t = re.sub(r'\s+', '', norm(text)); pos = 0
    segs = [re.sub(r'\s+', '', s.strip(' ,;:')) for s in re.split(r'…|\.\.\.', norm(quote))]
    segs = [s for s in segs if s]
    if not segs: return False
    for s in segs:
        i = t.find(s, pos)
        if i < 0: return False
        pos = i + len(s)
    return True

def load_pages():
    pages = {}
    for d in (PIPE, os.path.join(HERE, 'sources')):
        if not os.path.isdir(d): continue
        for f in os.listdir(d):
            if f.endswith('.json'):
                r = json.load(open(os.path.join(d, f)))
                if r.get('ok') and r.get('text'): pages[r['url']] = r
    return pages

LISTS = ('earn', 'credits', 'perks', 'protections')
def build(rules, pages):
    out = copy.deepcopy(rules); rejected = []; accepted = 0
    for cid, card in out['cards'].items():
        for kind in LISTS:
            keep = []
            for r in card.get(kind) or []:
                src = r.get('source') or {}; q = src.get('quote'); url = src.get('url')
                why = None
                if not q: why = 'no quote'
                elif url not in pages: why = 'source page not saved'
                elif not quote_in(q, pages[url]['text']): why = 'quote not found word for word in saved page'
                if why: rejected.append({'card': cid, 'kind': kind, 'id': r.get('id') or r.get('type'), 'url': url, 'reason': why}); continue
                src['pageSha256'] = pages[url].get('sha256'); src['verified'] = 'quote-verbatim'
                keep.append(r); accepted += 1
            card[kind] = keep
    body = json.dumps(out, sort_keys=True, ensure_ascii=False)     # exactly the string that is published, so clients can verify it
    return out, rejected, accepted, hashlib.sha256(body.encode()).hexdigest()

if __name__ == '__main__':
    sys.path.insert(0, HERE)
    from firebase_helper import firebase
    rules = json.loads(firebase.read(BENNY + '/rules/json')); engine = firebase.read(BENNY + '/engine/code')
    pages = load_pages()
    snap, rejected, accepted, rhash = build(rules, pages)
    version = 'v' + datetime.date.today().isoformat()
    report = {'version': version, 'accepted': accepted, 'rejected': rejected, 'cards': len(snap['cards']), 'pages': len(pages)}
    json.dump(report, open(os.path.join(HERE, 'snapshot_report.json'), 'w'), indent=1)
    print(json.dumps({k: v for k, v in report.items() if k != 'rejected'}), len(rejected), 'rejected')
    if '--publish' in sys.argv:
        ehash = hashlib.sha256(engine.encode()).hexdigest()
        firebase.update(APP + '/bundle', {'rulesJson': json.dumps(snap, sort_keys=True, ensure_ascii=False), 'rulesHash': rhash, 'rulesVersion': version,
            'engineCode': engine, 'engineHash': ehash, 'engineVersion': 'benny-engine ' + str(re.search(r"version: '([^']+)'", engine).group(1)),
            'cardCount': len(snap['cards']), 'acceptedRules': accepted, 'rejectedRules': len(rejected), 'builtAt': int(datetime.datetime.now().timestamp() * 1000),
            'source': 'apps/benny/app rules + engine, quotes verified against saved pages (build_snapshot.py)',
            'metadata': {'type': 'entry', 'displayName': 'Pinned rules + engine bundle', 'updatedAt': int(datetime.datetime.now().timestamp() * 1000)}})
        print('published', version, rhash[:12])
