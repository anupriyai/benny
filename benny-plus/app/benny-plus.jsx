
/* Benny+ · dollar-bill palette, light + dark. Private records live on the Benny+ API; this component reads only its own subtree. */
const PAL = {
  light: { bg: '#F3F2E8', surface: '#FBFAF3', sunk: '#EAE8DA', ink: '#16241C', muted: '#58675C', faint: '#8A968C', line: 'rgba(22,36,28,0.12)', lineStrong: 'rgba(22,36,28,0.22)',
           accent: '#1E6A48', accentInk: '#FFFFFF', accentSoft: 'rgba(30,106,72,0.10)', face: '#85BB65', likely: '#2C7476', likelySoft: 'rgba(44,116,118,0.10)', info: '#8C6F22', infoSoft: 'rgba(140,111,34,0.12)', danger: '#A23B2A', seal: '#2F6D55' },
  dark:  { bg: '#0C1511', surface: '#111D17', sunk: '#17261E', ink: '#E3EBDC', muted: '#97A898', faint: '#6D7E70', line: 'rgba(227,235,220,0.10)', lineStrong: 'rgba(227,235,220,0.20)',
           accent: '#86BC7A', accentInk: '#0C1511', accentSoft: 'rgba(134,188,122,0.12)', face: '#85BB65', likely: '#73B6B0', likelySoft: 'rgba(115,182,176,0.12)', info: '#CDB26A', infoSoft: 'rgba(205,178,106,0.12)', danger: '#E58468', seal: '#5E9C80' },
};
const PalCtx = React.createContext(PAL.light);
const usePal = () => React.useContext(PalCtx);
const SERIF = 'ui-serif, Georgia, "Times New Roman", serif';
const GOODS = new Set(['department', 'online', 'electronics', 'home_improvement', 'home']);
const MIXED = new Set(['wholesale', 'drugstore']);
const DAYMS = 86400000;
const BOM = String.fromCharCode(0xFEFF);
const todayUTC = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
const isoDay = t => new Date(t).toISOString().slice(0, 10);
const fmt = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = n => '$' + Math.round(n).toLocaleString();
const fmtDate = s => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); };
const jparse = s => { try { return typeof s === 'string' ? JSON.parse(s) : (s || {}); } catch (e) { return {}; } };
const mnorm = s => String(s || '').toLowerCase().replace(/[’'`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/* ---------- statement CSV import ---------- */
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}
function toISO(s) {
  s = String(s || '').trim(); let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  return null;
}
function money(s) {
  if (s == null) return null; let t = String(s).trim(); if (!t) return null;
  const neg = /^\(.*\)$/.test(t) || /^-|^−|-\$|\$-/.test(t);
  t = t.replace(/[^0-9.]/g, ''); if (!t) return null; const n = parseFloat(t);
  return isNaN(n) ? null : (neg ? -n : n);
}
const pick = (h, names) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } for (const n of names) { const i = h.findIndex(x => x.includes(n)); if (i >= 0) return i; } return -1; };

function headersOf(text) { const rows = parseCSV(text.split(BOM).join('')); return { headers: rows[0] || [], rows: rows.slice(1) }; }
function detectCols(headers) {
  const h = headers.map(x => String(x).trim().toLowerCase());
  return { date: pick(h, ['transaction date', 'trans. date', 'trans date', 'date', 'posted date', 'post date', 'posting date']), desc: pick(h, ['description', 'merchant', 'payee', 'name', 'details']),
           amount: pick(h, ['amount']), debit: pick(h, ['debit']), credit: pick(h, ['credit']), type: pick(h, ['type']) };
}
function buildRows(rows, cols) {
  if (cols.date < 0 || cols.desc < 0 || (cols.amount < 0 && cols.debit < 0)) return { error: 'Choose the date, description and amount (or debit) columns.' };
  const data = rows.map(r => ({ date: toISO(r[cols.date]), desc: String(r[cols.desc] || '').trim().replace(/\s+/g, ' '), amt: cols.amount >= 0 ? money(r[cols.amount]) : null,
    debit: cols.debit >= 0 ? money(r[cols.debit]) : null, credit: cols.credit >= 0 ? money(r[cols.credit]) : null, type: cols.type >= 0 ? String(r[cols.type] || '') : '' }))
    .filter(x => x.date && x.desc && (x.amt != null || x.debit != null || x.credit != null));
  if (!data.length) return { error: 'No rows had a readable date and amount with these columns.' };
  let sign = 1, signBasis = 'most rows';
  if (cols.amount >= 0) { const sales = data.filter(x => /sale|purchase|debit/i.test(x.type) && x.amt); const base = sales.length ? sales : data; if (sales.length) signBasis = 'the Type column'; sign = base.filter(x => x.amt < 0).length > base.length / 2 ? -1 : 1; }
  return { data, sign, signBasis, mode: cols.amount >= 0 ? 'amount' : 'debitcredit' };
}
function normalizeRows(a, sign) {
  return a.data.map(x => {
    const p = a.mode === 'amount' ? x.amt * sign : (x.debit ? Math.abs(x.debit) : -Math.abs(x.credit || 0));
    const text = x.desc + ' ' + x.type; let kind = 'purchase';
    if (p < 0) kind = /payment|autopay|thank you/i.test(text) ? 'payment' : /credit|reward|cash ?back|adjust/i.test(text) ? 'credit' : 'refund';
    else if (/payment|autopay/i.test(x.type)) kind = 'payment';
    else if (/interest charge|late fee|annual fee|membership fee|foreign transaction fee/i.test(text)) kind = 'fee';
    return { date: x.date, desc: x.desc, amount: Math.round(Math.abs(p) * 100) / 100, kind };
  });
}

/* ---------- private API ---------- */
async function apiCall(base, method, path, body) {
  const tok = await FS.auth.currentUser.getIdToken();
  const r = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((data && (data.message || data.error)) || ('Request failed (' + r.status + ')'));
  return data;
}
function loadPlaid() {
  return new Promise((res, rej) => {
    if (window.Plaid) return res(window.Plaid);
    const s = document.createElement('script'); s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload = () => res(window.Plaid); s.onerror = () => rej(new Error('Plaid Link could not load.')); document.head.appendChild(s);
  });
}
async function sha256hex(text) { const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''); }
async function imageToDataUrl(file, max = 1600) {
  const bmp = await createImageBitmap(file); const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); return cv.toDataURL('image/jpeg', 0.85);
}
/* Bank account names often end in the card digits already (“Robinhood Credit Card **0478”); strip them so ••0478 shows once. */
const stripMask = (s, mask) => { let t = String(s || '').trim(); t = t.replace(/[\s\-–(\[]*(\*+|•+|x{2,}|\.{2,}|…|ending( in)?|acct|account)\s*\d{3,4}[)\]]?$/i, '').trim();
  if (mask) t = t.replace(new RegExp('[\\s\\-–(]*' + mask + '\\)?$'), '').trim(); return t; };
const bankName = a => (a && stripMask(a.official_name || a.nickname, a.mask)) || 'Bank account';
const acctLabel = (a, cards) => { const c = a && cards[a.product_id]; return (c ? (c.short || c.name) : (a && (a.nickname || a.official_name) ? bankName(a) : 'Unconfirmed card')) + (a && a.mask ? ' ••' + a.mask : ''); };
const SRC = { plaid: 'bank', csv: 'statement', sample: 'sample', manual: 'manual', email: 'email', receipt: 'receipt', user: 'you', agent: 'AI reading', rules: 'card terms' };

/* ---------- derived reward comparison (engine decides; nothing stored) ---------- */
function categoryMap(st) {
  const m = {};
  for (const e of st.evidence || []) {
    if (e.subject_type !== 'category' || !String(e.subject_id).startsWith('m:')) continue;
    const k = e.subject_id.slice(2); const d = jparse(e.data);
    if (e.strength === 'confirmed' || !m[k]) m[k] = { level: e.strength, category: d.category, evidence: e };
  }
  return m;
}
/* Cards you HAVE vs cards you're TRYING (Oct 25, user direction): totals, credits to use and missed rewards use only cards you have;
   cards you're trying get a separate "what if" and never add to a total. A saved role (card page switch) wins; sample/demo cards count
   as yours; otherwise a card is yours once it's connected through Plaid or has a purchase or a receipt tied to it. A hand-picked card
   with nothing yet counts as trying, which nudges people to connect it for real transactions. */
function cardRole(a, st) {
  if (!a) return 'trying';
  if (a.role === 'held' || a.role === 'trying') return a.role;
  if (a.sample || a.virtual || a.source === 'plaid') return 'held';
  if ((st.purchases || []).some(p => p.account_id === a.id)) return 'held';
  if ((st.evidence || []).some(e => e.subject_type === 'doc_card' && jparse(e.data).account_id === a.id)) return 'held';
  return 'trying';
}
const NOT_CARD_SPEND = /order (has been )?(executed|filled)|\bshares? of\b|limit order|market order|\bstock(s)?\b|\bcrypto|\bETF\b|\bdividend|\bwire transfer|deposit (received|completed)/i;
const BROKERS = /robinhood|fidelity|schwab|vanguard|coinbase|webull|e\*?trade|interactive brokers|public\.com/i;
const BASE_MERCHANT = { id: 'unknown', name: '', categories: ['other'], confidence: 'low' };   // unknown store: the card's everyday rate applies
function computeFeed(E, rules, st, today) {
  const accounts = st.accounts || []; const byId = Object.fromEntries(accounts.map(a => [a.id, a]));
  const ready = accounts.filter(a => a.product_id && a.product_confirmed && rules.cards[a.product_id]);
  const roleOf = Object.fromEntries(ready.map(a => [a.id, cardRole(a, st)]));
  const held = ready.filter(a => roleOf[a.id] === 'held'); const trying = ready.filter(a => roleOf[a.id] === 'trying');
  const heldIds = held.map(a => a.id);
  const valueOn = (cardId, m, amount) => { const r = E.recommend(rules, [cardId], m, amount, 'cash'); return r.top ? r.top.valueUsd : 0; };
  const catm = categoryMap(st);
  const purchases = []; let unconfirmed = 0, undetermined = 0, undeterminedCents = 0, inferred = 0;
  for (const t of st.purchases || []) {
    const acct = byId[t.account_id]; if (!acct || t.kind !== 'purchase' || t.pending || t.amount_cents <= 0) continue;
    if ((t.currency || 'USD') !== 'USD') continue;
    if (!(acct.product_id && acct.product_confirmed && rules.cards[acct.product_id])) { unconfirmed++; continue; }
    if (roleOf[acct.id] !== 'held') continue;   // purchases on a card you marked as trying stay out of every total
    const user = catm[t.merchant_normalized]; let m = null, level = null;
    if (user && user.level === 'confirmed') { m = { id: 'cat:' + user.category, name: t.merchant_raw, categories: [user.category], confidence: 'high' }; level = 'you'; }
    else { const fm = E.findMerchant(rules.mcc, t.merchant_raw).match; if (fm) { m = fm; level = fm.confidence === 'high' ? 'table' : 'table-low'; }
      else if (user && user.category) { m = { id: 'cat:' + user.category, name: t.merchant_raw, categories: [user.category], confidence: 'low' }; level = 'inferred'; inferred++; } }
    if (!m) { undetermined++; undeterminedCents += t.amount_cents; }
    purchases.push({ id: t.id, accountId: acct.id, cardId: acct.product_id, merchant: m && level === 'table' ? m.name : t.merchant_raw, matched: !!m, level, categoryConfirmed: !!(m && m.confidence === 'high'), total: t.amount_cents / 100, date: t.posted_on, m, norm: t.merchant_normalized });
  }
  const ids = [...new Set(held.map(a => a.product_id))]; const missed = []; let best = 0;
  if (ids.length > 1) {
    for (const p of purchases) {
      if (!p.m || today - E.parse(p.date) > 120 * DAYMS) continue;
      const rec = E.recommend(rules, ids, p.m, p.total, 'cash'); const used = rec.ranking.find(r => r.cardId === p.cardId);
      if (rec.top && used && rec.top.cardId !== p.cardId && rec.top.valueUsd - used.valueUsd >= 0.25) {
        const high = Math.round((rec.top.valueUsd - used.valueUsd) * 100) / 100;
        const topAcct = held.find(a => a.product_id === rec.top.cardId);
        missed.push({ p, top: rec.top, used, topAcct, high, low: p.categoryConfirmed ? high : 0 });
      } else best++;
    }
    missed.sort((a, b) => b.high - a.high);
  }
  // Estimates (last 120 days): what each purchase earned on the card used. An unknown store earns the card's everyday rate.
  const cats = {}, byAcct = {}; let spent = 0, earned = 0, baseRated = 0;
  const missedById = Object.fromEntries(missed.map(x => [x.p.id, x]));
  const basis = [];   // every purchase in the window with the merchant used for its estimate (bank + receipts); feeds the "what if"
  for (const p of purchases) {
    if (today - E.parse(p.date) > 120 * DAYMS) continue;
    const key = p.m ? (p.m.categories || ['other'])[0] : '_unrecognized';
    const c = cats[key] || (cats[key] = { key, spent: 0, earned: 0, best: 0, missedLow: 0, missedHigh: 0, n: 0, estimate: false });
    const a = byAcct[p.accountId] || (byAcct[p.accountId] = { id: p.accountId, spent: 0, earned: 0, n: 0 });
    c.spent += p.total; c.n++; a.spent += p.total; a.n++; spent += p.total;
    if (!p.m) { c.estimate = true; baseRated++; }
    else if (p.level !== 'table' && p.level !== 'you') c.estimate = true;
    const mEff = p.m || BASE_MERCHANT; const u = valueOn(p.cardId, mEff, p.total);
    c.earned += u; a.earned += u; earned += u; basis.push({ m: mEff, total: p.total, value: u, key });
    const mx = missedById[p.id]; c.best += u + (mx ? mx.high : 0);
    if (mx) { c.missedLow += mx.low; c.missedHigh += mx.high; }
  }
  // Receipts and Gmail orders that no bank transaction covers: counted once, on the card the receipt names (last four, or the one card you have).
  let receiptsCounted = 0, receiptsEarned = 0, receiptsSpent = 0, receiptsUnassigned = 0;
  const bankPurch = (st.purchases || []).filter(t => t.kind === 'purchase' && !t.pending && t.amount_cents > 0 && t.posted_on);
  for (const d of st.documents || []) {
    let rv = null; try { rv = receiptView(d, st, rules, E, 'cash'); } catch (e) { rv = null; }
    if (!rv || !rv.ok || rv.foreign || rv.amount == null || rv.amount <= 0 || rv.facts.linkPurchaseId) continue;
    if (/^(shipping|cancellation|refund|return)/i.test(rv.ex.document_type || '')) continue;
    if (NOT_CARD_SPEND.test([d.subject, rv.ex.merchant, ...(rv.items || []).map(x => x.name)].join(' ')) || (BROKERS.test(rv.ex.merchant || '') && /order|executed|filled/i.test(d.subject || ''))) continue;   // trades and transfers aren't card purchases
    const day = rv.ex.purchase_date || d.doc_date; if (!day || today - E.parse(day) > 120 * DAYMS || E.parse(day) > today + DAYMS) continue;
    const dayT = E.parse(day); const mtok = mnorm(rv.ex.merchant).split(' ')[0] || '';
    if (bankPurch.some(t => Math.abs(E.parse(t.posted_on) - dayT) <= 4 * DAYMS && (Math.abs(t.amount_cents / 100 - rv.amount) < 0.011 || (mtok.length >= 3 && mnorm(t.merchant_raw).includes(mtok) && t.amount_cents / 100 >= rv.amount * 0.95 && t.amount_cents / 100 <= rv.amount * 1.3)))) continue;   // already on a bank statement, just not linked
    let acct = rv.paid.account && roleOf[rv.paid.account.id] === 'held' ? rv.paid.account : null;
    if (!acct && held.length === 1 && !(rv.paid.account && rv.paid.firm)) acct = held[0];
    if (!acct) { receiptsUnassigned++; continue; }
    const key = (rv.merchant.categories || ['other'])[0]; const u = valueOn(acct.product_id, rv.merchant, rv.amount);
    const c = cats[key] || (cats[key] = { key, spent: 0, earned: 0, best: 0, missedLow: 0, missedHigh: 0, n: 0, estimate: false });
    const a = byAcct[acct.id] || (byAcct[acct.id] = { id: acct.id, spent: 0, earned: 0, n: 0 });
    c.spent += rv.amount; c.n++; c.earned += u; c.best += u; c.estimate = true; a.spent += rv.amount; a.earned += u; a.n++;
    spent += rv.amount; earned += u; receiptsCounted++; receiptsEarned += u; receiptsSpent += rv.amount; basis.push({ m: rv.merchant, total: rv.amount, value: u, key });
  }
  // What if: each card you're trying, on the same purchases. Never added to a total.
  const heldProducts = new Set(ids); const seenTry = new Set(); const whatIf = [];
  for (const a of trying) {
    if (heldProducts.has(a.product_id) || seenTry.has(a.product_id)) continue; seenTry.add(a.product_id);
    let v = 0, pts = 0; const wins = {}; const cd = rules.cards[a.product_id]; const cur = cd.currency || {};
    for (const b of basis) { const r = E.recommend(rules, [a.product_id], b.m, b.total, 'cash'); const t = r.top ? r.top.valueUsd : 0; v += t; pts += r.top ? r.top.earned : 0; if (t - b.value > 0.005) wins[b.key] = (wins[b.key] || 0) + (t - b.value); }
    const r2 = n => Math.round(n * 100) / 100;
    const noCash = cur.unit !== 'cashback' && (cur.valueCents || {}).cash == null;   // points/miles with no guaranteed cash value: show the points, not $0
    whatIf.push({ acct: a, cardId: a.product_id, value: r2(v), delta: r2(v - earned), noCash, points: Math.round(pts), unitLabel: cur.unitLabel || 'points', wins: Object.entries(wins).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, d]) => ({ key: k, more: r2(d) })) });
  }
  whatIf.sort((x, y) => (x.noCash - y.noCash) || y.delta - x.delta);
  const fees = held.map(a => { const cd = rules.cards[a.product_id]; const fee = (cd.annualFee || 0) + ((cd.membershipFee && cd.membershipFee.usd) || 0); return fee ? { acct: a, usd: fee, label: cd.membershipFee && cd.membershipFee.usd ? cd.membershipFee.label : 'annual fee' } : null; }).filter(Boolean);
  const categories = Object.values(cats).sort((a, b) => (a.key === '_unrecognized') - (b.key === '_unrecognized') || b.missedHigh - a.missedHigh || b.spent - a.spent);
  return { ready, held, trying, heldIds, roleOf, purchases, missed, best, categories, accountsSummary: Object.values(byAcct), windowSpent: spent, windowEarned: earned, whatIf, fees,
           receipts: { counted: receiptsCounted, earned: receiptsEarned, spent: receiptsSpent, unassigned: receiptsUnassigned }, baseRated, windowCount: basis.length,
           coverage: { checked: purchases.length + unconfirmed, recognized: purchases.length - undetermined, undetermined, undeterminedCents, unconfirmed, inferred, comparable: ids.length > 1 },
           missedLow: missed.reduce((s, x) => s + x.low, 0), missedHigh: missed.reduce((s, x) => s + x.high, 0) };
}
/* UI-side invariant: the coverage line may never call everything optimal while anything is undetermined. */
function coverageLine(feed) {
  const cv = feed.coverage; if (!cv.checked) return null;
  const parts = [`Checked ${cv.checked} purchase${cv.checked === 1 ? '' : 's'}.`];
  if (cv.comparable) parts.push(`${cv.recognized} recognized: ${feed.missed.length ? feed.missed.length + ' could have earned more on another card' : 'no better card found among them'}.`);
  else parts.push(`${cv.recognized} recognized. Add a second card to compare.`);
  if (cv.undetermined) parts.push(`${cv.undetermined} not recognized (${fmt(cv.undeterminedCents / 100)}), so they weren’t compared.`);
  if (cv.unconfirmed) parts.push(`${cv.unconfirmed} on accounts not matched to a card yet.`);
  const text = parts.join(' ');
  if (/optimal|all .*best/i.test(text) && (cv.undetermined || cv.unconfirmed)) throw new Error('Invariant: optimal message while purchases are undetermined');
  return text;
}

/* ---------- crafted moment: an engraved guilloche rosette, like the border work on a bill ---------- */
function Guilloche({ size = 260, color, opacity = 0.5, glimmer = false }) {
  const paths = React.useMemo(() => {
    const out = []; const R = 0.46, r = 0.115, d = 0.16;
    for (let k = 0; k < 3; k++) {
      let s = ''; const scale = 1 - k * 0.17, rot = k * 0.21;
      for (let i = 0; i <= 1440; i++) {
        const t = i / 1440 * Math.PI * 2 * 12;
        const x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t), y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
        const xr = x * Math.cos(rot) - y * Math.sin(rot), yr = x * Math.sin(rot) + y * Math.cos(rot);
        s += (i ? 'L' : 'M') + (50 + xr * 100 * scale).toFixed(2) + ' ' + (50 + yr * 100 * scale).toFixed(2);
      }
      out.push(s);
    }
    return out;
  }, []);
  const gid = 'glim' + React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const [still] = React.useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const shine = glimmer && !still;
  const lines = (stroke, boost) => <>{paths.map((d, i) => <path key={i} d={d} fill="none" stroke={stroke} strokeWidth={(0.18 - i * 0.03) * boost} />)}<circle cx="50" cy="50" r="7.5" fill="none" stroke={stroke} strokeWidth={0.3 * boost} /></>;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ opacity, position: 'absolute', inset: 0 }}>{lines(color, 1)}</svg>
      {shine && <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{ position: 'absolute', inset: 0, opacity: 0.95 }}>
        <defs>
          {/* sunlit gold foil: only the travelling band is painted, so the engraving lights up in gold as it passes */}
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100">
            <stop offset="0" stopColor="#C8A03C" stopOpacity="0" /><stop offset="0.36" stopColor="#C8A03C" stopOpacity="0" />
            <stop offset="0.43" stopColor="#C8A03C" stopOpacity="0.75" /><stop offset="0.48" stopColor="#F1CF6E" stopOpacity="1" />
            <stop offset="0.5" stopColor="#FFF4CC" stopOpacity="1" /><stop offset="0.52" stopColor="#F1CF6E" stopOpacity="1" />
            <stop offset="0.58" stopColor="#B88A2A" stopOpacity="0.6" /><stop offset="0.64" stopColor="#B88A2A" stopOpacity="0" /><stop offset="1" stopColor="#B88A2A" stopOpacity="0" />
            <animateTransform attributeName="gradientTransform" type="translate" values="-120 -120; 120 120; 120 120" keyTimes="0; 0.5; 1" dur="7s" repeatCount="indefinite" calcMode="spline" keySplines="0.45 0 0.25 1; 0 0 1 1" />
          </linearGradient>
        </defs>
        {lines(`url(#${gid})`, 1.6)}
      </svg>}
    </div>
  );
}

function BennyRosette({ size = 25 }) {
  return <svg data-benny-mark="single-inner-rosette" width={size} height={size} viewBox="15 15 70 70" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}><path d="M80.433 63.591 L80.472 63.480 L80.491 63.362 L80.492 63.237 L80.474 63.105 L80.436 62.967 L80.379 62.823 L80.303 62.675 L80.208 62.523 L80.092 62.367 L79.957 62.207 L79.803 62.046 L79.629 61.882 L79.435 61.717 L79.222 61.551 L78.990 61.386 L78.738 61.221 L78.467 61.056 L78.178 60.894 L77.869 60.734 L77.542 60.576 L77.197 60.422 L76.834 60.272 L76.454 60.126 L76.055 59.985 L75.640 59.850 L75.209 59.721 L74.761 59.598 L74.297 59.482 L73.818 59.374 L73.323 59.274 L72.815 59.182 L72.292 59.099 L71.756 59.025 L71.206 58.960 L70.645 58.906 L70.071 58.862 L69.486 58.828 L68.890 58.806 L68.285 58.794 L67.669 58.794 L67.045 58.806 L66.412 58.829 L65.772 58.865 L65.125 58.913 L64.471 58.974 L63.812 59.047 L63.147 59.133 L62.478 59.231 L61.806 59.343 L61.131 59.467 L60.453 59.604 L59.774 59.754 L59.094 59.916 L58.413 60.092 L57.733 60.280 L57.054 60.480 L56.377 60.693 L55.702 60.918 L55.031 61.155 L54.363 61.404 L53.700 61.664 L53.041 61.936 L52.389 62.219 L51.742 62.512 L51.103 62.816 L50.471 63.130 L49.847 63.454 L49.232 63.787 L48.626 64.128 L48.030 64.479 L47.444 64.837 L46.869 65.203 L46.306 65.576 L45.754 65.955 L45.214 66.341 L44.687 66.732 L44.173 67.129 L43.672 67.529 L43.185 67.934 L42.713 68.342 L42.254 68.753 L41.811 69.166 L41.382 69.580 L40.969 69.996 L40.571 70.411 L40.190 70.827 L39.824 71.241 L39.474 71.654 L39.140 72.065 L38.822 72.473 L38.521 72.878 L38.237 73.278 L37.969 73.674 L37.717 74.064 L37.482 74.449 L37.263 74.827 L37.060 75.197 L36.874 75.560 L36.704 75.914 L36.550 76.259 L36.412 76.594 L36.289 76.920 L36.182 77.234 L36.090 77.537 L36.013 77.828 L35.950 78.106 L35.902 78.372 L35.868 78.624 L35.848 78.862 L35.840 79.085 L35.846 79.294 L35.865 79.487 L35.895 79.665 L35.937 79.826 L35.991 79.971 L36.055 80.098 L36.129 80.209 L36.214 80.302 L36.307 80.377 L36.409 80.433 L36.520 80.472 L36.638 80.491 L36.763 80.492 L36.895 80.474 L37.033 80.436 L37.177 80.379 L37.325 80.303 L37.477 80.208 L37.633 80.092 L37.793 79.957 L37.954 79.803 L38.118 79.629 L38.283 79.435 L38.449 79.222 L38.614 78.990 L38.779 78.738 L38.944 78.467 L39.106 78.178 L39.266 77.869 L39.424 77.542 L39.578 77.197 L39.728 76.834 L39.874 76.454 L40.015 76.055 L40.150 75.640 L40.279 75.209 L40.402 74.761 L40.518 74.297 L40.626 73.818 L40.726 73.323 L40.818 72.815 L40.901 72.292 L40.975 71.756 L41.040 71.206 L41.094 70.645 L41.138 70.071 L41.172 69.486 L41.194 68.890 L41.206 68.285 L41.206 67.669 L41.194 67.045 L41.171 66.412 L41.135 65.772 L41.087 65.125 L41.026 64.471 L40.953 63.812 L40.867 63.147 L40.769 62.478 L40.657 61.806 L40.533 61.131 L40.396 60.453 L40.246 59.774 L40.084 59.094 L39.908 58.413 L39.720 57.733 L39.520 57.054 L39.307 56.377 L39.082 55.702 L38.845 55.031 L38.596 54.363 L38.336 53.700 L38.064 53.041 L37.781 52.389 L37.488 51.742 L37.184 51.103 L36.870 50.471 L36.546 49.847 L36.213 49.232 L35.872 48.626 L35.521 48.030 L35.163 47.444 L34.797 46.869 L34.424 46.306 L34.045 45.754 L33.659 45.214 L33.268 44.687 L32.871 44.173 L32.471 43.672 L32.066 43.185 L31.658 42.713 L31.247 42.254 L30.834 41.811 L30.420 41.382 L30.004 40.969 L29.589 40.571 L29.173 40.190 L28.759 39.824 L28.346 39.474 L27.935 39.140 L27.527 38.822 L27.122 38.521 L26.722 38.237 L26.326 37.969 L25.936 37.717 L25.551 37.482 L25.173 37.263 L24.803 37.060 L24.440 36.874 L24.086 36.704 L23.741 36.550 L23.406 36.412 L23.080 36.289 L22.766 36.182 L22.463 36.090 L22.172 36.013 L21.894 35.950 L21.628 35.902 L21.376 35.868 L21.138 35.848 L20.915 35.840 L20.706 35.846 L20.513 35.865 L20.335 35.895 L20.174 35.937 L20.029 35.991 L19.902 36.055 L19.791 36.129 L19.698 36.214 L19.623 36.307 L19.567 36.409 L19.528 36.520 L19.509 36.638 L19.508 36.763 L19.526 36.895 L19.564 37.033 L19.621 37.177 L19.697 37.325 L19.792 37.477 L19.908 37.633 L20.043 37.793 L20.197 37.954 L20.371 38.118 L20.565 38.283 L20.778 38.449 L21.010 38.614 L21.262 38.779 L21.533 38.944 L21.822 39.106 L22.131 39.266 L22.458 39.424 L22.803 39.578 L23.166 39.728 L23.546 39.874 L23.945 40.015 L24.360 40.150 L24.791 40.279 L25.239 40.402 L25.703 40.518 L26.182 40.626 L26.677 40.726 L27.185 40.818 L27.708 40.901 L28.244 40.975 L28.794 41.040 L29.355 41.094 L29.929 41.138 L30.514 41.172 L31.110 41.194 L31.715 41.206 L32.331 41.206 L32.955 41.194 L33.588 41.171 L34.228 41.135 L34.875 41.087 L35.529 41.026 L36.188 40.953 L36.853 40.867 L37.522 40.769 L38.194 40.657 L38.869 40.533 L39.547 40.396 L40.226 40.246 L40.906 40.084 L41.587 39.908 L42.267 39.720 L42.946 39.520 L43.623 39.307 L44.298 39.082 L44.969 38.845 L45.637 38.596 L46.300 38.336 L46.959 38.064 L47.611 37.781 L48.258 37.488 L48.897 37.184 L49.529 36.870 L50.153 36.546 L50.768 36.213 L51.374 35.872 L51.970 35.521 L52.556 35.163 L53.131 34.797 L53.694 34.424 L54.246 34.045 L54.786 33.659 L55.313 33.268 L55.827 32.871 L56.328 32.471 L56.815 32.066 L57.287 31.658 L57.746 31.247 L58.189 30.834 L58.618 30.420 L59.031 30.004 L59.429 29.589 L59.810 29.173 L60.176 28.759 L60.526 28.346 L60.860 27.935 L61.178 27.527 L61.479 27.122 L61.763 26.722 L62.031 26.326 L62.283 25.936 L62.518 25.551 L62.737 25.173 L62.940 24.803 L63.126 24.440 L63.296 24.086 L63.450 23.741 L63.588 23.406 L63.711 23.080 L63.818 22.766 L63.910 22.463 L63.987 22.172 L64.050 21.894 L64.098 21.628 L64.132 21.376 L64.152 21.138 L64.160 20.915 L64.154 20.706 L64.135 20.513 L64.105 20.335 L64.063 20.174 L64.009 20.029 L63.945 19.902 L63.871 19.791 L63.786 19.698 L63.693 19.623 L63.591 19.567 L63.480 19.528 L63.362 19.509 L63.237 19.508 L63.105 19.526 L62.967 19.564 L62.823 19.621 L62.675 19.697 L62.523 19.792 L62.367 19.908 L62.207 20.043 L62.046 20.197 L61.882 20.371 L61.717 20.565 L61.551 20.778 L61.386 21.010 L61.221 21.262 L61.056 21.533 L60.894 21.822 L60.734 22.131 L60.576 22.458 L60.422 22.803 L60.272 23.166 L60.126 23.546 L59.985 23.945 L59.850 24.360 L59.721 24.791 L59.598 25.239 L59.482 25.703 L59.374 26.182 L59.274 26.677 L59.182 27.185 L59.099 27.708 L59.025 28.244 L58.960 28.794 L58.906 29.355 L58.862 29.929 L58.828 30.514 L58.806 31.110 L58.794 31.715 L58.794 32.331 L58.806 32.955 L58.829 33.588 L58.865 34.228 L58.913 34.875 L58.974 35.529 L59.047 36.188 L59.133 36.853 L59.231 37.522 L59.343 38.194 L59.467 38.869 L59.604 39.547 L59.754 40.226 L59.916 40.906 L60.092 41.587 L60.280 42.267 L60.480 42.946 L60.693 43.623 L60.918 44.298 L61.155 44.969 L61.404 45.637 L61.664 46.300 L61.936 46.959 L62.219 47.611 L62.512 48.258 L62.816 48.897 L63.130 49.529 L63.454 50.153 L63.787 50.768 L64.128 51.374 L64.479 51.970 L64.837 52.556 L65.203 53.131 L65.576 53.694 L65.955 54.246 L66.341 54.786 L66.732 55.313 L67.129 55.827 L67.529 56.328 L67.934 56.815 L68.342 57.287 L68.753 57.746 L69.166 58.189 L69.580 58.618 L69.996 59.031 L70.411 59.429 L70.827 59.810 L71.241 60.176 L71.654 60.526 L72.065 60.860 L72.473 61.178 L72.878 61.479 L73.278 61.763 L73.674 62.031 L74.064 62.283 L74.449 62.518 L74.827 62.737 L75.197 62.940 L75.560 63.126 L75.914 63.296 L76.259 63.450 L76.594 63.588 L76.920 63.711 L77.234 63.818 L77.537 63.910 L77.828 63.987 L78.106 64.050 L78.372 64.098 L78.624 64.132 L78.862 64.152 L79.085 64.160 L79.294 64.154 L79.487 64.135 L79.665 64.105 L79.826 64.063 L79.971 64.009 L80.098 63.945 L80.209 63.871 L80.302 63.786 L80.377 63.693 L80.433 63.591 Z" /><circle cx="50" cy="50" r="7.5" strokeWidth="1.3" /></svg>;
}

/* ---------- welcome landscape: engraved hills + sheep, dollar-bill vignette style (pure SVG, theme-aware) ----------
   Engraving vocabulary: tone comes only from line spacing and weight. Contour lines follow each ridge and thicken toward the valley;
   slopes facing away from the light (upper left) get a diagonal cross-hatch; sky is fine horizontal ruling with clouds left as paper;
   a low sun radiates fine rays; sheep are paper silhouettes with curl texture and a hatched belly. Geometry is seeded, so it never changes. */
const PW = 1400, PH = 460;
const PLAYERS = [
  { base: 222, amp: 20, f: 0.0036, ph: 1.0, gap: 3.6, op: 0.34, w: 0.42, shade: 26 },
  { base: 258, amp: 24, f: 0.0048, ph: 3.2, gap: 3.3, op: 0.48, w: 0.48, shade: 40 },
  { base: 305, amp: 28, f: 0.0044, ph: 5.0, gap: 3.0, op: 0.62, w: 0.54, shade: 58 },
  { base: 360, amp: 30, f: 0.0038, ph: 0.4, gap: 2.7, op: 0.76, w: 0.6, shade: 78 },
  { base: 428, amp: 18, f: 0.0031, ph: 2.2, gap: 2.4, op: 0.88, w: 0.66, shade: 50 },
];
const hillY = (L, x) => L.base - L.amp * (0.6 * Math.sin(x * L.f + L.ph) + 0.28 * Math.sin(x * L.f * 2.3 + L.ph * 1.7) + 0.12 * Math.sin(x * L.f * 5.1 + L.ph * 0.6));
const seeded = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const f1 = n => n.toFixed(1);
const PSHEEP = [
  { l: 1, x: 860, s: 0.4, dir: 1 }, { l: 1, x: 912, s: 0.36, dir: -1, graze: true },
  { l: 2, x: 520, s: 0.6, dir: 1 }, { l: 2, x: 650, s: 0.66, dir: -1, graze: true }, { l: 2, x: 1185, s: 0.58, dir: -1 },
  { l: 3, x: 975, s: 0.86, dir: 1, graze: true },
  { l: 4, x: 330, s: 1.5, dir: 1, graze: true, dy: 16 },
];
const PTREES = [{ l: 1, x: 352, r: 10 }, { l: 1, x: 374, r: 8 }, { l: 2, x: 1000, r: 13 }, { l: 2, x: 1028, r: 10 }, { l: 2, x: 1105, r: 12 }, { l: 3, x: 78, r: 17 }];
function sheepGeom(sh, L, rnd, idx) {
  const s = sh.s, dir = sh.dir, rx = 17 * s, ry = 10.5 * s, legs = 7.5 * s;
  const groundY = hillY(L, sh.x) + (sh.dy || 3), cx = sh.x, cy = groundY - legs - ry * 0.85;
  const pts = []; for (let i = 0; i < 44; i++) { const a = i / 44 * Math.PI * 2; const bump = 1 + 0.055 * Math.sin(a * 9 + idx) + 0.03 * (rnd() - 0.5); const flat = Math.sin(a) > 0 ? 0.92 : 1.04;
    pts.push([cx + rx * bump * Math.cos(a), cy + ry * bump * flat * Math.sin(a)]); }
  const body = 'M' + pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join(' L') + ' Z';
  const curls = []; for (let i = 0; i < Math.round(22 + 10 * s); i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.82; const x = cx + rx * r * Math.cos(a), y = cy + ry * r * Math.sin(a), cr = (1.2 + rnd() * 0.9) * s;
    curls.push(`M${f1(x - cr)} ${f1(y)} a${f1(cr)} ${f1(cr)} 0 1 1 ${f1(cr * 1.6)} ${f1(-cr * 0.6)}`); }
  const belly = []; for (let y = cy + ry * 0.15; y < cy + ry * 1.1; y += 1.35 * Math.max(0.7, s)) belly.push(`M${f1(cx - rx * 1.1)} ${f1(y)} L${f1(cx + rx * 1.1)} ${f1(y + 0.6 * s)}`);
  const legX = [-0.62, -0.38, 0.4, 0.62].map(k => cx + k * rx * dir);
  const legsD = legX.map((x, i) => `M${f1(x)} ${f1(cy + ry * 0.6)} L${f1(x + (i % 2 ? 0.5 : -0.5) * s)} ${f1(groundY)}`).join(' ');
  const hx = cx + dir * (rx + 4.5 * s), hy = sh.graze ? cy + ry * 0.75 : cy - ry * 0.55, rot = dir * (sh.graze ? 48 : -14);
  return { cx, cy, rx, ry, s, dir, groundY, body, curls: curls.join(' '), belly: belly.join(' '), legsD, hx, hy, rot, graze: sh.graze, id: 'sh' + idx };
}
function treeGeom(t, L, rnd) {
  const y0 = hillY(L, t.x) + 2, top = y0 - t.r * 2.6, cx = t.x, cy = top + t.r * 1.05; const marks = [];
  for (let i = 0; i < 55; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()); const x = cx + t.r * 1.05 * r * Math.cos(a), y = cy + t.r * 1.15 * r * Math.sin(a);
    const shadow = (x - cx) * 0.6 + (y - cy) > 0; const cr = t.r * (shadow ? 0.16 : 0.12);
    marks.push({ d: `M${f1(x - cr)} ${f1(y)} a${f1(cr)} ${f1(cr * 0.8)} 0 0 1 ${f1(cr * 2)} 0`, dark: shadow }); }
  return { trunk: `M${f1(cx - 0.8)} ${f1(y0)} L${f1(cx - 0.5)} ${f1(cy + t.r * 0.6)} M${f1(cx + 0.9)} ${f1(y0)} L${f1(cx + 0.5)} ${f1(cy + t.r * 0.6)}`, crown: { cx, cy, rx: t.r * 1.12, ry: t.r * 1.22 }, marks };
}
function pastureArt() {
  const rnd = seeded(20261025); const step = 18; const xs = []; for (let x = -18; x <= PW + 18; x += step) xs.push(x);
  const layers = PLAYERS.map((L, li) => {
    const top = xs.map((x, i) => (i ? 'L' : 'M') + x + ' ' + f1(hillY(L, x))).join(' ');
    const shape = top + ` L${PW + 18} ${PH} L-18 ${PH} Z`;
    const lines = []; let off = L.gap, k = 0;
    while (off < PH - L.base + L.amp + 10) {
      lines.push({ d: xs.map((x, i) => (i ? 'L' : 'M') + x + ' ' + f1(hillY(L, x) + off + Math.sin(x * 0.021 + k * 1.3) * 0.45)).join(' '), w: L.w * (0.5 + 0.95 * Math.min(1, k / 24)) });
      k++; off += L.gap * (1 + k * 0.012);
    }
    const runs = []; let run = null;   // slopes falling to the right face away from the light: cross-hatch them
    for (let x = -18; x <= PW + 18; x += 9) { const sl = hillY(L, x + 5) - hillY(L, x - 5);
      if (sl > 0.35) { if (!run) { run = []; runs.push(run); } run.push([x, sl]); } else run = null; }
    const shade = runs.filter(r => r.length > 4).map(r => { const n = r.length - 1;   // lens-shaped: depth swells in the middle of the slope and fades to nothing at both ends
      return 'M' + r.map(([x]) => x + ' ' + f1(hillY(L, x) + 1)).join(' L') + ' L' + r.slice().reverse().map(([x, sl], i) => x + ' ' + f1(hillY(L, x) + 1 + L.shade * Math.pow(Math.sin(Math.PI * (n - i) / n), 0.8) * (0.55 + 0.45 * Math.min(1, sl / 3)))).join(' L') + ' Z'; }).join(' ');
    const hatch = []; for (let x = -PH; x < PW + 40; x += 3.4) hatch.push(`M${x} ${PH} L${f1(x + PH * 0.62)} 0`);
    const grass = []; if (li >= 3) { for (let x = -10; x < PW + 10; x += li === 4 ? 5 : 9) { if (rnd() < (li === 4 ? 0.55 : 0.35)) continue; const y = hillY(L, x) + (li === 4 ? 1 + rnd() * 26 : 1); const h = (li === 4 ? 5 : 3.5) + rnd() * 5;
      grass.push(`M${f1(x)} ${f1(y)} q${f1(-1 - rnd())} ${f1(-h * 0.5)} ${f1(-0.5 - rnd() * 2)} ${f1(-h)} M${f1(x + 1.4)} ${f1(y)} q${f1(0.6)} ${f1(-h * 0.6)} ${f1(1.5 + rnd() * 1.5)} ${f1(-h * 0.85)}`); } }
    return { L, li, top, shape, lines, shade, hatch: hatch.join(' '), grass: grass.join(' ') };
  });
  const sky = []; for (let y = 14; y < 250; y += 3.1) sky.push(`M0 ${f1(y)} L${PW} ${f1(y + 0.4)}`);
  const clouds = [[{ x: 250, y: 92 }, 1.0], [{ x: 640, y: 58 }, 0.75], [{ x: 1270, y: 104 }, 0.85]].map(([c, k]) => {
    const puffs = []; for (let i = 0; i < 9; i++) { const t = i / 8; puffs.push({ cx: c.x + (t - 0.5) * 170 * k, cy: c.y - Math.sin(t * Math.PI) * 18 * k + (rnd() - 0.5) * 6, r: (16 + Math.sin(t * Math.PI) * 18 + rnd() * 6) * k }); }
    const base = `M${f1(c.x - 95 * k)} ${f1(c.y + 14 * k)} L${f1(c.x + 95 * k)} ${f1(c.y + 14 * k)}`;
    const shading = []; for (let i = 0; i < 5; i++) shading.push(`M${f1(c.x - (70 - i * 6) * k)} ${f1(c.y + (2 + i * 2.6) * k)} q${f1(70 * k)} ${f1(5 * k)} ${f1((140 - i * 12) * k)} 0`);
    return { puffs, base, baseY: c.y + 10 * k, shading: shading.join(' '), clip: { x: c.x - 130 * k, y: c.y - 90 * k, w: 260 * k, h: 100 * k } };
  });
  const sunL = PLAYERS[0], sun = { x: 1040, y: hillY(sunL, 1040) + 8, r: 30 };
  const rays = []; for (let a = 192; a <= 348; a += 4) { const rad = a * Math.PI / 180, long = (a / 4) % 2 === 0; rays.push(`M${f1(sun.x + Math.cos(rad) * (sun.r + 6))} ${f1(sun.y + Math.sin(rad) * (sun.r + 6))} L${f1(sun.x + Math.cos(rad) * (long ? 175 : 120))} ${f1(sun.y + Math.sin(rad) * (long ? 175 : 120))}`); }
  const lake = { cx: 470, top: 262, bot: 292, half: 270 };
  const lakeLines = []; for (let y = lake.top + 2; y < lake.bot; y += 2.4) { const t = (y - lake.top) / (lake.bot - lake.top), half = lake.half * Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 2)));
    let x = lake.cx - half; while (x < lake.cx + half) { const len = 14 + rnd() * 40, gap = 2 + rnd() * 9; lakeLines.push(`M${f1(x)} ${f1(y)} L${f1(Math.min(lake.cx + half, x + len))} ${f1(y)}`); x += len + gap; } }
  const lakeShape = (() => { const pts = []; for (let i = 0; i <= 40; i++) { const t = i / 40, x = lake.cx - lake.half + t * lake.half * 2; pts.push([x, lake.top + (lake.bot - lake.top) * (0.5 - 0.5 * Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 2))))]); }
    for (let i = 40; i >= 0; i--) { const t = i / 40, x = lake.cx - lake.half + t * lake.half * 2; pts.push([x, lake.top + (lake.bot - lake.top) * (0.5 + 0.5 * Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 2))))]); }
    return 'M' + pts.map(p => f1(p[0]) + ' ' + f1(p[1])).join(' L') + ' Z'; })();
  const fL = PLAYERS[3]; const posts = []; for (let x = 1065, i = 0; x <= PW + 10; x += 34 - i * 0.6, i++) posts.push({ x, y: hillY(fL, x) + 12, h: 22 - i * 0.5 });
  const sheep = PSHEEP.map((sh, i) => ({ ...sheepGeom(sh, PLAYERS[sh.l], rnd, i), l: sh.l }));
  const trees = PTREES.map(t => ({ ...treeGeom(t, PLAYERS[t.l], rnd), l: t.l }));
  return { layers, sky: sky.join(' '), clouds, sun, rays: rays.join(' '), lakeLines: lakeLines.join(' '), lakeShape, posts, sheep, trees };
}
function Pasture() {
  const P = usePal(); const art = React.useMemo(pastureArt, []); const [baa, setBaa] = React.useState(null);
  const dk = dark(P); const ink = dk ? '#9CC79A' : '#24533F'; const paper = P.bg; const wool = dk ? '#E4ECDB' : '#FBFAF3'; const face = dk ? '#5F7D64' : '#1F2B23'; const gold = dk ? '#D9B85C' : '#B8902E';
  React.useEffect(() => { if (baa == null) return; const t = setTimeout(() => setBaa(null), 1400); return () => clearTimeout(t); }, [baa]);
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const at = l => ({
    trees: art.trees.filter(t => t.l === l), sheep: art.sheep.filter(s => s.l === l),
  });
  return (
    <div className="relative w-full select-none" aria-hidden="true" style={{ marginTop: 8 }}>
      <svg viewBox={`0 40 ${PW} ${PH - 40}`} preserveAspectRatio="xMidYMax slice" className="block w-full" style={{ height: 'clamp(240px, 30vw, 420px)' }}>
        <defs>
          <linearGradient id={uid + 'fade'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="0.12" stopColor="#fff" stopOpacity="0" /><stop offset="0.4" stopColor="#fff" stopOpacity="1" /></linearGradient>
          <mask id={uid + 'skym'} maskUnits="userSpaceOnUse" x="0" y="0" width={PW} height={PH}><rect x="0" y="0" width={PW} height={PH} fill={`url(#${uid}fade)`} /></mask>
          {art.layers.map(a => <clipPath key={a.li} id={uid + 'hill' + a.li}><path d={a.shape} /></clipPath>)}
          {art.layers.map(a => <clipPath key={'s' + a.li} id={uid + 'shade' + a.li}><path d={a.shade || 'M0 0Z'} /></clipPath>)}
          {art.sheep.map(s => <clipPath key={s.id} id={uid + s.id}><path d={s.body} /></clipPath>)}
        </defs>
        <g mask={`url(#${uid}skym)`}>
          <path d={art.sky} stroke={ink} strokeWidth="0.32" opacity="0.32" fill="none" />
          <g>{art.rays && <path d={art.rays} stroke={gold} strokeWidth="0.55" opacity="0.55" fill="none" />}
            <circle cx={art.sun.x} cy={art.sun.y} r={art.sun.r} fill={paper} stroke={gold} strokeWidth="0.9" />
            <circle cx={art.sun.x} cy={art.sun.y} r={art.sun.r - 4} fill="none" stroke={gold} strokeWidth="0.4" opacity="0.7" /></g>
          {art.clouds.map((c, i) => (
            <g key={i}>
              <clipPath id={uid + 'cl' + i}><rect x={c.clip.x} y={c.clip.y} width={c.clip.w} height={c.baseY - c.clip.y} /></clipPath>
              <g clipPath={`url(#${uid}cl${i})`}>
                {c.puffs.map((p, j) => <circle key={j} cx={p.cx} cy={p.cy} r={p.r} fill="none" stroke={ink} strokeWidth="1.2" opacity="0.6" />)}
                {c.puffs.map((p, j) => <circle key={'f' + j} cx={p.cx} cy={p.cy} r={p.r - 0.35} fill={paper} />)}
                <path d={c.shading} stroke={ink} strokeWidth="0.4" opacity="0.45" fill="none" />
              </g>
            </g>))}
        </g>
        {art.layers.map(a => (
          <g key={a.li}>
            <path d={a.shape} fill={paper} />
            <g clipPath={`url(#${uid}hill${a.li})`} opacity={a.L.op}>
              {a.lines.map((ln, i) => <path key={i} d={ln.d} fill="none" stroke={ink} strokeWidth={ln.w} />)}
              {a.shade && <g clipPath={`url(#${uid}shade${a.li})`}><path d={a.hatch} stroke={ink} strokeWidth={a.L.w * 0.75} fill="none" /></g>}
            </g>
            <path d={a.top} fill="none" stroke={ink} strokeWidth={a.L.w * 1.25} opacity={Math.min(1, a.L.op + 0.1)} />
            {a.grass && <path d={a.grass} fill="none" stroke={ink} strokeWidth={a.li === 4 ? 0.6 : 0.45} opacity={a.L.op} strokeLinecap="round" />}
            {a.li === 1 && <g><path d={art.lakeShape} fill={paper} /><path d={art.lakeLines} stroke={ink} strokeWidth="0.45" opacity="0.55" fill="none" /></g>}
            {at(a.li).trees.map((t, i) => (
              <g key={i}>
                <path d={t.trunk} stroke={ink} strokeWidth="0.8" fill="none" />
                <ellipse cx={t.crown.cx} cy={t.crown.cy} rx={t.crown.rx} ry={t.crown.ry} fill={paper} stroke={ink} strokeWidth="0.35" opacity="0.9" />
                {t.marks.map((m, j) => <path key={j} d={m.d} fill="none" stroke={ink} strokeWidth={m.dark ? 0.6 : 0.4} opacity={m.dark ? 0.9 : 0.55} />)}
              </g>))}
            {a.li === 3 && <g>{art.posts.map((p, i) => <g key={i}><path d={`M${p.x} ${p.y} L${p.x} ${p.y - p.h} M${p.x + 1.6} ${p.y} L${p.x + 1.6} ${p.y - p.h + 0.6}`} stroke={ink} strokeWidth="0.9" /><path d={`M${p.x + 0.4} ${p.y - p.h * 0.3} l1 1 M${p.x + 0.4} ${p.y - p.h * 0.55} l1 1`} stroke={ink} strokeWidth="0.4" /></g>)}
              {[0.78, 0.42].map(h => <path key={h} d={art.posts.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + f1(p.y - p.h * h)).join(' ')} fill="none" stroke={ink} strokeWidth="1" />)}
              {[0.78, 0.42].map(h => <path key={'b' + h} d={art.posts.map((p, i) => (i ? 'L' : 'M') + p.x + ' ' + f1(p.y - p.h * h + 1.4)).join(' ')} fill="none" stroke={ink} strokeWidth="0.4" opacity="0.6" />)}</g>}
            {at(a.li).sheep.map(s => (
              <g key={s.id} onMouseEnter={() => setBaa(s.id)} style={{ cursor: 'default' }}>
                <ellipse cx={s.cx} cy={s.groundY + 0.5} rx={s.rx * 1.1} ry={1.6 * s.s} fill={ink} opacity="0.18" />
                <path d={s.legsD} stroke={face} strokeWidth={1.7 * s.s} strokeLinecap="round" />
                <path d={s.body} fill={wool} stroke={ink} strokeWidth={Math.max(0.55, 0.8 * s.s)} />
                <g clipPath={`url(#${uid}${s.id})`}><path d={s.belly} stroke={ink} strokeWidth={0.4 * s.s} opacity="0.5" fill="none" /></g>
                <path d={s.curls} fill="none" stroke={ink} strokeWidth={Math.max(0.35, 0.45 * s.s)} opacity="0.6" />
                <g transform={`rotate(${s.rot} ${s.hx} ${s.hy})`}>
                  <path d={`M${f1(s.hx - s.dir * 6 * s.s)} ${f1(s.hy - 2.8 * s.s)} q${f1(s.dir * 9 * s.s)} ${f1(-1.5 * s.s)} ${f1(s.dir * 11 * s.s)} ${f1(2.4 * s.s)} q${f1(-s.dir * 1.5 * s.s)} ${f1(3.2 * s.s)} ${f1(-s.dir * 9 * s.s)} ${f1(3.4 * s.s)} q${f1(-s.dir * 3 * s.s)} ${f1(-1.6 * s.s)} ${f1(-s.dir * 2 * s.s)} ${f1(-5.8 * s.s)} Z`} fill={face} />
                  <ellipse cx={s.hx - s.dir * 4.5 * s.s} cy={s.hy - 3.6 * s.s} rx={3 * s.s} ry={1.1 * s.s} transform={`rotate(${s.dir * -25} ${s.hx - s.dir * 4.5 * s.s} ${s.hy - 3.6 * s.s})`} fill={face} />
                  <circle cx={s.hx + s.dir * 0.6 * s.s} cy={s.hy - 0.9 * s.s} r={0.55 * s.s} fill={wool} />
                </g>
                {baa === s.id && <text x={s.cx + s.dir * 22 * s.s} y={s.cy - s.ry - 10 * s.s} textAnchor="middle" fontFamily={SERIF} fontStyle="italic" fontSize={Math.max(14, 13 * s.s)} fill={ink}>beeee</text>}
              </g>))}
          </g>
        ))}
      </svg>
    </div>
  );
}
/* ---------- small pieces ---------- */
const Ext = () => <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline', verticalAlign: '0' }}><path d="M3.5 8.5l5-5M4.5 3.5h4v4" /></svg>;

function CardArt({ card, width }) {
  const a = (card && card.art) || {}; const small = width && width < 90; const P = usePal();
  return (
    <div className="relative shrink-0 overflow-hidden" style={{ width: width || '100%', aspectRatio: '1.586', borderRadius: small ? 5 : 11, background: card ? `linear-gradient(135deg, ${a.from || '#52525b'}, ${a.to || '#27272a'})` : P.sunk, color: a.ink || '#fff', boxShadow: `inset 0 0 0 1px ${P.line}` }}>
      {!small && card && (<>
        <div className="absolute left-3 right-3 top-2.5 flex items-baseline justify-between gap-2" style={{ color: a.sub || a.ink }}>
          <div className="min-w-0 truncate text-[11px] font-medium">{card.issuer}</div>
          {card.network && card.network !== card.issuer && <div className="shrink-0 text-[10px] font-semibold italic">{card.network}</div>}
        </div>
        <div className="absolute bottom-2.5 left-3 right-3 text-[13px] font-semibold leading-tight">{card.short || card.name}</div>
      </>)}
    </div>
  );
}
const FOIL_CSS = `.benny-foil{position:relative;overflow:hidden;isolation:isolate}
.benny-foil>.benny-sheen{position:absolute;inset:-1px;pointer-events:none;z-index:1;border-radius:inherit;opacity:0;
background:linear-gradient(105deg,transparent 28%,rgba(214,176,74,.35) 40%,rgba(255,240,190,.85) 48%,rgba(255,252,240,.95) 50%,rgba(176,226,196,.5) 56%,transparent 70%);
transform:translateX(-130%)}
.benny-foil:hover>.benny-sheen,.benny-foil:focus-visible>.benny-sheen{opacity:1;animation:bennySheen .9s cubic-bezier(.3,0,.2,1) 1 forwards}
.benny-foil>.benny-label{position:relative;z-index:2}
@keyframes bennySheen{0%{transform:translateX(-130%)}100%{transform:translateX(130%)}}
@media (prefers-reduced-motion: reduce){.benny-foil>.benny-sheen{display:none}}`;
function Sheen() { return <span aria-hidden="true" className="benny-sheen" />; }
function Btn({ children, onClick, kind, disabled, small, title, foil }) {
  const P = usePal();
  const st = kind === 'primary' ? { background: P.accent, color: P.accentInk, border: `1px solid ${P.accent}` } : kind === 'quiet' ? { background: 'transparent', color: P.muted, border: '1px solid transparent' } : { background: 'transparent', color: P.ink, border: `1px solid ${P.lineStrong}` };
  const shine = (foil || kind === 'primary') && !disabled;
  return <button title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center rounded-full font-medium transition-opacity hover:opacity-85 disabled:opacity-40 ${shine ? 'benny-foil ' : ''}${small ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2 text-[13px]'}`} style={st}>{shine ? <><Sheen /><span className="benny-label">{children}</span></> : children}</button>;
}
function Label({ children }) { const P = usePal(); return <div className="text-[11px] font-semibold uppercase" style={{ color: P.muted, letterSpacing: '0.14em' }}>{children}</div>; }
function Muted({ children, className = '' }) { const P = usePal(); return <div className={className} style={{ color: P.muted }}>{children}</div>; }
function Panel({ children, className = '' }) { const P = usePal(); return <div className={`rounded-2xl p-5 ${className}`} style={{ background: P.surface, border: `1px solid ${P.line}` }}>{children}</div>; }
function Tier({ tier }) {
  const P = usePal(); const m = { confirmed: ['Confirmed', P.accent, P.accentSoft], possible: ['Likely', P.likely, P.likelySoft], likely: ['Likely', P.likely, P.likelySoft], needs_info: ['Needs info', P.info, P.infoSoft], you: ['Confirmed by you', P.accent, P.accentSoft], unused: ['Not used yet', P.info, P.infoSoft], ended: ['Period ended', P.faint, P.sunk], inferred: ['Inferred', P.info, P.infoSoft] }[tier] || [tier, P.muted, P.sunk];
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: m[1], background: m[2] }}>{m[0]}</span>;
}
function Select({ value, onChange, children }) { const P = usePal(); return <select value={value} onChange={e => onChange(e.target.value)} className="min-w-0 rounded-full px-3 py-2 text-[13px]" style={{ background: P.surface, color: P.ink, border: `1px solid ${P.lineStrong}` }}>{children}</select>; }
function Input(props) { const P = usePal(); return <input {...props} className={`min-w-0 rounded-full px-4 py-2 text-[13px] outline-none ${props.className || ''}`} style={{ background: P.surface, color: P.ink, border: `1px solid ${P.lineStrong}` }} />; }

function cardHint(c) {
  const cash = c.currency && c.currency.unit === 'cashback';
  const best = (c.earn || []).filter(e => !e.conditional && !(e.categories || []).includes('*')).sort((a, b) => b.rate - a.rate)[0];
  const fee = c.annualFee === 0 ? 'No annual fee' : typeof c.annualFee === 'number' ? '$' + c.annualFee + '/yr' : null;
  return [best ? best.rate + (cash ? '%' : 'x') + ' ' + best.label.toLowerCase() : null, fee].filter(Boolean).join(' · ');
}
function CardPicker({ cards, selected, onToggle }) {
  const P = usePal(); const [q, setQ] = React.useState('');
  const list = cards.slice().sort((a, b) => (a.issuer || '').localeCompare(b.issuer || '') || a.name.localeCompare(b.name)).filter(c => !q || (c.name + ' ' + c.issuer + ' ' + (c.short || '')).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <Input value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${cards.length} cards by name or bank`} className="w-full" />
      <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {list.map(c => { const on = selected.has(c.cardId); return (
          <button key={c.cardId} onClick={() => onToggle(c.cardId)} className="relative text-left" aria-pressed={on} title={on ? 'Tap to remove' : 'Tap to add'}>
            <div style={{ transform: on ? 'translateY(-2px)' : 'none', transition: 'transform .15s ease', boxShadow: on ? `0 0 0 2px ${P.accent}` : 'none', borderRadius: 11 }}><CardArt card={c} /></div>
            {on && <div className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px]" style={{ background: P.accent, color: P.accentInk }}>✓</div>}
            <div className="mt-1.5 text-[12.5px] font-medium leading-4" style={{ color: P.ink }}>{c.name}</div>
            <div className="mt-0.5 truncate text-[11.5px]" style={{ color: P.muted }}>{cardHint(c) || c.issuer}</div>
          </button>); })}
      </div>
      {list.length === 0 && <Muted className="mt-4 text-[13px]">No match for “{q}”.</Muted>}
      <Muted className="mt-4 text-[12px] leading-5">Card not listed? Benny+ covers {cards.length} popular cards for now. You can still bring in its purchases; they’re saved, but Benny+ can’t score them until the card is added.</Muted>
    </div>
  );
}
function Why({ items, quote }) {
  const P = usePal(); const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-2">
      <button className="text-[12px] font-medium underline" style={{ color: P.muted }} onClick={() => setOpen(o => !o)}>{open ? 'Hide why' : 'Why?'}</button>
      {open && <div className="mt-2 space-y-1.5 rounded-xl p-3 text-[12px] leading-5" style={{ background: P.sunk }}>
        {items.length === 0 && <div style={{ color: P.muted }}>No evidence yet beyond the transaction itself.</div>}
        {items.map((e, i) => <div key={i} className="flex flex-wrap items-baseline gap-x-2"><Tier tier={e.strength} /><span style={{ color: P.ink }}>{e.reason}</span><span style={{ color: P.faint }}>· from {SRC[e.source] || e.source} · by {e.producer}</span></div>)}
        {quote && quote.quote && <div className="pt-1" style={{ color: P.muted }}>Card terms: “{quote.quote}” {quote.url && <a className="underline" href={quote.url} target="_blank" rel="noreferrer">source <Ext /></a>}</div>}
      </div>}
    </div>
  );
}
function Row({ left, title, sub, right, children }) {
  const P = usePal(); const [open, setOpen] = React.useState(false);
  return (
    <div style={{ borderTop: `1px solid ${P.line}` }}>
      <button onClick={() => children && setOpen(o => !o)} className="flex w-full items-center gap-3 py-3 text-left">
        {left}<div className="min-w-0 flex-1"><div className="truncate text-[14px] font-medium" style={{ color: P.ink }}>{title}</div>{sub && <div className="truncate text-[12px]" style={{ color: P.muted }}>{sub}</div>}</div>{right}
      </button>
      {open && children && <div className="pb-4 pl-[56px] text-[13px] leading-5" style={{ color: P.muted }}>{children}</div>}
    </div>
  );
}

/* ---------- inputs: statement, bank, receipt/email ---------- */
const fileToDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('could not read the file')); r.readAsDataURL(f); });
const isPdf = f => f && (/\.pdf$/i.test(f.name) || f.type === 'application/pdf');
function Importer({ accounts, cards, defaultAccountId, call, onDone, onCancel, preparsed, preparsedFile }) {
  const P = usePal();
  const [pdf, setPdf] = React.useState(preparsed || null); const [reading, setReading] = React.useState(false); const [showAll, setShowAll] = React.useState(false);
  const [file, setFile] = React.useState(null); const [raw, setRaw] = React.useState(null); const [cols, setCols] = React.useState(null);
  const [sign, setSign] = React.useState(1); const [acct, setAcct] = React.useState(defaultAccountId || ''); const [usd, setUsd] = React.useState(false);
  const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(null);
  const adoptPdf = d => { setPdf(d); setRaw(null); const hit = d.card_last4 && accounts.filter(a => a.mask === d.card_last4); if (hit && hit.length === 1) setAcct(hit[0].id); if (/^(usd|\$|us\$)$/i.test(String(d.currency || '').trim())) setUsd(true); };
  React.useEffect(() => { if (preparsed) adoptPdf(preparsed); }, []);
  const onFile = async f => {
    setErr(null); setFile(f); setPdf(null); if (!f) return;
    if (isPdf(f)) {
      setReading(true);
      try { const d = await call('POST', '/v1/statements/pdf', { content: await fileToDataUrl(f), file_name: f.name });
        if (d.document_type !== 'card_statement') setErr('This PDF doesn’t look like a card statement. Add receipts with “Add a receipt or order email”.');
        else if (!d.rows.length) setErr('No transactions were found in this statement.'); else adoptPdf(d); }
      catch (e) { setErr(e.message); }
      setReading(false); return;
    }
    const r = headersOf(await f.text()); setRaw(r); const c = detectCols(r.headers); setCols(c); const b = buildRows(r.rows, c); if (b.sign) setSign(b.sign);
  };
  const built = raw && cols ? buildRows(raw.rows, cols) : null;
  const rows = pdf ? pdf.rows.map(r => ({ date: r.date, desc: r.desc, amount: r.amount_cents / 100, kind: r.kind })) : built && !built.error ? normalizeRows(built, sign) : [];
  const fname = (file && file.name) || (preparsedFile && preparsedFile.name) || 'statement.pdf';
  const counts = rows.reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {});
  const setCol = (k, v) => setCols(c => ({ ...c, [k]: Number(v) }));
  const run = async () => {
    if (!acct) { setErr('Choose which card this statement belongs to.'); return; }
    if (!usd) { setErr('Confirm the amounts are in US dollars.'); return; }
    setBusy(true); setErr(null);
    try { onDone(await call('POST', '/v1/imports/csv', { account_id: acct, file_name: fname, currency_confirmed: 'USD', rows: rows.map(x => ({ date: x.date, desc: x.desc, amount_cents: Math.round(x.amount * 100), kind: x.kind, currency: 'USD' })) })); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const colPick = (k, label, optional) => raw && <label className="flex items-center gap-2 text-[12px]" style={{ color: P.muted }}>{label}
    <Select value={cols[k]} onChange={v => setCol(k, v)}><option value={-1}>{optional ? 'none' : 'choose…'}</option>{raw.headers.map((h, i) => <option key={i} value={i}>{h || 'column ' + (i + 1)}</option>)}</Select></label>;
  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3"><div className="text-[15px] font-semibold">Upload a statement</div><Muted className="text-[12px]">CSV or PDF from your card’s website</Muted></div>
      <Muted className="mt-1 text-[13px] leading-5">A CSV download or the PDF statement itself. For a PDF, Benny+ reads the transaction lines (card numbers, emails and phone numbers are masked first) and checks them against the statement’s printed totals. Check the preview, choose the card, confirm the currency. Rows already here from your bank or an earlier upload are kept once. You can undo the upload later.</Muted>
      <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-3 text-[13px]" style={{ border: `1px dashed ${P.lineStrong}` }}>
        <span className="truncate">{reading ? 'Reading the statement…' : file ? file.name : preparsedFile ? preparsedFile.name : 'Choose a CSV or PDF statement'}</span><span className="font-medium" style={{ color: P.accent }}>Browse</span>
        <input type="file" disabled={reading} accept=".csv,text/csv,.pdf,application/pdf" className="hidden" onChange={e => { onFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
      </label>
      {pdf && (() => { const ck = pdf.checks || {}; const line = (label, printed, read, ok) => printed == null ? null :
          <div style={{ color: ok ? P.accent : P.danger }}>{ok ? '✓' : '!'} {label}: read {fmt(read / 100)}{ok ? ', matches the statement' : `, but the statement prints ${fmt(printed / 100)}. Check the rows before uploading.`}</div>;
        return <div className="mt-3 space-y-1 text-[12.5px]" style={{ color: P.muted }}>
          <div>{[pdf.issuer, pdf.card_last4 && 'card ending ' + pdf.card_last4, pdf.period_start && pdf.period_end && `${fmtDate(pdf.period_start)} – ${fmtDate(pdf.period_end)}`, pdf.pages && pdf.pages + ' page' + (pdf.pages === 1 ? '' : 's')].filter(Boolean).join(' · ')}</div>
          {line('Purchases', ck.purchases_printed, ck.purchases_read, ck.purchases_match)}{line('Payments and credits', ck.payments_printed, ck.payments_read, ck.payments_match)}
          {ck.purchases_printed == null && ck.payments_printed == null && <div>The statement’s totals weren’t found, so check the rows below.</div>}
          {pdf.card_last4 && !accounts.some(a => a.mask === pdf.card_last4) && <div>No card here ends in {pdf.card_last4} yet: pick the card below.</div>}
        </div>; })()}
      {(raw || pdf) && (
        <div className="mt-4 space-y-4">
          {raw && <div><Label>Columns</Label><div className="mt-2 flex flex-wrap gap-3">{colPick('date', 'Date')}{colPick('desc', 'Description')}{colPick('amount', 'Amount', true)}{colPick('debit', 'Debit', true)}{colPick('credit', 'Credit', true)}{colPick('type', 'Type', true)}</div></div>}
          {built && built.error && <div className="text-[13px]" style={{ color: P.danger }}>{built.error}</div>}
          {rows.length > 0 && <>
            <div className="rounded-xl" style={{ border: `1px solid ${P.line}` }}>
              {rows.slice(0, pdf ? (showAll ? rows.length : 6) : 3).map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]" style={i ? { borderTop: `1px solid ${P.line}` } : null}>
                  <span className="w-24 shrink-0" style={{ color: P.muted }}>{fmtDate(r.date)}</span><span className="min-w-0 flex-1 truncate">{r.desc}</span>
                  <span className="text-[11px]" style={{ color: P.muted }}>{r.kind}</span><span className="w-24 text-right tabular-nums">{fmt(r.kind === 'purchase' || r.kind === 'fee' ? r.amount : -r.amount)}</span>
                </div>))}
            </div>
            {pdf && rows.length > 6 && <button className="text-[12px] underline" style={{ color: P.muted }} onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${rows.length} rows`}</button>}
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]" style={{ color: P.muted }}>
              <span>{rows.length} rows · {counts.purchase || 0} purchases · {(counts.refund || 0) + (counts.credit || 0)} refunds or credits · {counts.payment || 0} payments</span>
              {built && built.mode === 'amount' && <button className="underline" onClick={() => setSign(s => -s)}>Purchases are {sign < 0 ? 'negative' : 'positive'} (from {built.signBasis}). Flip</button>}
            </div>
            <div><Label>Which card is this statement from?</Label>
              <div className="mt-2 flex flex-wrap gap-2">{accounts.map(x => { const on = acct === x.id; return (
                <button key={x.id} onClick={() => setAcct(x.id)} className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[12px]" style={{ border: `1px solid ${on ? P.accent : P.lineStrong}`, boxShadow: on ? `0 0 0 1px ${P.accent}` : 'none' }}>
                  <CardArt card={cards[x.product_id]} width={34} /><span>{acctLabel(x, cards)}</span></button>); })}</div></div>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={usd} onChange={e => setUsd(e.target.checked)} /> Amounts in this {pdf ? 'statement' : 'file'} are US dollars</label>
          </>}
        </div>
      )}
      {err && <div className="mt-3 text-[13px]" style={{ color: P.danger }}>{err}</div>}
      <div className="mt-4 flex gap-2"><Btn kind="primary" disabled={busy || !rows.length} onClick={run}>{busy ? 'Uploading…' : `Upload ${rows.length || ''} rows`}</Btn>{onCancel && <Btn onClick={onCancel}>Cancel</Btn>}</div>
    </Panel>
  );
}
/* ---------- receipt estimate: rewards first, paying card second (engine decides values; nothing stored) ---------- */
const walletAccts = (st, rules) => (st.accounts || []).filter(a => a.product_id && a.product_confirmed && rules && rules.cards[a.product_id]);
const NET_ALIAS = { amex: 'american express', mc: 'mastercard' };
function docFacts(st, docId) {
  const ev = st.evidence || []; const latest = t => ev.filter(e => e.subject_type === t && e.subject_id === docId).sort((a, b) => b.observed_at - a.observed_at)[0];
  const card = latest('doc_card'), cat = latest('doc_category');
  const link = ev.find(e => e.subject_type === 'link' && e.strength === 'confirmed' && jparse(e.data).document_id === docId);
  return { card: card ? jparse(card.data) : null, category: cat ? jparse(cat.data).category : null, linkPurchaseId: link ? link.subject_id : null, linkAuto: !!(link && link.producer === 'auto-match'), linkReason: link ? link.reason : null };
}
function resolvePaid(d, ex, st, rules) {
  const facts = docFacts(st, d.id); const accts = walletAccts(st, rules);
  const last4 = ex.payment_last4 ? (String(ex.payment_last4).replace(/\D/g, '').slice(-4) || null) : null;
  const linkP = facts.linkPurchaseId && (st.purchases || []).find(p => p.id === facts.linkPurchaseId);
  if (linkP) { const a = st.accounts.find(x => x.id === linkP.account_id); if (a) return { account: a, how: 'bank', firm: true, last4 }; }
  if (facts.card) {
    if (facts.card.account_id == null) return { account: null, how: 'unsure', firm: false, last4 };
    const a = st.accounts.find(x => x.id === facts.card.account_id); if (a) return { account: a, how: 'you', firm: true, last4 };
  }
  if (last4) { const hits = accts.filter(a => a.mask === last4); if (hits.length === 1) return { account: hits[0], how: 'last4', firm: false, last4 }; }
  if (ex.payment_network && accts.length > 1) {
    let net = mnorm(ex.payment_network); net = NET_ALIAS[net] || net;
    const hits = accts.filter(a => { const n = mnorm(rules.cards[a.product_id].network); return n && (net.includes(n) || n.includes(net)) && !(last4 && a.mask && a.mask !== last4); });
    if (hits.length === 1) return { account: hits[0], how: 'network', firm: false, last4, network: rules.cards[hits[0].product_id].network };
  }
  if (accts.length === 1) return { account: accts[0], how: 'only', firm: false, last4 };
  return { account: null, how: 'ask', firm: false, last4 };
}
function receiptView(d, st, rules, E, mode) {
  const ex = jparse(d.extracted); if (!ex.is_purchase_document) return { ex, ok: false };
  const items = ex.items || []; const itemSum = items.reduce((s, i) => s + (i.price_cents != null ? i.price_cents * (i.qty || 1) : 0), 0);
  const cents = ex.total_cents != null ? ex.total_cents : (itemSum || null); const amount = cents != null ? cents / 100 : null;
  const facts = docFacts(st, d.id); const accts = walletAccts(st, rules); const paid = resolvePaid(d, ex, st, rules);
  const foreign = !!(ex.currency && !/^(usd|\$|us\$)$/i.test(String(ex.currency).trim()));
  let m = null, catSource = 'unknown';
  if (facts.category) { m = { id: 'cat:' + facts.category, name: ex.merchant || '', categories: [facts.category], confidence: 'high' }; catSource = 'you'; }
  else if (ex.merchant && E) { const fm = E.findMerchant(rules.mcc, ex.merchant).match; if (fm) { m = fm; catSource = fm.confidence === 'high' ? 'table' : 'table-low'; } }
  const merchant = m || { id: 'unknown', name: ex.merchant || '', categories: ['other'], confidence: 'low' };
  const ids = [...new Set(accts.map(a => a.product_id))];
  const rec = E && amount != null && !foreign && ids.length ? E.recommend(rules, ids, merchant, amount, mode || 'cash') : null;
  const rows = rec ? accts.map(a => ({ a, r: rec.ranking.find(x => x.cardId === a.product_id) })).filter(x => x.r).sort((x, y) => y.r.valueUsd - x.r.valueUsd) : [];
  const top = rows[0] || null; const usedRow = paid.account ? rows.find(x => x.a.id === paid.account.id) : null;
  return { ok: true, ex, items, cents, amount, facts, accts, paid, foreign, merchant, catSource, rec, rows, top, usedRow };
}
function ReceiptEstimate({ d, st, rules, E, call, refresh, startOpen }) {
  const P = usePal(); const [open, setOpen] = React.useState(!!startOpen); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(null); const [changing, setChanging] = React.useState(false); const [mode, setMode] = React.useState('cash');
  const v = React.useMemo(() => (rules ? receiptView(d, st, rules, E, mode) : null), [d, st, rules, E, mode]);
  if (!v) return null;
  if (!v.ok) return <div className="py-3 text-[13px]" style={{ borderTop: `1px solid ${P.line}`, color: P.muted }}>{d.subject || d.file_name || 'Document'}: not a receipt or order confirmation, so there’s nothing to estimate.</div>;
  const { ex, paid, rows, top, usedRow } = v; const cards = rules.cards;
  const save = async (body, maskFor) => {
    setBusy(true); setErr(null);
    try { await call('POST', `/v1/documents/${d.id}/facts`, body);
      if (maskFor && paid.last4 && !maskFor.mask && !st.accounts.some(a => a.mask === paid.last4)) await call('POST', '/v1/accounts/' + maskFor.id, { mask: paid.last4 });
      setChanging(false); await refresh(); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const name = a => acctLabel(a, cards);
  const catLabel = v.catSource === 'you' ? 'you picked' : v.catSource === 'table' ? 'known merchant' : v.catSource === 'table-low' ? 'best guess' : 'not recognized';
  const cat = (v.merchant.categories || ['other'])[0];
  const best = top && top.r.valueUsd;
  const outcome = (() => {
    if (!usedRow || !top || rows.length < 2) return null;
    const diff = Math.round((top.r.valueUsd - usedRow.r.valueUsd) * 100) / 100; const pre = paid.firm ? 'You' : 'If that’s right, you';
    const usedCur = cards[usedRow.a.product_id].currency;
    if (usedRow.r.valueUsd === 0 && usedRow.r.earned > 0 && usedCur.unit !== 'cashback')
      return { good: false, text: `${pre} earned about ${Math.round(usedRow.r.earned).toLocaleString()} ${usedCur.unitLabel || 'points'} with ${name(usedRow.a)}. They have no fixed cash value; ${name(top.a)} would have paid ≈ ${fmt(top.r.valueUsd)}.` };
    if (diff < 0.01) return { good: true, text: `${pre} used your best card for this: ≈ ${fmt(usedRow.r.valueUsd)}.` };
    return { good: false, text: `${pre} earned ≈ ${fmt(usedRow.r.valueUsd)} with ${name(usedRow.a)}. ${name(top.a)} would have earned ≈ ${fmt(top.r.valueUsd)}, about ${fmt(diff)} more.` };
  })();
  const picker = (
    <div className="mt-2 flex flex-wrap gap-2">{v.accts.map(a => <Btn key={a.id} small kind={paid.account && paid.account.id === a.id ? 'primary' : undefined} disabled={busy} onClick={() => save({ account_id: a.id }, a)}>{name(a)}</Btn>)}
      <Btn small kind="quiet" disabled={busy} onClick={() => save({ account_id: null })}>Not sure</Btn>{changing && <Btn small kind="quiet" onClick={() => setChanging(false)}>Cancel</Btn>}</div>);
  const paidLine = (() => {
    const a = paid.account;
    if (paid.how === 'bank') { const lp = (st.purchases || []).find(p => p.id === v.facts.linkPurchaseId);
      return <span>Paid with <b>{name(a)}</b> · {v.facts.linkAuto ? 'matched automatically to' : 'matched to'} {lp ? <>“{lp.merchant_raw}” on {fmtDate(lp.posted_on)} ({fmt(lp.amount_cents / 100)})</> : 'your bank transaction'}
        {v.facts.linkAuto && v.facts.linkReason && <span title={v.facts.linkReason}> · {v.facts.linkReason.replace(/^Matched automatically: /, '')}</span>}
        {lp && <button className="ml-2 underline" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await call('POST', `/v1/documents/${d.id}/unlink`, { purchase_id: lp.id }); await refresh(); } catch (e) { setErr(e.message); } setBusy(false); }}>Not this one</button>}</span>; }
    if (paid.how === 'you') return <span>Paid with <b>{name(a)}</b> · you picked</span>;
    if (paid.how === 'last4') return <span>Paid with <b>{name(a)}</b> · the receipt shows the same last four digits</span>;
    if (paid.how === 'network') return <span>Probably <b>{name(a)}</b> · the receipt says {ex.payment_network} and it’s your only {paid.network} card</span>;
    if (paid.how === 'only') return <span>Assuming <b>{name(a)}</b> · it’s the only card in your wallet</span>;
    if (paid.how === 'unsure') return <span>Card not known · you said you’re not sure</span>;
    return <span className="font-medium" style={{ color: P.ink }}>Which card did you pay with?</span>;
  })();
  const summary = top ? (v.accts.length === 1 ? `≈ ${fmt(top.r.valueUsd)} on ${name(top.a)}` : `best: ${name(top.a)} ≈ ${fmt(best)}`) : (v.amount == null ? 'total not read' : v.foreign ? 'not in USD' : !v.accts.length ? 'add cards to estimate' : '');
  return (
    <div style={{ borderTop: `1px solid ${P.line}` }}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-baseline justify-between gap-3 py-3 text-left">
        <div className="min-w-0"><div className="truncate text-[14px] font-semibold" style={{ color: P.ink }}>{ex.merchant || 'Unknown merchant'}</div>
          <Muted className="truncate text-[12px]">{[ex.purchase_date && fmtDate(ex.purchase_date), v.cents != null && fmt(v.cents / 100), v.items.length ? `${v.items.length} item${v.items.length === 1 ? '' : 's'}` : null, d.kind === 'receipt' ? 'receipt photo' : 'email'].filter(Boolean).join(' · ')}</Muted></div>
        <div className="flex shrink-0 items-center gap-2"><span className="text-[13px] font-semibold" style={{ color: top ? P.accent : P.muted, fontFamily: top ? SERIF : undefined }}>{summary}</span>{paid.how === 'ask' && v.accts.length > 1 && <span className="rounded-full px-1.5 text-[11px] font-bold" style={{ background: P.infoSoft, color: P.info }}>pick card</span>}<span style={{ color: P.faint }}>{open ? '▾' : '▸'}</span></div>
      </button>
      {open && (
        <div className="pb-5">
          <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: P.muted }}>
            <span>Category: <b style={{ color: P.ink }}>{String(cat).replace(/_/g, ' ')}</b> ({catLabel})</span>
            <Select value={v.facts.category || ''} onChange={c => save({ category: c || null })}><option value="">{v.facts.category ? 'Use automatic' : 'Change category…'}</option>{(st.categories || []).map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</Select>
          </div>
          {v.amount == null ? <Muted className="mt-3 text-[13px]">Couldn’t read a total from this document, so there’s nothing to estimate.</Muted>
            : v.foreign ? <Muted className="mt-3 text-[13px]">This receipt is in {ex.currency}. Estimates are only shown for U.S. dollar purchases.</Muted>
            : !v.accts.length ? <Muted className="mt-3 text-[13px]">Add the cards you carry in Wallet to see what this purchase earns on each.</Muted>
            : <>
              <div className="mt-4"><div className="flex flex-wrap items-center justify-between gap-2"><Label>{v.accts.length === 1 ? `If you paid with ${name(v.accts[0])}` : 'What it would earn on each card'}</Label>
                {v.accts.some(a => cards[a.product_id].currency.unit !== 'cashback' && (cards[a.product_id].currency.valueCents || {}).travel != null) && <div className="flex rounded-full p-0.5 text-[11.5px]" style={{ border: `1px solid ${P.line}` }}>{[['cash', 'Points as cash'], ['travel', 'Points for travel']].map(([k, l]) => <button key={k} onClick={() => setMode(k)} className="rounded-full px-2.5 py-1 font-medium" style={mode === k ? { background: P.accentSoft, color: P.accent } : { color: P.muted }}>{l}</button>)}</div>}</div>
                <div className="mt-2">{rows.map((x, i) => { const isPaid = paid.account && paid.account.id === x.a.id; return (
                  <div key={x.a.id} className="flex items-baseline justify-between gap-3 py-2" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-[13px] font-medium" style={{ color: P.ink }}>{name(x.a)}
                      {i === 0 && rows.length > 1 && <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: P.accentSoft, color: P.accent }}>Best</span>}
                      {isPaid && <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ border: `1px solid ${P.lineStrong}`, color: P.muted }}>{paid.firm ? 'Paid with' : 'Likely paid with'}</span>}</div>
                      <Muted className="text-[12px]">{x.r.explanation}</Muted>{x.r.conditional && <Muted className="text-[12px]">{x.r.conditional.text}</Muted>}</div>
                    {x.r.valueUsd === 0 && x.r.earned > 0 && cards[x.a.product_id].currency.unit !== 'cashback'
                      ? <div className="shrink-0 text-right"><div className="text-[16px] font-semibold" style={{ fontFamily: SERIF, color: P.ink }}>{Math.round(x.r.earned).toLocaleString()} {cards[x.a.product_id].currency.unitLabel || 'points'}</div><Muted className="text-[11px]">no fixed $ value</Muted></div>
                      : <div className="shrink-0 text-[16px] font-semibold" style={{ fontFamily: SERIF, color: i === 0 ? P.accent : P.ink }}>≈ {fmt(x.r.valueUsd)}</div>}
                  </div>); })}</div>
                {v.rec && v.rec.mccNote && <Muted className="mt-1 text-[12px]">{v.rec.mccNote}</Muted>}
              </div>
              <div className="mt-4 rounded-xl px-4 py-3 text-[13px] leading-5" style={{ background: P.sunk }}>
                <div style={{ color: P.muted }}>{paidLine}{paid.account && paid.how !== 'bank' && !changing && <button className="ml-2 underline" onClick={() => setChanging(true)}>{paid.how === 'network' ? 'Confirm or change' : 'Change'}</button>}</div>
                {(paid.how === 'ask' || changing || (paid.how === 'unsure' && changing)) && <>
                  {paid.last4 && !v.accts.some(a => a.mask === paid.last4) && <Muted className="mt-1 text-[12px]">The receipt shows a card ending ••{paid.last4}. Pick the card and Benny+ will remember those digits for next time.</Muted>}
                  {picker}</>}
                {paid.how === 'unsure' && !changing && <button className="mt-1 text-[12px] underline" style={{ color: P.muted }} onClick={() => setChanging(true)}>Pick a card</button>}
                {outcome && <div className="mt-2 font-medium" style={{ color: outcome.good ? P.accent : P.ink }}>{outcome.text}</div>}
                {paid.how === 'ask' && rows.length > 1 && <Muted className="mt-2 text-[12px]">Pick the card to see what you actually earned versus your best option.</Muted>}
              </div>
              <Muted className="mt-3 text-[11.5px] leading-4">Estimates from each card’s published terms and how the merchant usually codes purchases. Actual rewards post on your statement.{!v.facts.linkPurchaseId ? ' No bank transaction needed for this estimate.' : ''}</Muted>
            </>}
          {err && <div className="mt-2 text-[12px]" style={{ color: P.danger }}>{err}</div>}
        </div>)}
    </div>
  );
}
function Intake({ call, refresh, compact, st, rules, E }) {
  const P = usePal(); const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(null); const [paste, setPaste] = React.useState(''); const [showPaste, setShowPaste] = React.useState(false);
  const [lastId, setLastId] = React.useState(null); const [showAll, setShowAll] = React.useState(false); const [stmt, setStmt] = React.useState(null);
  const send = async (kind, content, file_name) => {
    setBusy(true); setMsg(null);
    try {
      const r = await call('POST', '/v1/documents', { kind, content, file_name });
      setLastId(r.document_id || null);
      if (r.duplicate) setMsg({ ok: true, text: 'Already added. Here’s its estimate.' });
      else if (!r.extracted.is_purchase_document) setMsg({ ok: false, text: 'That doesn’t look like a receipt or order confirmation.' });
      else setMsg(null);
      setPaste(''); setShowPaste(false); await refresh();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  };
  const onFile = async f => {
    if (!f) return;
    try {
      if (/\.eml$/i.test(f.name) || f.type === 'message/rfc822') return send('eml', await f.text(), f.name);
      if (/^image\//.test(f.type)) return send('image', await imageToDataUrl(f), f.name);
      if (/\.(txt|html?)$/i.test(f.name)) return send('text', await f.text(), f.name);
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {   // a PDF card statement goes to the statement preview; a PDF receipt is read like an email
        setBusy(true); setMsg(null); setStmt(null);
        try { const d = await call('POST', '/v1/statements/pdf', { content: await fileToDataUrl(f), file_name: f.name });
          if (d.document_type === 'card_statement' && d.rows.length) { setStmt({ d, f }); setBusy(false); return; }
          setBusy(false); if (d.text && d.text.trim().length > 40) return send('text', d.text, f.name);
          setMsg({ ok: false, text: 'Couldn’t find a statement or receipt in that PDF.' }); }
        catch (e) { setMsg({ ok: false, text: e.message }); setBusy(false); }
        return;
      }
      setMsg({ ok: false, text: 'Use a .eml email file, a receipt photo or PDF, a PDF card statement, or paste the email text.' });
    } catch (e) { setMsg({ ok: false, text: 'Could not read that file (' + e.message + '). HEIC photos may need converting to JPEG.' }); }
  };
  const docs = st && rules ? (st.documents || []).filter(d => jparse(d.extracted).is_purchase_document) : [];
  const last = lastId && st ? (st.documents || []).find(d => d.id === lastId) : null;
  const others = docs.filter(d => d.id !== lastId); const shown = compact ? [] : (showAll ? others : others.slice(0, 4));
  return (
    <Panel>
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5 text-[15px] font-semibold"><Ico name="receipt" size={16} />Add a receipt<InfoTip align="left">Drop a saved email (.eml), a receipt photo or PDF, or a PDF card statement, or paste the email text. A statement goes to a preview of its transactions before anything is saved. For receipts, Benny+ reads the store, total and items, then estimates the rewards on each card you carry. If the receipt prints the card’s last 4 digits, it picks that card; otherwise you tell it which one you used. Card numbers, emails and phone numbers are masked before reading.</InfoTip></div><Muted className="text-[12px]">email, photo or PDF</Muted></div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center rounded-full px-4 py-2 text-[13px] font-medium" style={{ background: P.accent, color: P.accentInk, opacity: busy ? 0.5 : 1 }}>{busy ? 'Reading…' : 'Choose email, photo or PDF'}<input type="file" disabled={busy} multiple accept=".eml,message/rfc822,image/*,.txt,.html,.pdf,application/pdf" className="hidden" onChange={async e => { const fs = [...(e.target.files || [])]; e.target.value = ''; for (const f of fs) await onFile(f); }} /></label>
        <Btn onClick={() => setShowPaste(v => !v)} disabled={busy}>Paste email text</Btn>
      </div>
      {showPaste && <div className="mt-3"><textarea value={paste} onChange={e => setPaste(e.target.value)} rows={6} placeholder="Paste the full order confirmation here" className="w-full rounded-xl p-3 text-[13px] outline-none" style={{ background: P.surface, color: P.ink, border: `1px solid ${P.lineStrong}` }} />
        <div className="mt-2"><Btn kind="primary" small disabled={busy || paste.trim().length < 40} onClick={() => send('text', paste, 'pasted email')}>Read it</Btn></div></div>}
      {msg && <div className="mt-3 text-[13px]" style={{ color: msg.ok ? P.accent : P.danger }}>{msg.text}</div>}
      {stmt && st && rules && <div className="mt-4"><Importer key={stmt.f.name + stmt.d.rows.length} preparsed={stmt.d} preparsedFile={stmt.f} accounts={(st.accounts || []).filter(a => a.product_confirmed)} cards={rules.cards} call={call}
        onCancel={() => setStmt(null)} onDone={async r => { setStmt(null); setMsg({ ok: true, text: `Statement added: ${r.added} transactions${r.duplicates ? `, ${r.duplicates} were already here` : ''}. You can undo it in Wallet.` }); await refresh(); }} /></div>}
      {last && <div className="mt-4"><Label>Just added</Label><div className="mt-1"><ReceiptEstimate key={last.id} d={last} st={st} rules={rules} E={E} call={call} refresh={refresh} startOpen /></div></div>}
      {shown.length > 0 && <div className="mt-5"><Label>Your receipts · {others.length}</Label><div className="mt-1">{shown.map(d => <ReceiptEstimate key={d.id} d={d} st={st} rules={rules} E={E} call={call} refresh={refresh} />)}</div>
        {others.length > 4 && <button className="mt-2 text-[12px] font-medium underline" style={{ color: P.muted }} onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${others.length}`}</button>}</div>}
    </Panel>
  );
}
function AccountConfirm({ account, cards, call, onDone, accounts }) {
  const P = usePal(); const [pid, setPid] = React.useState(''); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(null); const [other, setOther] = React.useState(false);
  const list = Object.values(cards).sort((a, b) => a.name.localeCompare(b.name));
  const picked = (accounts || []).filter(x => x.id !== account.id && x.source === 'manual' && !!x.sample === !!account.sample && x.product_confirmed && cards[x.product_id]);
  const save = async p => { setBusy(true); setErr(null); try { await call('POST', '/v1/accounts/' + account.id, { product_id: p }); onDone && onDone(); } catch (e) { setErr(e.message); } setBusy(false); };
  const bank = bankName(account);
  return (
    <div className="rounded-xl p-4" style={{ border: `1px solid ${P.line}`, background: P.surface }}>
      <div className="text-[14px] font-medium">Which card is “{bank}”{account.mask ? ' ••' + account.mask : ''}?</div>
      {picked.length > 0 && !other ? <>
        <Muted className="mt-0.5 text-[12px]">Is it one of the cards you added? It becomes that card, now with your bank’s transactions, so it isn’t listed twice.</Muted>
        <div className="mt-3 flex flex-wrap items-center gap-2">{picked.map(x => <Btn key={x.id} small kind="primary" disabled={busy} onClick={() => save(x.product_id)}>It’s my {cards[x.product_id].short || cards[x.product_id].name}</Btn>)}
          <Btn small kind="quiet" onClick={() => setOther(true)}>A different card</Btn></div>
      </> : <>
        <Muted className="mt-0.5 text-[12px]">Pick the card so the right benefits apply.{picked.length ? ' ' : ''}{picked.length > 0 && <button className="underline" onClick={() => setOther(false)}>Back to the cards you added</button>}</Muted>
        <div className="mt-3 flex flex-wrap items-center gap-2"><Select value={pid} onChange={setPid}><option value="">Choose a card…</option>{list.map(x => <option key={x.cardId} value={x.cardId}>{x.name}</option>)}</Select><Btn small kind="primary" disabled={!pid || busy} onClick={() => save(pid)}>Confirm</Btn></div>
      </>}
      {err && <div className="mt-2 text-[12px]" style={{ color: P.danger }}>{err}</div>}
    </div>
  );
}
/* ---------- Gmail ----------
   Two ways to reach the viewer's own Gmail, both read-only:
   - workspace owner: the Gmail API through a symbolic proxy holding the owner's own Google token (owner-only; no Mana sandbox needed);
     messages are read and slimmed in this browser and sent to the Benny+ API like an uploaded email.
   - everyone else: the importer runs in the viewer's own Mana sandbox with the viewer's own Google connection (needs an approved Mana account).
   Either way each email goes through the same intake, auto-match and estimates; non-purchase emails are deleted after reading. */
const GM_NODE = 'benny-gmail';
const GM_QUERY = d => `newer_than:${d}d -category:promotions -category:social -in:spam -in:trash (subject:(receipt OR order OR invoice OR "order confirmation" OR "your purchase" OR "payment received" OR "thanks for your order" OR "thank you for your order" OR "you paid" OR "purchase confirmation" OR "e-receipt" OR "your trip" OR "booking confirmation") OR from:(auto-confirm@amazon.com OR receipts OR receipt OR orders OR order-update))`;
const GM_MAX = 25;   // newest receipt-looking emails per run; reruns only read new ones (duplicates and known non-receipts return instantly)
const b64uText = s => { const bin = atob(String(s || '').replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))); };
function gmBody(p) {
  if (!p) return null; let plain = null;
  if (p.mimeType === 'text/html' && p.body && p.body.data) return { t: 'text/html', d: p.body.data };
  if (p.mimeType === 'text/plain' && p.body && p.body.data) plain = { t: 'text/plain', d: p.body.data };
  for (const q of p.parts || []) { const r = gmBody(q); if (r && r.t === 'text/html') return r; if (r && !plain) plain = r; }
  return plain;
}
function gmEml(msg) {
  const h = Object.fromEntries(((msg.payload && msg.payload.headers) || []).map(x => [String(x.name).toLowerCase(), x.value]));
  const b = gmBody(msg.payload); const text = b ? b64uText(b.d) : (msg.snippet || '');
  return `Subject: ${String(h.subject || '').replace(/\n/g, ' ')}\nFrom: ${h.from || ''}\nDate: ${h.date || ''}\nMIME-Version: 1.0\nContent-Type: ${b ? b.t : 'text/plain'}; charset=utf-8\n\n${text.slice(0, 350000)}`;
}
function GmailImport({ refresh, demo, call }) {
  const P = usePal(); const [days, setDays] = React.useState(90); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(null);
  const [remote, setRemote] = React.useState(null); const [local, setLocal] = React.useState(null); const [linked, setLinked] = React.useState(null); const [noSandbox, setNoSandbox] = React.useState(false);
  const lastN = React.useRef(-1); const isOwner = userId === ownerId;
  const gm = useSymbolicProxyUrl({ name: 'gmail', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages', method: 'GET', allowSubpaths: true, headers: { authorization: 'Bearer ${secrets.GOOGLE_OAUTH_TOKEN}' } });
  React.useEffect(() => { let on = true; Promise.resolve(checkOAuthStatus(userId)).then(v => on && setLinked(!!v)).catch(() => on && setLinked(false)); return () => { on = false; }; }, []);
  const st = isOwner ? local : remote;
  React.useEffect(() => { if (!st) return; const n = (st.imported || 0) + (st.state === 'done' ? 1000 : 0); if (lastN.current >= 0 && n !== lastN.current) refresh(); lastN.current = n; }, [st && st.imported, st && st.state]);
  const runHere = async () => {   // owner: Gmail through the owner-only proxy, processed in this browser
    if (!gm.url) throw new Error(gm.error ? 'Google isn’t ready: ' + gm.error.message : 'Google connection is still loading; try again in a moment.');
    let s = { state: 'running', found: 0, processed: 0, imported: 0, matched: 0, duplicates: 0, skipped: 0, failed: 0, days }; const push = x => { s = { ...s, ...x, updatedAt: Date.now() }; setLocal(s); };
    push({});
    const ids = []; let page = null;
    while (ids.length < GM_MAX) {
      const q = new URLSearchParams({ q: GM_QUERY(days), maxResults: String(GM_MAX - ids.length) }); if (page) q.set('pageToken', page);
      const r = await fetch(gm.url + '?' + q);
      if (r.status === 401 || r.status === 403) { push({ state: 'error', error: 'no_gmail_access', message: 'Your Google connection doesn’t allow reading Gmail (' + r.status + '). Reconnect Google and allow Gmail access.' }); return; }
      if (!r.ok) throw new Error('Gmail search failed (' + r.status + ')');
      const d = await r.json(); for (const m of d.messages || []) ids.push(m.id); page = d.nextPageToken; if (!page) break;
    }
    push({ found: ids.length });
    let k = 0;
    const worker = async () => { while (k < ids.length) { const id = ids[k++]; let res = 'failed';
      try {
        const r = await fetch(gm.url + '/' + id + '?format=full');
        if (r.ok) { const x = await call('POST', '/v1/documents', { kind: 'eml', content: gmEml(await r.json()), file_name: 'Gmail', discard_non_purchase: true });
          if (x.duplicate) res = 'duplicate';
          else if (x.skipped || !(x.extracted || {}).is_purchase_document) res = 'skipped';
          else res = (x.link || {}).confirmed ? 'matched' : 'imported'; }
      } catch (e) {}
      push({ processed: s.processed + 1, imported: s.imported + (res === 'imported' || res === 'matched' ? 1 : 0), matched: s.matched + (res === 'matched' ? 1 : 0),
        duplicates: s.duplicates + (res === 'duplicate' ? 1 : 0), skipped: s.skipped + (res === 'skipped' ? 1 : 0), failed: s.failed + (res === 'failed' ? 1 : 0) }); } };
    await Promise.all(Array.from({ length: 8 }, worker));
    push({ state: 'done' });
  };
  const runHelper = async () => {   // everyone else: a small Gmail page in their OWN workspace (they own it, so their Google connection works there; no sandbox)
    const [kit, api] = await Promise.all([FS.get(FS.ref(FS.db, relPathAddress('gmail-kit', 'helper'))), FS.get(FS.ref(FS.db, relPathAddress('service', 'url')))]);
    if (!kit.val() || !api.val()) throw new Error('Gmail import isn’t set up in this Benny+.');
    const now = Date.now(); const ret = window.location.href;
    await FS.update(FS.ref(FS.db, `${userId}/file-system/benny-gmail-helper`), { metadata: { type: 'link', hidden: true, displayName: 'Benny+ Gmail import', createdAt: now, updatedAt: now },
      'app/code': kit.val(), 'app/metadata': { type: 'user_div', displayName: 'Benny+ Gmail import', createdAt: now, updatedAt: now },
      'app/config': { api: api.val(), days, returnUrl: ret, requestedAt: now, metadata: { type: 'entry', createdAt: now, updatedAt: now } } });
    window.location.href = `/home/${userId}/benny-gmail-helper`;
  };
  const run = async () => { setBusy(true); setErr(null); setNoSandbox(false); try { await (isOwner ? runHere() : runHelper()); } catch (e) { setErr(String(e.message || e).slice(0, 220)); if (isOwner) setLocal(null); } setBusy(false); };
  const connect = () => { setErr(null); connectGoogleOAuth(userId, { onSuccess: () => { setLinked(true); setTimeout(run, isOwner ? 1500 : 0); }, onError: e => setErr('Google didn’t connect' + (e && e.message ? ': ' + e.message : '.')) }); };
  const running = busy || (st && st.state === 'running' && Date.now() - (st.updatedAt || 0) < 10 * 60 * 1000);
  const pct = st && st.state === 'running' && st.found ? Math.round(100 * (st.processed || 0) / st.found) : 0;
  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3"><div className="text-[15px] font-semibold">Import receipts from Gmail</div><Muted className="text-[12px]">read-only</Muted></div>
      <Muted className="mt-1 text-[13px] leading-5">Benny+ searches your Gmail for receipts and order confirmations, reads each one like an uploaded email, and matches it to the card transaction. Only the purchase facts are saved; other emails are skipped and nothing is sent or changed. It uses your own Google connection.</Muted>
      {demo ? <Muted className="mt-3 text-[12.5px]">Exit the demo to import your own email.</Muted> : <>
        <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-[12px]" style={{ color: P.muted }}>Look back</span>
          {[30, 90, 180].map(d => <button key={d} onClick={() => setDays(d)} disabled={running} className="rounded-full px-3 py-1 text-[12px]" style={days === d ? { background: P.accent, color: P.accentInk, border: `1px solid ${P.accent}` } : { color: P.ink, border: `1px solid ${P.lineStrong}` }}>{d} days</button>)}</div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {linked === false && isOwner ? <Btn kind="primary" onClick={connect} disabled={busy}>Connect Gmail</Btn> : <Btn kind="primary" onClick={run} disabled={running || (isOwner && linked === null) || !call}>{busy && !(st && st.found) ? 'Starting…' : running ? 'Importing…' : st && st.state === 'done' ? 'Import again' : 'Import from Gmail'}</Btn>}
          {linked && <Muted className="text-[12px]">Google connected</Muted>}{!isOwner && <Muted className="text-[12px]">Opens a small import page in your own Mana space, then brings you back.</Muted>}
        </div>
        {st && st.state === 'running' && <div className="mt-4"><div className="h-1.5 overflow-hidden rounded-full" style={{ background: P.line }}><div className="h-full rounded-full transition-all" style={{ width: Math.max(4, pct) + '%', background: P.accent }} /></div>
          <Muted className="mt-1.5 text-[12.5px]">{st.found ? `Reading ${st.processed || 0} of ${st.found} emails · ${st.imported || 0} receipt${st.imported === 1 ? '' : 's'} so far${st.matched ? `, ${st.matched} matched to a transaction` : ''}` : 'Searching your Gmail…'}</Muted></div>}
        {st && st.state === 'done' && <div className="mt-3 text-[13px]" style={{ color: P.accent }}>{st.found ? `Checked ${st.found} email${st.found === 1 ? '' : 's'} from the last ${st.days} days: ${st.imported} receipt${st.imported === 1 ? '' : 's'} added${st.matched ? ` (${st.matched} matched to a card transaction)` : ''}${st.duplicates ? `, ${st.duplicates} already here` : ''}${st.skipped ? `, ${st.skipped} weren’t purchases` : ''}${st.failed ? `, ${st.failed} couldn’t be read` : ''}.` : `No receipt emails found in the last ${st.days} days.`}</div>}
        {st && st.state === 'error' && st.error !== 'not_connected' && <div className="mt-3 text-[13px]" style={{ color: P.danger }}>{st.message || 'Gmail import stopped.'}{st.error === 'no_gmail_access' && <> <button className="underline" onClick={connect}>Reconnect Google</button></>}</div>}
        {noSandbox && <div className="mt-3 rounded-xl p-3 text-[13px] leading-5" style={{ background: P.infoSoft, color: P.ink }}>Your Mana account can’t run the Gmail import yet: it runs in your own Mana space, which needs an approved Mana account. For now, save receipt emails as .eml files (in Gmail: ⋮ → Download message) and add them below. You can select several at once, and they go through the same reading and matching.</div>}
      </>}
      {err && <div className="mt-3 text-[13px]" style={{ color: P.danger }}>{err}</div>}
    </Panel>
  );
}
/* ---------- Wallet shared helpers ---------- */
const ago = ts => { if (!ts) return null; const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 90) return 'just now'; const m = s / 60; if (m < 60) return Math.round(m) + ' minutes ago'; const h = m / 60; if (h < 36) return Math.round(h) + ' hour' + (Math.round(h) === 1 ? '' : 's') + ' ago';
  const d = Math.round(h / 24); return d + ' day' + (d === 1 ? '' : 's') + ' ago'; };
const localMonth = () => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0'); };
/* Products the user already holds (any confirmed account, from any source; sample cards excluded). */
const heldProducts = accounts => new Set((accounts || []).filter(a => a.product_confirmed && a.product_id && !a.sample).map(a => a.product_id));
/* Sheets: focus moves inside on open and returns on close; Escape closes only while focus is inside the sheet. */
function useSheetFocus(onClose) {
  const ref = React.useRef(null);
  React.useEffect(() => { const prev = document.activeElement; const el = ref.current; if (el) el.focus({ preventScroll: true });
    return () => { if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true }); }; }, []);
  const onKeyDown = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); } };
  return { ref, onKeyDown };
}
/* Plaid Link: POST /v1/plaid/link_token → Link → /v1/plaid/exchange → /v1/plaid/sync → refresh (shared by the Wallet header and setup). */
function usePlaidConnect(call, refresh, demo) {
  const [busy, setBusy] = React.useState(false); const [msg, setMsg] = React.useState(null);
  const connect = async () => {
    const mode = demo ? { mode: 'demo' } : {};
    setBusy(true); setMsg({ ok: true, text: 'Opening Plaid…' });
    try {
      const [{ link_token }, Plaid] = await Promise.all([call('POST', '/v1/plaid/link_token', mode), loadPlaid()]);
      setMsg(null);
      Plaid.create({ token: link_token,
        onSuccess: async (public_token, meta) => {
          try { setMsg({ ok: true, text: 'Connected. Importing transactions…' }); await call('POST', '/v1/plaid/exchange', { ...mode, public_token, institution: meta && meta.institution && meta.institution.name });
            const r = await call('POST', '/v1/plaid/sync'); setMsg({ ok: true, text: `Imported ${r.added} transaction${r.added === 1 ? '' : 's'}. Confirm which card each account is.` }); await refresh(); } catch (e) { setMsg({ ok: false, text: e.message }); }
          setBusy(false);
        },
        onExit: err => { setBusy(false); setMsg(err ? { ok: false, text: err.display_message || err.error_message || 'Connection closed.' } : null); } }).open();
    } catch (e) { setMsg({ ok: false, text: e.message }); setBusy(false); }
  };
  return { connect, busy, msg, setMsg };
}
function sourceSummary(st) {
  const items = st.plaid_items || [], imports = st.imports || [], docs = (st.documents || []);
  const parts = items.map(it => `${it.institution || 'Bank'} via Plaid${it.env === 'sandbox' ? ' (test)' : ''} · ${it.last_sync_at ? 'synced ' + ago(it.last_sync_at) : 'not synced yet'}`);
  if (imports.length) parts.push(imports.length + ' statement' + (imports.length === 1 ? '' : 's'));
  if (docs.length) parts.push(docs.length + ' receipt' + (docs.length === 1 ? '' : 's') + ' or email' + (docs.length === 1 ? '' : 's'));
  return parts;
}
function SourcesList({ st, call, refresh }) {
  const P = usePal(); const [confirm, setConfirm] = React.useState(null); const [busy, setBusy] = React.useState(null); const [note, setNote] = React.useState(null);
  const act = async (key, fn, done) => { setBusy(key); setNote(null); try { const r = await fn(); if (done) setNote({ ok: true, text: done(r) }); await refresh(); } catch (e) { setNote({ ok: false, text: e.message }); } setBusy(null); setConfirm(null); };
  const row = { borderTop: `1px solid ${P.line}` };
  const empty = !(st.plaid_items || []).length && !(st.imports || []).length && !(st.documents || []).length;
  return (
    <div>
      {(st.plaid_items || []).map(it => (
        <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13px]" style={row}>
          <span className="min-w-0">{it.institution || 'Bank'}{it.env === 'sandbox' ? ' (test mode)' : ''} · {it.last_sync_at ? 'synced ' + ago(it.last_sync_at) : 'not synced yet'}</span>
          <span className="flex flex-wrap gap-2"><Btn small disabled={!!busy} onClick={() => act('sync', () => call('POST', '/v1/plaid/sync'), r => `Sync done: ${r.added} new, ${r.modified} updated, ${r.removed} removed.`)}>{busy === 'sync' ? 'Syncing…' : 'Sync'}</Btn>
            {confirm === it.id ? <><Btn small disabled={!!busy} onClick={() => act(it.id, () => call('DELETE', '/v1/plaid/items/' + it.id), () => 'Disconnected and removed its transactions.')}>Disconnect and delete</Btn><Btn small onClick={() => setConfirm(null)}>Keep</Btn></> : <Btn small kind="quiet" onClick={() => setConfirm(it.id)}>Disconnect</Btn>}</span>
        </div>))}
      {(st.imports || []).map(b => (
        <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13px]" style={row}>
          <span className="min-w-0">{b.file_name || 'Statement'} · {new Date(b.created_at).toLocaleDateString()} · {b.added} added, {b.duplicates} already here</span>
          {confirm === b.id ? <span className="flex gap-2"><Btn small disabled={!!busy} onClick={() => act(b.id, () => call('DELETE', '/v1/imports/' + b.id), r => `Undone: removed ${r.removed} transactions.`)}>Undo upload</Btn><Btn small onClick={() => setConfirm(null)}>Keep</Btn></span> : <Btn small kind="quiet" onClick={() => setConfirm(b.id)}>Undo</Btn>}
        </div>))}
      {(st.documents || []).map(d => { const ex = jparse(d.extracted); return (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13px]" style={row}>
          <span className="min-w-0">{d.subject || d.file_name || d.kind} · {ex.merchant || '?'} · {ex.total_cents != null ? fmt(ex.total_cents / 100) : '?'}</span>
          {confirm === d.id ? <span className="flex gap-2"><Btn small disabled={!!busy} onClick={() => act(d.id, () => call('DELETE', '/v1/documents/' + d.id), () => 'Removed with its evidence.')}>Remove</Btn><Btn small onClick={() => setConfirm(null)}>Keep</Btn></span> : <Btn small kind="quiet" onClick={() => setConfirm(d.id)}>Remove</Btn>}
        </div>); })}
      {empty && <Muted className="py-3 text-[13px]" >{(st.accounts || []).some(a => a.sample) ? 'Sample purchases only (demo). Exit the demo to connect your own.' : 'Nothing connected yet.'}</Muted>}
      {note && <div className="pt-2 text-[12.5px]" style={{ color: note.ok ? P.accent : P.danger }}>{note.text}</div>}
    </div>
  );
}
function ConnectionsSheet({ st, cards, rules, E, call, refresh, onClose }) {
  const P = usePal(); const { ref, onKeyDown } = useSheetFocus(onClose);
  const confirmed = (st.accounts || []).filter(a => a.product_confirmed && !a.sample);
  const [acct, setAcct] = React.useState(confirmed.length === 1 ? confirmed[0].id : ''); const [importing, setImporting] = React.useState(false); const [done, setDone] = React.useState(null);
  return (
    <div className="absolute inset-0 z-40 flex justify-end" style={{ background: dark(P) ? 'rgba(0,0,0,0.45)' : 'rgba(22,36,28,0.22)' }} onClick={onClose}>
      <div ref={ref} tabIndex={-1} onKeyDown={onKeyDown} className="h-full w-full max-w-[560px] overflow-y-auto px-6 pb-10 pt-5 outline-none" style={{ background: P.bg, borderLeft: `1px solid ${P.line}`, boxShadow: '-20px 0 40px -24px rgba(0,0,0,0.35)' }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Other connections">
        <div className="flex items-center justify-between gap-3"><Label>Other connections</Label>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full" style={{ border: `1px solid ${P.lineStrong}`, color: P.muted }}><svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg></button></div>
        <h2 className="mt-3 text-[24px] font-semibold tracking-tight" style={{ fontFamily: SERIF }}>Bring in purchases</h2>
        <Muted className="mt-1 text-[13px] leading-5">Statements and receipts fill in what your bank connection doesn’t. Everything here can be undone.</Muted>
        <section className="mt-6">
          <div className="text-[15px] font-semibold">Upload a statement</div>
          {confirmed.length === 0
            ? <Muted className="mt-1 text-[13px] leading-5">{(st.accounts || []).some(a => a.sample) ? 'Sample cards can’t take statements. Exit the demo to upload your own.' : 'Add a card first, then upload its statement.'}</Muted>
            : importing ? <div className="mt-3"><Importer accounts={confirmed} cards={cards} defaultAccountId={acct} call={call} onCancel={() => setImporting(false)} onDone={async r => { setImporting(false); setDone(`Statement added: ${r.added} transactions${r.duplicates ? `, ${r.duplicates} were already here` : ''}.`); await refresh(); }} /></div>
            : <div className="mt-2 flex flex-wrap items-center gap-2">
                <Select value={acct} onChange={setAcct}><option value="">Which card is it for?</option>{confirmed.map(a => <option key={a.id} value={a.id}>{acctLabel(a, cards)}</option>)}</Select>
                <Btn disabled={!acct} onClick={() => setImporting(true)}>Choose a CSV or PDF</Btn>
              </div>}
          {done && <div className="mt-2 text-[12.5px]" style={{ color: P.accent }}>{done}</div>}
        </section>
        <section className="mt-7"><Intake call={call} refresh={refresh} st={st} rules={rules} E={E} /></section>
        <section className="mt-7"><div className="text-[15px] font-semibold">Where your purchases come from</div><div className="mt-1"><SourcesList st={st} call={call} refresh={refresh} /></div></section>
      </div>
    </div>
  );
}
function PlaidPanel({ call, refresh, demo }) {
  const P = usePal(); const { connect, busy, msg } = usePlaidConnect(call, refresh, demo);
  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3"><div className="text-[15px] font-semibold">Connect your bank</div><Muted className="text-[12px]">via Plaid{demo ? ' · demo test bank' : ''}</Muted></div>
      {demo
        ? <Muted className="mt-1 text-[13px] leading-5">You’re in demo mode, so this connects Plaid’s test bank, not a real one. Pick any bank and sign in with <b>user_good</b> / <b>pass_good</b>. The test accounts leave when you exit the demo. To connect your real cards, exit the demo first.</Muted>
        : <Muted className="mt-1 text-[13px] leading-5">Choose the bank that issued your card (for example Citi for a Costco Visa) and sign in with your online-banking login inside Plaid’s window, then pick the credit cards to share. Benny+ never sees your password, and connecting history never enables payments.</Muted>}
      <div className="mt-4 flex flex-wrap items-center gap-3"><Btn kind="primary" disabled={busy || !call} onClick={connect}>{busy ? 'Connecting…' : 'Connect with Plaid'}</Btn>{msg && <span className="text-[12px]" style={{ color: msg.ok ? P.accent : P.danger }}>{msg.text}</span>}</div>
    </Panel>
  );
}

function ConnectCardRow({ card, done, call, refresh, demo }) {
  const P = usePal(); const { connect, busy, msg } = usePlaidConnect(call, refresh, demo); const art = card.art || {};
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl p-4" style={{ background: P.surface, border: `1px solid ${P.line}` }}>
      <span className="h-[30px] w-[46px] shrink-0 rounded-[5px]" style={{ background: `linear-gradient(135deg, ${art.from || P.sunk}, ${art.to || P.sunk})`, boxShadow: `inset 0 0 0 1px ${P.line}` }} />
      <div className="min-w-0 flex-1"><div className="text-[14.5px] font-semibold" style={{ color: P.ink }}>{card.short || card.name}</div>
        <Muted className="text-[12.5px]">{done ? 'Connected: transactions come from your bank' : `Choose ${card.issuer} in Plaid${demo ? ' (demo: any test bank, user_good / pass_good)' : ''}`}</Muted>
        {msg && <div className="mt-1 text-[12px]" style={{ color: msg.ok ? P.accent : P.danger }}>{msg.text}</div>}</div>
      {done ? <span className="inline-flex items-center gap-1 text-[13px] font-medium" style={{ color: P.accent }}><Ico name="check" size={14} />Connected</span>
        : <Btn small kind="primary" disabled={busy || !call} onClick={connect}>{busy ? 'Connecting…' : `Connect ${card.issuer}`}</Btn>}
    </div>
  );
}
function GmailNote() {
  return <Panel><div className="flex items-baseline justify-between gap-3"><div className="text-[15px] font-semibold">Connect Gmail</div><Muted className="text-[12px]">read-only, later</Muted></div>
    <Muted className="mt-1 text-[13px] leading-5">Automatic inbox import comes after the demo. For now, forward or save an order email as .eml, or paste it into “Add a receipt or order email”. It goes through the same reading and matching.</Muted></Panel>;
}

/* ---------- setup ---------- */
function Setup({ step, go, cards, st, call, refresh, loadSample, finish, inSample, useOwn, leaving, rules, E }) {
  const P = usePal(); const accounts = st.accounts;
  const [sel, setSel] = React.useState(() => new Set());   // nothing pre-selected (Eden, Oct 25)
  const [importing, setImporting] = React.useState(false); const [note, setNote] = React.useState(null); const [err, setErr] = React.useState(null);
  const [modes, setModes] = React.useState({});   // per picked card: 'compare' (benefits only) or 'plaid' (connect its bank)
  const [connectFor, setConnectFor] = React.useState(null);   // after Continue: the picked cards to connect through Plaid
  const cardList = Object.values(cards).sort((a, b) => a.name.localeCompare(b.name));
  const steps = ['welcome', 'cards', 'data']; const idx = Math.max(0, steps.indexOf(step));
  const saveCards = async () => {
    setErr(null);
    try {
      const have = heldProducts(accounts);
      for (const pid of sel) if (!have.has(pid)) await call('POST', '/v1/accounts', { product_id: pid });
      // The wallet becomes exactly what was ticked (Eden, Oct 25). Ticking nothing (Skip) changes nothing.
      // A hand-added card that already has purchases is kept and named, so no purchase history is lost.
      const kept = [];
      if (sel.size) for (const a of accounts) if (a.source === 'manual' && !a.sample && !sel.has(a.product_id)) { if (st.purchases.some(p => p.account_id === a.id)) kept.push(a); else await call('DELETE', '/v1/accounts/' + a.id); }
      setNote(kept.length ? `Kept ${kept.map(a => acctLabel(a, cards)).join(', ')}: ${kept.length === 1 ? 'it has' : 'they have'} purchases. Remove ${kept.length === 1 ? 'it' : 'them'} in Wallet.` : null);
      await refresh();
      const viaBank = [...sel].filter(pid => modes[pid] === 'plaid');
      if (viaBank.length) setConnectFor(viaBank); else go('setup', 'data');
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl px-5 pt-8 pb-3">
      <div className="mb-8 flex items-center gap-2">{idx > 0 && <button onClick={() => go('setup', 'welcome')} className="mr-2 shrink-0 text-[12px] font-medium" style={{ color: P.muted }}>← Back</button>}{steps.map((s, i) => <div key={s} className="h-1 flex-1 rounded-full" style={{ background: i <= idx ? P.accent : P.line }} />)}</div>
      {idx === 0 && (
        <div className="relative">
          <div className="pointer-events-none absolute -right-10 -top-10 hidden sm:block"><Guilloche size={300} color={P.seal} opacity={0.35} glimmer /></div>
          <Label><span className="inline-flex items-center gap-1">Benny<span style={{ color: P.accent }}><BennyRosette size={17} /></span></span></Label>
          <h1 className="relative mt-3 max-w-xl text-[38px] font-semibold italic leading-tight tracking-tight" style={{ fontFamily: SERIF }}>Your cards already owe you something.</h1>
                    <div className="relative mt-8 grid gap-5 sm:grid-cols-3">
            {[['I', 'Pick your cards', `${Object.keys((rules && rules.cards) || {}).length || 21} cards, every rule quoted from its source. No card numbers.`], ['II', 'Add a receipt or connect your bank', 'See what each purchase earns on every card you carry.'], ['III', 'Act on evidence', 'Recovered counts only what is confirmed. Everything else says why.']].map(([n, t, d]) => (
              <div key={n} style={{ borderTop: `1px solid ${P.lineStrong}`, paddingTop: 12 }}><div className="text-[13px] font-semibold" style={{ color: P.accent, fontFamily: SERIF }}>{n}</div><div className="mt-1 text-[14px] font-semibold">{t}</div><Muted className="mt-1 text-[13px] leading-5">{d}</Muted></div>))}
          </div>
          <Muted className="mt-8 text-[12px] leading-5">Your cards and transactions are stored privately on Benny+’s server and only returned to you when you’re signed in.</Muted>
          <div className="mt-5 flex flex-wrap gap-2">{inSample
            ? <><Btn kind="primary" disabled={leaving} onClick={useOwn}>{leaving ? 'Clearing sample…' : 'Get started with my own cards'}</Btn><Btn foil onClick={() => go('wallet', null)}>Continue the demo</Btn></>
            : <><Btn kind="primary" onClick={() => go('setup', 'cards')}>Set up my wallet</Btn><Btn foil onClick={loadSample}>Try demo</Btn></>}</div>
          {inSample && <Muted className="mt-3 text-[12px] leading-5">Getting started removes the sample cards and purchases first, so your own wallet starts clean.</Muted>}
        </div>
      )}
      {idx === 1 && !connectFor && (
        <div>
          <h2 className="text-[26px] font-semibold tracking-tight" style={{ fontFamily: SERIF }}>Which cards do you carry?</h2>
          <Muted className="mt-1 text-[14px]">For each card, choose whether to just compare its benefits or connect it through your bank for real transactions. You can mix both.</Muted>
          <div className="mt-5"><CardPicker cards={cardList} selected={sel} onToggle={id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })} /></div>
          {err && <div className="mt-3 text-[13px]" style={{ color: P.danger }}>{err}</div>}
          <div className="sticky bottom-0 z-10 -mx-5 mt-6 px-5 py-3" style={{ background: P.bg, borderTop: `1px solid ${P.line}`, boxShadow: `0 -18px 18px -6px ${P.bg}` }}>
            {sel.size > 0 && <div className="mb-3 max-h-[40vh] space-y-2 overflow-y-auto">
              {[...sel].map(pid => { const cd = cards[pid]; if (!cd) return null; const m = modes[pid] || 'compare'; const art = cd.art || {}; return (
                <div key={pid} className="flex flex-wrap items-center gap-3">
                  <span className="h-[22px] w-[34px] shrink-0 rounded-[4px]" style={{ background: `linear-gradient(135deg, ${art.from || P.sunk}, ${art.to || P.sunk})`, boxShadow: `inset 0 0 0 1px ${P.line}` }} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium" style={{ color: P.ink }}>{cd.short || cd.name}</span>
                  <span className="inline-flex rounded-full p-0.5" role="radiogroup" aria-label={`How to add ${cd.short || cd.name}`} style={{ border: `1px solid ${P.lineStrong}` }}>
                    {[['compare', 'Just compare'], ['plaid', 'Connect with Plaid']].map(([k, l]) => <button key={k} role="radio" aria-checked={m === k} onClick={() => setModes(x => ({ ...x, [pid]: k }))} className="rounded-full px-3 py-1 text-[12px]" style={m === k ? { background: P.accent, color: P.accentInk } : { color: P.muted }}>{l}</button>)}
                  </span>
                </div>); })}
            </div>}
            <div className="flex items-center justify-between gap-3">
              <Muted className="text-[13px]">{sel.size ? `${sel.size} selected${[...sel].some(p => modes[p] === 'plaid') ? ` · ${[...sel].filter(p => modes[p] === 'plaid').length} to connect` : ''}` : 'Pick the cards you carry'}</Muted>
              <div className="flex gap-2"><Btn onClick={() => go('setup', 'welcome')}>Back</Btn><Btn kind="primary" onClick={saveCards}>{sel.size ? 'Continue' : 'Skip, I’ll connect my bank'}</Btn></div>
            </div>
          </div>
        </div>
      )}
      {idx === 1 && connectFor && (
        <div>
          <h2 className="text-[26px] font-semibold tracking-tight" style={{ fontFamily: SERIF }}>Connect your bank for these cards</h2>
          <Muted className="mt-1 text-[14px]">In Plaid’s window, choose the bank that issued the card and sign in. Benny+ joins the bank account to the card you picked, so it stays one card.</Muted>
          <div className="mt-5 space-y-3">
            {connectFor.map(pid => { const cd = cards[pid]; const done = accounts.some(a => a.source === 'plaid' && a.product_id === pid && a.product_confirmed); return cd && <ConnectCardRow key={pid} card={cd} done={done} call={call} refresh={refresh} demo={(st.accounts || []).some(a => a.sample)} />; })}
            {accounts.filter(a => !a.product_confirmed).map(a => <AccountConfirm key={a.id} account={a} cards={cards} call={call} onDone={refresh} accounts={accounts} />)}
          </div>
          <div className="mt-6 flex justify-between gap-2"><Btn onClick={() => setConnectFor(null)}>Back</Btn>
            <div className="flex gap-2"><Btn kind="quiet" onClick={() => { setConnectFor(null); go('setup', 'data'); }}>Skip for now</Btn><Btn kind="primary" onClick={() => { setConnectFor(null); go('setup', 'data'); }}>Continue</Btn></div></div>
        </div>
      )}
      {idx === 2 && (
        <div>
          <h2 className="text-[26px] font-semibold tracking-tight" style={{ fontFamily: SERIF }}>Bring in your purchases</h2>
          <Muted className="mt-1 text-[14px]">Your bank tells Benny+ which card paid. Receipts and order emails add what you bought, and Benny+ matches them to the card transaction.</Muted>
          <div className="mt-5 space-y-4">
            {!accounts.some(a => a.source === 'plaid') && <PlaidPanel call={call} refresh={refresh} demo={(st.accounts || []).some(a => a.sample)} />}
            {accounts.filter(a => !a.product_confirmed).map(a => <AccountConfirm key={a.id} account={a} cards={cards} call={call} onDone={refresh} accounts={accounts} />)}
            <GmailImport refresh={refresh} call={call} demo={(st.accounts || []).some(a => a.sample)} />
            <Intake call={call} refresh={refresh} st={st} rules={rules} E={E} />
            {importing ? <Importer accounts={accounts.filter(a => a.product_confirmed)} cards={cards} defaultAccountId={accounts.length === 1 ? accounts[0].id : ''} call={call} onCancel={() => setImporting(false)} onDone={async r => { setImporting(false); setNote(`Added ${r.added} transactions${r.duplicates ? `, ${r.duplicates} were already here` : ''}.`); await refresh(); }} />
              : <Panel><div className="text-[15px] font-semibold">Or upload a statement</div><Muted className="mt-1 text-[13px]">Backup for cards your bank connection doesn’t cover: a CSV download or the PDF statement from your issuer’s website.</Muted><div className="mt-4"><Btn onClick={() => setImporting(true)} disabled={!accounts.some(a => a.product_confirmed)}>Choose a CSV or PDF</Btn></div></Panel>}
            {note && <div className="text-[13px]" style={{ color: P.accent }}>{note}</div>}
          </div>
          <div className="mt-6 flex justify-between gap-2"><Btn onClick={() => go('setup', 'cards')}>Back</Btn>
            {(() => { const connected = st.purchases.length > 0 || (st.documents || []).length > 0 || accounts.some(a => a.source === 'plaid');   // Finish only once something is connected; Skip always
              return <div className="flex gap-2"><Btn kind="quiet" onClick={finish}>Skip</Btn><Btn kind="primary" onClick={finish} disabled={!connected} title={connected ? '' : 'Connect a bank, add a receipt or upload a statement first'}>{st.purchases.length ? 'See what Benny+ found' : 'Finish'}</Btn></div>; })()}</div>
        </div>
      )}
    </div>
  );
}

/* ---------- home ---------- */
function ClaimPacket({ findingId, call, onClose }) {
  const P = usePal(); const [pk, setPk] = React.useState(null); const [err, setErr] = React.useState(null); const [text, setText] = React.useState(''); const [copied, setCopied] = React.useState(null);
  React.useEffect(() => { call('GET', '/v1/claims/' + findingId).then(r => { setPk(r); setText(r.narrative || ''); }).catch(e => setErr(e.message)); }, [findingId]);
  if (err) return <div className="mt-3 text-[13px]" style={{ color: P.danger }}>{err}</div>;
  if (!pk) return <Muted className="mt-3 text-[13px]">Preparing the packet from confirmed evidence…</Muted>;
  const md = [`# Claim packet: ${pk.benefit.label}`, '', `Card: ${pk.card} ${pk.account}`, `Purchase: ${pk.purchase.merchant}, ${pk.purchase.date}, ${fmt(pk.purchase.amount_usd)}`,
    ...pk.items.map(i => `Item: ${i.name}${i.model ? ' (model ' + i.model + ')' : ''}, ${fmt(i.price_usd)}`), '', `Benefit terms: “${pk.benefit.quote}” (${pk.benefit.url})`,
    pk.benefit.notify_days ? `Tell the benefit administrator within ${pk.benefit.notify_days} days of the incident; send documents within ${pk.benefit.docs_days} days.` : '', pk.benefit.claims_url ? `Claims: ${pk.benefit.claims_url}` : '', '',
    '## Statement', text, '', '## Documents', ...pk.documents.map(d => `- [${d.have ? 'x' : ' '}] ${d.id.replace(/_/g, ' ')}`), '', pk.note].filter(x => x !== '').join('\n');
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); a.download = 'benny-claim-packet.md'; a.click(); };
  return (
    <div className="mt-3 rounded-xl p-4 text-[13px] leading-5" style={{ background: P.sunk, color: P.ink }}>
      <div className="flex items-center justify-between gap-2"><div className="font-semibold">Claim packet · {pk.benefit.label}</div><button className="text-[12px] underline" style={{ color: P.muted }} onClick={onClose}>Close</button></div>
      <div className="mt-2" style={{ color: P.muted }}>{pk.card} {pk.account} · {pk.purchase.merchant} · {fmtDate(pk.purchase.date)} · {fmt(pk.purchase.amount_usd)}</div>
      {pk.items.map((i, k) => <div key={k}>Item: {i.name}{i.model ? ` (model ${i.model})` : ''} · {fmt(i.price_usd)}</div>)}
      <div className="mt-2" style={{ color: P.muted }}>Terms: “{pk.benefit.quote}” <a className="underline" href={pk.benefit.url} target="_blank" rel="noreferrer">source <Ext /></a></div>
      {pk.benefit.notify_days && <div className="mt-1">Deadlines: tell the administrator within {pk.benefit.notify_days} days of the incident; documents within {pk.benefit.docs_days} days.</div>}
      <div className="mt-3"><Label>Statement (edit the blanks)</Label><textarea value={text} onChange={e => setText(e.target.value)} rows={5} className="mt-1 w-full rounded-lg p-2 text-[13px] outline-none" style={{ background: P.surface, color: P.ink, border: `1px solid ${P.line}` }} /></div>
      <div className="mt-2"><Label>Documents</Label><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{pk.documents.map(d => <span key={d.id} style={{ color: d.have ? P.accent : P.muted }}>{d.have ? '✓' : '○'} {d.id.replace(/_/g, ' ')}</span>)}</div></div>
      <div className="mt-3 flex flex-wrap items-center gap-2"><Btn small kind="primary" onClick={download}>Download packet</Btn><Btn small onClick={async () => setCopied(await copyText(md))}>{copied === 'failed' ? 'Copy failed' : copied ? 'Copied' : 'Copy'}</Btn>{pk.benefit.claims_url && <a className="text-[12px] underline" href={pk.benefit.claims_url} target="_blank" rel="noreferrer" style={{ color: P.muted }}>Open the claims site <Ext /></a>}</div>
      <div className="mt-2 text-[12px]" style={{ color: P.muted }}>{pk.note}</div>
    </div>
  );
}

let _echarts = null; const loadECharts = () => (_echarts = _echarts || import('https://esm.sh/echarts@6.0.0'));
const CAT_LABEL = k => k === '_unrecognized' ? 'Not recognized' : String(k).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
/* ---------- quiet UI: icons + ⓘ tips. Labels stay short; explanations live behind ⓘ (nothing removed, just folded). ---------- */
const ICON_PATHS = {
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.2" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.2l2.4 2.4 4.6-4.8" /></>,
  gift: <><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M4 13h16M12 9v11M12 9c-1.6-3.2-5-3.4-5-1.2C7 9 9.4 9 12 9zm0 0c1.6-3.2 5-3.4 5-1.2C17 9 14.6 9 12 9z" /></>,
  shield: <><path d="M12 3l7 3v5.5c0 4.2-2.9 7.7-7 9.5-4.1-1.8-7-5.3-7-9.5V6z" /><path d="M9 12l2.2 2.2L15.5 10" /></>,
  chart: <><path d="M4 20h16" /><path d="M7 16v-5M12 16V7M17 16v-8" /></>,
  receipt: <><path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.2v.2" /></>,
  star: <path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />,
  card: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" /></>,
  arrow: <path d="M9 6l6 6-6 6" />,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" />,
  flask: <><path d="M10 3h4M10.5 3v6L5 19a1.3 1.3 0 0 0 1.2 2h11.6A1.3 1.3 0 0 0 19 19l-5.5-10V3" /><path d="M7.5 15h9" /></>,
};
function Ico({ name, size = 16, color, stroke = 1.8, className = '' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || 'currentColor'} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>{ICON_PATHS[name]}</svg>;
}
function InfoTip({ children, label = 'More info', align = 'center' }) {
  const P = usePal(); const [open, setOpen] = React.useState(false); const ref = React.useRef(null);
  React.useEffect(() => { if (!open) return; const off = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape' && ref.current && ref.current.contains(document.activeElement)) setOpen(false); };
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc); return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); }; }, [open]);
  const pos = align === 'right' ? 'right-0' : align === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2';
  return (
    <span ref={ref} className="relative inline-flex align-middle" onClick={e => e.stopPropagation()}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(o => !o)} className="inline-flex h-5 w-5 items-center justify-center rounded-full" style={{ color: open ? P.ink : P.faint }}><Ico name="info" size={15} /></button>
      {open && <span role="note" className={`absolute top-6 z-40 block w-64 rounded-xl p-3 text-left text-[12px] font-normal normal-case leading-5 tracking-normal ${pos}`} style={{ background: P.surface, color: P.muted, border: `1px solid ${P.lineStrong}`, boxShadow: '0 14px 30px -14px rgba(0,0,0,0.35)' }}>{children}</span>}
    </span>
  );
}
/* Robinhood-style stat: icon, big figure, one-word label. */
function Stat({ icon, value, label, color, onClick }) {
  const P = usePal(); const Tag = onClick ? 'button' : 'div';
  return <Tag onClick={onClick} className="flex min-w-0 items-center gap-3 rounded-2xl px-3.5 py-3 text-left" style={{ background: P.sunk }}>
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: P.surface, color: color || P.ink }}><Ico name={icon} size={18} /></span>
    <span className="min-w-0"><span className="block truncate text-[18px] font-semibold leading-6 tabular-nums" style={{ fontFamily: SERIF, color: color || P.ink }}>{value}</span><span className="block truncate text-[11.5px]" style={{ color: P.muted }}>{label}</span></span>
  </Tag>;
}
/* Small tappable pill with an icon (hero shortcuts). */
function Chip({ icon, children, onClick, tone }) {
  const P = usePal(); const c = tone === 'danger' ? P.danger : tone === 'info' ? P.info : P.accent;
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium" style={{ color: c, background: tone === 'danger' ? (dark(P) ? 'rgba(229,132,104,0.12)' : 'rgba(162,59,42,0.08)') : tone === 'info' ? P.infoSoft : P.accentSoft }}>
    {icon && <Ico name={icon} size={14} />}{children}{onClick && <Ico name="arrow" size={12} stroke={2.2} />}</button>;
}
/* Readable merchant name: the curated name when known, otherwise the normalized descriptor in title case (no store numbers). */
const nameOf = (t, fp) => (fp && fp.level === 'table' && fp.merchant) ? fp.merchant : titleCase(String((t && (t.merchant_normalized || t.merchant_raw)) || 'Purchase').replace(/\s#?\d{3,}.*$/, ''));
const dayLabel = s => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}), timeZone: 'UTC' }); };
/* iOS-style on/off switch: shows "On"/"Off" beside it so the state reads without colour. */
function Toggle({ on, onChange, disabled, label }) {
  const P = usePal();
  return <span className="inline-flex items-center gap-2">
    <span className="w-6 text-right text-[12px] font-medium" style={{ color: on ? P.accent : P.faint }}>{on ? 'On' : 'Off'}</span>
    <button type="button" role="switch" aria-checked={!!on} aria-label={label} title={disabled ? 'Not available for this card' : label} disabled={disabled} onClick={() => onChange(!on)}
      className="relative inline-flex h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40" style={{ background: on ? P.accent : P.lineStrong }}>
      <span className="absolute left-0 top-[3px] h-5 w-5 rounded-full transition-transform duration-200 motion-reduce:transition-none" style={{ background: '#fff', transform: `translateX(${on ? 21 : 3}px)`, boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
    </button>
  </span>;
}
function Flag({ size = 18 }) { const P = usePal(); return <span aria-label="Estimate" className="inline-flex shrink-0 items-center justify-center rounded-full font-bold" style={{ width: size, height: size, fontSize: size * 0.62, background: P.danger, color: '#fff', lineHeight: 1 }}>!</span>; }
function CategoryChart({ rows }) {
  const P = usePal(); const ref = React.useRef(null);
  React.useEffect(() => {
    let ch = null, ro = null, dead = false;
    loadECharts().then(echarts => {
    if (dead || !ref.current) return; ch = echarts.init(ref.current, null, { renderer: 'svg' });
    const data = rows.slice().reverse();
    ch.setOption({
      animationDuration: 500, grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: P.surface, borderColor: P.line, textStyle: { color: P.ink, fontSize: 12 },
        formatter: ps => { const r = data[ps[0].dataIndex]; return `<b>${CAT_LABEL(r.key)}</b><br/>Spent ${fmt(r.spent)}<br/>Earned ${fmt(r.earned)}<br/>Could have earned ${fmt(r.best)}${r.estimate ? '<br/><span style="color:' + P.danger + '">Estimate: confirm in Review</span>' : ''}`; } },
      xAxis: { type: 'value', axisLabel: { color: P.faint, fontSize: 11, formatter: v => '$' + v }, splitLine: { lineStyle: { color: P.line } } },
      yAxis: { type: 'category', data: data.map(r => CAT_LABEL(r.key)), axisLabel: { color: P.ink, fontSize: 12 }, axisLine: { show: false }, axisTick: { show: false } },
      series: [
        { name: 'Earned', type: 'bar', stack: 'v', data: data.map(r => +r.earned.toFixed(2)), itemStyle: { color: P.accent, borderRadius: [3, 0, 0, 3] }, barWidth: 14 },
        { name: 'Missed', type: 'bar', stack: 'v', data: data.map(r => +r.missedHigh.toFixed(2)), itemStyle: { color: P.info, borderRadius: [0, 3, 3, 0] },
          label: { show: true, position: 'right', color: P.muted, fontSize: 11, formatter: p => data[p.dataIndex].missedHigh >= 0.01 ? '+' + fmt(data[p.dataIndex].missedHigh) : '' } },
      ],
    });
    ro = new ResizeObserver(() => ch && ch.resize()); ro.observe(ref.current);
    }).catch(() => {});
    return () => { dead = true; if (ro) ro.disconnect(); if (ch) ch.dispose(); };
  }, [rows, P]);
  return <div ref={ref} style={{ width: '100%', height: Math.max(120, rows.length * 34 + 24) }} />;
}
/* Spending by category as a donut (Eden, Oct 25): slices = spend share; legend keeps exact $ and the gold missed amount. */
function SpendPie({ rows, go }) {
  const P = usePal(); const ref = React.useRef(null); const chart = React.useRef(null);
  const SL = dark(P) ? ['#86BC7A', '#73B6B0', '#CDB26A', '#4E8F5F', '#A9D39A', '#3F7F86', '#E2CF94', '#5E9C80'] : ['#1E6A48', '#2C7476', '#C9A447', '#85BB65', '#4A8FA0', '#8C6F22', '#A7C98F', '#5E9C80'];
  const known = rows.filter(r => r.key !== '_unrecognized' && r.spent > 0).sort((a, b) => b.spent - a.spent);
  const top = known.slice(0, 7); const rest = known.slice(7); const unk = rows.find(r => r.key === '_unrecognized' && r.spent > 0);
  const slices = top.map((r, k) => ({ key: r.key, name: CAT_LABEL(r.key), spent: r.spent, missed: r.missedHigh || 0, estimate: r.estimate, color: SL[k % SL.length] }));
  if (rest.length) slices.push({ key: '_other', name: 'Other', spent: rest.reduce((s, r) => s + r.spent, 0), missed: rest.reduce((s, r) => s + (r.missedHigh || 0), 0), estimate: rest.some(r => r.estimate), color: P.faint });
  if (unk) slices.push({ key: '_unrecognized', name: 'Not recognized', spent: unk.spent, missed: 0, estimate: true, color: P.lineStrong });
  const total = slices.reduce((s, x) => s + x.spent, 0);
  React.useEffect(() => {
    let ro = null, dead = false;
    loadECharts().then(echarts => {
      if (dead || !ref.current) return; const ch = echarts.init(ref.current, null, { renderer: 'svg' }); chart.current = ch;
      ch.setOption({
        animationDuration: 600,
        tooltip: { trigger: 'item', backgroundColor: P.surface, borderColor: P.line, textStyle: { color: P.ink, fontSize: 12 },
          formatter: p => { const s = slices[p.dataIndex]; return `<b>${s.name}</b><br/>${fmt(s.spent)} · ${Math.round(s.spent / total * 100)}%${s.missed >= 0.01 ? '<br/><span style="color:' + P.info + '">+' + fmt(s.missed) + ' missed</span>' : ''}`; } },
        series: [{ type: 'pie', radius: ['62%', '92%'], center: ['50%', '50%'], avoidLabelOverlap: true, label: { show: false }, labelLine: { show: false },
          itemStyle: { borderColor: P.bg, borderWidth: 2, borderRadius: 4 }, emphasis: { scale: true, scaleSize: 5 },
          data: slices.map(s => ({ name: s.name, value: +s.spent.toFixed(2), itemStyle: { color: s.color } })) }],
      });
      ro = new ResizeObserver(() => ch.resize()); ro.observe(ref.current);
    }).catch(() => {});
    return () => { dead = true; if (ro) ro.disconnect(); if (chart.current) { chart.current.dispose(); chart.current = null; } };
  }, [rows, P]);
  const hi = (k, on) => { const ch = chart.current; if (ch) ch.dispatchAction({ type: on ? 'highlight' : 'downplay', seriesIndex: 0, dataIndex: k }); };
  if (!slices.length) return null;
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-10">
      <div className="relative h-[210px] w-[210px] shrink-0">
        <div ref={ref} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[26px] font-semibold leading-none tabular-nums" style={{ fontFamily: SERIF, color: P.ink }}>{fmt0(total)}</span>
          <span className="mt-1 text-[12px]" style={{ color: P.muted }}>spent</span>
        </div>
      </div>
      <div className="w-full min-w-0 flex-1">
        {slices.map((s, k) => (
          <div key={s.key} onMouseEnter={() => hi(k, true)} onMouseLeave={() => hi(k, false)} className="flex items-center gap-3 py-2" style={{ borderTop: k ? `1px solid ${P.line}` : 'none' }}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="flex min-w-0 flex-1 items-center gap-2"><span className="truncate text-[13.5px]" style={{ color: P.ink }}>{s.name}</span>
              {s.estimate && <button onClick={() => go('review')} title="Estimate: confirm in Review"><Flag size={14} /></button>}
              {s.missed >= 0.01 && <span className="whitespace-nowrap text-[12px] font-semibold tabular-nums" style={{ color: P.info }}>+{fmt(s.missed)} missed</span>}</span>
            <span className="w-9 shrink-0 text-right text-[12px] tabular-nums" style={{ color: P.faint }}>{Math.round(s.spent / total * 100)}%</span>
            <span className="w-[86px] shrink-0 text-right text-[13.5px] font-medium tabular-nums" style={{ color: P.ink }}>{fmt(s.spent)}</span>
          </div>))}
      </div>
    </div>
  );
}
function Savings({ feed, st, cards, go, reviewCount, call, refresh }) {
  const P = usePal();
  const byAcct = Object.fromEntries(st.accounts.map(a => [a.id, a]));
  const credits = (st.credit_status || []).map(c => ({ ...c, d: jparse(c.data) })).filter(c => c.state !== 'expired' || c.d.observed_cents);
  const recovered = credits.filter(c => c.state === 'issuer_credit_observed').reduce((s, c) => s + c.d.observed_cents, 0) / 100;
  const toUse = credits.filter(c => c.state === 'unknown').reduce((s, c) => s + c.d.amount_cents, 0) / 100;
  const prot = (st.findings || []).filter(f => f.type === 'protection' || f.type === 'claim');
  const est = feed.missedHigh; const sure = feed.missedLow;
  const cats = feed.categories.filter(c => c.key !== '_unrecognized');
  const line = coverageLine(feed);
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <div>
      {!st.purchases.length && <div className="mt-6"><Panel><div className="flex items-center gap-2 text-[13px]"><Ico name="card" />No purchases yet. <button className="font-medium underline" onClick={() => go('wallet')}>Connect in Wallet</button></div></Panel></div>}

      {feed.categories.some(c => c.spent > 0) && <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-1.5"><Label>Where your money went</Label><InfoTip align="left">Spending by category, last 120 days. Gold shows rewards a better card in your wallet would have added. ! means the category is a guess: confirm it in Review.</InfoTip></span>
          {reviewCount > 0 && <span className="whitespace-nowrap"><Chip icon="alert" tone="danger" onClick={() => go('review')}>Estimate · {reviewCount} to confirm</Chip></span>}
        </div>
        <div className="mt-4"><SpendPie rows={feed.categories} go={go} /></div>
      </section>}

      <div className="relative mt-10">   {/* sits below the donut. Top number = rewards earned on cards you have (Oct 25); missed rewards and trying cards follow */}
        <div className="flex flex-wrap items-center gap-2"><div className="text-[14px] font-medium" style={{ color: P.muted }}>Rewards earned</div>{feed.held.length > 0 && <EstimateFlag feed={feed} cards={cards} />}</div>
        <div className="relative mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <div className="text-[56px] font-semibold leading-[1.05] tabular-nums tracking-tight" style={{ fontFamily: SERIF, color: P.ink }}>{feed.held.length ? fmt(feed.windowEarned) : '—'}</div>
          <span className="whitespace-nowrap text-[13px]" style={{ color: P.muted }}>last 120 days · {fmt(feed.windowSpent)} spent</span>
        </div>
        {!feed.held.length && <Muted className="mt-1 text-[13px]">Connect a card with Plaid to see what your purchases earned. <button className="font-medium underline" onClick={() => go('wallet')}>Go to Wallet</button></Muted>}
        {feed.coverage.comparable && <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[14px]" style={{ color: P.muted }}>Missed with your other card: <b className="tabular-nums" style={{ color: P.ink }}>{fmt(est)}</b>
          <InfoTip align="left">What a better card you have would have earned on each purchase, last 120 days.{est > sure ? ` ${fmt(sure)} of it is certain; the rest depends on how merchants code purchases.` : ''} {line}</InfoTip></div>}
      </div>
      <WhatIfList feed={feed} cards={cards} call={call} refresh={refresh} go={go} className="mt-8" />

      {feed.missed.length > 0 && <section className="mt-10"><Label>Biggest misses</Label><div className="mt-2">
        {feed.missed.slice(0, 5).map(x => (
          <div key={x.p.id} className="flex items-center gap-3 py-2.5" style={{ borderTop: `1px solid ${P.line}` }}>
            <CardArt card={cards[x.p.cardId]} width={40} />
            <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-medium" style={{ color: P.ink }}>{x.p.merchant}</div><div className="truncate text-[12px]" style={{ color: P.muted }}>{dayLabel(x.p.date)} · paid with {acctLabel(byAcct[x.p.accountId], cards)}</div></div>
            {/* Next-time recommendation beside the miss (Eden, Oct 25) */}
            <span className="flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-[12px] font-semibold" style={{ background: P.accentSoft, color: P.accent }} title={`Next time at ${x.p.merchant}, use ${acctLabel(x.topAcct, cards)}`}>
              <CardArt card={cards[x.top.cardId]} width={24} /><span className="whitespace-nowrap">Use {acctLabel(x.topAcct, cards)}</span></span>
            <span className="flex w-[64px] shrink-0 items-center justify-end gap-1.5 text-[13px] font-semibold tabular-nums" style={{ color: P.info }}>{x.low !== x.high && <Flag size={14} />}+{fmt(x.high)}</span>
          </div>))}
      </div></section>}

        <Activity feed={feed} st={st} cards={cards} call={call} refresh={refresh} embedded />
      </div>

      <Muted className="mt-8 text-[11.5px]">Estimates from card terms. Your issuer decides.</Muted>
    </div>
  );
}

const dark = P => P.bg === PAL.dark.bg;


/* Estimate flag + "what if" for cards you're trying (Oct 25). Totals use only cards you have; trying cards are never added. */
function EstimateFlag({ feed, cards, align = 'left' }) {
  const P = usePal(); const r = feed.receipts || {}; const n = feed.windowCount || 0; const one = feed.held.length === 1 ? feed.held[0] : null;
  const rates = feed.held.slice(0, 2).map(a => { const cd = cards[a.product_id]; if (!cd) return null; const base = (cd.earn || []).filter(e => !e.conditional && (e.categories || []).includes('*')).sort((x, y) => y.rate - x.rate)[0];
    const cash = (cd.currency || {}).unit === 'cashback'; return base ? `${cd.short || cd.name} ${base.rate}${cash ? '%' : 'x'} on everyday purchases` : null; }).filter(Boolean);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ color: P.danger, background: P.danger + '1A' }}><Ico name="alert" size={12} color={P.danger} />Estimate</span>
      <InfoTip align={align}>Based on your imported data: {n} purchase{n === 1 ? '' : 's'} from the last 120 days{r.counted ? ` (${r.counted} of them from receipts or Gmail with no bank transaction)` : ''}, using each card’s published rates{rates.length ? ` (${rates.join('; ')})` : ''}. Points count at their guaranteed cash value. {feed.coverage.inferred ? `${feed.coverage.inferred} store categor${feed.coverage.inferred === 1 ? 'y was' : 'ies were'} guessed. ` : ''}{feed.baseRated ? `${feed.baseRated} unknown store${feed.baseRated === 1 ? '' : 's'} earn the everyday rate. ` : ''}{r.counted && one ? `Receipts that don’t name a card are assumed on ${acctLabel(one, cards)}. ` : ''}Cards you’re only trying aren’t counted. Your card statement is the final word.</InfoTip>
    </span>
  );
}
function WhatIfList({ feed, cards, call, refresh, go, className }) {
  const P = usePal(); const [busy, setBusy] = React.useState(null);
  if (!feed.whatIf || !feed.whatIf.length) return null;
  const has = feed.windowCount > 0;
  const keep = async id => { if (!call || busy) return; setBusy(id); try { await call('POST', '/v1/accounts/' + id, { role: 'held' }); await refresh(); } catch (e) { console.warn(e); } setBusy(null); };
  return (
    <section className={className || ''}>
      <div className="flex items-center gap-1.5"><Label>Cards you’re trying</Label><InfoTip align="left">Not counted in your totals. Each one is scored on the same purchases with its own published rates. If you already have one, connect it with Plaid for its real transactions, or tap I have it.</InfoTip></div>
      <div className="mt-2">
        {feed.whatIf.map((w, i) => { const cd = cards[w.cardId]; const up = w.delta > 0.005; return (
          <div key={w.acct.id} className="flex flex-wrap items-center gap-3 py-3" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
            <CardArt card={cd} width={44} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="text-[14px] font-semibold" style={{ color: P.ink }}>{cd ? (cd.short || cd.name) : w.cardId}</span><span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase" style={{ letterSpacing: '0.08em', color: P.info, border: `1px dashed ${P.info}` }}>Trying</span></div>
              <div className="mt-0.5 text-[12.5px]" style={{ color: P.muted }}>{!has ? 'Connect a card you have to compare it on your real purchases.'
                : w.noCash ? `≈ ${w.points.toLocaleString()} ${w.unitLabel} on the same purchases · no fixed cash value`
                : <>If you’d used it: ≈ <b style={{ color: P.ink }}>{fmt(w.value)}</b> · <span style={{ color: up ? P.accent : P.muted }}>{up ? `+${fmt(w.delta)} vs your cards` : `${fmt(-w.delta)} less than your cards`}</span>{w.wins.length ? ` · wins on ${w.wins.map(x => catName(x.key)).join(', ')}` : ''}</>}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Btn small onClick={() => keep(w.acct.id)} disabled={busy === w.acct.id}>{busy === w.acct.id ? 'Saving…' : 'I have it'}</Btn>
              {go && <Btn small kind="primary" onClick={() => go('wallet')}>Connect with Plaid</Btn>}
            </div>
          </div>); })}
      </div>
    </section>
  );
}

/* ---------- Home: what your cards owe you (benefits not used yet) ---------- */
function OwedRow({ left, title, sub, right, actions, why }) {
  const P = usePal(); const [open, setOpen] = React.useState(false);
  return (
    <div className="py-3" style={{ borderTop: `1px solid ${P.line}` }}>
      <div className="flex items-center gap-3">
        {left}
        <button className="min-w-0 flex-1 text-left" onClick={() => why && setOpen(o => !o)}>
          <div className="truncate text-[14px] font-medium" style={{ color: P.ink }}>{title}</div>
          <div className="truncate text-[12px]" style={{ color: P.muted }}>{sub}</div>
        </button>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}   {/* buttons sit on the row, left of the right-hand label (Eden, Oct 25) */}
        {right}
      </div>
      {open && why && <div className="pl-[56px]">{why}</div>}
    </div>
  );
}
function DaysBadge({ days }) {
  const P = usePal(); const urgent = days <= 7;
  return <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums" style={{ color: urgent ? P.danger : P.muted, background: urgent ? (dark(P) ? 'rgba(229,132,104,0.14)' : 'rgba(162,59,42,0.08)') : P.sunk }}>{days === 0 ? 'last day' : days + 'd left'}</span>;
}

/* ---------- every benefit on a card, with its catches in yellow (derived from quoted terms; nothing stored) ---------- */
const WARN = { light: { text: '#7A5A00', bg: '#FBF0C2', line: 'rgba(176,132,0,0.30)' }, dark: { text: '#E9C95B', bg: 'rgba(233,201,91,0.12)', line: 'rgba(233,201,91,0.28)' } };
const PER = { monthly: ['a month', 12], quarterly: ['a quarter', 4], semiannual: ['every 6 months', 2], annual: ['a year', 1], quadrennial: ['every 4 years', 0.25] };
const listNames = a => { a = (a || []).filter(Boolean); return a.length <= 3 ? a.join(', ') : a.slice(0, 3).join(', ') + ' + ' + (a.length - 3) + ' more'; };
const MONTHS3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const usDate = s => String(s).replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_, m, d, y) => `${MONTHS3[+m - 1] || m} ${+d}, ${y}`);
const lowerFirst = s => /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
/* Sentence-cased “Only …” note for a conditional earn rule, built from its condition text. */
function conditionNote(c) {
  let s = usDate(String(c || '').trim()).replace(/^(only|if)\s+/i, '');
  if (!s) return 'Only when a condition is met';
  s = lowerFirst(s).replace(/through the (.+?) mobile application/i, 'in the $1 app');
  if (/^category of your choice/i.test(s)) return 'Only in the category you choose';
  if (/^each quarter you activate/i.test(s)) return 'Only in quarters you activate';
  if (/^top eligible spend category/i.test(s)) return 'Only in your top spend category' + (/each billing cycle/i.test(s) ? ' each billing cycle' : '');
  if (/^purchased /i.test(s)) return 'Only when ' + s;
  return 'Only ' + s;
}
function caveatsFor(kind, x, card) {
  const q = (x.source && x.source.quote) || ''; const out = []; const add = (text, tip) => { if (text && !out.some(o => o.text === text)) out.push({ text, tip: !!tip }); };
  const paid = /auto-renewing|after you (purchase|pay for|buy)|membership|subscription/i.test(q);
  if (x.requiresActivation || /enrol/i.test(q)) add('Enroll first');
  if (paid && kind !== 'earn') add(kind === 'credit' && (x.merchantNames || []).length ? 'Only after you pay for ' + listNames(x.merchantNames) : 'Needs a paid membership', 0);
  const sp = q.match(/spend(?:ing)? \$([\d,]+)/i); if (sp) add('Spend $' + sp[1] + ' first');
  const portalQ = /prepaid|through [A-Z][\w+&® ]*Travel|portal|book(?:ed|ing)? (?:through|with)/i.test(q);
  if (portalQ && (kind !== 'earn' || (/travel|portal/i.test(x.label || '') && !/other travel|directly/i.test(x.label || '')))) add('Book through the issuer’s travel site');
  if (kind === 'earn') {
    const base = (card.earn || []).find(e => !e.conditional && (e.categories || []).includes('*'));
    if (x.cap && x.cap.note) { const n = String(x.cap.note); const tail = !/then/i.test(n) && base ? ', then ' + base.rate + (card.currency && card.currency.unit === 'cashback' ? '%' : 'x') : '';
      add(/^\$/.test(n) ? 'Up to ' + n + tail : n.charAt(0).toUpperCase() + n.slice(1) + tail); }
    if (x.conditional || x.condition) add(conditionNote(x.condition));
    if (x.excludesText) { const ex = lowerFirst(usDate(x.excludesText)); add('Excludes ' + (ex.length > 70 ? ex.slice(0, 68) + '…' : ex)); }
    if (/\bU\.S\./.test(q + ' ' + x.label)) add('U.S. only');
  }
  if (kind === 'credit') {
    if (!paid && (x.merchantNames || []).length) add('Only at ' + listNames(x.merchantNames));
    if (x.period === 'quadrennial') add('Once every 4 years, not yearly');
    else if (x.period && x.period !== 'annual') add('Resets ' + PER[x.period][0] + '; unused amounts don’t carry over');
  }
  if (/subject to availability/i.test(q)) add('Subject to availability');
  if (kind === 'protection') { if (x.incomplete) add('Terms not fully confirmed yet'); if (x.secondary) add('Pays after your other insurance'); if (/decline the collision/i.test(q)) add('Decline the rental company’s coverage'); }
  if (paid && kind !== 'earn') add('Worth it only if you’d pay for it anyway', 1);
  if (kind === 'earn' && x.conditional) add('Benny+ doesn’t count this rate until you meet the condition', 1);
  return out;
}
function benefitsOf(card) {
  const cash = card.currency && card.currency.unit === 'cashback'; const items = [];
  for (const e of card.earn || []) items.push({ kind: 'earn', group: 'Earns', fig: e.rate + (cash ? '%' : 'x'), title: e.label, sub: cash ? 'cash back' : (card.currency.unitLabel || 'points') + ' per $1', x: e });
  for (const c of card.credits || []) if (c.amountUsd != null) items.push({ kind: 'credit', group: 'Credits', fig: '$' + c.amountUsd.toLocaleString(), title: c.label, sub: (({ monthly: 'per month', quarterly: 'per quarter', semiannual: 'every 6 months', annual: 'per year', quadrennial: 'once every 4 years' })[c.period] || '') + (c.period && c.period !== 'annual' && c.period !== 'quadrennial' ? ' · $' + (c.amountUsd * PER[c.period][1]).toLocaleString() + ' a year' : ''), yearly: c.amountUsd * ((PER[c.period] || [0, 1])[1]), x: c });
  const creditIds = new Set((card.credits || []).map(c => c.id));
  for (const p of card.perks || []) if (!creditIds.has(p.id)) items.push({ kind: 'perk', group: 'Perks', fig: null, title: p.label, sub: '', x: p });
  for (const p of card.protections || []) { const win = p.windowDays ? p.windowDays + ' days from purchase' : p.addsMonths ? '+' + p.addsMonths + ' mo of warranty' : p.minDelayHours ? 'after a ' + p.minDelayHours + '-hour delay' : '';
    items.push({ kind: 'protection', group: 'Protections', fig: p.perItemCapUsd ? '$' + p.perItemCapUsd.toLocaleString() : p.perTravelerCapUsd ? '$' + p.perTravelerCapUsd.toLocaleString() : null, title: p.label, sub: (p.perItemCapUsd ? 'per item' : p.perTravelerCapUsd ? 'per traveler' : '') + (win ? ((p.perItemCapUsd || p.perTravelerCapUsd) ? ' · ' : '') + win : ''), x: p }); }
  return items.map(it => ({ ...it, caveats: caveatsFor(it.kind, it.x, card) }));
}
function breakEven(card) {
  const perYear = (card.credits || []).reduce((s, c) => s + (c.amountUsd || 0) * ((PER[c.period] || [0, 1])[1]), 0);
  const tips = [];
  if (card.annualFee) {
    if (!perYear) tips.push(`$${card.annualFee} annual fee and no statement credits: the rewards you earn have to cover it.`);
    else if (perYear < card.annualFee) tips.push(`$${card.annualFee} annual fee. The credits add up to $${perYear.toLocaleString()} a year if you use every one, so the rest has to come from rewards.`);
    else tips.push(`$${card.annualFee} annual fee. The credits are worth up to $${perYear.toLocaleString()} a year, but only the ones you’d use anyway count toward it.`);
  }
  if (card.currency && card.currency.unit !== 'cashback' && !(card.currency.valueCents || {}).cash) tips.push(`${card.currency.unitLabel || 'Points'} have no fixed cash value; Benny+ counts them as $0 in cash mode.`);
  return { perYear, tips };
}
function WarnChip({ text, tip }) {
  const P = usePal(); const W = dark(P) ? WARN.dark : WARN.light;
  return <span className="inline-flex max-w-full items-start gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-medium leading-4" style={{ color: W.text, background: W.bg, boxShadow: `inset 0 0 0 1px ${W.line}` }}>
    <span aria-hidden="true" className="font-bold">{tip ? '→' : '!'}</span><span className="min-w-0">{tip ? 'Tip: ' + text : text}</span></span>;
}
/* Money back as a list row, same layout as Unused benefits: card swatch, "$10 Instacart credit", card · cadence, catches on the right; tap for every catch + the exact terms. */
function PerkRow({ it, accounts, cards, status }) {
  const P = usePal(); const W = dark(P) ? WARN.dark : WARN.light; const s = it.x.source || {};
  const n = it.caveats.filter(c => !c.tip).length;
  const protection = it.kind === 'protection';
  const x = it.x;
  const q = ((x.source && x.source.quote) || '') + ' ' + (x.label || '');
  const perkTiming = it.kind === 'perk' ? (x.requiresActivation ? 'Enroll first' : /every (4|four) years/i.test(q) ? 'Every 4 years' : /monthly|each month|per month/i.test(q) ? 'Monthly' : /annual|each year|per year|calendar year/i.test(q) ? 'Yearly' : null) : null;
  const trigger = perkTiming || (protection ? (x.addsMonths ? (x.addsMonths % 12 === 0 ? `+${x.addsMonths / 12} ${x.addsMonths === 12 ? 'year' : 'years'}` : `+${x.addsMonths} months`) : x.windowDays ? `${x.windowDays} days` : x.minDelayHours ? `${x.minDelayHours}+ hour delay` : null) : null);
  const limit = protection && it.fig ? `Up to ${it.fig}${x.perItemCapUsd ? ' per item' : x.perTravelerCapUsd ? ' per traveler' : ''}` : '';
  const subtitle = protection ? [acctLabel(it.a, cards), limit].filter(Boolean).join(' · ') : [acctLabel(it.a, cards), it.sub].filter(Boolean).join(' · ');
  return <OwedRow left={<CardArt card={it.card} width={44} />} title={protection ? it.title : (it.fig ? it.fig + ' ' : '') + it.title}
    sub={<>{subtitle}{n ? <span className="ml-2 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[1px] align-middle text-[12px] font-semibold leading-5" style={{ color: W.text, background: W.bg, boxShadow: `inset 0 0 0 1px ${W.line}` }}><Ico name="alert" size={12} color={W.text} stroke={2.2} />{n} {n === 1 ? 'catch' : 'catches'}</span> : null}</>}
    right={trigger ? <span className="shrink-0 whitespace-nowrap text-right text-[13px] font-semibold tabular-nums" style={{ color: P.ink }}>{trigger}</span> : status ? <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold" style={{ color: status[1] }}>{status[0]}</span> : null}
    why={<div className="mt-2 space-y-2">
      {it.caveats.length > 0 && <div className="flex flex-wrap gap-1">{it.caveats.map(c => <WarnChip key={c.text} {...c} />)}</div>}
      <div className="text-[12px] leading-5" style={{ color: P.muted }}>{s.quote ? <>“{s.quote}”</> : 'No quote saved for this one.'}
        {s.url && <div className="mt-1"><a className="underline" href={s.url} target="_blank" rel="noreferrer">Issuer terms <Ext /></a>{s.asOf ? ' · checked ' + fmtDate(s.asOf) : ''}</div>}</div>
    </div>} />;
}
function PerkTile({ it, cardEl, status }) {
  const P = usePal(); const [open, setOpen] = React.useState(false); const s = it.x.source || {};
  return (
    <button onClick={() => setOpen(o => !o)} className="flex min-w-0 flex-col items-start rounded-2xl p-4 text-left" style={{ background: P.surface, border: `1px solid ${open ? P.lineStrong : P.line}` }}>
      <div className="flex w-full items-center gap-2"><div className="min-w-0 flex-1 truncate text-[10.5px] font-semibold uppercase" style={{ color: P.faint, letterSpacing: '0.12em' }}>{cardEl || it.group.replace(/s$/, '')}</div>{status && <span className="shrink-0 text-[11px] font-semibold" style={{ color: status[1] }}>{status[0]}</span>}</div>
      {it.fig && <div className="mt-1 text-[32px] leading-none tabular-nums" style={{ fontFamily: SERIF, color: P.ink }}>{it.fig}</div>}
      <div className={`${it.fig ? 'mt-1.5 text-[13px]' : 'mt-1 text-[17px] leading-snug'} font-medium`} style={{ color: P.ink, fontFamily: it.fig ? undefined : SERIF }}>{it.title}</div>
      {it.sub && <div className="text-[12px]" style={{ color: P.muted }}>{it.sub}</div>}
      {it.caveats.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1">{it.caveats.map(c => <WarnChip key={c.text} {...c} />)}</div>}
      {open && <div className="mt-3 w-full border-t pt-2 text-[12px] leading-5" style={{ borderColor: P.line, color: P.muted }}>
        {s.quote ? <>“{s.quote}”</> : 'No quote saved for this one.'}
        {s.url && <div className="mt-1"><a className="underline" href={s.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>Issuer terms <Ext /></a>{s.asOf ? ' · checked ' + fmtDate(s.asOf) : ''}</div>}
      </div>}
    </button>
  );
}
function AllPerks({ feed, st, cards }) {
  const P = usePal(); const W = dark(P) ? WARN.dark : WARN.light;
  const accts = feed.ready; const [sel, setSel] = React.useState('all'); const [catchOnly, setCatchOnly] = React.useState(false);
  if (!accts.length) return null;
  const pickd = sel === 'all' ? accts : accts.filter(x => x.id === sel); const one = pickd.length === 1;
  const cs = (st.credit_status || []).map(x => ({ ...x, d: jparse(x.data) }));
  const statusOf = (a, cr) => { const s = cs.filter(x => x.account_id === a.id && x.credit_id === cr.id).sort((x, y) => y.period_start.localeCompare(x.period_start))[0]; if (!s) return null;
    return ({ unknown: s.d.days_left >= 0 ? ['Ready to use', P.accent] : null, issuer_credit_observed: ['Used', P.likely], user_confirmed: ['Used', P.likely], qualifying_purchase_seen: ['Used', P.likely], expired: null })[s.state] || null; };   // Ready to use | Used (Eden, Oct 25)
  const all = []; let perYear = 0, fees = 0, left = 0;
  for (const a of pickd) { const card = cards[a.product_id]; fees += card.annualFee || 0;
    for (const it of benefitsOf(card)) if (it.kind !== 'earn') { all.push({ ...it, a, card }); if (it.kind === 'credit') perYear += it.yearly || 0; } }
  for (const x of cs) if (pickd.some(a => a.id === x.account_id) && x.state === 'unknown' && x.d.days_left >= 0) left += x.d.amount_cents / 100;
  const shown = catchOnly ? all.filter(i => i.caveats.some(c => !c.tip)) : all;   // Catches tile filters (Eden, Oct 25)
  const groups = [['Credits', 'Money back'], ['Protections', 'Covered if something goes wrong'], ['Perks', 'Extras']].map(([g, t]) => [g, t, shown.filter(i => i.group === g).sort((x, y) => (y.yearly || 0) - (x.yearly || 0))]).filter(([, , v]) => v.length);
  const catches = all.filter(i => i.caveats.some(c => !c.tip)).length;
  const tips = one ? breakEven(pickd[0] && cards[pickd[0].product_id]).tips.filter(t => !/points|miles/i.test(t)) : [];   // fees now sit in the summary card
  return (
    <section>
      {/* Summary card in the Credits-to-use style, but tonal (sunk fill, no rosette, no card fan) and with what's included on the right, so the two read differently. */}
      <div className="rounded-3xl px-6 py-7 sm:px-8 sm:py-9" style={{ background: P.surface, border: `1px solid ${P.line}` }}>
        <div className="flex flex-wrap items-center justify-between gap-6 sm:flex-nowrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[15px] font-medium" style={{ color: P.muted }}>Everything your cards include<InfoTip align="left">What your cards offer, used or not. Earning rates live on each card’s page in Wallet. Catches are read from each benefit’s quoted terms: enrollment, paid memberships, travel-site bookings, limits. Tap a row for the exact clause.</InfoTip></div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2"><span className="text-[56px] font-semibold leading-[1.05] tabular-nums tracking-tight" style={{ fontFamily: SERIF, color: P.ink }}>{fmt0(perYear)}</span><span className="text-[16px]" style={{ color: P.muted }}>a year in credits</span></div>
            <div className="mt-2 text-[13px]" style={{ color: P.muted }}>{pickd.length} card{pickd.length === 1 ? '' : 's'}{fees ? ` · ${fmt0(fees)} in annual fees` : ' · no annual fee'}</div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[['gift', 'Credits', 'Money back'], ['shield', 'Protections', 'Protections'], ['star', 'Perks', 'Extras']].map(([icon, g, label]) => (
              <div key={g} className="flex min-w-[80px] flex-col items-start rounded-2xl px-3.5 py-3" style={{ background: P.sunk }}>
                <Ico name={icon} size={16} color={P.muted} />
                <span className="mt-1 text-[22px] font-semibold leading-none tabular-nums" style={{ fontFamily: SERIF, color: P.ink }}>{all.filter(i => i.group === g).length}</span>
                <span className="mt-1 text-[11.5px]" style={{ color: P.muted }}>{label}</span>
              </div>))}
            {catches > 0 && <button type="button" onClick={() => setCatchOnly(v => !v)} aria-pressed={catchOnly} title={catchOnly ? 'Show all benefits' : 'Show only benefits with a catch'}
              className="flex min-w-[80px] flex-col items-start rounded-2xl px-3.5 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2"
              style={{ background: W.bg, boxShadow: `inset 0 0 0 ${catchOnly ? '1.5px' : '1px'} ${catchOnly ? W.text : W.line}`, outlineColor: W.text }}>
              <Ico name="alert" size={16} color={W.text} />
              <span className="mt-1 text-[22px] font-semibold leading-none tabular-nums" style={{ fontFamily: SERIF, color: W.text }}>{catches}</span>
              <span className="mt-1 whitespace-nowrap text-[11.5px]" style={{ color: W.text }}>{catchOnly ? 'Show all' : 'Catches'}</span>
            </button>}
          </div>
        </div>
      </div>
      {accts.length > 1 && <div className="mt-4 flex gap-2 overflow-x-auto pb-1">{[{ id: 'all' }].concat(accts).map(x => { const on = x.id === sel; return (
        <button key={x.id} onClick={() => setSel(x.id)} className={`flex shrink-0 items-center gap-2 rounded-full py-1 ${x.id === 'all' ? 'px-3' : 'pl-1 pr-3'} text-[12px] font-medium`} style={{ background: on ? P.accentSoft : 'transparent', color: on ? P.accent : P.muted, border: `1px solid ${on ? P.accent : P.line}` }}>
          {x.id === 'all' ? 'All cards' : <><CardArt card={cards[x.product_id]} width={30} />{acctLabel(x, cards)}</>}</button>); })}</div>}
      {tips.length > 0 && <div className="mt-3 rounded-2xl px-4 py-3 text-[13px] leading-5" style={{ background: W.bg, color: W.text, boxShadow: `inset 0 0 0 1px ${W.line}` }}>{tips.map(t => <div key={t}>{t}</div>)}</div>}
      {groups.map(([g, t, list]) => <div key={g} className="mt-5">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: P.muted }}><Ico name={g === 'Credits' ? 'gift' : g === 'Protections' ? 'shield' : 'star'} size={14} />{t} <span style={{ color: P.faint }}>{list.length}</span></div>
        <div>{list.map((it, i) => <PerkRow key={it.a.id + it.kind + (it.x.id || it.title) + i} it={it} cards={cards} status={it.kind === 'credit' ? statusOf(it.a, it.x) : null} />)}</div>
      </div>)}
    </section>
  );
}
/* What it earns: one compact row per earn rule. Rate in a fixed left column (serif, sized to fit), category beside it,
   at most one catch inline (+N more); tap a row for every catch, the exact quote and the issuer link. Unit is said once. */
const sentence = s => { s = String(s || '').trim(); return s && /^[a-z]/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
function EarnList({ card }) {
  const P = usePal(); const cash = card.currency && card.currency.unit === 'cashback'; const unit = cash ? 'cash back on every $1' : ((card.currency && card.currency.unitLabel) || 'points') + ' per $1';
  const rules = (card.earn || []).slice(); const isAll = r => (r.categories || []).includes('*') && !r.conditional;
  const rows = rules.filter(r => !isAll(r)).sort((x, y) => (!!x.conditional - !!y.conditional) || y.rate - x.rate).concat(rules.filter(isAll));
  if (!rows.length) return null;
  const topRate = Math.max(...rows.filter(r => !isAll(r) && !r.conditional).map(r => r.rate), 0);
  return (
    <div>
      <h3 className="text-[26px] font-bold tracking-tight" style={{ color: P.ink }}>What it earns</h3>
      <Muted className="mb-3 mt-0.5 text-[13px]">{sentence(unit)}</Muted>
      <div className="overflow-hidden rounded-[28px]" style={{ background: P.surface, border: `1px solid ${P.line}`, containerType: 'inline-size' }}>
        {rows.map((r, i) => <EarnRow key={(r.id || r.label) + i} r={r} card={card} cash={cash} first={i === 0} top={!isAll(r) && !r.conditional && r.rate === topRate && rows.filter(x => !isAll(x)).length > 1} all={isAll(r)} />)}
      </div>
    </div>
  );
}
function EarnRow({ r, card, cash, first, top, all }) {
  const P = usePal(); const W = dark(P) ? WARN.dark : WARN.light; const [open, setOpen] = React.useState(false); const s = r.source || {};
  const cav = caveatsFor('earn', r, card); const notes = cav.filter(c => !c.tip && !(r.conditional && /^Only /.test(c.text)));
  const fig = r.rate + (cash ? '%' : 'x');
  const figSize = top ? 'clamp(1.2rem, 5.2cqi, 1.6rem)' : all ? 'clamp(0.95rem, 3.6cqi, 1.1rem)' : 'clamp(1.05rem, 4.4cqi, 1.32rem)';
  const condLine = r.conditional ? 'Not counted · ' + (cav.find(c => /^Only /.test(c.text)) || { text: 'only when a condition is met' }).text.replace(/^Only /, 'only ') : null;
  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${P.line}` }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 text-left" style={{ height: 62 }}>
        <span className="shrink-0 whitespace-nowrap text-right tabular-nums leading-none" style={{ width: '3.9rem', fontFamily: SERIF, fontSize: figSize, color: r.conditional || all ? P.faint : P.ink, textDecoration: r.conditional ? 'line-through' : 'none', textDecorationThickness: 1 }}>{fig}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium leading-5" title={all ? undefined : sentence(r.label)} style={{ color: all ? P.muted : P.ink }}>{all ? 'All other purchases' : sentence(r.label)}</span>
          {(condLine || notes.length > 0) && <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4" style={{ height: 18 }}>
            {condLine ? <span className="truncate" style={{ color: P.info }}>{condLine}</span>
              : <><span className="inline-flex min-w-0 items-center gap-1 truncate rounded-md px-1.5" style={{ color: W.text, background: W.bg, boxShadow: `inset 0 0 0 1px ${W.line}` }}><b aria-hidden="true">!</b><span className="truncate">{notes[0].text}</span></span>{notes.length > 1 && <span className="shrink-0" style={{ color: P.muted }}>+{notes.length - 1} more</span>}</>}
          </span>}
        </span>
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke={P.faint} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M1 1l6 6-6 6" /></svg>
      </button>
      {open && <div className="px-4 pb-4 text-[12px] leading-5" style={{ paddingLeft: 'calc(3.9rem + 1.75rem)', color: P.muted }}>
        {!all && String(r.label || '').length > 34 && <div className="mb-1.5 text-[13px] font-medium" style={{ color: P.ink }}>{sentence(r.label)}</div>}
        {cav.length > 0 && <div className="mb-2 flex flex-wrap gap-1">{cav.map(c => <WarnChip key={c.text} {...c} />)}</div>}
        {s.quote ? <>“{s.quote}”</> : 'No quote saved for this one.'}
        {s.url && <div className="mt-1"><a className="underline" href={s.url} target="_blank" rel="noreferrer">Issuer terms <Ext /></a>{s.asOf ? ' · checked ' + fmtDate(s.asOf) : ''}</div>}
      </div>}
    </div>
  );
}

function Home({ feed, st, cards, go, call, refresh, reviewCount }) {
  const P = usePal(); const [busy, setBusy] = React.useState(null); const [pend, setPend] = React.useState({});   // pend: optimistic switch states until the server answers
  // The display-only demo card has no server record, so its switches live in this browser (cleared on Exit demo).
  const [localOn, setLocalOn] = React.useState(() => { try { return JSON.parse(localStorage.getItem(DEMO_PERKS_KEY) || '{}'); } catch (e) { return {}; } });
  const readBenefitsPane = () => new URLSearchParams(window.location.search).get('benefitsView') === 'all' ? 'all' : 'yours';
  const [benefitsPane, setBenefitsPane] = React.useState(readBenefitsPane);
  const benefitsId = React.useId();
  React.useEffect(() => { const sync = () => setBenefitsPane(readBenefitsPane()); const reset = () => setBenefitsPane('yours'); window.addEventListener('popstate', sync); window.addEventListener('benny-benefits-reset', reset); return () => { window.removeEventListener('popstate', sync); window.removeEventListener('benny-benefits-reset', reset); }; }, []);
  const selectBenefitsPane = next => { const u = new URL(window.location.href); if (next === 'all') u.searchParams.set('benefitsView', 'all'); else u.searchParams.delete('benefitsView'); window.history.replaceState({}, '', u); setBenefitsPane(next); };
  const byAcct = Object.fromEntries(st.accounts.map(a => [a.id, a])); const byPur = Object.fromEntries(st.purchases.map(p => [p.id, p]));
  const evById = Object.fromEntries((st.evidence || []).map(e => [e.id, e]));
  const onEv = new Map((st.evidence || []).filter(e => e.subject_type === 'perk' && e.producer === 'user').map(e => [e.subject_id, e.id]));
  const turnedOn = new Set([...onEv.keys()].filter(k => pend[k] !== false).concat(Object.keys(pend).filter(k => pend[k] === true), Object.keys(localOn).filter(k => localOn[k])));
  // On/off switch for enrollment perks (Eden, Oct 25): on = a user 'perk' evidence row; off = /v1/review/reject removes it (server keeps a rejection note).
  const setPerk = async (sid, next) => {
    if (sid.startsWith(DEMO_VIRTUAL_ID + ':')) { setLocalOn(o => { const n = { ...o, [sid]: next }; try { localStorage.setItem(DEMO_PERKS_KEY, JSON.stringify(n)); } catch (e) {} return n; }); return; }
    if (busy === sid) return; setBusy(sid); setPend(p => ({ ...p, [sid]: next }));
    try { if (next) await call('POST', '/v1/evidence/user', { subject_type: 'perk', subject_id: sid, reason: 'You turned this on' });
          else if (onEv.get(sid)) await call('POST', '/v1/review/reject', { evidence_id: onEv.get(sid) });
          await refresh(); } catch (e) { console.warn(e); }
    finally { setPend(p => { const n = { ...p }; delete n[sid]; return n; }); setBusy(null); }
  };
  const credits = (st.credit_status || []).map(c => ({ ...c, d: jparse(c.data) })).filter(c => !feed.roleOf || feed.roleOf[c.account_id] !== 'trying');   // credits on cards you're only trying aren't yours to use
  const open = credits.filter(c => c.state === 'unknown' && c.d.days_left >= 0).sort((a, b) => a.d.days_left - b.d.days_left);
  const used = credits.filter(c => ['issuer_credit_observed', 'qualifying_purchase_seen', 'user_confirmed'].includes(c.state));
  const owed = open.reduce((s, c) => s + c.d.amount_cents, 0) / 100;
  const recovered = credits.filter(c => c.state === 'issuer_credit_observed').reduce((s, c) => s + c.d.observed_cents, 0) / 100;
  const perks = [];
  for (const a of feed.held) {
    // Perks to turn on = everything on the card whose terms require enrollment (credits AND perks, deduped by id); the switch lives only here.
    const card = cards[a.product_id]; const seen = new Set();
    for (const p of (card.credits || []).filter(x => x.requiresActivation).map(x => ({ ...x, isCredit: true })).concat((card.perks || []).filter(x => x.requiresActivation))) {
      if (seen.has(p.id)) continue; seen.add(p.id); perks.push({ a, card, p, on: turnedOn.has(a.id + ':' + p.id) }); }
  }
  const prot = (st.findings || []).filter(f => f.type === 'protection' || f.type === 'claim').map(f => ({ ...f, d: jparse(f.data) }));
  const claimReady = prot.filter(f => f.claim_packet);
  const tap = async (key, body) => { setBusy(key); try { await call('POST', '/v1/evidence/user', body); await refresh(); } finally { setBusy(null); } };
  const label = { issuer_credit_observed: 'Credit posted ✓', user_confirmed: 'You confirmed', qualifying_purchase_seen: 'Looks like you used it' };
  const count = open.length + perks.filter(x => !x.on).length + claimReady.length;
  const conditional = open.filter(c => needsPurchase(creditRule(cards, c))).reduce((s, c) => s + c.d.amount_cents, 0) / 100;
  const usedValue = used.reduce((s, c) => s + (c.state === 'issuer_credit_observed' && c.d.observed_cents ? c.d.observed_cents : (c.d.amount_cents || 0)), 0) / 100;
  const totalBenefits = feed.windowEarned + usedValue;
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <div role="tablist" aria-label="Benefits views" className="mb-6 flex w-fit max-w-full gap-1 rounded-full p-1" style={{ background: P.sunk }}>
        {[['yours', 'Your benefits'], ['all', 'All benefits']].map(([key, text]) => <button key={key} id={benefitsId + '-tab-' + key} type="button" role="tab" aria-selected={benefitsPane === key} aria-controls={benefitsId + '-panel-' + key} tabIndex={benefitsPane === key ? 0 : -1}
          onClick={() => selectBenefitsPane(key)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'yours' : e.key === 'End' ? 'all' : key === 'yours' ? 'all' : 'yours'; selectBenefitsPane(next); document.getElementById(benefitsId + '-tab-' + next)?.focus(); } }}
          className="whitespace-nowrap rounded-full px-5 py-2 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ background: benefitsPane === key ? P.surface : 'transparent', color: benefitsPane === key ? P.ink : P.muted }}>{text}</button>)}
      </div>
      <div hidden={benefitsPane === 'all'} className="relative overflow-hidden rounded-3xl p-6" style={{ background: P.surface, border: `1px solid ${P.line}` }}>
        <div className="pointer-events-none absolute -right-16 -top-16"><Guilloche size={320} color={P.seal} opacity={0.26} glimmer /></div>
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            {/* Total benefits (Oct 25): rewards your purchases earned on cards you have + credits already used. Credits still to use sit below. */}
            <div className="flex flex-wrap items-center gap-2"><div className="text-[14px] font-medium" style={{ color: P.muted }}>{feed.held.length ? 'Your cards earned you' : 'What your cards earn you'}</div>{feed.held.length > 0 && <EstimateFlag feed={feed} cards={cards} />}</div>
            {feed.held.length ? <>
              <div className="text-[60px] font-semibold leading-[1.02] tabular-nums tracking-tight" style={{ fontFamily: SERIF, color: P.ink }}>{fmt(totalBenefits)}</div>
              <div className="mt-1 text-[13px]" style={{ color: P.muted }}>last 120 days · {fmt(feed.windowEarned)} in rewards{usedValue > 0 ? ` + ${fmt(usedValue)} in credits used` : ''} · {feed.held.length} card{feed.held.length === 1 ? '' : 's'} you have</div>
              {owed > 0 && <div className="mt-1 text-[13px]" style={{ color: P.ink }}>+ {fmt(owed)} in credits still to use <span style={{ color: P.muted }}>· {count} to use</span></div>}
              {conditional > 0 && <div className="mt-1 flex items-center gap-1 text-[12.5px]" style={{ color: P.muted }}>{fmt(conditional)} of that needs a membership<InfoTip align="left">Only if you use them. {fmt(conditional)} of this pays back only if you already buy things like a membership or subscription.</InfoTip></div>}
              {feed.fees.length > 0 && <div className="mt-1 text-[12.5px]" style={{ color: P.muted }}>{feed.fees.map(f => `${fmt0(f.usd)}/yr ${f.label}`).join(' · ')} · not subtracted</div>}
            </> : <>
              <div className="mt-1 text-[24px] font-semibold leading-tight" style={{ fontFamily: SERIF, color: P.ink }}>Connect a card to see what it earns you</div>
              <div className="mt-1 max-w-md text-[13px] leading-5" style={{ color: P.muted }}>Cards you only picked count as trying. Connect your bank with Plaid and Benny+ adds up the rewards and credits on your real purchases.</div>
              <div className="mt-3"><Btn kind="primary" onClick={() => go('wallet')}>Connect with Plaid</Btn></div>
            </>}
          </div>
          <div className="flex items-end">{feed.held.concat(feed.trying).slice(0, 5).map((a, i) => <div key={a.id} style={{ marginLeft: i ? -22 : 0, transform: `rotate(${(i - 1) * 4}deg)`, opacity: feed.roleOf[a.id] === 'trying' ? 0.45 : 1 }} title={feed.roleOf[a.id] === 'trying' ? 'Trying: not counted' : undefined}><CardArt card={cards[a.product_id]} width={84} /></div>)}</div>
        </div>
        <div className="relative mt-5 flex flex-wrap gap-x-6 gap-y-1 text-[13px]" style={{ color: P.muted }}>
          {recovered > 0 && <Chip icon="check">{fmt(recovered)} recovered</Chip>}
          {feed.coverage.comparable && feed.missedHigh > 0 && <Chip icon="chart" tone="info" onClick={() => go('savings')}>Missed {fmt(feed.missedHigh)}</Chip>}
          {reviewCount > 0 && <Chip icon="alert" tone="danger" onClick={() => go('review')}>{reviewCount} to confirm</Chip>}
        </div>
      </div>
      <WhatIfList feed={feed} cards={cards} call={call} refresh={refresh} go={go} className="mt-6" />

      <div id={benefitsId + '-panel-yours'} role="tabpanel" aria-labelledby={benefitsId + '-tab-yours'} hidden={benefitsPane !== 'yours'}>
      <section className="mt-9"><div className="flex items-baseline justify-between gap-3"><span className="flex items-center gap-1.5"><Ico name="gift" size={15} color={P.muted} /><Label>Unused benefits</Label><InfoTip align="left">Benny+ reads each card’s transactions. A credit leaves this list once a qualifying purchase or the issuer’s statement credit shows up.</InfoTip></span>{open.length > 0 && <span className="text-[13px] font-semibold tabular-nums" style={{ color: P.accent }}>{fmt(owed)}</span>}</div><div className="mt-2">
        {open.length === 0 && <Muted className="py-3 text-[13px]">{feed.held.length ? 'Every credit on your cards has been used this period.' : 'Connect a card with Plaid to track its credits. Cards you only picked count as trying.'}</Muted>}
        {open.map(c => { const a = byAcct[c.account_id]; const key = `${c.account_id}:${c.credit_id}:${c.period_start}`; const on = turnedOn.has(c.account_id + ':' + c.credit_id); return (
          <OwedRow key={key} left={<CardArt card={cards[c.d.product_id]} width={44} />} title={`${fmt(c.d.amount_cents / 100)} ${c.d.title}`}
            sub={`${acctLabel(a, cards)} · ${(creditRule(cards, c) || {}).period === 'quadrennial' ? 'once every 4 years' : 'resets ' + fmtDate(c.period_end)}${a && !a.sample && !st.purchases.some(p => p.account_id === a.id) ? ' · connect transactions to track' : ''}${c.d.requires_activation ? (on ? ' · turned on' : ' · enroll first (Perks to turn on)') : ''}`} right={<DaysBadge days={c.d.days_left} />}
            actions={null}
            why={<Why items={jparse(c.evidence_ids).map(id => evById[id]).filter(Boolean)} quote={c.d.source} />} />); })}
      </div></section>

      {perks.length > 0 && <section className="mt-9"><span className="flex items-center gap-1.5"><Ico name="spark" size={15} color={P.muted} /><Label>Perks to turn on</Label><InfoTip align="left">Benefits whose terms say you must enroll or activate with the issuer first. The switch records that you did; it doesn’t enroll you.</InfoTip></span><div className="mt-2">
        {perks.slice().sort((x, y) => x.on - y.on).map(({ a, card, p, on }) => { const key = a.id + ':' + p.id; return (
          <OwedRow key={key} left={<CardArt card={card} width={44} />} title={p.isCredit && p.amountUsd != null ? `${fmt(p.amountUsd)} ${p.label}` : p.label} sub={`${acctLabel(a, cards)} · ${on ? 'turned on' : 'enroll with ' + card.issuer}`}
            right={p.source && p.source.url ? <a className="text-[12px] underline" style={{ color: P.muted }} href={p.source.url} target="_blank" rel="noreferrer">terms <Ext /></a> : null}
            actions={<Toggle on={on} label={'Turned on: ' + p.label} disabled={busy === key} onChange={v => setPerk(key, v)} />}
            why={p.source && p.source.quote ? <Muted className="mt-2 text-[12px] leading-5">“{p.source.quote}”</Muted> : null} />); })}
      </div></section>}



      <section className="mt-9"><span className="flex items-center gap-1.5"><Ico name="shield" size={15} color={P.muted} /><Label>Protected purchases</Label></span><div className="mt-2">
        {prot.length === 0 && <Muted className="py-3 text-[13px]">No purchases with an open protection window.</Muted>}
        {prot.slice(0, 8).map(f => { const p = byPur[f.purchase_id] || {}; const a = byAcct[f.account_id]; return (
          <OwedRow key={f.id} left={<CardArt card={a && cards[a.product_id]} width={44} />} title={`${nameOf(p)} · ${fmt((p.amount_cents || 0) / 100)}`}
            sub={`${f.d.label}${f.d.until ? ' until ' + fmtDate(f.d.until) : ''} · up to ${fmt(f.amount_high_cents / 100)}`}
            right={f.claim_packet ? <button className="text-[12px] font-semibold" style={{ color: P.accent }} onClick={() => go('review')}>Claim packet ready →</button> : <button className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: P.muted }} onClick={() => go('review')}><Flag size={13} />{f.tier === 'possible' ? 'Confirm details' : 'Add receipt'}</button>} />); })}
      </div></section>

      {used.length > 0 && <section className="mt-9"><Label>Used this period</Label><div className="mt-2">
        {used.map(c => { const a = byAcct[c.account_id]; return (
          <OwedRow key={c.account_id + c.credit_id + c.period_start} left={<CardArt card={cards[c.d.product_id]} width={44} />} title={`${fmt(c.d.amount_cents / 100)} ${c.d.title}`} sub={`${acctLabel(a, cards)} · ${label[c.state]}`}
            right={<Tier tier={c.state === 'issuer_credit_observed' ? 'confirmed' : c.state === 'user_confirmed' ? 'you' : 'possible'} />} why={<Why items={jparse(c.evidence_ids).map(id => evById[id]).filter(Boolean)} quote={c.d.source} />} />); })}
      </div></section>}
      </div>
      <div id={benefitsId + '-panel-all'} role="tabpanel" aria-labelledby={benefitsId + '-tab-all'} hidden={benefitsPane !== 'all'}>
        <AllPerks feed={feed} st={st} cards={cards} />
      </div>
      <Muted className="mt-10 text-[11.5px]">Estimates from card terms. Your issuer decides.</Muted>
    </div>
  );
}

/* Detailed, confirmable lists (shown on the Review page) */
function CreditsDetail({ st, cards, call, refresh }) {
  const P = usePal(); const byAcct = Object.fromEntries(st.accounts.map(a => [a.id, a])); const evById = Object.fromEntries((st.evidence || []).map(e => [e.id, e]));
  const credits = (st.credit_status || []).map(c => ({ ...c, d: jparse(c.data) })).filter(c => c.state !== 'expired' || c.d.observed_cents);
  const label = { issuer_credit_observed: 'Credit posted ✓', user_confirmed: 'You confirmed', qualifying_purchase_seen: 'Looks like you used it', unknown: 'No qualifying purchase seen', expired: 'Period ended' };
  const confirmCredit = async key => { await call('POST', '/v1/evidence/user', { subject_type: 'credit', subject_id: key, reason: 'You said you used this credit' }); await refresh(); };
  if (!credits.length) return null;
  return (
    <section className="mt-10"><Label>Card credits this period · {credits.length}</Label><Muted className="mt-1 text-[12px] leading-5">For reference, not counted in the Review number. Tap a credit only if you’ve already used it.</Muted><div className="mt-2">
      {credits.map(c => { const a = byAcct[c.account_id]; const card = cards[c.d.product_id] || {}; const tier = c.state === 'issuer_credit_observed' ? 'confirmed' : c.state === 'user_confirmed' ? 'you' : c.state === 'unknown' ? 'unused' : c.state === 'expired' ? 'ended' : 'possible'; return (
        <Row key={c.account_id + c.credit_id + c.period_start} left={<CardArt card={card} width={44} />} title={`${fmt(c.d.amount_cents / 100)} ${c.d.title}`} sub={`${acctLabel(a, cards)} · ${label[c.state]}${c.d.requires_activation && c.state === 'unknown' ? ' · must be turned on' : ''} · ${c.d.days_left >= 0 ? c.d.days_left + ' days left' : 'period ended ' + fmtDate(c.period_end)}`}
          right={<span className="flex items-center gap-2">{c.d.alert && <Flag size={14} />}<Tier tier={tier} /></span>}>
          <p>{c.state === 'issuer_credit_observed' ? `The issuer’s credit of ${fmt(c.d.observed_cents / 100)} posted. This is the only state counted as recovered.` : c.state === 'unknown' ? 'Benny+ only sees purchases you’ve brought in, so check your issuer before assuming it’s unused.' : 'Not counted as recovered until the issuer’s credit shows up as a transaction.'}</p>
          <Why items={jparse(c.evidence_ids).map(id => evById[id]).filter(Boolean)} quote={c.d.source} />
          {(c.state === 'unknown' || c.state === 'qualifying_purchase_seen') && <div className="mt-2"><Btn small onClick={() => confirmCredit(`${c.account_id}:${c.credit_id}:${c.period_start}`)}>I used it</Btn></div>}
        </Row>); })}
    </div></section>
  );
}
function ProtectionDetail({ st, cards, call, skip }) {
  const P = usePal(); const [packet, setPacket] = React.useState(null);
  const byAcct = Object.fromEntries(st.accounts.map(a => [a.id, a])); const byPur = Object.fromEntries(st.purchases.map(p => [p.id, p])); const evById = Object.fromEntries((st.evidence || []).map(e => [e.id, e]));
  const prot = (st.findings || []).filter(f => f.type === 'protection' || f.type === 'claim').map(f => ({ ...f, d: jparse(f.data) })).sort((a, b) => ({ confirmed: 0, possible: 1, needs_info: 2 }[a.tier] - { confirmed: 0, possible: 1, needs_info: 2 }[b.tier]))
    .filter(f => !(skip && f.tier === 'needs_info' && skip.has(f.purchase_id)));   // already listed under 'Add receipts'
  if (!prot.length) return null;
  return (
    <section className="mt-10"><Label>Purchase protection · {prot.length}</Label><div className="mt-2">
      {prot.map(f => { const p = byPur[f.purchase_id] || {}; const a = byAcct[f.account_id]; return (
        <Row key={f.id} left={<CardArt card={a && cards[a.product_id]} width={44} />} title={`${nameOf(p)} · ${fmt((p.amount_cents || 0) / 100)}`}
          sub={`${f.d.label}${f.d.until ? ' until ' + fmtDate(f.d.until) : ''} · ${f.tier === 'confirmed' ? 'ready for a claim packet' : f.tier === 'possible' ? 'confirm the item details above' : 'possibly covered: add item details'}`} right={<Tier tier={f.tier} />}>
          <p>{f.tier === 'confirmed' ? `Item and purchase link are both confirmed. Up to ${fmt(f.amount_high_cents / 100)}${f.d.cap_known ? ' (per-item cap)' : ''}.` : f.tier === 'possible' ? 'A receipt or email is attached but something is still only likely. Confirm it above.' : 'The transaction shows the card and amount, not what you bought. Add the receipt or order email below to check coverage.'}</p>
          <Why items={jparse(f.evidence_ids).map(id => evById[id]).filter(Boolean)} quote={f.d.source} />
          {f.claim_packet ? <div className="mt-2"><Btn small kind="primary" onClick={() => setPacket(packet === f.id ? null : f.id)}>Prepare claim packet</Btn></div> : null}
          {packet === f.id && <ClaimPacket findingId={f.id} call={call} onClose={() => setPacket(null)} />}
        </Row>); })}
    </div></section>
  );
}

/* ---------- review queue: one tap per item ---------- */
function buildReview(st, feed, rules) {
  const items = []; const ev = st.evidence || []; const byPur = Object.fromEntries(st.purchases.map(p => [p.id, p]));
  const confirmedLinkDocs = new Set(ev.filter(e => e.subject_type === 'link' && e.strength === 'confirmed').map(e => jparse(e.data).document_id));
  const rejected = new Set(ev.filter(e => e.subject_type === 'rejection').map(e => e.source_ref + '|' + e.subject_id));
  for (const a of st.accounts.filter(a => !a.product_confirmed)) items.push({ kind: 'account', key: 'a' + a.id, a });
  for (const e of ev.filter(e => e.subject_type === 'link' && e.strength === 'likely' && !confirmedLinkDocs.has(jparse(e.data).document_id))) items.push({ kind: 'link', key: e.id, e, p: byPur[e.subject_id], doc: st.documents.find(d => d.id === e.source_ref) });
  for (const d of st.documents || []) {
    const ex = jparse(d.extracted); const hasLink = ev.some(e => e.subject_type === 'link' && e.source_ref === d.id);
    if (ex.is_purchase_document && !hasLink) {
      const cands = st.purchases.filter(p => p.kind === 'purchase' && ex.total_cents != null && Math.abs(p.amount_cents - ex.total_cents) <= 100 && ex.purchase_date && Math.abs((Date.parse(p.posted_on) - Date.parse(ex.purchase_date)) / DAYMS) <= 5 && !rejected.has(d.id + '|' + p.id));
      if (cands.length) items.push({ kind: 'unlinked', key: 'd' + d.id, d, ex, cands });
    }
    if (ex.is_purchase_document && rules && walletAccts(st, rules).length > 1 && resolvePaid(d, ex, st, rules).how === 'ask') items.push({ kind: 'paidwith', key: 'w' + d.id, d });
  }
  const confirmedItems = new Set(ev.filter(e => e.subject_type === 'item' && e.strength === 'confirmed').map(e => e.subject_id));
  for (const e of ev.filter(e => e.subject_type === 'item' && e.strength === 'likely' && !confirmedItems.has(e.subject_id))) items.push({ kind: 'item', key: e.id, e, doc: st.documents.find(d => d.id === jparse(e.data).document_id) });
  for (const e of ev.filter(e => e.subject_type === 'credit_txn' && e.strength === 'likely')) if (!ev.some(x => x.subject_type === 'credit_txn' && x.strength === 'confirmed' && x.subject_id === e.subject_id)) items.push({ kind: 'credit', key: e.id, e, p: byPur[e.subject_id] });
  const catm = categoryMap(st); const seen = new Set();
  for (const p of feed.purchases) {
    if (p.m || seen.has(p.norm)) continue; seen.add(p.norm);   // categories are assumed automatically; only merchants nothing could place need a pick
    const n = feed.purchases.filter(x => x.norm === p.norm); items.push({ kind: 'category', key: 'c' + p.norm, norm: p.norm, raw: st.purchases.find(x => x.id === p.id).merchant_raw, suggestion: catm[p.norm], count: n.length, cents: n.reduce((s, x) => s + x.total * 100, 0) });
  }
  for (const f of (st.findings || []).filter(f => f.type === 'protection' && f.tier === 'needs_info')) items.push({ kind: 'missing', key: 'f' + f.id, f, p: byPur[f.purchase_id] });
  return items;
}
function Review({ st, feed, cards, rules, E, call, refresh }) {
  const P = usePal(); const items = buildReview(st, feed, rules); const [busy, setBusy] = React.useState(null); const [msg, setMsg] = React.useState(null); const [cat, setCat] = React.useState({});
  const act = async (key, fn, done) => { setBusy(key); setMsg(null); try { const r = await fn(); if (done) setMsg(done(r)); await refresh(); } catch (e) { setMsg('Error: ' + e.message); } setBusy(null); };
  const groups = [['account', 'Match accounts to cards'], ['link', 'Is this the right purchase?'], ['paidwith', 'Which card paid for this receipt?'], ['unlinked', 'Match a receipt to a bank transaction'], ['item', 'Do these items look right?'], ['credit', 'Is this statement credit the card benefit?'], ['category', 'Merchants we couldn’t place'], ['missing', 'Add receipts to check coverage']];
  const docName = d => d ? (d.subject || d.file_name || (d.kind === 'receipt' ? 'receipt photo' : 'email')) : 'document';
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-[26px] font-semibold tracking-tight" style={{ fontFamily: SERIF }}>Review</h2><Muted className="flex items-center gap-1 text-[13px]">Confirm to make the numbers real.<InfoTip align="left">AI suggestions stay “likely” until a fixed check or your tap confirms them. Only confirmed evidence counts.</InfoTip></Muted></div>
        <div className="flex flex-wrap gap-2"><Btn small disabled={busy === 'cr'} onClick={() => act('cr', () => call('POST', '/v1/agents/credits'), r => `Read ${r.read} statement credits. Confirm them below.`)}>{busy === 'cr' ? 'Reading…' : 'Read statement credits'}</Btn></div></div>
      {msg && <div className="mt-3 text-[13px]" style={{ color: msg.startsWith('Error') ? P.danger : P.accent }}>{msg}</div>}
      {items.length === 0 && <div className="mt-8"><Panel><div className="text-[14px]">Nothing to review.</div><Muted className="mt-1 text-[13px]">New purchases, receipts and credits will show up here when something needs your call.</Muted></Panel></div>}
      {groups.map(([k, title]) => { const list = items.filter(i => i.kind === k); if (!list.length) return null; return (
        <section key={k} className="mt-8"><Label>{title} · {list.length}</Label><div className="mt-2">
          {list.slice(0, 25).map(i => (
            <div key={i.key} className="flex flex-wrap items-center gap-3 py-3" style={{ borderTop: `1px solid ${P.line}` }}>
              <div className="min-w-0 flex-1 text-[13px] leading-5">
                {k === 'paidwith' && <div className="-mt-3"><ReceiptEstimate d={i.d} st={st} rules={rules} E={E} call={call} refresh={refresh} startOpen /></div>}
                {k === 'account' && <AccountConfirm account={i.a} cards={cards} call={call} onDone={refresh} accounts={typeof st !== 'undefined' && st ? st.accounts : null} />}
                {k === 'link' && <><div className="font-medium">{docName(i.doc)} → {i.p ? `${i.p.merchant_raw} · ${fmt(i.p.amount_cents / 100)} · ${fmtDate(i.p.posted_on)}` : 'purchase'}</div><Muted className="text-[12px]">Proposed by the linker: {i.e.reason}. The fixed check didn’t confirm it (amount, merchant, date or card digits differ).</Muted></>}
                {k === 'unlinked' && <><div className="font-medium">{docName(i.d)} · {i.ex.merchant || 'merchant?'} · {i.ex.total_cents != null ? fmt(i.ex.total_cents / 100) : 'total?'} · {fmtDate(i.ex.purchase_date)}</div>
                  {i.cands.length ? <div className="mt-1 flex flex-wrap gap-2">{i.cands.slice(0, 4).map(p => <Btn key={p.id} small onClick={() => act(i.key, () => call('POST', `/v1/documents/${i.d.id}/link`, { purchase_id: p.id }), () => 'Matched.')}>{p.merchant_raw} · {fmt(p.amount_cents / 100)} · {fmtDate(p.posted_on)}</Btn>)}</div> : <Muted className="text-[12px]">No purchase within 5 days and $1 yet. It will match when the transaction arrives.</Muted>}</>}
                {k === 'item' && (() => { const d = jparse(i.e.data); return <><div className="font-medium">{d.name}{d.model ? ` · model ${d.model}` : ''}{d.price_cents != null ? ` · ${fmt(d.price_cents / 100)}` : ''}{d.qty > 1 ? ` × ${d.qty}` : ''}</div><Muted className="text-[12px]">Read from {docName(i.doc)}</Muted></>; })()}
                {k === 'credit' && <><div className="font-medium">{i.p ? `${i.p.merchant_raw} · ${fmt(i.p.amount_cents / 100)}` : 'credit'}</div><Muted className="text-[12px]">Credit reader: {jparse(i.e.data).credit_id} · {i.e.reason}</Muted></>}
                {k === 'category' && <><div className="font-medium">{i.raw}</div><Muted className="text-[12px]">{i.count} purchase{i.count === 1 ? '' : 's'} · {fmt(i.cents / 100)}{i.suggestion && i.suggestion.category ? ` · AI suggests ${i.suggestion.category.replace(/_/g, ' ')} (inferred)` : ''}</Muted></>}
                {k === 'missing' && <div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: P.sunk, color: P.info }}><Ico name="shield" size={17} /></span><div className="min-w-0"><div className="truncate font-medium">{i.p ? `${nameOf(i.p)} · ${fmt(i.p.amount_cents / 100)}` : 'Purchase'}</div><Muted className="truncate text-[12px]">{jparse(i.f.data).label}{jparse(i.f.data).until ? ' until ' + dayLabel(jparse(i.f.data).until) : ''}</Muted></div></div>}
              </div>
              <div className="flex flex-wrap gap-2">
                {(k === 'link' || k === 'item' || k === 'credit') && <><Btn small kind="primary" disabled={busy === i.key} onClick={() => act(i.key, () => call('POST', '/v1/review/confirm', { evidence_id: i.e.id }), () => 'Confirmed.')}>Looks right</Btn><Btn small disabled={busy === i.key} onClick={() => act(i.key, () => call('POST', '/v1/review/reject', { evidence_id: i.e.id }), () => 'Removed.')}>Not this</Btn></>}
                {k === 'missing' && <Btn small onClick={() => { const el = document.getElementById('bp-intake'); const inp = el && el.querySelector('input[type=file]'); if (inp && !inp.disabled) inp.click(); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><span className="inline-flex items-center gap-1"><Ico name="receipt" size={13} />Add receipt</span></Btn>}
                {k === 'category' && <><Select value={cat[i.norm] || (i.suggestion && i.suggestion.category) || ''} onChange={v => setCat(c => ({ ...c, [i.norm]: v }))}><option value="">Pick category…</option>{st.categories.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</Select>
                  <Btn small kind="primary" disabled={busy === i.key || !(cat[i.norm] || (i.suggestion && i.suggestion.category))} onClick={() => act(i.key, () => call('POST', '/v1/categories/confirm', { merchant_normalized: i.norm, category: cat[i.norm] || i.suggestion.category }), () => 'Category saved.')}>Pick</Btn></>}
              </div>
            </div>))}
        </div></section>); })}
      <CreditsDetail st={st} cards={cards} call={call} refresh={refresh} />
      <ProtectionDetail st={st} cards={cards} call={call} skip={new Set(items.filter(i => i.kind === 'missing' && i.p).map(i => i.p.id))} />
      <div id="bp-intake" className="mt-10 space-y-4" style={{ scrollMarginTop: 16 }}><GmailImport refresh={refresh} call={call} demo={(st.accounts || []).some(a => a.sample)} /><Intake call={call} refresh={refresh} st={st} rules={rules} E={E} /></div>
    </div>
  );
}

/* ---------- activity + wallet ---------- */
function SavingsBrief({ feed, st, cards, filter }) {
  const P = usePal(); const [open, setOpen] = React.useState(false);
  const missed = feed.missed.filter(x => filter === 'all' || x.p.accountId === filter);
  const comparable = feed.held && new Set(feed.held.map(a => a.product_id)).size > 1;
  if (!comparable) return <div className="mt-5 rounded-2xl px-5 py-4 text-[13px]" style={{ background: P.surface, border: `1px solid ${P.line}`, color: P.muted }}>Add a second card in Wallet to see how much a different card would have earned on these purchases.</div>;
  const total = missed.reduce((s, x) => s + x.high, 0); const certain = missed.reduce((s, x) => s + x.low, 0);
  const groups = {}; for (const x of missed) { const k = x.topAcct ? x.topAcct.id : x.top.cardId; const cat = x.p.m ? (x.p.m.categories || ['other'])[0] : 'other';
    const g = groups[k] || (groups[k] = { acct: x.topAcct, card: cards[x.top.cardId], sum: 0, n: 0, cats: {} }); g.sum += x.high; g.n++; g.cats[cat] = (g.cats[cat] || 0) + x.high; }
  const list = Object.values(groups).sort((a, b) => b.sum - a.sum);
  return (
    <div className="mt-5 rounded-2xl px-5 py-5" style={{ background: P.surface, border: `1px solid ${P.line}` }}>
      {missed.length ? <>
        <Label>Last 120 days{filter !== 'all' ? ' · this card' : ''}</Label>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="text-[34px] font-semibold leading-none tracking-tight" style={{ fontFamily: SERIF, color: P.accent }}>≈ {fmt(total)}</span>
          <span className="text-[14px]" style={{ color: P.ink }}>more you could have earned by paying with the best card each time</span></div>
        <Muted className="mt-1 text-[12.5px]">{missed.length} purchase{missed.length === 1 ? '' : 's'}{certain > 0 && certain < total - 0.005 ? ` · ${fmt(certain)} of it is certain; the rest depends on categories Benny+ picked automatically` : ''}</Muted>
        <div className="mt-4 space-y-2">{list.map((g, i) => (
          <div key={i} className="flex flex-wrap items-center gap-3 py-1.5" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
            <CardArt card={g.card} width={44} />
            <div className="min-w-0 flex-1 text-[13.5px]"><div className="font-medium" style={{ color: P.ink }}>Use {g.acct ? acctLabel(g.acct, cards) : (g.card && (g.card.short || g.card.name))}</div>
              <Muted className="truncate text-[12px]">for {Object.entries(g.cats).sort((a, b) => b[1] - a[1]).map(([k]) => catName(k).toLowerCase()).join(', ')} · {g.n} purchase{g.n === 1 ? '' : 's'}</Muted></div>
            <div className="text-[16px] font-semibold tabular-nums" style={{ fontFamily: SERIF, color: P.accent }}>+{fmt(g.sum)}</div>
          </div>))}</div>
        <button className="mt-3 text-[12px] underline" style={{ color: P.muted }} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'How this is worked out'}</button>
        {open && <Muted className="mt-1 text-[12px] leading-5">For each purchase, every card you carry is scored with its published earning rate for that merchant’s category (points at their guaranteed cash value; no fixed value counts as $0). The difference between the best card and the card you used is added up. These are estimates; rewards actually post on your statements.</Muted>}
      </> : <div className="text-[13.5px]" style={{ color: P.ink }}>{coverageLine(feed) || 'No purchases to compare yet.'}</div>}
    </div>
  );
}
function Activity({ feed, st, cards, call, refresh, embedded }) {
  const P = usePal(); const [f, setF] = React.useState('all'); const [edit, setEdit] = React.useState(null);
  const missedById = Object.fromEntries(feed.missed.map(x => [x.p.id, x]));
  const byAcct = Object.fromEntries(st.accounts.map(a => [a.id, a])); const pm = Object.fromEntries(feed.purchases.map(p => [p.id, p]));
  const linked = new Set((st.evidence || []).filter(e => e.subject_type === 'link').map(e => e.subject_id));
  const list = st.purchases.filter(t => f === 'all' || t.account_id === f);
  return (
    <section className={embedded ? 'mt-10' : 'mx-auto w-full max-w-3xl px-5 py-8'}>
      <div className="flex flex-wrap items-center justify-between gap-3"><Label>Transactions</Label>
        <div className="flex flex-wrap gap-1.5">{[['all', 'All']].concat(st.accounts.map(a => [a.id, acctLabel(a, cards)])).map(([k, l]) => (
          <button key={k} onClick={() => setF(k)} className="rounded-full px-3 py-1 text-[12px]" style={f === k ? { background: P.accent, color: P.accentInk, border: `1px solid ${P.accent}` } : { color: P.ink, border: `1px solid ${P.lineStrong}` }}>{l}</button>))}</div></div>
      {!embedded && <SavingsBrief feed={feed} st={st} cards={cards} filter={f} />}
      <div className="mt-3">
        {list.length === 0 && <Muted className="py-6 text-[13px]">No transactions yet.</Muted>}
        {list.slice(0, 300).map(t => { const a = byAcct[t.account_id]; const p = pm[t.id]; const neg = t.amount_cents < 0; const mx = missedById[t.id]; return (
          <div key={t.id} className="flex items-center gap-3 py-2.5" style={{ borderTop: `1px solid ${P.line}` }}>
            <CardArt card={a && cards[a.product_id]} width={34} />
            <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-1.5 text-[14px] font-medium" style={{ color: P.ink }}><span className="truncate" title={t.merchant_raw}>{nameOf(t, p)}</span>{t.pending ? <span className="text-[11px] font-normal" style={{ color: P.muted }}>pending</span> : null}{linked.has(t.id) ? <span title="Receipt attached" style={{ color: P.accent }}><Ico name="receipt" size={13} /></span> : null}</div>
              <div className="truncate text-[12px]" style={{ color: P.muted }}>{dayLabel(t.posted_on)} · {acctLabel(a, cards)}{t.kind !== 'purchase' ? ' · ' + t.kind : !p ? (a && !a.product_confirmed ? ' · card not confirmed' : '') : null}
                {t.kind === 'purchase' && p && <> · <button className="underline decoration-dotted underline-offset-2" onClick={() => setEdit(edit === t.id ? null : t.id)} title={'Category ' + (p.m ? '(' + catSourceLabel(p.level) + ')' : '') + ' · tap to change'}>{p.m ? catName((p.m.categories || ['other'])[0]) : 'Uncategorized'}</button></>}</div>
              {edit === t.id && p && <div className="mt-1"><CategoryChange compact norm={t.merchant_normalized} current={p.m ? (p.m.categories || [])[0] : null} level={p.level} st={st} call={call} refresh={async () => { await refresh(); setEdit(null); }} /></div>}</div>
            <div className="text-[14px] tabular-nums" style={{ color: neg ? P.accent : P.ink }}>{fmt(t.amount_cents / 100)}</div>
          </div>); })}
      </div>
    </section>
  );
}

const CAT_NAME = { dining: 'Dining', grocery: 'Groceries', gas: 'Gas', gas_costco: 'Costco gas', travel: 'Travel', airline: 'Flights', hotel: 'Hotels', hotel_direct: 'Hotels direct', car_rental: 'Car rental', chase_travel: 'Chase Travel', costco_travel: 'Costco Travel', online: 'Online', online_grocery: 'Online grocery', streaming: 'Streaming', drugstore: 'Drugstores', rideshare: 'Rideshare', wholesale: 'Wholesale clubs', electronics: 'Electronics', department: 'Department stores', home_improvement: 'Home improvement', home: 'Home', ev_charging: 'EV charging', united: 'United', transit: 'Transit', _everyday: 'Everyday' };
const catName = c => CAT_NAME[c] || String(c).replace(/_/g, ' ').replace(/^./, x => x.toUpperCase());
/* Which categories each card in the wallet wins (engine decides; ties and catch-all rates don't count). */
function walletRoles(E, rules, accounts) {
  const ids = [...new Set(accounts.filter(a => a.product_confirmed && rules.cards[a.product_id]).map(a => a.product_id))]; const roles = {};
  if (!E || !ids.length) return roles;
  const cats = [...new Set(rules.mcc.flatMap(m => m.categories))];
  for (const cat of cats) {
    const rec = E.recommend(rules, ids, { id: 'cat:' + cat, name: cat, categories: [cat], confidence: 'high' }, 100, 'cash'); const top = rec.ranking[0];
    if (!top || rec.tie || !top.rule || (top.rule.categories || []).includes('*') || top.valueUsd <= 0) continue;
    (roles[top.cardId] = roles[top.cardId] || []).push({ cat, rate: top.rate, explanation: top.explanation });
  }
  const ev = E.recommend(rules, ids, { id: 'cat:other', name: 'everything else', categories: ['other'], confidence: 'high' }, 100, 'cash');
  if (ev.ranking[0] && !ev.tie && ids.length > 1) (roles[ev.ranking[0].cardId] = roles[ev.ranking[0].cardId] || []).push({ cat: '_everyday', rate: ev.ranking[0].rate, explanation: ev.ranking[0].explanation });
  for (const k in roles) roles[k].sort((a, b) => b.rate - a.rate);
  return roles;
}
function NetworkMark({ network, ink, h = 20 }) {
  if (network === 'Visa') return <span style={{ fontStyle: 'italic', fontWeight: 900, fontSize: h * 0.95, letterSpacing: '0.02em', color: ink, lineHeight: 1, fontFamily: 'Arial, Helvetica, sans-serif' }}>VISA</span>;
  if (network === 'Mastercard') return <svg width={h * 1.6} height={h} viewBox="0 0 32 20" aria-label="Mastercard"><circle cx="11" cy="10" r="9" fill="#EB001B" /><circle cx="21" cy="10" r="9" fill="#F79E1B" fillOpacity="0.9" /></svg>;
  if (network === 'American Express') return <span style={{ background: '#2E77BC', color: '#fff', fontWeight: 800, fontSize: h * 0.5, padding: `${h * 0.18}px ${h * 0.25}px`, borderRadius: 3, letterSpacing: '0.04em', lineHeight: 1 }}>AMEX</span>;
  if (network === 'Discover') return <span className="flex items-center gap-0.5" style={{ fontWeight: 800, fontSize: h * 0.55, color: ink, letterSpacing: '0.04em' }}>DISC<span style={{ width: h * 0.5, height: h * 0.5, borderRadius: 99, background: '#F58220', display: 'inline-block' }} />VER</span>;
  return null;
}
function BigCard({ card, acct, w, roles, front }) {
  const P = usePal(); const h = Math.round(w / 1.586); const a = (card && card.art) || {}; const pad = Math.round(w * 0.055);
  if (!card) return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ width: w, height: h, borderRadius: Math.round(w * 0.05), border: `1.5px dashed ${P.lineStrong}`, background: P.surface, color: P.muted }}>
      <div className="text-[15px] font-semibold" style={{ color: P.ink }}>{bankName(acct)}{acct.mask ? ' ••' + acct.mask : ''}</div>
      <div className="mt-1 text-[12px]">Which card is this? Tap to confirm.</div>
    </div>
  );
  const ink = a.ink || '#fff', sub = a.sub || ink; const metal = a.style === 'metal'; const lightFace = /^#(E|F|D|B)/i.test(a.from || '');
  const chip = 'rgba(255,255,255,0.16)';
  const rs = (roles || []).map(r => catName(r.cat));
  return (
    <div className="relative overflow-hidden text-left" style={{ width: w, height: h, borderRadius: Math.round(w * 0.05), background: `linear-gradient(135deg, ${a.from || '#52525b'}, ${a.to || '#27272a'})`, color: ink, boxShadow: '0 1px 1px rgba(0,0,0,0.05), 0 16px 32px -18px rgba(0,0,0,0.55)' }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: lightFace ? 'linear-gradient(155deg, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0) 46%)' : 'linear-gradient(155deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 44%)' }} />
      {metal && <div className="pointer-events-none absolute inset-0" style={{ background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px, rgba(0,0,0,0.02) 1px 3px)' }} />}
      {a.style === 'globe' && <svg className="pointer-events-none absolute" style={{ right: -w * 0.12, top: -h * 0.1, opacity: 0.18 }} width={w * 0.7} height={w * 0.7} viewBox="0 0 100 100" fill="none" stroke={ink} strokeWidth="0.6"><circle cx="50" cy="50" r="46" /><ellipse cx="50" cy="50" rx="20" ry="46" /><ellipse cx="50" cy="50" rx="36" ry="46" /><path d="M4 50h92M10 28h80M10 72h80" /></svg>}
      {a.style === 'costco' && <div className="pointer-events-none absolute left-0 right-0" style={{ top: h * 0.3, height: h * 0.07, background: 'linear-gradient(90deg, #E31837 0 50%, #005DAA 50% 100%)', opacity: 0.85 }} />}
      <div className="pointer-events-none absolute inset-0" style={{ borderRadius: 'inherit', boxShadow: lightFace ? 'inset 0 0 0 1px rgba(0,0,0,0.07)' : 'inset 0 0 0 1px rgba(255,255,255,0.08)' }} />
      <div className="absolute left-0 right-0 top-0 flex items-start justify-between gap-3" style={{ padding: `${pad}px ${pad + 2}px` }}>
        <div className="min-w-0"><div className="truncate" style={{ fontSize: Math.max(14, Math.min(18, w / 21)), fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{card.short || card.name}</div>
          <div className="truncate" style={{ fontSize: 11.5, color: sub, marginTop: 2 }}>{card.issuer}{acct.mask ? ' · ••' + acct.mask : ''}</div></div>
        {rs.length > 0 && <span className="shrink-0 whitespace-nowrap rounded-full" style={{ fontSize: 11.5, fontWeight: 600, padding: '4px 10px', background: lightFace ? 'rgba(0,0,0,0.07)' : chip }}>{rs[0]}{rs.length > 1 ? `  +${rs.length - 1}` : ''}</span>}
      </div>
      <div className="absolute flex items-center gap-2.5" style={{ left: pad + 2, top: h * 0.44 }}>
        <svg width={w * 0.11} height={w * 0.083} viewBox="0 0 44 33" aria-hidden="true"><rect x="0.5" y="0.5" width="43" height="32" rx="6" fill="#D9B970" stroke="rgba(0,0,0,0.18)" /><path d="M0 11h14M0 22h14M30 11h14M30 22h14M14 0v33M30 0v33M14 16.5h16" stroke="rgba(90,70,30,0.45)" strokeWidth="1.2" fill="none" /></svg>
        <svg width={w * 0.045} height={w * 0.055} viewBox="0 0 18 22" fill="none" stroke={sub} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 6c2 3 2 7 0 10M8 3c3.5 5 3.5 11 0 16M13 1c4.5 6 4.5 14 0 20" /></svg>
      </div>
      <div className="absolute flex items-end justify-between gap-3" style={{ left: pad + 2, right: pad + 2, bottom: pad }}>
        <div className="min-w-0" style={{ lineHeight: 1.35 }}>
          {front && (rs.length ? <><div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: sub }}>Use for</div><div className="truncate" style={{ fontSize: 13, fontWeight: 600 }}>{rs.slice(0, 3).join(' · ')}</div></>
            : <div style={{ fontSize: 12.5, color: sub }}>{acct.mask ? '•••• ' + acct.mask : ((card.credits || []).length ? 'Credits & perks card' : 'Backup card')}</div>)}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {acct.sample ? <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em', padding: '2px 6px', borderRadius: 4, border: `1px solid ${sub}`, color: sub }}>SAMPLE</span> : null}
          <NetworkMark network={card.network} ink={ink} h={Math.max(16, w / 20)} />
        </div>
      </div>
    </div>
  );
}
function WalletStack({ accounts, cards, front, onPick, rolesByCard }) {
  const ref = React.useRef(null); const [w, setW] = React.useState(360);
  React.useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(es => setW(es[0].contentRect.width)); ro.observe(el); return () => ro.disconnect(); }, []);
  const cardW = Math.max(240, Math.min(w, 420)); const cardH = Math.round(cardW / 1.586); const peek = Math.round(Math.max(56, cardH * 0.25));
  const ids = accounts.map(a => a.id); const order = ids.filter(id => id !== front).concat(ids.includes(front) ? [front] : []);
  const height = order.length ? (order.length - 1) * peek + cardH : cardH; const left = Math.max(0, (w - cardW) / 2);
  return (
    <ul ref={ref} className="relative m-0 w-full list-none p-0" style={{ height, transition: 'height 420ms ease' }} aria-label="Cards in your wallet">
      {accounts.map(a => { const i = order.indexOf(a.id); const isFront = i === order.length - 1; return (
        <li key={a.id} className="absolute motion-reduce:transition-none" style={{ left, top: i * peek, width: cardW, height: cardH, zIndex: i + 1, transition: 'top 560ms cubic-bezier(.2,.85,.25,1)' }}>
          <button type="button" onClick={() => onPick(a.id, isFront)} aria-label={acctLabel(a, cards) + (isFront ? '. Open its transactions.' : '. Bring to front.')}
            className="block h-full w-full p-0 motion-reduce:transition-none" style={{ borderRadius: Math.round(cardW * 0.05), transition: 'transform 220ms ease' }}
            onMouseEnter={e => { if (!isFront) e.currentTarget.style.transform = 'translateY(-6px)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}>
            <BigCard card={a.product_confirmed ? cards[a.product_id] : null} acct={a} w={cardW} roles={rolesByCard[a.product_id]} front={isFront} />
          </button>
        </li>); })}
    </ul>
  );
}

const PROT_LINE = pr => {
  const bits = [];
  if (pr.windowDays) bits.push(`${pr.windowDays} days from purchase`);
  if (pr.addsMonths) bits.push(`adds ${pr.addsMonths} months to the manufacturer’s warranty${pr.maxOriginalWarrantyMonths ? ` (warranties up to ${pr.maxOriginalWarrantyMonths} months)` : ''}`);
  if (pr.minDelayHours) bits.push(`delays over ${pr.minDelayHours} hours`);
  if (pr.perItemCapUsd) bits.push(`up to ${fmt0(pr.perItemCapUsd)} per item`);
  if (pr.maxPerTripUsd) bits.push(`up to ${fmt0(pr.maxPerTripUsd)} per trip`);
  if (pr.secondary) bits.push('secondary to other insurance');
  if (pr.incomplete) bits.push('some terms not confirmed yet');
  return bits.join(' · ');
};
function cardSummary(card) {
  const cash = card.currency && card.currency.unit === 'cashback'; const r = x => cash ? x + '%' : x + 'x';
  const earn = (card.earn || []).filter(e => !e.conditional); const base = earn.find(e => (e.categories || []).includes('*'));
  const top = earn.filter(e => e !== base).sort((a, b) => b.rate - a.rate).slice(0, 3).map(e => `${r(e.rate)} ${e.label.toLowerCase()}`);
  return top.concat(base ? [`${r(base.rate)} everything else`] : []).join(' · ') || 'No earn rates found';
}
function PolicyRow({ a, card, roles, onOpen, first, trying }) {
  const P = usePal(); const art = (card && card.art) || {};
  const nCred = card ? (card.credits || []).filter(c => c.amountUsd != null).length : 0; const nProt = card ? (card.protections || []).length : 0;
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-4 py-4 text-left" style={{ borderTop: first ? 'none' : `1px solid ${P.line}` }}>
      <div className="shrink-0" style={{ width: 52, height: 33, borderRadius: 6, background: card ? `linear-gradient(135deg, ${art.from}, ${art.to})` : P.sunk, boxShadow: `inset 0 0 0 1px ${P.line}` }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="text-[15px] font-semibold" style={{ color: P.ink }}>{card ? (card.short || card.name) : bankName(a)}{a.mask ? ' ••' + a.mask : ''}</span>
          {card ? <span style={{ color: P.accent }} title={card.verified ? 'Checked by our team against the issuer’s benefit guide' : 'Every rule quotes the issuer’s own page word for word'}><Ico name="check" size={15} /></span>
            : <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ letterSpacing: '0.1em', color: P.info, border: `1px dashed ${P.info}` }}>Confirm card</span>}
          {card && trying && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase" style={{ letterSpacing: '0.08em', color: P.info, border: `1px dashed ${P.info}` }} title="Not counted in your totals. Connect it with Plaid or open it and tap I have it.">Trying</span>}</div>
        {card && <div className="mt-0.5 truncate text-[13px]" style={{ color: P.ink, opacity: 0.85 }}>{cardSummary(card)}</div>}
        {card ? <div className="mt-1 flex min-w-0 items-center gap-3 text-[12px]" style={{ color: P.muted }}>
          <span className="flex min-w-0 items-center gap-1 truncate"><Ico name="star" size={13} />{roles && roles.length ? roles.map(r => catName(r.cat)).slice(0, 2).join(', ') + (roles.length > 2 ? ` +${roles.length - 2}` : '') : nCred ? 'Credits & perks' : 'Backup'}</span>
          {nCred > 0 && <span className="flex shrink-0 items-center gap-1" title={`${nCred} credit${nCred === 1 ? '' : 's'}`}><Ico name="gift" size={13} />{nCred}</span>}
          {nProt > 0 && <span className="flex shrink-0 items-center gap-1" title={`${nProt} protection${nProt === 1 ? '' : 's'}`}><Ico name="shield" size={13} />{nProt}</span>}
        </div> : <div className="mt-0.5 truncate text-[12px]" style={{ color: P.muted }}>Tap to choose the card</div>}
      </div>
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke={P.faint} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6" /></svg>
    </button>
  );
}
function BenefitGroup({ title, items }) {
  const P = usePal(); if (!items.length) return null;
  return (
    <div className="mt-6"><Label>{title}</Label><div className="mt-1">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-3 py-2.5" style={{ borderTop: `1px solid ${P.line}` }}>
          <div className="w-16 shrink-0 pt-px text-[14px] font-semibold tabular-nums" style={{ fontFamily: SERIF, color: it.tone || P.accent }}>{it.big}</div>
          <div className="min-w-0 flex-1 text-[13px] leading-5"><div style={{ color: P.ink }}>{String(it.title).replace(/^./, ch => ch.toUpperCase())}</div>{it.sub && <div style={{ color: P.muted }}>{it.sub}</div>}
            {it.src && it.src.quote && !(i > 0 && items[i - 1].src && items[i - 1].src.quote === it.src.quote) && <div className="mt-1 text-[12px] italic" style={{ color: P.faint }}>“{it.src.quote.length > 220 ? it.src.quote.slice(0, 220) + '…' : it.src.quote}”</div>}</div>
          {it.right}
          {it.src && it.src.url && <a className="shrink-0 pt-0.5 text-[12px]" style={{ color: P.faint }} href={it.src.url} target="_blank" rel="noreferrer" title="Open the source page"><Ext /></a>}
        </div>))}
    </div></div>
  );
}
function CardBenefits({ a, card, st, cards, call, refresh, onImport, onRemoveAsk, roles }) {
  const P = usePal(); const month = localMonth();
  const tx = st.purchases.filter(t => t.account_id === a.id);
  const spent = tx.filter(t => t.kind === 'purchase' && (t.posted_on || '').startsWith(month)).reduce((s, t) => s + t.amount_cents, 0) / 100;
  const cs = (st.credit_status || []).filter(x => x.account_id === a.id).map(x => ({ ...x, d: jparse(x.data) }));
  const rec = cs.filter(x => x.state === 'issuer_credit_observed').reduce((s, x) => s + x.d.observed_cents, 0) / 100;
  const owed = cs.filter(x => x.state === 'unknown' && x.d.days_left >= 0).reduce((s, x) => s + x.d.amount_cents, 0) / 100;
  if (!card) return <div className="mt-5"><AccountConfirm account={a} cards={cards} call={call} onDone={refresh} accounts={typeof st !== 'undefined' && st ? st.accounts : null} /></div>;
  const cash = card.currency && card.currency.unit === 'cashback'; const unit = (card.currency && card.currency.unitLabel) || 'points';
  const stateLabel = { issuer_credit_observed: ['Credit posted ✓', P.accent], user_confirmed: ['You confirmed', P.likely], qualifying_purchase_seen: ['Looks used', P.likely], unknown: ['Not used yet', P.info], expired: ['Period ended', P.faint] };
  const creditIds = new Set((card.credits || []).map(c => c.id));
  const earn = (card.earn || []).slice().sort((x, y) => (x.categories || []).includes('*') - (y.categories || []).includes('*') || y.rate - x.rate).map(r => ({
    big: cash ? r.rate + '%' : r.rate + 'x', title: r.label + (cash ? ' cash back' : ' ' + unit), sub: [r.cap && r.cap.note ? 'up to ' + r.cap.note : null, r.conditional ? 'only if ' + String(r.condition || 'a condition is met').replace(/^only |^if /i, '') : null].filter(Boolean).join(' · ') || null, src: r.source, tone: r.conditional ? P.info : P.accent }));
  const credits = (card.credits || []).map(c => { const s = cs.filter(x => x.credit_id === c.id).sort((x, y) => y.period_start.localeCompare(x.period_start))[0]; const sl = s && stateLabel[s.state];
    return { big: c.amountUsd != null ? fmt0(c.amountUsd) : '—', title: c.label, sub: [c.period ? c.period : null, c.requiresActivation ? 'turn on first' : null, (c.merchantNames || []).slice(0, 3).join(', ') || null].filter(Boolean).join(' · '), src: c.source, right: sl ? <span className="shrink-0 text-[11px] font-semibold" style={{ color: sl[1] }}>{sl[0]}</span> : null }; });
  const perks = (card.perks || []).filter(p => !creditIds.has(p.id)).map(p => ({ big: '✓', title: p.label, sub: p.requiresActivation ? 'needs enrollment' : null, src: p.source, tone: P.likely }));
  const prots = (card.protections || []).map(pr => ({ big: pr.windowDays ? pr.windowDays + 'd' : pr.addsMonths ? '+' + pr.addsMonths + 'mo' : '✓', title: pr.label, sub: PROT_LINE(pr), src: pr.source, tone: P.seal }));
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-[18px] font-semibold tracking-tight" style={{ fontFamily: SERIF }}>{card.name}{a.mask ? ' ••' + a.mask : ''}</div>
          <Muted className="mt-0.5 text-[12px]">{a.sample ? 'Sample card' : a.source === 'plaid' ? 'Connected through your bank' : 'Added by you'} · {tx.length} transactions · annual fee {card.annualFee ? fmt0(card.annualFee) : '$0'}</Muted></div>
        <div className="flex flex-wrap gap-2">{a.product_confirmed && !a.sample && <Btn small onClick={onImport}>Upload statement</Btn>}{a.source !== 'plaid' && <Btn small kind="quiet" onClick={onRemoveAsk}>Remove</Btn>}</div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        {[[fmt(owed), 'credits left this period', P.ink], [fmt(rec), 'recovered', P.accent], [fmt(spent), 'spent this month', P.muted]].map(([v, l, c]) => <div key={l} style={{ borderTop: `1px solid ${P.lineStrong}`, paddingTop: 8 }}><div className="text-[18px] font-semibold tabular-nums" style={{ fontFamily: SERIF, color: c }}>{v}</div><Muted className="text-[11px]">{l}</Muted></div>)}
      </div>
      <BenefitGroup title="Use it for" items={(roles || []).map(r => ({ big: (cash ? r.rate + '%' : r.rate + 'x'), title: catName(r.cat), sub: 'Best card in your wallet for ' + catName(r.cat).toLowerCase(), tone: P.accent }))} />
      <BenefitGroup title="Earns" items={earn} />
      <BenefitGroup title="Credits" items={credits} />
      <BenefitGroup title="Perks" items={perks} />
      <BenefitGroup title="Protections" items={prots} />
      <Muted className="mt-4 text-[11px] leading-4">Every benefit is quoted from {card.issuer}’s own pages (the arrow opens the source). {card.verified ? 'Checked by hand.' : 'Read automatically and verified word for word against the saved page.'}</Muted>
    </div>
  );
}

/* ---------- one card: big face, policy link, latest transactions ---------- */
const CAT_TINT = { dining: '#C2410C', grocery: '#2F7D32', online_grocery: '#2F7D32', gas: '#1D5FA8', gas_costco: '#1D5FA8', ev_charging: '#1D5FA8', travel: '#5B3FB6', airline: '#5B3FB6', hotel: '#5B3FB6', united: '#1E3A8A', chase_travel: '#1E3A8A', rideshare: '#111827', streaming: '#9D174D', electronics: '#334155', department: '#B91C1C', wholesale: '#1D4ED8', drugstore: '#0F766E', home_improvement: '#C2410C', online: '#6D28D9' };
const titleCase = s => String(s || '').toLowerCase().replace(/\b[a-z]/g, x => x.toUpperCase());
const shortDate = s => { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${m}/${d}/${String(y).slice(2)}`; };
function CategoryChange({ norm, current, level, st, call, refresh, compact }) {
  const P = usePal(); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(null);
  if (!call || !norm) return null;
  const save = async v => { setBusy(true); setErr(null); try { await call('POST', '/v1/categories/confirm', { merchant_normalized: norm, category: v === '__auto' ? null : v }); await refresh(); } catch (e) { setErr(e.message); } setBusy(false); };
  return (
    <span className="inline-flex flex-wrap items-center gap-2" onClick={e => e.stopPropagation()}>
      <select value="" disabled={busy} onChange={e => e.target.value && save(e.target.value)} aria-label="Change category" className={`rounded-full ${compact ? 'px-2 py-0.5 text-[11.5px]' : 'px-3 py-1 text-[12px]'}`} style={{ background: P.surface, color: P.ink, border: `1px solid ${P.lineStrong}` }}>
        <option value="">{busy ? 'Saving…' : 'Change category'}</option>
        {level === 'you' && <option value="__auto">Use automatic category</option>}
        {(st.categories || []).filter(x => x !== current).map(x => <option key={x} value={x}>{catName(x)}</option>)}
      </select>
      {err && <span style={{ color: P.danger }}>{err}</span>}
    </span>
  );
}
const catSourceLabel = level => level === 'you' ? 'picked by you' : level === 'table' ? 'known merchant' : level === 'inferred' ? 'auto-picked' : 'best match';
function TxTile({ name, cat }) {
  const bg = CAT_TINT[cat] || '#55625A'; const letter = (String(name || '?').match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase();
  return <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[17px] font-bold" style={{ background: bg, color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }}>{letter}</div>;
}
function TxRow({ t, fp, findings, linked, missed, first, cards, st, call, refresh }) {
  const P = usePal(); const [open, setOpen] = React.useState(false);
  const cat = fp && fp.m ? (fp.m.categories || [])[0] : null;
  const name = fp && fp.level === 'table' ? fp.merchant : titleCase(t.merchant_normalized || t.merchant_raw);
  const neg = t.amount_cents < 0; const kindLabel = { payment: 'Payment', refund: 'Refund', credit: 'Statement credit', fee: 'Fee' }[t.kind];
  const sub = [kindLabel || (cat ? catName(cat) : 'Not recognized'), { plaid: 'Bank', csv: 'Statement', sample: 'Sample' }[t.source] || t.source].filter(Boolean).join(' · ');
  const f = findings.find(x => x.purchase_id === t.id);
  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${P.line}` }}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-start gap-4 px-5 py-4 text-left">
        <TxTile name={name} cat={cat} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold" style={{ color: P.ink }}>{name}</div>
          <div className="truncate text-[13px]" style={{ color: P.muted }}>{sub}{t.pending ? ' · pending' : ''}</div>
          <div className="text-[13px] tabular-nums" style={{ color: P.muted }}>{shortDate(t.posted_on)}</div>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          {(linked || f || missed) && <span className="flex gap-1">{linked && <span title="Receipt attached" className="h-1.5 w-1.5 rounded-full" style={{ background: P.accent }} />}{f && <span title="Protection window" className="h-1.5 w-1.5 rounded-full" style={{ background: P.likely }} />}{missed && <span title="Another card earns more" className="h-1.5 w-1.5 rounded-full" style={{ background: P.info }} />}</span>}
          <span className="text-[16px] font-medium tabular-nums" style={{ color: neg ? P.accent : P.ink }}>{fmt(t.amount_cents / 100)}</span>
          <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke={P.faint} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}><path d="M1 1l6 6-6 6" /></svg>
        </div>
      </button>
      {open && <div className="space-y-1.5 px-5 pb-4 pl-[80px] text-[13px] leading-5" style={{ color: P.muted }}>
        <div>Statement shows “{t.merchant_raw}”</div>
        {t.kind === 'purchase' && <div className="flex flex-wrap items-center gap-2">Category: {cat ? catName(cat) + ' (' + catSourceLabel(fp.level) + ')' : 'not recognized yet'}{st && <CategoryChange norm={t.merchant_normalized} current={cat} level={fp && fp.level} st={st} call={call} refresh={refresh} />}</div>}
        {missed && <div style={{ color: P.info }}>{acctLabel(missed.topAcct, cards)} would have earned {missed.low === missed.high ? fmt(missed.high) : 'up to ' + fmt(missed.high)} more</div>}
        {f && <div style={{ color: P.likely }}>{jparse(f.data).label}{jparse(f.data).until ? ' until ' + fmtDate(jparse(f.data).until) : ''} · {f.claim_packet ? 'claim packet ready in Review' : f.tier === 'possible' ? 'confirm the item in Review' : 'add the receipt in Review'}</div>}
        <div>{linked ? 'Receipt or order email attached' : 'No receipt attached'}</div>
      </div>}
    </div>
  );
}
function RemoveCard({ a, cards, n, call, refresh, onBack }) {
  const P = usePal(); const [ask, setAsk] = React.useState(false); const [busy, setBusy] = React.useState(false); const [err, setErr] = React.useState(null);
  const bank = a.source === 'plaid';
  const go = async () => { setBusy(true); setErr(null); try { await call('DELETE', '/v1/accounts/' + a.id); await refresh(); onBack && onBack(); } catch (e) { setErr(e.message); setBusy(false); } };
  if (!ask) return <div className="mt-3 flex justify-end"><button className="text-[12.5px] font-medium" style={{ color: P.muted }} onClick={() => setAsk(true)}>Remove from wallet</button></div>;
  return (
    <div className="mt-3 rounded-2xl p-4 text-[13px]" style={{ background: P.sunk }}>
      <div className="font-medium" style={{ color: P.ink }}>Remove {acctLabel(a, cards)}?</div>
      <Muted className="mt-1 text-[12.5px] leading-5">{n ? `Its ${n} transaction${n === 1 ? '' : 's'} and their findings are removed too. ` : ''}{bank ? 'Benny+ also stops importing it from your bank (if it’s the last card on that connection, the connection is closed). ' : ''}Receipts you added stay.</Muted>
      <div className="mt-3 flex gap-2"><Btn small kind="primary" disabled={busy} onClick={go}>{busy ? 'Removing…' : 'Remove'}</Btn><Btn small onClick={() => setAsk(false)}>Keep</Btn></div>
      {err && <div className="mt-2" style={{ color: P.danger }}>{err}</div>}
    </div>
  );
}
function CardDetail({ a, st, cards, rules, E, feed, roles, onBack, onOpenPolicy, call, refresh }) {
  const P = usePal(); const ref = React.useRef(null); const [w, setW] = React.useState(420); const [importing, setImporting] = React.useState(false); const [roleBusy, setRoleBusy] = React.useState(false);
  React.useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(es => setW(es[0].contentRect.width)); ro.observe(el); return () => ro.disconnect(); }, []);
  const card = a.product_confirmed ? cards[a.product_id] : null;
  const tx = st.purchases.filter(t => t.account_id === a.id).sort((x, y) => (y.posted_on || '').localeCompare(x.posted_on || ''));
  const fpById = Object.fromEntries((feed ? feed.purchases : []).map(p => [p.id, p])); const missedById = Object.fromEntries((feed ? feed.missed : []).map(x => [x.p.id, x]));
  const linked = new Set((st.evidence || []).filter(e => e.subject_type === 'link' && e.strength === 'confirmed').map(e => e.subject_id));
  const findings = (st.findings || []).filter(f => f.account_id === a.id && (f.type === 'protection' || f.type === 'claim'));
  const cs = (st.credit_status || []).filter(x => x.account_id === a.id).map(x => ({ ...x, d: jparse(x.data) }));
  const owed = cs.filter(x => x.state === 'unknown' && x.d.days_left >= 0).reduce((s, x) => s + x.d.amount_cents, 0) / 100;
  const inner = Math.max(0, w - 40); const wide = inner >= 860; const gap = 40; const col = wide ? (inner - gap) / 2 : inner;
  const cardW = Math.min(col, 460); const art = (card && card.art) || {};
  const cardBlock = <div className="flex justify-center" style={{ filter: card ? `drop-shadow(0 18px 34px ${art.from || '#000'}66)` : 'none' }}><BigCard card={card} acct={a} w={cardW} roles={card ? (roles || {})[a.product_id] : []} front /></div>;
  const removeBox = !a.sample && <RemoveCard a={a} cards={cards} n={tx.length} call={call} refresh={refresh} onBack={onBack} />;
  const role = feed && feed.roleOf ? feed.roleOf[a.id] : null;
  const setRole = async r => { if (!call || roleBusy) return; setRoleBusy(true); try { await call('POST', '/v1/accounts/' + a.id, { role: r }); await refresh(); } catch (e) { console.warn(e); } setRoleBusy(false); };
  const roleBox = card && !a.sample && !a.virtual && role && <div className="mt-5 flex flex-wrap items-center gap-2 text-[13px]" style={{ color: P.muted }}>
    <span>This card:</span>
    {[['held', 'I have it'], ['trying', 'Just trying it']].map(([k, t]) => <button key={k} type="button" disabled={roleBusy || (a.source === 'plaid' && k === 'trying')} onClick={() => role !== k && setRole(k)}
      className="rounded-full px-3 py-1 text-[12.5px] font-medium" style={role === k ? { background: P.accent, color: P.accentInk, border: `1px solid ${P.accent}` } : { color: P.ink, border: `1px solid ${P.lineStrong}`, opacity: a.source === 'plaid' && k === 'trying' ? 0.4 : 1 }}>{t}</button>)}
    {role === 'trying' && <span className="basis-full text-[12.5px] leading-5">Not counted in your totals or credits. If you have it, connect it with Plaid in Wallet for its real transactions.</span>}
  </div>;
  const policy = <>
    {roleBox}
    {!card && <div className="mt-5"><AccountConfirm account={a} cards={cards} call={call} onDone={refresh} accounts={typeof st !== 'undefined' && st ? st.accounts : null} /></div>}
    {card && <div className="mt-6 overflow-hidden rounded-[28px]" style={{ background: P.surface, border: `1px solid ${P.line}` }}>
      <button onClick={() => onOpenPolicy(a.id)} className="flex w-full items-center gap-4 px-5 py-4 text-left">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: P.accent, color: P.accentInk }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></svg></span>
        <div className="min-w-0 flex-1"><div className="text-[16px] font-semibold" style={{ color: P.ink }}>Card policy</div><div className="flex items-center gap-3 text-[12.5px]" style={{ color: P.muted }}><span className="flex items-center gap-1"><Ico name="gift" size={13} />{(card.credits || []).filter(c => c.amountUsd != null).length} credits</span><span className="flex items-center gap-1"><Ico name="shield" size={13} />{(card.protections || []).length} protections</span></div></div>
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke={P.faint} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l6 6-6 6" /></svg>
      </button>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-[13px]" style={{ borderTop: `1px solid ${P.line}`, color: P.muted }}>
        <span><b className="tabular-nums" style={{ color: P.ink }}>{fmt(owed)}</b> credits left</span>
        <span><b className="tabular-nums" style={{ color: P.ink }}>{findings.length}</b> protected</span>
        {!a.sample && <button className="ml-auto inline-flex items-center gap-1 font-medium" style={{ color: P.accent }} onClick={() => setImporting(v => !v)}><Ico name="receipt" size={13} />Upload statement</button>}
      </div>
    </div>}
    {importing && <div className="mt-4"><Importer accounts={[a]} cards={cards} defaultAccountId={a.id} call={call} onCancel={() => setImporting(false)} onDone={async () => { setImporting(false); await refresh(); }} /></div>}
    {removeBox}
  </>;
  const earns = card ? <EarnList card={card} /> : null;
  const txs = <>
    <h3 className="mb-3 mt-9 text-[26px] font-bold tracking-tight" style={{ color: P.ink }}>Latest Transactions</h3>
    <div className="overflow-hidden rounded-[28px]" style={{ background: P.surface, border: `1px solid ${P.line}` }}>
      {tx.length === 0 && <div className="px-5 py-8 text-center text-[13px]" style={{ color: P.muted }}>No transactions on this card yet. Connect your bank or upload a statement.</div>}
      {tx.slice(0, 100).map((t, i) => <TxRow key={t.id} t={t} fp={fpById[t.id]} findings={findings} linked={linked.has(t.id)} missed={missedById[t.id]} first={i === 0} cards={cards} st={st} call={call} refresh={refresh} />)}
    </div>
    {tx.length > 0 && <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px]" style={{ color: P.muted }}>
      {[[P.accent, 'receipt attached'], [P.likely, 'protection window'], [P.info, 'another card earns more']].map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />{l}</span>)}</div>}
  </>;
  const back = <button onClick={onBack} className="mb-5 flex items-center gap-1.5 text-[14px] font-medium" style={{ color: P.accent }}><svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1L1 7l6 6" /></svg>Wallet</button>;
  return (
    <div ref={ref} className="mx-auto w-full max-w-[1100px] px-5 py-6">
      {back}
      {wide
        ? <div className="grid items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', columnGap: gap }}>
            <div className="min-w-0">{cardBlock}{policy}{txs}</div>
            <div className="min-w-0">{earns}</div>
          </div>
        : <div className="mx-auto max-w-[560px]">{cardBlock}{policy}{earns && <div className="mt-9">{earns}</div>}{txs}</div>}
    </div>
  );
}

function PolicySheet({ a, st, cards, rules, E, call, refresh, onClose, roles }) {
  const P = usePal(); const card = a && a.product_confirmed ? cards[a.product_id] : null; const [importing, setImporting] = React.useState(false); const [confirmRm, setConfirmRm] = React.useState(false); const [busy, setBusy] = React.useState(false);
  roles = roles || {}; const { ref: sheetRef, onKeyDown } = useSheetFocus(onClose);
  if (!a) return null;
  const n = st.purchases.filter(t => t.account_id === a.id).length;
  return (
    <div className="absolute inset-0 z-40 flex justify-end" style={{ background: dark(P) ? 'rgba(0,0,0,0.45)' : 'rgba(22,36,28,0.22)' }} onClick={onClose}>
      <div ref={sheetRef} tabIndex={-1} onKeyDown={onKeyDown} className="h-full w-full max-w-[560px] overflow-y-auto px-6 pb-10 pt-5 outline-none" style={{ background: P.bg, borderLeft: `1px solid ${P.line}`, boxShadow: '-20px 0 40px -24px rgba(0,0,0,0.35)' }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Card policy">
        <div className="flex items-center justify-between gap-3"><Label>Card policy</Label>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full" style={{ border: `1px solid ${P.lineStrong}`, color: P.muted }}><svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2 2l8 8M10 2l-8 8" /></svg></button></div>
        <div className="mt-4 flex justify-center"><BigCard card={card} acct={a} w={340} roles={card ? roles[a.product_id] : []} front /></div>
        {card ? <CardBenefits a={a} card={card} st={st} cards={cards} call={call} refresh={refresh} roles={roles[a.product_id]} onImport={() => setImporting(v => !v)} onRemoveAsk={() => setConfirmRm(true)} />
          : <div className="mt-5"><AccountConfirm account={a} cards={cards} call={call} onDone={refresh} accounts={typeof st !== 'undefined' && st ? st.accounts : null} /></div>}
        {confirmRm && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl p-3 text-[13px]" style={{ background: P.sunk }}><span className="flex-1">Remove {acctLabel(a, cards)}{n ? ` and its ${n} transactions` : ''}?</span>
          <Btn small disabled={busy} onClick={async () => { setBusy(true); try { await call('DELETE', '/v1/accounts/' + a.id); await refresh(); onClose(); } finally { setBusy(false); } }}>Remove</Btn><Btn small onClick={() => setConfirmRm(false)}>Keep</Btn></div>}
        {importing && <div className="mt-4"><Importer accounts={[a]} cards={cards} defaultAccountId={a.id} call={call} onCancel={() => setImporting(false)} onDone={async () => { setImporting(false); await refresh(); }} /></div>}
      </div>
    </div>
  );
}
function Wallet({ st, cards, rules, E, feed, call, refresh, onOpenPolicy, cardId, onOpenCard, onCloseCard, roles }) {
  const P = usePal();
  const [adding, setAdding] = React.useState(false); const [note, setNote] = React.useState(null); const [busy, setBusy] = React.useState(null);
  const [front, setFront] = React.useState(null); const [sheet, setSheet] = React.useState(false); const [choose, setChoose] = React.useState(null);
  const demo = (st.accounts || []).some(a => a.sample);
  const plaid = usePlaidConnect(call, refresh, demo);
  const testMode = demo || st.plaid_env === 'sandbox';
  const held = heldProducts(st.accounts);
  const act = async (key, fn, done) => { setBusy(key); setNote(null); try { const r = await fn(); if (done) setNote(done(r)); await refresh(); } catch (e) { setNote('Error: ' + e.message); } setBusy(null); };
  const frontId = st.accounts.some(a => a.id === front) ? front : (st.accounts[st.accounts.length - 1] && st.accounts[st.accounts.length - 1].id);
  const detail = cardId && st.accounts.find(a => a.id === cardId);
  if (detail) return <CardDetail a={detail} st={st} cards={cards} rules={rules} E={E} feed={feed} roles={roles} onBack={onCloseCard} onOpenPolicy={onOpenPolicy} call={call} refresh={refresh} />;
  const toggleCard = pid => { const name = (cards[pid] && cards[pid].name) || 'Card';
    if (!held.has(pid)) { setNote(null); setChoose(pid); return; }   // ask: just compare, or connect it through the bank
    const mine = st.accounts.filter(x => x.product_id === pid && x.product_confirmed && !x.sample);
    if (mine.some(x => x.source === 'plaid')) { setNote(`You already have ${name} through your bank connection, so it can’t be added again.`); return; }
    const a = mine.find(x => x.source === 'manual'); if (!a) return;
    if (st.purchases.some(p => p.account_id === a.id)) { setNote(`${name} has purchases, so it wasn’t removed here. Open the card and use Remove.`); return; }
    act('rm', () => call('DELETE', '/v1/accounts/' + a.id), () => `Removed ${name}.`); };
  const sources = sourceSummary(st);
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0"><h2 className="text-[34px] font-semibold leading-tight tracking-tight" style={{ fontFamily: SERIF, color: P.ink }}>Wallet</h2></div>
        <div className="flex flex-wrap items-start gap-2 sm:pt-1.5">
          <Btn kind={adding ? undefined : 'primary'} onClick={() => { if (demo) { setNote('These are sample cards. Exit the demo (banner above) to add your own.'); return; } setAdding(v => !v); }}>{adding ? 'Done' : '+ Add card'}</Btn>
          <div className="flex flex-col items-center"><Btn disabled={plaid.busy || !call} onClick={plaid.connect}>{plaid.busy ? 'Connecting…' : 'Connect with Plaid'}</Btn>
            {testMode && plaid.busy && <span className="mt-1 text-[10.5px] leading-none" style={{ color: P.faint }}>test login: user_good / pass_good</span>}</div>
          <Btn onClick={() => setSheet(true)}>Other connections</Btn>
        </div>
      </div>
      {plaid.msg && <div className="mt-3 text-[13px]" role="status" style={{ color: plaid.msg.ok ? P.accent : P.danger }}>{plaid.msg.text}</div>}
      {adding && choose && cards[choose] && (() => { const cd = cards[choose]; const nm = cd.short || cd.name; return (
        <div className="mt-6 rounded-2xl p-4" role="dialog" aria-label={`Add ${nm}`} style={{ background: P.accentSoft, border: `1px solid ${P.accent}` }}>
          <div className="text-[15px] font-semibold" style={{ color: P.ink }}>Add {nm}</div>
          <Muted className="mt-0.5 text-[12.5px] leading-5">Just compare shows its benefits and what each purchase would earn. Connect with Plaid also brings in its real transactions from {cd.issuer}; the bank account joins this card, so it isn’t listed twice.</Muted>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn small disabled={!!busy} onClick={() => { setChoose(null); act('add', () => call('POST', '/v1/accounts', { product_id: choose }), () => `Added ${nm} to compare. Tap it again to remove it.`); }}>Just compare</Btn>
            <Btn small kind="primary" disabled={!!busy || plaid.busy} onClick={async () => { const pid = choose; setChoose(null); await act('add', () => call('POST', '/v1/accounts', { product_id: pid }), () => `Added ${nm}. In Plaid’s window choose ${cd.issuer}.`); plaid.connect(); }}>Connect with Plaid</Btn>
            <Btn small kind="quiet" onClick={() => setChoose(null)}>Cancel</Btn>
          </div>
        </div>); })()}
      {adding && <div className="mt-6"><Panel><CardPicker cards={Object.values(cards)} selected={choose ? new Set([...held, choose]) : held} onToggle={toggleCard} /></Panel></div>}
      {note && <div className="mt-4 text-[13px]" role="status" style={{ color: note.startsWith('Error') ? P.danger : P.accent }}>{note}</div>}
      <div className="mt-8 flex flex-wrap items-start gap-10">
        <div className="min-w-[260px] flex-[1_1_340px]">
          {st.accounts.length ? <WalletStack accounts={st.accounts} cards={cards} front={frontId} rolesByCard={roles} onPick={(id, isFront) => { if (isFront) onOpenCard(id); else setFront(id); }} />
            : <div className="flex flex-col items-center justify-center rounded-2xl px-6 py-14 text-center" style={{ border: `1.5px dashed ${P.lineStrong}` }}><div className="text-[15px] font-semibold">Your wallet is empty</div><Muted className="mt-1 text-[13px]">Add the cards you carry. Card products only, never card numbers.</Muted><div className="mt-4"><Btn kind="primary" small onClick={() => setAdding(true)}>Add a card</Btn></div></div>}
          {st.accounts.length > 0 && <Muted className="mt-5 text-center text-[12px]">Tap a card to open it</Muted>}
        </div>
        <div className="min-w-[300px] flex-[1.25_1_420px] space-y-4">
          <div className="rounded-3xl px-6 pb-2 pt-5" style={{ background: P.surface, border: `1px solid ${P.line}` }}>
            <div className="flex items-center gap-1.5 text-[20px] font-semibold tracking-tight" style={{ fontFamily: SERIF }}>Card policies<InfoTip align="left">Pulled from each issuer’s own pages and checked word for word. The rules every result uses.</InfoTip></div>
            <div className="mt-2">{st.accounts.length === 0 && <Muted className="py-5 text-[13px]">Add a card to see its policy.</Muted>}
              {st.accounts.map((a, i) => <PolicyRow key={a.id} a={a} card={a.product_confirmed ? cards[a.product_id] : null} roles={roles[a.product_id]} first={i === 0} trying={!!(feed && feed.roleOf && feed.roleOf[a.id] === 'trying')} onOpen={() => onOpenPolicy(a.id)} />)}</div>
          </div>
          <button type="button" onClick={() => setSheet(true)} className="flex w-full items-center gap-3 rounded-2xl px-5 py-3.5 text-left" style={{ background: P.surface, border: `1px solid ${P.line}` }} aria-label="Where your purchases come from. Open other connections.">
            <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold" style={{ color: P.ink }}>Where your purchases come from</div>
              <div className="truncate text-[12.5px]" style={{ color: P.muted }}>{sources.length ? sources.join(' · ') : demo ? 'Sample purchases (demo). Exit the demo to connect your own.' : 'Nothing connected yet. Use Connect with Plaid or Other connections above.'}</div></div>
            <svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke={P.faint} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6" /></svg>
          </button>
        </div>
      </div>
      {sheet && <ConnectionsSheet st={st} cards={cards} rules={rules} E={E} call={call} refresh={refresh} onClose={() => setSheet(false)} />}
    </div>
  );
}

/* ---------- blueprint ---------- */
const BP = {
  principle: 'Agents propose, evidence decides. AI reads receipts, proposes matches, reads statement credits and suggests categories; fixed checks and your taps are the only way anything becomes confirmed. Every number shown traces back to stored evidence.',
  tiers: [
    ['Private records', 'Benny+ API, server-side', 'Accounts, purchases, documents, evidence, credit status, findings. Every endpoint checks the signed-in user and scopes every query to them; another user’s ids return not found. Firebase holds nothing private.'],
    ['Secrets', 'Server only', 'Plaid keys used through Mana’s proxy; Plaid access tokens encrypted at rest. Logs hold no amounts, merchants or tokens (the privacy test checks the log files).'],
    ['Rules + engine', 'Pinned inside Benny+', 'Snapshot of 21 cards built from saved Bright Data pages. A rule is kept only if its quote appears word for word in the saved page. Version and SHA-256 are checked on load.'],
  ],
  order: [
    ['1. Data model, server-side auth, A/B privacy test', 'built', '15 privacy checks pass on the public URL, including log files.'],
    ['2. Plaid Sandbox, CSV import (preview, column mapping, dedupe, undo), card accounts', 'built', ''],
    ['3. Intake agent, Linker agent, link confirm', 'built', 'Email (.eml or pasted) and receipt photos. Gmail inbox import is later.'],
    ['4. Review queue, coverage-based empty state, invariant check', 'built', ''],
    ['5. Pinned rules snapshot + word-for-word quote verify', 'built', '169 rules accepted, 2 rejected and logged.'],
    ['6. Findings tiers, credit status per account, credit reader, claim packet', 'built', ''],
    ['7. Benny+ bundling and self-check', 'built', 'Reads only its own subtree. View-only link sharing is on for apps/benny-plus; the rest of the workspace stays private.'],
    ['8. Shopping and location advice', 'later', 'Cut first.'],
  ],
  tests: [['B requesting A’s records gets 404', 'pass'], ['$400 Best Buy: “Possibly covered”, no claim button; after the email + confirmed link + confirmed item, the claim packet appears', 'pass'], ['DoorDash: “Looks like you used it”, not recovered; “Credit posted ✓” after the credit transaction', 'pass'], ['Unrecognized merchant never shows “all optimal”', 'pass'], ['Two Sapphire accounts: separate credit statuses and totals', 'pass'], ['Same month by CSV and Plaid: one record each; undo CSV leaves Plaid', 'pass'], ['Rule quote not in the saved page is rejected', 'pass'], ['Share link works from a fresh account without Benny access (simulated; real second account pending)', 'ready'], ['Invariant check passes on the full dataset', 'pass']],
};
function Blueprint({ st, check }) {
  const P = usePal(); const c = s => s === 'built' || s === 'pass' ? P.accent : s === 'ready' || s === 'next' ? P.likely : P.faint;
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8">
      <Label>Blueprint · final plan</Label>
      <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight" style={{ fontFamily: SERIF }}>Agents propose, evidence decides.</h2>
      <Muted className="mt-2 text-[14px] leading-6">{BP.principle}</Muted>
      <div className="mt-4 space-y-1 text-[13px]">
        {check && <div style={{ color: check.ok ? P.accent : P.danger }}>Self-check: {check.text}</div>}
        {st && st.invariants && <div style={{ color: st.invariants.ok ? P.accent : P.danger }}>Invariant check on your data: {st.invariants.ok ? 'passing' : st.invariants.failures.length + ' failing'} · last run {new Date(st.invariants.at).toLocaleString()}</div>}
      </div>
      <section className="mt-8"><Label>Where things live</Label>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">{BP.tiers.map(([t, w, d]) => <div key={t} style={{ borderTop: `1px solid ${P.lineStrong}`, paddingTop: 12 }}><div className="text-[14px] font-semibold">{t}</div><div className="mt-0.5 text-[12px]" style={{ color: P.accent }}>{w}</div><Muted className="mt-2 text-[13px] leading-5">{d}</Muted></div>)}</div></section>
      <section className="mt-10"><Label>Build order</Label><div className="mt-3">{BP.order.map(([t, s, d]) => <div key={t} className="py-3" style={{ borderTop: `1px solid ${P.line}` }}><div className="flex items-center justify-between gap-3 text-[14px] font-medium"><span>{t}</span><span className="text-[11px] font-semibold" style={{ color: c(s) }}>{s}</span></div>{d && <Muted className="mt-0.5 text-[13px] leading-5">{d}</Muted>}</div>)}</div></section>
      <section className="mt-10"><Label>Acceptance tests</Label><div className="mt-3">{BP.tests.map(([t, s]) => <div key={t} className="flex items-center justify-between gap-3 py-2.5 text-[14px]" style={{ borderTop: `1px solid ${P.line}` }}><span>{t}</span><span className="text-[11px] font-semibold" style={{ color: c(s) }}>{s}</span></div>)}</div></section>
    </div>
  );
}

/* ---------- Shop: built-in browser + wallet rail. The page is read by AI; the pinned engine picks the card. ---------- */
// The browser runs in EACH USER'S OWN Mana sandbox ('benny-shop' service, installed per user from app/shop-kit into
// <uid>/file-system/benny-shop and run there via POST /run). It serves only that user, uses their own sign-ins, and can
// fill a saved card into the checkout form. Card details are encrypted in the user's own sandbox and never come back to
// any browser. Benny+ never clicks Place order or pays; the user does.
/* generic store list removed: the Shop links are the partner sites of the wallet's credits (BP_PARTNERS) */
/* Partner sites: where a card credit in the viewer's wallet actually applies (from the rules' credit merchants). */
const BP_PARTNERS = [
  { id: 'doordash', name: 'DoorDash', urls: ['https://www.doordash.com/'], kind: 'Food and grocery delivery', keys: ['doordash'] },
  { id: 'chase-travel', name: 'Chase Travel', urls: ['https://www.chase.com/personal/travel', 'https://travelsecure.chase.com/'], kind: 'Chase’s travel site · sign in with Chase', keys: ['chase travel', 'the edit'] },
  { id: 'opentable', name: 'OpenTable', urls: ['https://www.opentable.com/'], kind: 'Restaurant reservations', keys: ['opentable', 'sapphire reserve exclusive tables'] },
  { id: 'trusted-traveler', name: 'Global Entry or TSA PreCheck', urls: ['https://ttp.dhs.gov/'], kind: 'One credit covers either application fee', keys: ['global entry', 'nexus', 'tsa precheck'] },
  { id: 'instacart', name: 'Instacart', urls: ['https://www.instacart.com/'], kind: 'Grocery delivery', keys: ['instacart'] },
  { id: 'uber', name: 'Uber', urls: ['https://www.uber.com/'], kind: 'Rides and Uber Eats', keys: ['uber'] },
  { id: 'uber-one', name: 'Uber One', urls: ['https://www.uber.com/us/en/u/uber-one/'], kind: 'Uber membership', keys: ['uber one'] },
  { id: 'lyft', name: 'Lyft', urls: ['https://www.lyft.com/'], kind: 'Rides', keys: ['lyft'] },
  { id: 'united-hotels', name: 'United Hotels', urls: ['https://hotels.united.com/'], kind: 'United’s hotel booking site', keys: ['united hotels'] },
  { id: 'disneyplus', name: 'Disney+', urls: ['https://www.disneyplus.com/'], kind: 'Streaming', keys: ['disneyplus com', 'disney bundle', 'disney cinema'] },
  { id: 'hulu', name: 'Hulu', urls: ['https://www.hulu.com/'], kind: 'Streaming', keys: ['hulu com', 'hulu'] },
  { id: 'espn', name: 'ESPN+', urls: ['https://www.espn.com/espnplus/'], kind: 'Streaming', keys: ['stream espn com', 'espn'] },
  { id: 'grubhub', name: 'Grubhub', urls: ['https://www.grubhub.com/'], kind: 'Food delivery', keys: ['grubhub'] },
  { id: 'seamless', name: 'Seamless', urls: ['https://www.seamless.com/'], kind: 'Food delivery', keys: ['seamless'] },
  { id: 'bww', name: 'Buffalo Wild Wings', urls: ['https://www.buffalowildwings.com/'], kind: 'Restaurant', keys: ['buffalo wild wings'] },
  { id: 'five-guys', name: 'Five Guys', urls: ['https://www.fiveguys.com/'], kind: 'Restaurant', keys: ['five guys'] },
  { id: 'cheesecake', name: 'The Cheesecake Factory', urls: ['https://www.thecheesecakefactory.com/'], kind: 'Restaurant', keys: ['the cheesecake factory'] },
  { id: 'wonder', name: 'Wonder', urls: ['https://www.wonder.com/'], kind: 'Food delivery', keys: ['wonder'] },
  { id: 'resy', name: 'Resy', urls: ['https://resy.com/'], kind: 'Restaurant reservations', keys: ['resy'] },
  { id: 'dunkin', name: 'Dunkin’', urls: ['https://www.dunkindonuts.com/'], kind: 'Coffee', keys: ['dunkin'] },
  { id: 'amex-travel', name: 'American Express Travel', urls: ['https://www.americanexpress.com/en-us/travel/'], kind: 'Amex’s travel site · Fine Hotels + Resorts', keys: ['fine hotels resorts', 'the hotel collection', 'american express travel'] },
  { id: 'clear', name: 'CLEAR+', urls: ['https://www.clearme.com/'], kind: 'Airport security membership', keys: ['clear'] },
  { id: 'nyt', name: 'The New York Times', urls: ['https://www.nytimes.com/subscription'], kind: 'News subscription', keys: ['the new york times'] },
  { id: 'paramount', name: 'Paramount+', urls: ['https://www.paramountplus.com/'], kind: 'Streaming', keys: ['paramount'] },
  { id: 'peacock', name: 'Peacock', urls: ['https://www.peacocktv.com/'], kind: 'Streaming', keys: ['peacock'] },
  { id: 'wsj', name: 'The Wall Street Journal', urls: ['https://www.wsj.com/'], kind: 'News subscription', keys: ['the wall street journal'] },
  { id: 'yt-premium', name: 'YouTube Premium', urls: ['https://www.youtube.com/premium'], kind: 'Streaming', keys: ['youtube premium'] },
  { id: 'yt-tv', name: 'YouTube TV', urls: ['https://tv.youtube.com/'], kind: 'Streaming', keys: ['youtube tv'] },
  { id: 'lululemon', name: 'lululemon', urls: ['https://shop.lululemon.com/'], kind: 'Clothing', keys: ['lululemon'] },
  { id: 'walmart-plus', name: 'Walmart+', urls: ['https://www.walmart.com/plus'], kind: 'Walmart membership', keys: ['walmart'] },
  { id: 'oura', name: 'Oura', urls: ['https://ouraring.com/'], kind: 'Oura Ring', keys: ['oura ring'] },
  { id: 'citi-travel', name: 'Citi Travel', urls: ['https://www.cititravel.com/'], kind: 'Citi’s travel site', keys: ['cititravel com'] },
];
const BP_PERIOD = { monthly: 'a month', quarterly: 'a quarter', semiannual: 'every 6 months', annual: 'a year' };
const bpPartnerFor = token => { const t = mnorm(token); return BP_PARTNERS.find(p => p.keys.includes(t)) || null; };
function bpPartnerOffers(rules, st) {
  const byPartner = {}; const general = [];
  const accts = (st && st.accounts || []).filter(a => a.product_id && a.product_confirmed && rules.cards[a.product_id]);
  const status = {}; for (const s of (st && st.credit_status) || []) status[s.account_id + '|' + s.credit_id] = s;
  for (const a of accts) {
    const card = rules.cards[a.product_id];
    for (const cr of card.credits || []) {
      if (cr.amountUsd == null) continue;
      const names = (cr.merchantNames || []).filter(Boolean); const ids = ((cr.match && cr.match.merchants) || []).map(x => String(x).replace(/-/g, ' '));
      const tokens = names.length ? names : ids;
      const s = status[a.id + '|' + cr.id]; const d = s ? jparse(s.data) : {};
      const offer = { acct: a, card, credit: cr, amount: cr.amountUsd, period: cr.period, activation: !!cr.requiresActivation, state: s ? s.state : 'unknown', daysLeft: d.days_left != null ? d.days_left : null };
      const ps = [...new Set(tokens.map(bpPartnerFor).filter(Boolean))];
      if (!ps.length) { general.push(offer); continue; }
      for (const p of ps) (byPartner[p.id] = byPartner[p.id] || { partner: p, offers: [] }).offers.push(offer);
    }
  }
  const usable = o => o.state === 'unknown';   // not used this period, not expired, not already posted
  const list = Object.values(byPartner).map(x => ({ ...x, usable: x.offers.filter(usable).sort((a, b) => b.amount - a.amount), readyUsd: x.offers.filter(usable).reduce((t, o) => t + o.amount, 0) }))
    .sort((a, b) => (b.readyUsd > 0) - (a.readyUsd > 0) || b.readyUsd - a.readyUsd || a.partner.name.localeCompare(b.partner.name));
  return { list, general };
}
function bpOfferStatus(o) {
  if (o.state === 'issuer_credit_observed') return { text: 'Credit posted', tone: 'accent' };
  if (o.state === 'user_confirmed') return { text: 'Used this period', tone: 'muted' };
  if (o.state === 'expired') return { text: 'Period ended', tone: 'muted' };
  if (o.state === 'qualifying_purchase_seen') return { text: 'Looks used', tone: 'muted' };
  if (o.activation) return { text: 'Turn it on first', tone: 'info' };
  return { text: o.daysLeft != null ? `Ready · ${o.daysLeft} day${o.daysLeft === 1 ? '' : 's'} left` : 'Ready to use', tone: 'accent' };
}

const BP_SHOP_NODE = 'benny-shop';
const BP_KIT_VERSION = 2;                    // shop-kit/version; a v1 personal service is updated in place when Shop connects
const BP_GOOGLE = 'https://www.google.com/';
const BP_BROKEN_TTL = 24 * 3600 * 1000;      // a partner that failed to load is hidden this long, then tried again
const BP_SEARCH_HOST_RE = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yandex\.[a-z]+|baidu\.com)$/i;
const bpIsSearchSite = u => BP_SEARCH_HOST_RE.test(bpHost(u));
/* Address bar: a URL or bare domain opens as is; anything else is a Google search. */
const bpToUrl = s => { s = String(s || '').trim(); if (!s) return BP_GOOGLE; if (/^https?:\/\//i.test(s)) return s; if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s)) return 'https://' + s; return 'https://www.google.com/search?q=' + encodeURIComponent(s); };
const BP_BROKEN_RE = /service unavailable|dns failure|access denied|403 forbidden|404 not found|page not found|bad gateway|gateway time-?out|this site can.t be reached|pardon our interruption|request blocked/i;
const BP_CHALLENGE_RE = /just a moment|verify (you are|you.re) human|are you a robot|captcha|before you continue|unusual traffic|consent/i;
/* How the main document loaded, from a /open or /tab reply: 'ok' | 'challenge' (consent / human check: leave it to the user) | 'broken'.
   Service v2 sends `load`; with a v1 service only the title and URL are available. */
function bpVerdict(info) {
  if (!info) return 'ok';
  const l = info.load;
  if (l && l.kind) return l.kind === 'challenge' ? 'challenge' : (l.ok === false ? 'broken' : 'ok');
  if (/^chrome-error:/.test(info.url || '')) return 'broken';
  if (BP_CHALLENGE_RE.test(info.title || '')) return 'challenge';
  if (BP_BROKEN_RE.test(info.title || '')) return 'broken';
  return 'ok';
}
const bpFriendly = e => { const k = e && e.code; if (k === 404) return 'No page is open yet. Pick a site or search first.'; if (k === 0) return 'Your shopping browser isn’t answering. Tap Repair if this keeps happening.'; if (k >= 500 || k === 400) return 'This page didn’t load, so there’s nothing to read. Try another site.'; return (e && e.message) || 'Something went wrong.'; };
function BpSwatch({ card, size = 10 }) { const P = usePal(); const a = (card && card.art) || {}; return <span aria-hidden="true" className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: `linear-gradient(135deg, ${a.from || P.sunk}, ${a.to || P.sunk})`, boxShadow: `0 0 0 1px ${P.line}` }} />; }
/* Partner pill: site · one swatch + credit amount per card in the wallet whose credit applies there. */
function BpPill({ entry, cards, on, hi, disabled, onClick }) {
  const P = usePal(); const { partner: s, usable } = entry;
  const needsOn = usable.length > 0 && usable.every(o => o.activation);
  const hiCard = hi && cards[hi.product_id]; const hiColor = hiCard && hiCard.art ? hiCard.art.from : P.accent;
  const title = s.name + ': ' + usable.map(o => `${fmt0(o.amount)} ${BP_PERIOD[o.period] || ''} on ${acctLabel(o.acct, cards)}${o.activation ? ' (turn it on first)' : ''}`).join('; ');
  const style = on ? { background: P.accent, color: P.accentInk, border: `1px solid ${P.accent}` } : hi ? { background: P.surface, color: P.ink, border: `1px solid ${hiColor}`, boxShadow: `0 0 0 2px ${hiColor}33` } : { color: P.muted, border: `1px solid ${P.line}` };
  return (
    <button type="button" data-bp-pill="1" disabled={disabled} onClick={onClick} title={title} aria-pressed={on} className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium" style={style}>
      <span>{s.name}</span>
      {usable.map((o, k) => <span key={k} className="flex items-center gap-1"><span style={{ opacity: 0.5 }}>·</span><BpSwatch card={o.card} /><span className="tabular-nums">{fmt0(o.amount)}</span><span style={{ opacity: on ? 0.85 : 0.75 }}>{o.card.short || o.card.name}</span></span>)}
      {needsOn && <span className="rounded-full px-1.5 text-[10.5px] font-semibold" style={on ? { background: 'rgba(255,255,255,0.22)', color: P.accentInk } : { background: P.infoSoft, color: P.info }}>turn on first</span>}
    </button>
  );
}
/* The permanent first pill: Google, the browser's home. Same shape as the partner pills; never touches the card stack. */
function BpHomePill({ on, disabled, onClick }) {
  const P = usePal();
  const style = on ? { background: P.accent, color: P.accentInk, border: `1px solid ${P.accent}` } : { color: P.muted, border: `1px solid ${P.line}` };
  return (
    <button type="button" data-bp-home="1" disabled={disabled} onClick={onClick} title="Back to Google" aria-label="Google, the shopping home page" aria-pressed={on} className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium" style={style}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" /></svg>
      <span>Google</span>
    </button>
  );
}
const BP_CHECKOUT_RE = /(cart|basket|checkout|check-out|\/buy\/|\/bag\b|payment|place-?order|review-?(trip|order)|purchase|booking|reservation|trip-?summary|thank-?you|confirmation|order-?(placed|received|details|confirm))/i;
const bpHost = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
const bpKey = u => (u || '').split('#')[0];
const bpCheckoutish = (url, title) => BP_CHECKOUT_RE.test(url || '') || /\b(cart|checkout|basket|review your order|place your order|order confirmation|thank you)\b/i.test(title || '');
const BP_SHOP_CATS = ['dining', 'grocery', 'online_grocery', 'gas', 'ev_charging', 'airline', 'hotel', 'car_rental', 'travel', 'rideshare', 'transit', 'streaming', 'drugstore', 'online', 'department', 'wholesale', 'electronics', 'home_improvement', 'home', 'other'];

function bpPagePrompt(pg) {
  return 'You read the text of a web page the shopper has open in an in-app browser, to help them choose which of their own credit cards to use. Return only JSON: ' +
    '{"readable": boolean, "pageType": "product"|"cart"|"checkout"|"confirmation"|"other", "merchant": string|null, "amount": number|null, "amountKind": "total"|"subtotal"|"price"|null, "currency": string|null, ' +
    '"category": ' + JSON.stringify(BP_SHOP_CATS.join('|')) + ', "bookedDirect": boolean|null, "physicalGoods": boolean|null, "items": [{"name": string, "price": number|null}], "orderNumber": string|null, "summary": string, "evidence": string[]}. ' +
    'Page URL: ' + (pg.url || '') + '. Page title: ' + (pg.title || '') + '. ' +
    'merchant is the business running the site (Amazon for amazon.com, Alaska Airlines for alaskaair.com). category describes that business, never the products; a department store selling food is still department. ' +
    'amount: order total on a checkout or confirmation page, cart subtotal on a cart (amountKind subtotal), main product price on a product page (amountKind price). Ignore ads, related products, gift card offers, credit card sign-up offers and savings banners. ' +
    'bookedDirect is true on an airline or hotel’s own site, false on a travel booking site, else null. physicalGoods is true only for durable physical goods (not food, consumables, services, travel or subscriptions). items: up to 6 short names. ' +
    'readable is true for product, cart, checkout and confirmation pages, false for search results, home pages and sign-in pages. Use null rather than guessing. Never output card numbers or personal details.';
}
async function bpReadPage(gemUrl, pg) {
  if (!gemUrl) throw new Error('AI is still connecting. Try again in a moment.');
  const res = await fetch(gemUrl + '/models/gemini-3.8-flash:generateContent', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: bpPagePrompt(pg) }, { text: 'Page text:\n' + (pg.text || '') }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }) });
  if (res.status === 402) throw new Error('Out of Mana credits for AI reading.');
  if (!res.ok) throw new Error('The AI couldn’t read this page right now (' + res.status + ').');
  const j = await res.json(); const txt = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(p => p.text || '').join('');
  let o; try { o = JSON.parse(txt); } catch (e) { throw new Error('The AI response couldn’t be read.'); }
  const amount = typeof o.amount === 'number' && o.amount > 0 ? Math.round(o.amount * 100) / 100 : null;
  return {
    readable: o.readable !== false && !!(o.merchant || amount), pageType: ['product', 'cart', 'checkout', 'confirmation', 'other'].includes(o.pageType) ? o.pageType : 'other',
    merchant: typeof o.merchant === 'string' && o.merchant.trim() ? o.merchant.trim() : null, amount, amountKind: ['total', 'subtotal', 'price'].includes(o.amountKind) ? o.amountKind : null,
    currency: typeof o.currency === 'string' && /^[A-Za-z]{3}$/.test(o.currency) ? o.currency.toUpperCase() : 'USD',
    category: BP_SHOP_CATS.includes(o.category) ? o.category : 'other', bookedDirect: typeof o.bookedDirect === 'boolean' ? o.bookedDirect : null,
    physicalGoods: typeof o.physicalGoods === 'boolean' ? o.physicalGoods : null,
    items: Array.isArray(o.items) ? o.items.filter(i => i && i.name).slice(0, 6).map(i => ({ name: String(i.name).slice(0, 120), price: typeof i.price === 'number' ? i.price : null })) : [],
    orderNumber: typeof o.orderNumber === 'string' && o.orderNumber.trim() ? o.orderNumber.trim().slice(0, 40) : null,
    summary: typeof o.summary === 'string' ? o.summary : '', evidence: Array.isArray(o.evidence) ? o.evidence.filter(x => typeof x === 'string').slice(0, 4) : [],
  };
}
/* Merchant for the engine: the curated table first (by site, then by name), else the AI's category, labelled as a guess. */
function bpResolveMerchant(E, rules, ctx, host) {
  if (ctx.categoryOverride) return { m: { id: 'cat:' + ctx.categoryOverride, name: ctx.merchant || host, categories: [ctx.categoryOverride], confidence: 'low' }, how: 'you' };
  const site = host ? host.split('.').slice(-2, -1)[0] : '';
  const tries = [site ? site + ' com' : null, ctx.merchant ? ctx.merchant + ' online' : null, ctx.merchant, site].filter(Boolean);
  let first = null;
  for (const q of tries) { const r = E.findMerchant(rules.mcc, q).match; if (!r) continue; if ((r.categories || []).includes('online')) return { m: r, how: 'table' }; first = first || r; }
  if (first) return { m: first, how: 'table' };
  let cat = ctx.category || 'other';
  if ((cat === 'airline' || cat === 'hotel') && ctx.bookedDirect === false) cat = 'travel';
  return { m: { id: 'cat:' + cat, name: ctx.merchant || host || 'This store', categories: cat === 'airline' || cat === 'hotel' ? [cat, 'travel'] : [cat], confidence: 'low' }, how: 'ai' };
}

function BpStoreMark({ s, size = 34 }) { const P = usePal(); return <div aria-hidden="true" className="flex shrink-0 items-center justify-center font-semibold" style={{ width: size, height: size, borderRadius: size * 0.3, background: P.sunk, color: P.ink, fontSize: size * 0.44, fontFamily: SERIF }}>{s.mark}</div>; }

function ShopAdvice({ E, rules, st, cards, ctx, pageInfo, onEdit, onRecheck, onSave, saving, savedMsg }) {
  const P = usePal(); const [why, setWhy] = React.useState(false); const [edit, setEdit] = React.useState(false);
  const [cat, setCat] = React.useState(''); const [amt, setAmt] = React.useState('');
  const ready = st.accounts.filter(a => a.product_id && a.product_confirmed && rules.cards[a.product_id]);
  const ids = [...new Set(ready.map(a => a.product_id))];
  const { m, how } = bpResolveMerchant(E, rules, ctx, pageInfo && pageInfo.host);
  const amount = ctx.amount != null ? ctx.amount : 100;
  const rec = E.recommend(rules, ids, m, amount, 'cash'); const top = rec.top; const second = rec.ranking[1];
  const topAcct = top && ready.find(a => a.product_id === top.cardId);
  const confirmed = ctx.pageType === 'confirmation';
  const prots = ctx.physicalGoods ? ready.map(a => ({ a, card: rules.cards[a.product_id], list: ((rules.cards[a.product_id].protections) || []).filter(p => !p.incomplete && ['purchase_protection', 'return_protection', 'extended_warranty'].includes(p.type)) })).filter(x => x.list.length) : [];
  if (!top) return <Muted className="text-[13px]">Add a confirmed card to your wallet to compare.</Muted>;
  const chip = (t, tone) => <span className="rounded-full px-2.5 py-1 text-[12px]" style={{ background: tone === 'info' ? P.infoSoft : P.sunk, color: tone === 'info' ? P.info : P.ink }}>{t}</span>;
  return (
    <div>
      {confirmed && <div className="mb-4 rounded-2xl px-4 py-3.5" style={{ background: P.accentSoft }}>
        <div className="text-[14px] font-semibold">Order placed{ctx.orderNumber ? ' · ' + ctx.orderNumber : ''}</div>
        <Muted className="mt-0.5 text-[12.5px] leading-5">Save it to Benny+ so it’s matched to the card purchase and its protections are tracked.</Muted>
        <div className="mt-3 flex items-center gap-2"><Btn small kind="primary" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : 'Save this order to Benny+'}</Btn></div>
        {savedMsg && <div className="mt-2 text-[12.5px]" style={{ color: savedMsg.ok ? P.accent : P.danger }}>{savedMsg.text}</div>}
      </div>}
      <div className="flex flex-wrap items-center gap-2"><span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase" style={{ background: P.accentSoft, color: P.accent, letterSpacing: '0.1em' }}>Use this card</span>{(how !== 'table' || m.confidence !== 'high') && <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase" style={{ background: P.infoSoft, color: P.info, letterSpacing: '0.1em' }}>Estimate</span>}</div>
      <div className="mt-3 flex items-center gap-4">
        <CardArt card={rules.cards[top.cardId]} width={76} />
        <div className="min-w-0"><div className="text-[22px] font-semibold leading-tight tracking-tight" style={{ fontFamily: SERIF }}>{top.short}</div><Muted className="text-[12.5px]">{topAcct && topAcct.mask ? acctLabel(topAcct, cards) : (rules.cards[top.cardId].name || top.name)}</Muted></div>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-2">
        <span className="text-[30px] font-semibold tabular-nums tracking-tight" style={{ fontFamily: SERIF, color: P.accent }}>≈ {fmt(top.valueUsd)}</span>
        <Muted className="text-[13px]">{ctx.amount != null ? `back on ${fmt(ctx.amount)}` : 'per $100 (no amount on this page)'}</Muted>
      </div>
      <div className="mt-2 text-[13.5px] leading-6">{top.explanation}{rec.diffUsd > 0 && second ? <span style={{ color: P.muted }}> · {fmt(rec.diffUsd)} more than {second.short}</span> : null}</div>
      {rec.tie && second && <Muted className="mt-1 text-[12.5px]">Tied with {second.short}; either earns the same here.</Muted>}
      {top.unitValue && top.unitValue.note && <Muted className="mt-1 text-[12.5px]">{top.unitValue.note}</Muted>}
      {top.conditional && <div className="mt-2 rounded-xl px-3 py-2 text-[12.5px] leading-5" style={{ background: P.infoSoft, color: P.ink }}>{top.conditional.text}</div>}
      {rec.mccNote && <div className="mt-2 rounded-xl px-3 py-2 text-[12.5px] leading-5" style={{ background: P.infoSoft, color: P.ink }}>{rec.mccNote}</div>}

      <div className="mt-5"><Label>Read as</Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chip(ctx.merchant || (pageInfo && pageInfo.host) || 'Store')}
          {chip((m.categories || []).map(catName).join(' · '), how === 'ai' ? 'info' : null)}
          {chip(ctx.amount != null ? fmt(ctx.amount) + (ctx.amountKind === 'subtotal' ? ' subtotal' : '') : 'No amount', ctx.amount == null ? 'info' : null)}
          <button type="button" onClick={() => { setEdit(v => !v); setCat((m.categories || [])[0] || 'other'); setAmt(ctx.amount != null ? String(ctx.amount) : ''); }} className="rounded-full px-2.5 py-1 text-[12px] font-semibold" style={{ color: P.accent, border: `1px solid ${P.line}` }}>{edit ? 'Close' : 'Not right? Edit'}</button>
        </div>
        <Muted className="mt-2 text-[12px] leading-5">{how === 'table' ? `Matched to the merchant table: ${m.name}${m.mcc ? ' (MCC ' + m.mcc + ')' : ''}.` : how === 'you' ? 'Category set by you.' : 'Not in the merchant table, so the category is the AI’s guess.'} Read by AI from {pageInfo && pageInfo.host ? pageInfo.host : 'this page'}{ctx.summary ? ' · ' + ctx.summary : ''}</Muted>
        {ctx.amountKind === 'subtotal' && <Muted className="mt-1 text-[12px]">This page shows a subtotal; tax and shipping can change the final total slightly.</Muted>}
        {edit && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl p-3" style={{ background: P.sunk }}>
          <select aria-label="Category" value={cat} onChange={e => setCat(e.target.value)} className="rounded-full px-3 py-1.5 text-[13px]" style={{ background: P.surface, color: P.ink, border: `1px solid ${P.line}` }}>{BP_SHOP_CATS.map(c => <option key={c} value={c}>{c === 'other' ? 'Everything else' : catName(c)}</option>)}</select>
          <input aria-label="Amount" type="number" min="0" step="0.01" value={amt} onChange={e => setAmt(e.target.value)} placeholder="Amount" className="w-28 rounded-full px-3 py-1.5 text-[13px]" style={{ background: P.surface, color: P.ink, border: `1px solid ${P.line}` }} />
          <Btn small kind="primary" onClick={() => { onEdit({ categoryOverride: cat, amount: amt === '' ? null : Math.max(0, Number(amt)) }); setEdit(false); }}>Apply</Btn>
        </div>}
      </div>

      <div className="mt-5 rounded-2xl" style={{ border: `1px solid ${P.line}` }}>
        <button type="button" aria-expanded={why} onClick={() => setWhy(v => !v)} className="flex w-full items-center justify-between px-4 py-3 text-[14px] font-semibold">Why this card?<span style={{ color: P.muted }}>{why ? '−' : '+'}</span></button>
        {why && <div className="px-4 pb-4">
          {rec.ranking.map((r, i) => <div key={r.cardId} className="py-2.5" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
            <div className="flex items-center gap-2.5"><CardArt card={rules.cards[r.cardId]} width={30} /><span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{r.short}{i === 0 && <span className="ml-2 text-[11px] font-semibold" style={{ color: P.accent }}>Best</span>}</span><span className="text-[13.5px] font-semibold tabular-nums">{fmt(r.valueUsd)}</span></div>
            <Muted className="ml-10 mt-1 text-[12px] leading-5">{r.explanation}</Muted>
            {r.conditional && <div className="ml-10 mt-1 text-[12px]" style={{ color: P.info }}>{r.conditional.text}</div>}
            {r.rule && r.rule.source && r.rule.source.url && <a href={r.rule.source.url} target="_blank" rel="noreferrer" className="ml-10 mt-1 inline-flex items-center gap-1 text-[11.5px]" style={{ color: P.muted }}>{r.rule.source.quote ? '“' + String(r.rule.source.quote).slice(0, 110) + (String(r.rule.source.quote).length > 110 ? '…' : '') + '”' : 'Source'} <Ext /></a>}
          </div>)}
          <Muted className="mt-2 text-[11.5px] leading-5">The pinned rules engine decides; AI only read the page. Conditional rates are never counted.</Muted>
        </div>}
      </div>

      {prots.length > 0 && <div className="mt-4 rounded-2xl px-4 py-3.5" style={{ border: `1px solid ${P.line}` }}>
        <div className="text-[13.5px] font-semibold">Protections <span className="font-normal" style={{ color: P.muted }}>· a separate trade-off, not savings</span></div>
        <div className="mt-2 space-y-1">{prots.map(x => <div key={x.a.id} className="flex gap-2 text-[12.5px]"><span className="shrink-0 font-medium">{x.card.short || x.card.name}</span><span style={{ color: P.muted }}>{x.list.map(p => p.label + (p.windowDays ? ` (${p.windowDays} days)` : '')).join(' · ')}</span></div>)}</div>
        <Muted className="mt-1.5 text-[11.5px]">Only applies if you pay with that card.</Muted>
      </div>}
      <Muted className="mt-4 text-[11.5px] leading-5">Estimated rewards from verified card terms. Benny+ recommends, and fills a saved card only when you tap Fill card. It never places orders or pays.</Muted>
      <div className="mt-4 flex flex-wrap items-center gap-3"><Btn kind="primary" onClick={onRecheck}>Check this page again</Btn>{!confirmed && <button type="button" onClick={onSave} disabled={saving} className="text-[12.5px] font-semibold" style={{ color: P.accent }}>{saving ? 'Saving…' : 'Placed the order? Save it to Benny+'}</button>}</div>
      {!confirmed && savedMsg && <div className="mt-2 text-[12.5px]" style={{ color: savedMsg.ok ? P.accent : P.danger }}>{savedMsg.text}</div>}
    </div>
  );
}

/* Visitors' browser: an isolated session on the app owner's Mana, shown as live screenshots; clicks, typing and
   scrolling are sent to the bridge, which applies them only to that visitor's own page. */
const BP_KEYMAP = { Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Escape: 'Escape', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' };
function BpRemoteView({ api, apiBlob, tab, onTab }) {
  const P = usePal();
  const [src, setSrc] = React.useState(null); const [addr, setAddr] = React.useState(tab.url || ''); const [focused, setFocused] = React.useState(false); const [err, setErr] = React.useState('');
  const boxRef = React.useRef(null); const imgRef = React.useRef(null); const fast = React.useRef(0); const buf = React.useRef(''); const bufT = React.useRef(null); const wheel = React.useRef(0); const wheelT = React.useRef(null); const busy = React.useRef(false);
  React.useEffect(() => { if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.bpAddr) return; setAddr(tab.url || ''); }, [tab.url]);
  React.useEffect(() => {
    let stop = false, last = null;
    const loop = async () => {
      while (!stop) {
        if (document.visibilityState !== 'hidden') {
          try { const b = await apiBlob('/shot'); if (stop) break; const u = URL.createObjectURL(b); setSrc(u); if (last) URL.revokeObjectURL(last); last = u; setErr(''); }
          catch (e) { if (!stop) setErr(e.message || 'Lost the connection to the browser.'); }
        }
        const wait = Date.now() < fast.current ? 300 : 1000;
        await new Promise(r => setTimeout(r, wait));
      }
      if (last) URL.revokeObjectURL(last);
    };
    loop(); return () => { stop = true; };
  }, [apiBlob]);
  const send = async body => { fast.current = Date.now() + 4000; try { const info = await api('/input', { method: 'POST', body }); if (info && info.url) onTab(info); } catch (e) { setErr(e.message); } };
  const flush = () => { const t = buf.current; buf.current = ''; if (t) send({ kind: 'type', text: t }); };
  const onKey = e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.length === 1) { e.preventDefault(); buf.current += e.key; clearTimeout(bufT.current); bufT.current = setTimeout(flush, 140); return; }
    const k = BP_KEYMAP[e.key]; if (!k) return; e.preventDefault(); clearTimeout(bufT.current); flush(); send({ kind: 'key', key: k });
  };
  const onClick = e => {
    const img = imgRef.current; if (!img || !img.naturalWidth) return; const r = img.getBoundingClientRect();
    const s = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight); const w = img.naturalWidth * s, h = img.naturalHeight * s;
    const x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top - (r.height - h) / 2) / h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return; boxRef.current && boxRef.current.focus(); send({ kind: 'click', x, y });
  };
  React.useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const h = e => { e.preventDefault(); wheel.current += e.deltaY; if (wheelT.current) return; wheelT.current = setTimeout(() => { const dy = wheel.current; wheel.current = 0; wheelT.current = null; if (dy) send({ kind: 'scroll', dy }); }, 160); };
    el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h);
  }, []);
  const navTo = async action => { fast.current = Date.now() + 4000; try { const info = await api('/nav', { method: 'POST', body: { action } }); if (info) onTab(info); } catch (e) { setErr(e.message); } };
  const go = async () => { if (!addr.trim()) return; fast.current = Date.now() + 5000; try { const info = await api('/open', { method: 'POST', body: { url: bpToUrl(addr) } }); if (info) onTab(info); } catch (e) { setErr(e.message); } };
  const ib = (label, d, on) => <button type="button" aria-label={label} title={label} onClick={on} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ color: P.muted }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg></button>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <form className="flex items-center gap-1 px-2 py-1.5" style={{ borderBottom: `1px solid ${P.line}` }} onSubmit={e => { e.preventDefault(); go(); }}>
        {ib('Back', <path d="M15 18l-6-6 6-6" />, () => navTo('back'))}
        {ib('Forward', <path d="M9 18l6-6-6-6" />, () => navTo('forward'))}
        {ib('Reload', <><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 4v5h-5" /></>, () => navTo('reload'))}
        <input data-bp-addr="1" value={addr} onChange={e => setAddr(e.target.value)} placeholder="Search Google or type an address" aria-label="Search Google or type an address" className="h-8 min-w-0 flex-1 rounded-full px-3 text-[12.5px]" style={{ background: P.sunk, color: P.ink, border: 'none' }} />
      </form>
      <div ref={boxRef} tabIndex={0} onKeyDown={onKey} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); flush(); }}
        onPaste={e => { const t = e.clipboardData && e.clipboardData.getData('text'); if (t) { e.preventDefault(); send({ kind: 'type', text: t.slice(0, 500) }); } }}
        className="relative min-h-0 flex-1 overflow-hidden outline-none" style={{ background: P.sunk, boxShadow: focused ? `inset 0 0 0 2px ${P.accent}` : 'none', cursor: 'pointer' }}>
        {src ? <img ref={imgRef} src={src} alt={'Live view of ' + (tab.title || tab.url || 'the page')} onClick={onClick} draggable={false} className="h-full w-full select-none object-contain" />
          : <div className="flex h-full items-center justify-center text-[13px]" style={{ color: P.muted }}>Opening the page…</div>}
        {err && <div className="absolute inset-x-3 top-3 rounded-xl px-3 py-2 text-[12px]" style={{ background: P.surface, color: P.danger, border: `1px solid ${P.line}` }}>{err}</div>}
      </div>
      <div className="px-3 py-1.5 text-[11.5px] leading-4" style={{ color: P.muted, borderTop: `1px solid ${P.line}` }}>Your own browser in your own Mana space: only you can see or use it. Sign in and check out as usual. Click the page, then type.</div>
    </div>
  );
}

/* Pay with a card: details live encrypted in the user's own sandbox (benny-shop /cards); the browser only ever sees last 4. */
function bpLuhn(n) { let s = 0; for (let i = 0; i < n.length; i++) { let d = +n[n.length - 1 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } s += d; } return n.length >= 12 && s % 10 === 0; }
function BpPayPanel({ api, acct, cards, saved, onSaved, tabOpen }) {
  const P = usePal(); const card = acct && cards[acct.product_id];
  const [editing, setEditing] = React.useState(false); const [num, setNum] = React.useState(''); const [exp, setExp] = React.useState(''); const [name, setName] = React.useState(''); const [zip, setZip] = React.useState('');
  const [busy, setBusy] = React.useState(''); const [msg, setMsg] = React.useState(null);
  React.useEffect(() => { setEditing(false); setMsg(null); setNum(''); setExp(''); }, [acct && acct.id]);
  if (!acct) return null;
  const digits = num.replace(/\D/g, ''); const em = exp.match(/^\s*(\d{1,2})\s*\/?\s*(\d{2}|\d{4})\s*$/);
  const maskWarn = acct.mask && digits.length >= 12 && digits.slice(-4) !== String(acct.mask).slice(-4);
  const valid = bpLuhn(digits) && em && +em[1] >= 1 && +em[1] <= 12;
  const save = async () => {
    setBusy('save'); setMsg(null);
    try { await api('/cards', { method: 'POST', body: { key: acct.id, label: acctLabel(acct, cards), number: digits, exp_month: +em[1], exp_year: +em[2], name: name.trim(), zip: zip.trim() } });
      setNum(''); setExp(''); setEditing(false); setMsg({ ok: true, text: 'Saved in your own Mana space, encrypted. Only the last 4 digits are ever shown.' }); onSaved(); }
    catch (e) { setMsg({ ok: false, text: e.message }); }
    setBusy('');
  };
  const fill = async field => { setBusy(field); setMsg(null); try { const r = await api('/fill', { method: 'POST', body: { key: acct.id, field } }); setMsg({ ok: !!(r.filled && r.filled.length), text: r.message }); } catch (e) { setMsg({ ok: false, text: e.message }); } setBusy(''); };
  const remove = async () => { setBusy('rm'); try { await api('/cards/' + encodeURIComponent(acct.id), { method: 'DELETE' }); onSaved(); setMsg({ ok: true, text: 'Payment details removed.' }); } catch (e) { setMsg({ ok: false, text: e.message }); } setBusy(''); };
  const inp = { background: P.sunk, color: P.ink, border: `1px solid ${P.line}` };
  const chip = (f, label) => <button key={f} type="button" disabled={!!busy || !tabOpen} onClick={() => fill(f)} className="h-7 rounded-full px-2.5 text-[12px] font-medium disabled:opacity-40" style={{ color: P.ink, border: `1px solid ${P.lineStrong}` }}>{busy === f ? '…' : label}</button>;
  return (
    <div className="rounded-3xl p-5" style={{ background: P.surface, border: `1px solid ${P.line}` }}>
      <div className="flex items-center gap-3"><CardArt card={card} width={44} /><div className="min-w-0 flex-1"><Label>Pay with</Label><div className="truncate text-[14px] font-semibold">{acctLabel(acct, cards)}</div></div>
        {saved && !editing && <span className="text-[11.5px]" style={{ color: P.muted }}>{saved.brand} ••{saved.last4} · {saved.exp}</span>}</div>
      {saved && !editing ? (<>
        <div className="mt-4"><Btn kind="primary" small disabled={!!busy || !tabOpen} onClick={() => fill('auto')}>{busy === 'auto' ? 'Filling…' : 'Fill card at checkout'}</Btn></div>
        <Muted className="mt-2 text-[12px] leading-5">{tabOpen ? 'On the payment step, Benny+ types this card into the form. Then add the security code and place the order yourself.' : 'Open a store first.'}</Muted>
        <div className="mt-3 text-[11.5px]" style={{ color: P.faint }}>Form not found? Click a field in the page, then:</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">{chip('number', 'Card number')}{chip('exp', 'Expiry')}{saved.hasName && chip('name', 'Name')}{saved.hasZip && chip('zip', 'ZIP')}</div>
        <div className="mt-3 flex gap-3 text-[12px]"><button type="button" onClick={() => setEditing(true)} style={{ color: P.accent }}>Replace</button><button type="button" disabled={!!busy} onClick={remove} style={{ color: P.muted }}>Remove</button></div>
      </>) : editing || !saved ? (
        !editing ? (<div className="mt-3"><Muted className="text-[12.5px] leading-5"><span className="inline-flex items-center gap-1">Optional autofill<InfoTip align="left">You can pay with this card on the store’s own checkout. If you want autofill, save its details once: they’re encrypted in your own Mana space, never sent to Benny+ or the app owner, and Benny+ never places orders.</InfoTip></span></Muted><div className="mt-3"><Btn small onClick={() => setEditing(true)}>Set up autofill (optional)</Btn></div></div>) : (
        <form className="mt-4 space-y-2" autoComplete="off" onSubmit={e => { e.preventDefault(); if (valid) save(); }}>
          <input type="password" inputMode="numeric" autoComplete="off" value={num} onChange={e => setNum(e.target.value)} placeholder="Card number" aria-label="Card number" className="h-9 w-full rounded-xl px-3 text-[13px]" style={inp} />
          <div className="flex gap-2"><input value={exp} onChange={e => setExp(e.target.value)} placeholder="MM/YY" aria-label="Expiry" className="h-9 w-24 rounded-xl px-3 text-[13px]" style={inp} /><input value={zip} onChange={e => setZip(e.target.value)} placeholder="Billing ZIP (optional)" aria-label="Billing ZIP" className="h-9 min-w-0 flex-1 rounded-xl px-3 text-[13px]" style={inp} /></div>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name on card (optional)" aria-label="Name on card" className="h-9 w-full rounded-xl px-3 text-[13px]" style={inp} />
          {digits.length >= 12 && !bpLuhn(digits) && <div className="text-[12px]" style={{ color: P.danger }}>That number doesn’t check out. Look at the digits again.</div>}
          {maskWarn && <div className="text-[12px]" style={{ color: P.info }}>This ends in {digits.slice(-4)}, but the card in Benny+ ends in {String(acct.mask).slice(-4)}.</div>}
          <Muted className="text-[11.5px] leading-4">Security code isn’t saved; you type it at checkout.</Muted>
          <div className="flex gap-2 pt-1"><Btn kind="primary" small disabled={!valid || busy === 'save'} onClick={() => valid && save()}>{busy === 'save' ? 'Saving…' : 'Save card'}</Btn><Btn small onClick={() => { setEditing(false); setNum(''); setExp(''); }}>Cancel</Btn></div>
        </form>)
      ) : null}
      {msg && <div className="mt-3 text-[12.5px] leading-5" style={{ color: msg.ok ? P.accent : P.danger }}>{msg.text}</div>}
    </div>
  );
}

function Shop({ st, cards, rules, E, call, refresh, onOpenCard }) {
  const P = usePal(); const isOwner = userId === ownerId;   // only decides live view vs screenshots; the browser is always the viewer's own
  const [svc, setSvc] = React.useState(undefined);
  React.useEffect(() => userId ? FS.onValue(FS.ref(FS.db, `${userId}/file-system/${BP_SHOP_NODE}/service`), s => setSvc(s.val()), () => setSvc(null)) : undefined, []);
  const [broken, setBroken] = React.useState({});
  React.useEffect(() => userId ? FS.onValue(FS.ref(FS.db, `${userId}/file-system/${BP_SHOP_NODE}/broken`), s => setBroken(s.val() || {}), () => setBroken({})) : undefined, []);
  const svcOk = !!(svc && svc.url && (!svc.expiresAt || svc.expiresAt > Date.now() + 60000));
  const ing = { url: svcOk ? svc.url : null, error: svc === null || (svc && !svcOk) ? new Error('setup') : null };
  const [savedCards, setSavedCards] = React.useState({});
  const gem = useManaRouter('gemini');
  const partners = React.useMemo(() => bpPartnerOffers(rules, st), [rules, st]);
  const isBroken = id => !!(broken[id] && broken[id].at && Date.now() - broken[id].at < BP_BROKEN_TTL);
  const live = partners.list.filter(x => !isBroken(x.partner.id));          // grid tiles: every partner with any credit, minus broken ones
  const pills = live.filter(x => x.usable.length);                          // pills: only credits still usable this period
  const rootRef = React.useRef(null); const [w, setW] = React.useState(1200);
  React.useEffect(() => { const el = rootRef.current; if (!el) return; const ro = new ResizeObserver(es => setW(es[0].contentRect.width)); ro.observe(el); return () => ro.disconnect(); }, []);
  const wide = w >= 900;
  const [conn, setConn] = React.useState('connecting'); const [tab, setTab] = React.useState(null); const [opening, setOpening] = React.useState(false); const [addr, setAddr] = React.useState('');
  const [auto, setAuto] = React.useState(true); const [phase, setPhase] = React.useState('idle'); const [ctx, setCtx] = React.useState(null); const [pageInfo, setPageInfo] = React.useState(null); const [err, setErr] = React.useState('');
  const [front, setFront] = React.useState(null); const [installing, setInstalling] = React.useState(false); const [installMsg, setInstallMsg] = React.useState(''); const [epoch, setEpoch] = React.useState(0);
  const [saving, setSaving] = React.useState(false); const [savedMsg, setSavedMsg] = React.useState(null);
  const [notice, setNotice] = React.useState(''); const [showSites, setShowSites] = React.useState(false);
  const lastPage = React.useRef(null); const readUrl = React.useRef(null); const adviceKey = React.useRef(null); const runRef = React.useRef(0); const autoRef = React.useRef(false); const upgRef = React.useRef(false); const tabRef = React.useRef(null);
  tabRef.current = tab;
  const roles = React.useMemo(() => walletRoles(E, rules, st.accounts), [E, rules, st.accounts]);
  const ready = st.accounts.filter(a => a.product_id && a.product_confirmed && rules.cards[a.product_id]);

  const api = React.useCallback(async (path, opts = {}) => {
    if (!ing.url) throw Object.assign(new Error('The shopping browser is still connecting.'), { code: 0 });
    const tok = FS.auth && FS.auth.currentUser ? await FS.auth.currentUser.getIdToken() : '';
    let r; try { r = await fetch(ing.url + path, { method: opts.method || 'GET', headers: { Authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
    catch (e) { throw Object.assign(new Error('Your shopping browser isn’t answering.'), { code: 0 }); }
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('This browser belongs to a different Mana account. Set up your own.'), { code: 401 });
    if (!r.ok) { let m = ''; try { m = (await r.json()).error || ''; } catch (e) {} throw Object.assign(new Error(m || ('The shopping browser answered ' + r.status + '.')), { code: r.status }); }
    return r.json();
  }, [ing.url]);
  const apiBlob = React.useCallback(async path => {
    if (!ing.url) throw new Error('The shopping browser is still connecting.');
    const tok = FS.auth && FS.auth.currentUser ? await FS.auth.currentUser.getIdToken() : '';
    const r = await fetch(ing.url + path, { headers: { Authorization: 'Bearer ' + tok } });
    if (!r.ok) { let m = ''; try { m = (await r.json()).error || ''; } catch (e) {} throw new Error(m || ('The shopping browser answered ' + r.status + '.')); }
    return r.blob();
  }, [ing.url]);

  React.useEffect(() => {
    if (svc === undefined) return; if (ing.error) { setConn('setup'); return; } if (!ing.url) return;
    let stop = false, t = null;
    const tick = async () => { if (stop) return;
      if (document.visibilityState !== 'hidden') { try { const info = await api('/tab'); if (!stop) { setConn('ok'); setTab(info && info.targetId && info.alive !== false ? info : null); } } catch (e) { if (!stop) setConn(e.code === 401 ? 'denied' : 'offline'); } }
      t = setTimeout(tick, 2000); };
    tick(); return () => { stop = true; clearTimeout(t); };
  }, [ing.url, !!ing.error, svc === undefined, api, epoch]);
  const loadCards = React.useCallback(async () => { try { const r = await api('/cards'); setSavedCards(Object.fromEntries((r.cards || []).map(c => [c.key, c]))); } catch (e) {} }, [api]);
  React.useEffect(() => { if (conn === 'ok') loadCards(); }, [conn, loadCards]);

  // the advice belongs to one page: forget it the moment the tab moves to another URL or a new site is opened
  const resetAdvice = () => { runRef.current++; adviceKey.current = null; readUrl.current = null; lastPage.current = null; setPhase('idle'); setErr(''); setCtx(null); setPageInfo(null); setSavedMsg(null); };
  const applyTab = info => { setTab(info && info.targetId ? info : null); resetAdvice(); };
  const readPage = async () => {
    const run = ++runRef.current; const t = tabRef.current; adviceKey.current = t ? bpKey(t.url) : null; setPhase('reading'); setErr(''); setSavedMsg(null);
    try {
      const pg = await api('/read'); if (run !== runRef.current) return;
      readUrl.current = bpKey(pg.url); adviceKey.current = bpKey(pg.url); lastPage.current = pg;
      const c = await bpReadPage(gem.url, pg); if (run !== runRef.current) return;
      setPageInfo({ url: pg.url, title: pg.title, host: bpHost(pg.url) });
      if (!c.readable || (c.amount == null && c.pageType !== 'confirmation')) { setCtx(null); setPhase('nothing'); return; }
      setCtx(c); setPhase('result');
    } catch (e) { if (run !== runRef.current) return; setErr(bpFriendly(e)); setPhase('error'); }
  };
  // bring the recommended card to the front of the stack
  React.useEffect(() => {
    if (phase !== 'result' || !ctx) return;
    try { const ids = [...new Set(ready.map(a => a.product_id))]; const { m } = bpResolveMerchant(E, rules, ctx, pageInfo && pageInfo.host);
      const top = E.recommend(rules, ids, m, ctx.amount != null ? ctx.amount : 100, 'cash').top; const acct = top && ready.find(a => a.product_id === top.cardId); if (acct) setFront(acct.id); } catch (e) {}
  }, [phase, ctx]);
  const curKey = tab ? bpKey(tab.url) : null; const curTitle = tab ? tab.title : ''; const isCk = tab ? bpCheckoutish(tab.url, tab.title) : false; const onSearch = tab ? bpIsSearchSite(tab.url) : false;
  React.useEffect(() => { if (adviceKey.current && adviceKey.current !== curKey) resetAdvice(); }, [curKey]);
  React.useEffect(() => { const el = rootRef.current && rootRef.current.querySelector('[data-bp-pill][aria-pressed="true"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [curKey, showSites]);
  React.useEffect(() => {
    if (!auto || !curKey || !isCk || onSearch || !ready.length || readUrl.current === curKey) return;   // search-engine pages are never read automatically
    const h = setTimeout(() => { if (readUrl.current !== curKey) readPage(); }, 2200); return () => clearTimeout(h);
  }, [curKey, curTitle, auto, isCk, onSearch, ready.length, gem.url]);

  const openStore = async url => { setOpening(true); setShowSites(false); try { const info = await api('/open', { method: 'POST', body: { url } }); applyTab(info); } catch (e) { setErr(bpFriendly(e)); setPhase('error'); } setOpening(false); };
  const markBroken = async (partner, info) => {
    const l = info && info.load; const reason = l ? (l.kind === 'http' ? 'HTTP ' + l.httpStatus : l.kind) + (l.title ? ' · ' + String(l.title).slice(0, 60) : '') : ((info && info.title) || 'did not load');
    try { await FS.update(FS.ref(FS.db, `${userId}/file-system/${BP_SHOP_NODE}/broken`), { [partner.id]: { at: Date.now(), url: (info && info.url) || partner.urls[0], reason, metadata: { type: 'entry' } }, metadata: { type: 'entry', hidden: true } }); } catch (e) {}
    setBroken(b => ({ ...b, [partner.id]: { at: Date.now(), reason } }));
  };
  // open a partner site: try each address; a site that fails to load everywhere is hidden for a day and the user is told
  const openPartner = async entry => {
    const best = entry.usable[0] || entry.offers[0]; if (best) setFront(best.acct.id);
    setOpening(true); setShowSites(false); setNotice('');
    let info = null, verdict = 'broken';
    try {
      for (const u of entry.partner.urls) { info = await api('/open', { method: 'POST', body: { url: u } }); verdict = bpVerdict(info); if (verdict !== 'broken') break; }
    } catch (e) { setErr(bpFriendly(e)); setPhase('error'); setOpening(false); return; }
    if (verdict === 'broken') {
      await markBroken(entry.partner, info); setNotice(`${entry.partner.name} didn’t load here, so it’s hidden for now. Benny+ will try it again tomorrow.`);
      try { info = await api('/open', { method: 'POST', body: { url: BP_GOOGLE } }); } catch (e) {}
    }
    applyTab(info); setOpening(false);
  };
  // Google is the home page: open it as soon as the browser is connected and nothing is open yet
  const openHome = async () => {
    setOpening(true); try { const info = await api('/open', { method: 'POST', body: { url: BP_GOOGLE } }); applyTab(info);
      if (bpVerdict(info) === 'broken') { setShowSites(true); setNotice('Google didn’t load in your shopping browser, so here are the sites where your card credits apply.'); }
      else { setShowSites(false); setNotice(''); } }
    catch (e) { setErr(bpFriendly(e)); setPhase('error'); } setOpening(false);
  };
  React.useEffect(() => { if (conn !== 'ok' || tab || autoRef.current) return; autoRef.current = true; openHome(); }, [conn, tab]);
  const install = async quiet => {
    setInstalling(true); setInstallMsg(quiet ? 'Updating your shopping browser…' : 'Setting up your own shopping browser in your Mana space…');
    try { const kit = (await FS.get(FS.ref(FS.db, relPathAddress('shop-kit', 'installer')))).val(); if (!kit) throw new Error('installer missing');
      const now = Date.now();
      await FS.update(FS.ref(FS.db, `${userId}/file-system/${BP_SHOP_NODE}`), { metadata: { type: 'link', hidden: true, displayName: 'Benny+ shopping browser', createdAt: now, updatedAt: now },
        install: { source: kit, metadata: { type: 'python', displayName: 'Install shopping browser', createdAt: now, updatedAt: now } } });
      const tok = await FS.auth.currentUser.getIdToken();
      const r = await fetch(API_BASE_URL + '/run', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ user: { uid: userId }, path: `file-system/${BP_SHOP_NODE}/install`, run_id: 'run_' + now.toString(16) }) });
      const res = r.ok ? await r.json() : null; if (!res || res.error || !/^DONE /m.test(res.stdout || '')) throw new Error((res && (res.error_message || res.stderr)) || ('setup failed (' + r.status + ')'));
      setInstallMsg(''); if (!quiet) { setEpoch(e => e + 1); setConn('connecting'); }
    } catch (e) { setInstallMsg((quiet ? 'Update didn’t finish: ' : 'Setup didn’t finish: ') + String(e.message || e).slice(0, 160)); }
    setInstalling(false);
  };
  React.useEffect(() => { if (conn !== 'ok' || !svc || (svc.version || 1) >= BP_KIT_VERSION || upgRef.current) return; upgRef.current = true; install(true); }, [conn, svc]);
  const saveOrder = async () => {
    const pg = lastPage.current; if (!pg || !call) return; setSaving(true); setSavedMsg(null);
    try { const r = await call('POST', '/v1/documents', { kind: 'text', content: `Page: ${pg.title}\nURL: ${pg.url}\n\n${pg.text}`, file_name: bpHost(pg.url) + ' order page' });
      if (r.duplicate) setSavedMsg({ ok: true, text: 'Already saved.' });
      else if (!r.extracted || !r.extracted.is_purchase_document) setSavedMsg({ ok: false, text: 'Benny+ didn’t find an order on this page. Save it from the confirmation page.' });
      else setSavedMsg({ ok: true, text: `Saved ${r.items} item${r.items === 1 ? '' : 's'} from ${r.extracted.merchant || 'this order'}. ` + (r.link && r.link.confirmed ? 'Matched automatically to its card transaction.' : r.link && r.link.proposed ? 'Found a likely card transaction; confirm it in Review.' : 'It will be matched automatically when the card transaction arrives.') });
      await refresh();
    } catch (e) { setSavedMsg({ ok: false, text: e.message }); }
    setSaving(false);
  };

  const frontId = st.accounts.some(a => a.id === front) ? front : (st.accounts[st.accounts.length - 1] && st.accounts[st.accounts.length - 1].id);
  const frontAcct = st.accounts.find(a => a.id === frontId);
  const searchForm = (cls, big) => (
    <form className={cls} onSubmit={e => { e.preventDefault(); if (addr.trim()) openStore(bpToUrl(addr)); }}>
      <input value={addr} onChange={e => setAddr(e.target.value)} placeholder="Search Google or type a store’s address" aria-label="Search Google or type a store’s address" className={big ? 'h-10 min-w-0 flex-1 rounded-full px-4 text-[13px]' : (w < 760 ? 'h-7 w-[132px] min-w-0 rounded-full px-3 text-[12px]' : 'h-7 w-[210px] min-w-0 rounded-full px-3 text-[12px]')} style={{ background: big ? P.surface : P.sunk, color: P.ink, border: big ? `1px solid ${P.lineStrong}` : 'none' }} />
      {big && <Btn kind="primary" disabled={opening || !addr.trim()} onClick={() => addr.trim() && openStore(bpToUrl(addr))}>{opening ? 'Opening…' : 'Go'}</Btn>}
    </form>
  );
  const tile = ({ partner: s, offers }) => (
    <button key={s.id} type="button" disabled={opening} onClick={() => openPartner(live.find(x => x.partner.id === s.id))} className="flex items-start gap-3 rounded-2xl px-3 py-3 text-left hover:opacity-85 disabled:opacity-50" style={{ background: P.surface, border: `1px solid ${P.line}` }}>
      <BpStoreMark s={{ mark: s.name.replace(/^the /i, '')[0].toUpperCase() }} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">{s.name}</div><Muted className="text-[12px]">{s.kind}</Muted>
        <div className="mt-2 space-y-1">{offers.map((o, k) => { const stt = bpOfferStatus(o); return (
          <div key={k} className="text-[12px] leading-4">
            <BpSwatch card={o.card} /> <span className="font-semibold tabular-nums" style={{ fontFamily: SERIF }}>{fmt0(o.amount)}</span> <span style={{ color: P.muted }}>{BP_PERIOD[o.period] || ''} · {acctLabel(o.acct, cards)}</span>
            <span className="ml-1.5 whitespace-nowrap rounded-full px-1.5 py-px text-[10.5px] font-semibold" style={stt.tone === 'accent' ? { background: P.accentSoft, color: P.accent } : stt.tone === 'info' ? { background: P.infoSoft, color: P.info } : { background: P.sunk, color: P.muted }}>{stt.text}</span>
            <div className="truncate text-[11px]" style={{ color: P.faint }}>{o.credit.short || o.credit.label}</div>
          </div>); })}</div>
      </div>
    </button>);
  const hiddenNames = partners.list.filter(x => isBroken(x.partner.id)).map(x => x.partner.name);
  const storeGrid = (
    <div className="h-full overflow-y-auto"><div className="mx-auto max-w-[560px] px-6 py-8">
      <div className="mb-8">{searchForm('flex gap-2', true)}<Muted className="mt-2 text-[12px]">Search for any store, or pick a site below.</Muted></div>
      <div className="text-[26px] font-semibold tracking-tight" style={{ fontFamily: SERIF }}>Card credit sites</div>
      <Muted className="mt-1.5 text-[14px] leading-6">The sites your cards pay you back at, from the credits in your wallet. Open one here; at checkout Benny+ still picks the best card for the purchase.</Muted>
      {notice && tab && <div className="mt-4 rounded-xl px-3 py-2 text-[12.5px]" style={{ background: P.infoSoft, color: P.ink }}>{notice}</div>}
      {live.length === 0 && <div className="mt-6 rounded-2xl px-4 py-4 text-[13px] leading-5" style={{ background: P.surface, border: `1px solid ${P.line}`, color: P.muted }}>{partners.list.length ? 'The partner sites for your cards didn’t load here; they’ll be tried again tomorrow.' : 'None of the cards in your wallet have a credit tied to a partner site. Add cards in Wallet, or search above.'}</div>}
      <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">{live.map(tile)}</div>
      {partners.general.length > 0 && <Muted className="mt-3 text-[12px] leading-5">Also in your wallet, not tied to one site: {partners.general.map(o => `${fmt0(o.amount)} ${BP_PERIOD[o.period] || ''} ${o.credit.short || o.credit.label} (${o.card.short || o.card.name})`).join(' · ')}.</Muted>}
      {hiddenNames.length > 0 && <Muted className="mt-2 text-[12px] leading-5">Hidden because they didn’t load here: {hiddenNames.join(', ')}. Benny+ tries again after a day.</Muted>}
      <Muted className="mt-6 text-[11.5px] leading-5">This browser runs in your own Mana space, only for you, and remembers your sign-ins. Benny+ reads page text to find the store and total (Google Gemini through Mana, not saved). With your OK it fills a saved card into the payment form; you add the security code and place the order. Some sites limit automated browsers; United’s flight search doesn’t load here.</Muted>
    </div></div>
  );
  let pane;
  if (conn === 'setup' || conn === 'offline' || conn === 'denied') pane = <div className="flex h-full items-center justify-center p-8"><div className="max-w-[420px] text-center"><div className="text-[18px] font-semibold" style={{ fontFamily: SERIF }}>{conn === 'offline' ? 'Your shopping browser isn’t answering' : conn === 'denied' ? 'This browser belongs to another account' : 'Set up your shopping browser'}</div><Muted className="mt-1.5 text-[13px] leading-5">{conn === 'offline' ? 'Repair restarts it in your Mana space. It takes about ten seconds.' : 'It runs in your own Mana space, only for you, so you can sign in to stores and check out with your own cards. Setup takes about ten seconds.'}</Muted><div className="mt-4"><Btn kind="primary" disabled={installing} onClick={() => install(false)}>{installing ? 'Setting up…' : conn === 'offline' || conn === 'denied' ? 'Repair' : 'Set up shopping browser'}</Btn></div>{installMsg && <div className="mt-3 text-[12.5px]" style={{ color: installing ? P.muted : P.danger }}>{installMsg}</div>}</div></div>;
  else if (conn === 'connecting') pane = <div className="flex h-full items-center justify-center text-[13px]" style={{ color: P.muted }}>Connecting to your shopping browser…</div>;
  else pane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 px-2.5 py-2" style={{ borderBottom: `1px solid ${P.line}` }}>
        <BpHomePill on={!!tab && !showSites && /(^|\.)google\.[a-z.]+$/.test(bpHost(tab.url))} disabled={opening} onClick={openHome} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {tab && pills.map(entry => { const s = entry.partner;
            const sameHost = u => bpHost(tab.url) === bpHost(u) || bpHost(tab.url).endsWith('.' + bpHost(u));
            const shared = pills.filter(o => o !== entry && o.partner.urls.some(sameHost)).length > 0;   // uber vs uber-one: both on uber.com, so the path decides
            const on = !showSites && entry.partner.urls.some(u => sameHost(u) && (!shared || !new URL(u).pathname.slice(1) || (tab.url || '').includes(new URL(u).pathname)));
            const hi = frontAcct && entry.usable.some(o => o.acct.id === frontId) ? frontAcct : null;
            return <BpPill key={s.id} entry={entry} cards={cards} on={on} hi={hi} disabled={opening} onClick={() => openPartner(entry)} />; })}
          {!tab && pills.map(entry => <BpPill key={entry.partner.id} entry={entry} cards={cards} on={false} hi={frontAcct && entry.usable.some(o => o.acct.id === frontId) ? frontAcct : null} disabled={opening} onClick={() => openPartner(entry)} />)}
        </div>
      </div>
      {notice && !showSites && <div className="flex items-center gap-2 px-3 py-1.5 text-[12px]" style={{ background: P.infoSoft, color: P.ink }}><span className="min-w-0 flex-1">{notice}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice('')} className="shrink-0 px-1 text-[14px]" style={{ color: P.muted }}>×</button></div>}
      {installMsg && <div className="px-3 py-1 text-[12px]" style={{ color: installing ? P.muted : P.danger }}>{installMsg}</div>}
      <div className="relative min-h-0 flex-1" onPointerDown={e => e.stopPropagation()}>{!tab || showSites ? storeGrid : isOwner ? <ManaBrowser key={tab.targetId} targetId={tab.targetId} /> : <BpRemoteView api={api} apiBlob={apiBlob} tab={tab} onTab={info => setTab(t => ({ ...(t || {}), ...info }))} />}</div>
    </div>
  );

  const host = tab ? bpHost(tab.url) : '';
  let advice;
  if (!ready.length) advice = <Muted className="text-[13px]">Add a card in Wallet first. Recommendations only compare cards you hold.</Muted>;
  else if (phase === 'reading') advice = <div aria-live="polite"><div className="text-[15px] font-semibold">Reading {host || 'this page'}…</div><Muted className="mt-0.5 text-[12.5px]">Finding the store, total and what you’re buying.</Muted><div className="mt-3 space-y-2"><div className="h-2.5 w-3/4 animate-pulse rounded-full" style={{ background: P.sunk }} /><div className="h-2.5 w-1/2 animate-pulse rounded-full" style={{ background: P.sunk }} /></div></div>;
  else if (phase === 'result' && ctx) advice = <ShopAdvice E={E} rules={rules} st={st} cards={cards} ctx={ctx} pageInfo={pageInfo} onEdit={o => setCtx(c => ({ ...c, ...o }))} onRecheck={readPage} onSave={saveOrder} saving={saving} savedMsg={savedMsg} />;
  else if (phase === 'nothing' || phase === 'error') advice = (
    <div>
      <div className="text-[19px] font-semibold tracking-tight" style={{ fontFamily: SERIF }}>{phase === 'nothing' ? 'No price on this page yet' : 'Couldn’t read this page'}</div>
      <div className="mt-1 text-[13px] leading-5" style={{ color: phase === 'error' ? P.danger : P.muted }}>{phase === 'nothing' ? 'Open a product, your cart or the checkout, and Benny+ compares your cards.' : err}</div>
      {tab && <div className="mt-4"><Btn kind="primary" small onClick={readPage}>Which card for this page?</Btn></div>}
    </div>
  );
  else advice = (   // idle: one compact row, heading and the check button
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-semibold tracking-tight" style={{ fontFamily: SERIF }}>{tab ? (onSearch ? 'Search for a store' : `Browsing ${host}`) : 'Your card, ready at checkout'}</div>
        {tab && !auto && <Muted className="text-[12px]">Automatic checking is off.</Muted>}
      </div>
      {tab && <Btn kind="primary" small onClick={readPage}>Which card for this page?</Btn>}
    </div>
  );
  const idle = !!ready.length && !['reading', 'result', 'nothing', 'error'].includes(phase);
  const rail = (
    <div className="space-y-5">
      {st.accounts.length > 0 && <WalletStack accounts={st.accounts} cards={cards} front={frontId} rolesByCard={roles} onPick={(id, isFront) => { if (isFront) onOpenCard(id); else setFront(id); }} />}
      <div className={idle ? 'rounded-3xl px-4 py-3' : 'rounded-3xl p-5'} style={{ background: P.surface, border: `1px solid ${P.line}` }}>{advice}</div>
      {conn === 'ok' && <BpPayPanel api={api} acct={frontAcct} cards={cards} saved={savedCards[frontId]} onSaved={loadCards} tabOpen={!!tab} />}
      {tab && <label className="flex cursor-pointer items-center gap-2 px-1 text-[12.5px]" style={{ color: P.muted }}><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} style={{ accentColor: P.accent }} />Check carts and checkouts automatically</label>}
    </div>
  );
  return (
    <div ref={rootRef} className="mx-auto w-full max-w-[1500px] px-5 pt-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-[30px] font-semibold leading-tight tracking-tight" style={{ fontFamily: SERIF }}>Shop</h2><Muted className="mt-0.5 text-[14px]">Browse any store. Your best card is ready at checkout.</Muted></div></div>
      {wide ? (
        <div className="grid min-h-0 gap-5" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px', height: 'calc(var(--mana-app-height, 82vh) - 250px)', minHeight: 480 }}>
          <div className="min-h-0 overflow-hidden rounded-3xl" style={{ background: P.surface, border: `1px solid ${P.line}` }}>{pane}</div>
          <div className="-mr-2 min-h-0 overflow-y-auto px-2 pb-4 pt-1">{rail}</div>
        </div>
      ) : (
        <div className="space-y-5 pb-6"><div className="overflow-hidden rounded-3xl" style={{ height: w < 640 ? 520 : 600, background: P.surface, border: `1px solid ${P.line}` }}>{pane}</div>{rail}</div>
      )}
    </div>
  );
}

function readRoute() { const p = new URLSearchParams(window.location.search); return { view: p.get('bp') || '', step: p.get('step') || '', card: p.get('card') || null }; }

/* Demo mode shows ONLY the sample cards and purchases, so sample data never mixes with the user's own cards. */
const DEMO_VIRTUAL_ID = 'acct_demo_united_virtual';
const DEMO_PERKS_KEY = 'benny-demo-perks';
function demoView(s, rules) {
  if (!s || !(s.accounts || []).some(a => a.sample)) return s;
  const ids = new Set(s.accounts.filter(a => a.sample).map(a => a.id));
  const keep = x => !x.account_id || ids.has(x.account_id);
  const acctOf = e => String(e.subject_id || '').split(':')[0];
  // Third demo card (Eden, Oct 25): the server's sample has 2 cards, so the app adds United Explorer while demo mode is on.
  // Display-only: never stored, gone on Exit demo; writes that name it are refused in `call`. Real fix = add it to the server's sample seed.
  const extra = s.accounts.some(a => a.sample && a.product_id === 'united-explorer') ? [] : [{ id: DEMO_VIRTUAL_ID, owner: s.accounts[0] && s.accounts[0].owner, product_id: 'united-explorer', mask: '0417', nickname: null, holder: 'primary', source: 'sample', product_confirmed: 1, official_name: null, sample: 1, virtual: true }];
  // Track the virtual card's credits like the server does: one 'unknown' row per credit for the current period (no purchases on it, so none are used).
  const vRows = [];
  const vcard = extra.length && rules && rules.cards && rules.cards['united-explorer'];
  if (vcard) {
    const now = new Date(); const y = now.getFullYear(), m = now.getMonth(); const today = Date.UTC(y, m, now.getDate());
    const span = p => p === 'monthly' ? [Date.UTC(y, m, 1), Date.UTC(y, m + 1, 0)] : p === 'quarterly' ? [Date.UTC(y, Math.floor(m / 3) * 3, 1), Date.UTC(y, Math.floor(m / 3) * 3 + 3, 0)]
      : p === 'semiannual' ? [Date.UTC(y, m < 6 ? 0 : 6, 1), Date.UTC(y, m < 6 ? 6 : 12, 0)] : p === 'quadrennial' ? [Date.UTC(y, 0, 1), Date.UTC(y + 3, 11, 31)] : [Date.UTC(y, 0, 1), Date.UTC(y, 11, 31)];
    const iso = t => new Date(t).toISOString().slice(0, 10);
    for (const cr of vcard.credits || []) { if (cr.amountUsd == null) continue; const [st0, en] = span(cr.period); const days = Math.round((en - today) / 86400000);
      vRows.push({ owner: extra[0].owner, account_id: DEMO_VIRTUAL_ID, credit_id: cr.id, period_start: iso(st0), period_end: iso(en), state: 'unknown', evidence_ids: '[]', virtual: true,
        data: JSON.stringify({ title: cr.label, amount_cents: Math.round(cr.amountUsd * 100), requires_activation: !!cr.requiresActivation, days_left: days, alert: days <= 7, observed_cents: 0, source: cr.source, product_id: 'united-explorer' }) }); }
  }
  return { ...s, accounts: s.accounts.filter(a => ids.has(a.id)).concat(extra), purchases: (s.purchases || []).filter(keep), credit_status: (s.credit_status || []).filter(keep).concat(vRows), findings: (s.findings || []).filter(keep),
    evidence: (s.evidence || []).filter(e => (e.subject_type === 'perk' || e.subject_type === 'credit') ? ids.has(acctOf(e)) : true), hiddenOwn: s.accounts.length - ids.size };
}
/* Clearer display names than the catalog's short names (e.g. “Sapphire” vs “Reserve”). */
const SHORT_NAMES = { 'chase-sapphire-preferred': 'Sapphire Preferred', 'chase-sapphire-reserve': 'Sapphire Reserve', 'united-explorer': 'United Explorer', 'discover-it-cash-back': 'Discover it Cash Back', 'capital-one-savor': 'Capital One Savor', 'capital-one-venture-x': 'Venture X', 'bofa-customized-cash': 'BofA Customized Cash', 'citi-custom-cash': 'Citi Custom Cash', 'citi-double-cash': 'Citi Double Cash', 'citi-strata-premier': 'Citi Strata Premier', 'wells-fargo-active-cash': 'Wells Fargo Active Cash', 'wells-fargo-autograph': 'Wells Fargo Autograph', 'robinhood-gold-card': 'Robinhood Gold' };
function polishRules(r) {
  for (const [id, c] of Object.entries(r.cards || {})) {
    if (SHORT_NAMES[id]) c.short = SHORT_NAMES[id];
    for (const cr of c.credits || []) if (/every (4|four) years/i.test((cr.periodNote || '') + ' ' + ((cr.source && cr.source.quote) || ''))) cr.period = 'quadrennial';
    // 'Needs enrollment' only when the quoted terms say so (Oct 25: United's Global Entry/TSA credit was flagged but pays when the fee is charged to the card)
    for (const x of (c.credits || []).concat(c.perks || [])) if (x.requiresActivation && !/enrol|activat|opt-in|opt in|select one|sign up|must|add to their eligible|to get started/i.test((x.source && x.source.quote) || '')) x.requiresActivation = false;
  }
  return r;
}
const creditRule = (cards, c) => { const card = cards[c.d && c.d.product_id]; return card ? (card.credits || []).find(x => x.id === c.credit_id) : null; };
const PAID_RE = /auto-renewing|after you (purchase|pay for|buy|apply)|membership|subscription|application fee/i;
const needsPurchase = cr => !!cr && (cr.period === 'quadrennial' || PAID_RE.test((cr.source && cr.source.quote) || ''));

function UserDiv() {
  const { theme, toggleTheme } = useTheme(); const P = PAL[theme === 'dark' ? 'dark' : 'light'];
  const [bundle, setBundle] = React.useState(undefined); const [rules, setRules] = React.useState(null); const [E, setE] = React.useState(null); const [check, setCheck] = React.useState(null);
  const [svc, setSvc] = React.useState(null); const [stRaw, setSt] = React.useState(null); const st = React.useMemo(() => demoView(stRaw, rules), [stRaw, rules]); const [confirmExit, setConfirmExit] = React.useState(false); const [apiErr, setApiErr] = React.useState(null);
  const [route, setRoute] = React.useState(readRoute);
  const [policyFor, setPolicyFor] = React.useState(null);
  React.useEffect(() => FS.onValue(FS.ref(FS.db, relPathAddress('bundle')), s => setBundle(s.val())), []);
  React.useEffect(() => FS.onValue(FS.ref(FS.db, relPathAddress('service')), s => setSvc(s.val())), []);
  React.useEffect(() => { const h = () => setRoute(readRoute()); window.addEventListener('popstate', h); return () => window.removeEventListener('popstate', h); }, []);
  React.useEffect(() => {   // self-check: the pinned bundle must match its recorded hashes before anything is shown
    if (bundle === undefined) return;
    (async () => {
      try {
        if (!bundle || !bundle.rulesJson || !bundle.engineCode) throw new Error('rules bundle missing');
        const [rh, eh] = await Promise.all([sha256hex(bundle.rulesJson), sha256hex(bundle.engineCode)]);
        if (rh !== bundle.rulesHash) throw new Error('rules hash mismatch');
        if (eh !== bundle.engineHash) throw new Error('engine hash mismatch');
        const r = polishRules(JSON.parse(bundle.rulesJson)); const m = { exports: {} }; new Function('module', 'exports', bundle.engineCode)(m, m.exports);
        if (typeof m.exports.recommend !== 'function') throw new Error('engine incomplete');
        setRules(r); setE(m.exports);
        setCheck({ ok: true, text: `Rules ${bundle.rulesVersion} · ${Object.keys(r.cards).length} cards · ${bundle.acceptedRules} verified rules (${bundle.rejectedRules} rejected) · engine OK · ${bundle.rulesHash.slice(0, 10)}` });
      } catch (e) { setRules(null); setE(null); setCheck({ ok: false, text: 'Rules self-check failed: ' + e.message + '. Results are hidden rather than shown wrong.' }); }
    })();
  }, [bundle]);
  const call = React.useMemo(() => (svc && svc.url ? async (m, p, b) => { if (m !== 'GET' && (String(p) + JSON.stringify(b || '')).includes(DEMO_VIRTUAL_ID)) throw new Error('This demo card is view only.'); return apiCall(svc.url, m, p, b); } : null), [svc]);
  const refresh = React.useCallback(async () => { if (!call) return; try { setSt(await call('GET', '/v1/state')); setApiErr(null); } catch (e) { setApiErr(e.message); } }, [call]);
  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {   // changes made elsewhere (another tab, another device, Mana) show up when you come back to this tab
    const h = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', h); window.addEventListener('focus', h);
    return () => { document.removeEventListener('visibilitychange', h); window.removeEventListener('focus', h); };
  }, [refresh]);
  const firstLoad = React.useRef(true);
  React.useEffect(() => {   // every new visit (shared link, new tab, any ?bp) starts on the welcome page; reloads within the same tab keep their screen
    let seen = false; try { seen = sessionStorage.getItem('benny-entered') === '1'; sessionStorage.setItem('benny-entered', '1'); } catch (e) {}
    if (!seen && !(route.view === 'setup' && (route.step || 'welcome') === 'welcome')) go('setup', 'welcome', true);
  }, []);
  React.useEffect(() => {   // later in the session, a deep link still opens on the welcome page for anyone not set up yet
    if (!st || !firstLoad.current) return; firstLoad.current = false;
    if (!st.onboarded_at && !['setup', 'blueprint'].includes(route.view)) go('setup', null, true);
  }, [st]);

  const go = (view, step, replace) => { const u = new URL(window.location.href); u.searchParams.set('bp', view); u.searchParams.delete('benefitsView'); if (view === 'home') setTimeout(() => window.dispatchEvent(new Event('benny-benefits-reset')), 0);   // Benefits always opens on Your benefits (Eden, Oct 25)
    if (step) u.searchParams.set('step', step); else u.searchParams.delete('step'); u.searchParams.delete('card'); window.history[replace ? 'replaceState' : 'pushState']({}, '', u); setRoute({ view, step: step || '', card: null }); };
  const openCard = id => { const u = new URL(window.location.href); u.searchParams.set('bp', 'wallet'); u.searchParams.delete('step'); u.searchParams.set('card', id); window.history.pushState({}, '', u); setRoute({ view: 'wallet', step: '', card: id }); };
  const closeCard = () => { if (window.history.length > 1 && route.card) window.history.back(); else go('wallet', null, true); };
  const today = todayUTC();
  const feed = React.useMemo(() => { if (!E || !rules || !st) return null; try { return computeFeed(E, rules, st, today); } catch (e) { return { error: String(e && e.message || e) }; } }, [E, rules, st, today]);
  const autoCat = React.useRef('');
  React.useEffect(() => {   // new merchants the curated table doesn't know get an automatic category (from the fixed category list); you can change it later
    if (!call || !feed || feed.error) return;
    const unknown = [...new Set(feed.purchases.filter(p => !p.m).map(p => p.norm))].sort();
    const key = unknown.join('|'); if (!unknown.length || autoCat.current === key) return; autoCat.current = key;
    call('POST', '/v1/agents/categorize').then(r => { if (r && r.categorized) refresh(); }).catch(() => {});
  }, [feed, call]);
  const reviewItems = React.useMemo(() => (feed && !feed.error && st ? buildReview(st, feed, rules) : []), [feed, st, rules]);
  const onboarded = !!(st && st.onboarded_at);
  const view = ['blueprint', 'setup', 'home', 'savings', 'review', 'activity', 'wallet', 'shop'].includes(route.view) ? route.view : 'setup';   // no ?bp: the welcome page, for everyone; ?bp=home (Benefits) and ?bp=savings (Dashboard) stay valid
  const walletRolesAll = React.useMemo(() => (E && rules && st ? walletRoles(E, rules, st.accounts) : {}), [E, rules, st]);   // no ?bp: everyone (owner or visitor) lands on the welcome page
  const finish = async () => { await call('POST', '/v1/onboarded'); await refresh(); go('wallet', null, true); };
  const loadSample = async () => { try { await call('POST', '/v1/sample'); await refresh(); go('wallet', null, true); } catch (e) { setApiErr(e.message); } };
  const inSample = !!(st && st.accounts && st.accounts.some(a => a.sample));
  const [leaving, setLeaving] = React.useState(false);
  const exitDemo = async () => { setLeaving(true); try { await call('DELETE', '/v1/sample'); await refresh(); } catch (e) { setApiErr(e.message); } setLeaving(false); };
  const useOwn = async () => { setLeaving(true); try { await call('DELETE', '/v1/sample'); await refresh(); go('setup', 'cards'); } catch (e) { setApiErr(e.message); } setLeaving(false); };
  const leaveDemo = async () => { setLeaving(true); try { try { localStorage.removeItem(DEMO_PERKS_KEY); } catch (e) {} await call('DELETE', '/v1/sample'); const s = await call('GET', '/v1/state'); setSt(s); setConfirmExit(false); go('setup', 'welcome', true); } catch (e) { setApiErr(e.message); } setLeaving(false); };
  const ready = rules && E && st;
  const tabs = [['wallet', 'Wallet'], ['home', 'Benefits'], ['savings', 'Dashboard'], ['review', 'Review'], ['shop', 'Shop']];
  let uiInvariant = null; if (feed && !feed.error) { try { coverageLine(feed); } catch (e) { uiInvariant = e.message; } }
  return (
    <PalCtx.Provider value={P}><style>{FOIL_CSS}</style>
    <div className="relative flex w-full flex-col" style={{ height: 'var(--mana-app-height, 82vh)', background: P.bg, color: P.ink }}>
      {ready && policyFor && view === 'wallet' && <PolicySheet a={st.accounts.find(x => x.id === policyFor)} st={st} cards={rules.cards} rules={rules} E={E} call={call} refresh={refresh} roles={walletRolesAll} onClose={() => setPolicyFor(null)} />}
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
        <button onClick={() => go('wallet', null)} title="Wallet" className="flex items-baseline gap-0.5 text-[19px] font-semibold tracking-tight" style={{ fontFamily: SERIF }}>Benny<span style={{ color: P.accent, display: 'inline-flex', alignSelf: 'center', marginLeft: 2 }}><BennyRosette /></span></button>
        <div className="flex items-center gap-2">{!onboarded && view === 'blueprint' && <button onClick={() => go('setup', null)} className="rounded-full px-3 py-1.5 text-[13px] font-medium" style={{ color: P.accent }}>Get started</button>}
          
          {ready && !inSample && view !== 'setup' && view !== 'wallet' && <button onClick={() => go('setup', 'cards')} className="benny-foil rounded-full px-3 py-1.5 text-[12.5px] font-medium" style={{ border: `1px solid ${P.lineStrong}`, color: P.ink }}><Sheen /><span className="benny-label">Add my cards</span></button>}
          {ready && !inSample && view !== 'setup' && <button onClick={() => go('setup', 'welcome')} disabled={leaving} title="Back to the start: set up your wallet or try the demo" className="benny-foil rounded-full px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50" style={{ border: `1px solid ${P.lineStrong}`, color: P.muted }}><Sheen /><span className="benny-label">Try demo</span></button>}
          {ready && inSample && view !== 'setup' && <Btn small kind="primary" disabled={leaving} onClick={leaveDemo}>{leaving ? 'Exiting…' : 'Exit demo'}</Btn>}   {/* one click: clears the sample, opens the welcome page (Eden, Oct 25) */}
          <button onClick={toggleTheme} aria-label="Toggle light and dark" title="Light / dark" className="ml-1 flex h-8 w-8 items-center justify-center rounded-full" style={{ border: `1px solid ${P.lineStrong}`, color: P.muted }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">{theme === 'dark' ? <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></> : <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />}</svg></button></div>
      </div>
      {ready && inSample && view !== 'setup' && (
        <div className="mx-5 mb-1 flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl px-4 py-2.5" style={{ background: P.infoSoft, border: `1px solid ${P.line}` }}>
          <div className="flex items-center gap-2 text-[13px] leading-5"><span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: P.info }}><Ico name="flask" size={15} />Demo</span><span style={{ color: P.muted }}>{confirmExit ? 'Removes sample data. Your cards stay.' : `Sample data${st.hiddenOwn ? ` · your ${st.hiddenOwn} card${st.hiddenOwn === 1 ? '' : 's'} hidden` : ''}`}</span></div>
        </div>)}
      <div className={`min-h-0 flex-1 overflow-y-auto ${view === 'setup' ? 'pb-0' : 'pb-28'}`}>
        {((st && st.invariants && !st.invariants.ok) || uiInvariant) && <div className="mx-auto max-w-3xl px-5 pt-4 text-[12px]" style={{ color: P.danger }}>Invariant check failing: {uiInvariant || st.invariants.failures.slice(0, 3).join(' · ')}</div>}
        {check && !check.ok && <div className="mx-auto max-w-3xl px-5 pt-6 text-[13px]" style={{ color: P.danger }}>{check.text}</div>}
        {apiErr && <div className="mx-auto max-w-3xl px-5 pt-6 text-[13px]" style={{ color: P.danger }}>Benny+ server: {apiErr}</div>}
        {(svc === null || bundle === undefined) && <div className="px-5 py-16 text-center text-[13px]" style={{ color: P.muted }}>Connecting…</div>}
        {svc && check && check.ok && !st && !apiErr && view !== 'blueprint' && <div className="px-5 py-16 text-center text-[13px]" style={{ color: P.muted }}>Loading your wallet…</div>}
        {view === 'blueprint' && <Blueprint st={st} check={check} />}
        {ready && view === 'setup' && <div className="flex min-h-full flex-col"><Setup key={inSample ? "demo" : "own"} step={route.step} go={go} cards={rules.cards} st={st} call={call} refresh={refresh} loadSample={loadSample} finish={finish} inSample={inSample} useOwn={useOwn} leaving={leaving} rules={rules} E={E} />{!['cards', 'data'].includes(route.step) && <div className="relative z-0" style={{ marginTop: 'clamp(-96px, -6vw, -44px)' }}><Pasture /></div>}</div>}
        {ready && feed && feed.error && view !== 'blueprint' && view !== 'setup' && <div className="mx-auto max-w-3xl px-5 py-6 text-[13px]" style={{ color: P.danger }}>The engine couldn’t evaluate your records: {feed.error}</div>}
        {ready && feed && !feed.error && view === 'home' && <Home feed={feed} st={st} cards={rules.cards} go={go} call={call} refresh={refresh} reviewCount={reviewItems.length} />}
        {ready && feed && !feed.error && (view === 'savings' || view === 'activity') && <Savings feed={feed} st={st} cards={rules.cards} go={go} reviewCount={reviewItems.length} call={call} refresh={refresh} />}
        {ready && feed && !feed.error && view === 'review' && <Review st={st} feed={feed} cards={rules.cards} rules={rules} E={E} call={call} refresh={refresh} />}
        
        {ready && view === 'shop' && <Shop st={st} cards={rules.cards} rules={rules} E={E} call={call} refresh={refresh} onOpenCard={openCard} />}
        {ready && view === 'wallet' && <Wallet st={st} cards={rules.cards} rules={rules} E={E} feed={feed && !feed.error ? feed : null} call={call} refresh={refresh} onOpenPolicy={setPolicyFor} cardId={route.card} onOpenCard={openCard} onCloseCard={closeCard} roles={walletRolesAll} />}
      </div>
      {view !== 'setup' && (
        <nav aria-label="Benny+ sections" className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-full p-1.5" style={{ background: dark(P) ? 'rgba(17,29,23,0.82)' : 'rgba(251,250,243,0.86)', border: `1px solid ${P.line}`, boxShadow: dark(P) ? '0 12px 32px -12px rgba(0,0,0,0.7)' : '0 12px 32px -14px rgba(22,36,28,0.35)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
            {tabs.map(([k, l]) => { const on = view === k || (k === 'savings' && view === 'activity'); return (
              <button key={k} onClick={() => go(k, null, true)} aria-current={on ? 'page' : undefined} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors" style={on ? { background: P.accent, color: P.accentInk } : { color: P.muted }}>
                {l}{k === 'review' && reviewItems.length ? <span className="rounded-full px-1.5 text-[11px] font-bold" style={on ? { background: 'rgba(255,255,255,0.25)', color: P.accentInk } : { background: P.danger, color: '#fff' }}>{reviewItems.length}</span> : null}
              </button>); })}
          </div>
        </nav>)}
    </div>
    </PalCtx.Provider>
  );
}

