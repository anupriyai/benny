/* Benny+ rewards decision layer: turns a user's records + the pinned rules into every number the app shows
   (earned rewards, missed rewards, cards you have vs trying, receipt estimates, what-if comparisons, fees).
   Pure functions, no I/O, no AI. GENERATED from app/benny-plus.jsx by scripts/extract_decisions.py; the test fails if they drift.
   Money math per purchase comes from the shared engine (engine.recommend / scoreCard). */
'use strict';
const DAYMS = 86400000;

const jparse = s => { try { return typeof s === 'string' ? JSON.parse(s) : (s || {}); } catch (e) { return {}; } };

const mnorm = s => String(s || '').toLowerCase().replace(/[’'`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function categoryMap(st) {
  const m = {};
  for (const e of st.evidence || []) {
    if (e.subject_type !== 'category' || !String(e.subject_id).startsWith('m:')) continue;
    const k = e.subject_id.slice(2); const d = jparse(e.data);
    if (e.strength === 'confirmed' || !m[k]) m[k] = { level: e.strength, category: d.category, evidence: e };
  }
  return m;
}

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
    const clash = a => !!(a && rv.paid.last4 && a.mask && a.mask !== rv.paid.last4);   // the receipt prints a different card number: paid with something else
    let acct = rv.paid.account && roleOf[rv.paid.account.id] === 'held' && !(rv.paid.how === 'only' && clash(rv.paid.account)) ? rv.paid.account : null;
    if (!acct && held.length === 1 && !(rv.paid.account && rv.paid.firm) && !clash(held[0])) acct = held[0];
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

module.exports = { jparse, mnorm, categoryMap, cardRole, NOT_CARD_SPEND, BROKERS, BASE_MERCHANT, computeFeed, coverageLine, walletAccts, NET_ALIAS, docFacts, resolvePaid, receiptView };
