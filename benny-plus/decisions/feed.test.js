// Decision-layer tests on synthetic sample data: node benny-plus/decisions/feed.test.js
'use strict';
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const HERE = __dirname; const ROOT = path.join(HERE, '..');
const E = require(path.join(ROOT, 'bundle/engine.js'));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'bundle/rules.snapshot.json'), 'utf8'));
const F = require('./feed.js');
const base = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/sample_state.json'), 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));
const today = E.parse('2026-10-25');
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.011, `${m}: ${a} vs ${b}`);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const [SAP, COST] = base.accounts.map(a => a.id);
const valueOn = (cardId, m, amt) => E.recommend(rules, [cardId], m, amt, 'cash').top.valueUsd;

// 0. the module is exactly the app's decision code (no drift)
const app = fs.readFileSync(path.join(ROOT, 'app/benny-plus.jsx'), 'utf8');
for (const fn of Object.keys(F).filter(k => typeof F[k] === 'function')) {
  const src = F[fn].toString(); ok(app.includes(src.split('\n')[0]) && app.includes(src), 'feed.js ' + fn + ' matches app/benny-plus.jsx (run scripts/extract_decisions.py)');
}

// 1. sample wallet: both cards held, earned = engine value of every purchase on the card used
let f = F.computeFeed(E, rules, base, today);
ok(f.held.length === 2 && f.trying.length === 0, 'sample cards count as held');
ok(f.coverage.comparable, 'two held cards are comparable');
let expect = 0; for (const p of f.purchases) if (today - E.parse(p.date) <= 120 * F.computeFeed.length * 0 + 120 * 86400000) expect += valueOn(p.cardId, p.m || F.BASE_MERCHANT, p.total);
near(f.windowEarned, expect, 'earned is the sum of per-purchase engine values');
ok(f.windowEarned > 0, 'earned is positive');
ok(f.missed.every(x => x.top.cardId !== x.p.cardId && x.high >= 0.25), 'missed rewards only name a different held card');
ok(f.fees.some(x => x.acct.id === SAP && x.usd === 95), 'Sapphire annual fee listed');
const earned0 = f.windowEarned;

// 2. a hand-picked card with no purchases is TRYING: never in totals, scored as a what-if
let s = clone(base); s.accounts.push({ id: 'acct_try', product_id: 'amex-gold', product_confirmed: 1, source: 'manual', sample: 0, mask: null });
s.accounts.push({ id: 'acct_try2', product_id: 'citi-double-cash', product_confirmed: 1, source: 'manual', sample: 0, mask: null });
f = F.computeFeed(E, rules, s, today);
ok(f.trying.map(a => a.id).sort().join() === 'acct_try,acct_try2', 'unconnected picked cards are trying');
near(f.windowEarned, earned0, 'trying cards add nothing to earned');
const amex = f.whatIf.find(w => w.cardId === 'amex-gold'); const dc = f.whatIf.find(w => w.cardId === 'citi-double-cash');
ok(amex && amex.noCash && amex.points > 0, 'points card without cash value shows points, not $0');
ok(dc && !dc.noCash && dc.value > 0, 'cash card what-if has a dollar value');
near(dc.delta, dc.value - f.windowEarned, 'what-if delta is vs your cards');
ok(f.whatIf[f.whatIf.length - 1].noCash, 'no-cash-value cards sort last');
ok(!f.missed.some(x => x.top.cardId === 'amex-gold' || x.top.cardId === 'citi-double-cash'), 'missed rewards never cite a trying card');

// 3. explicit roles win over the automatic rule
s = clone(base); s.accounts.find(a => a.id === COST).role = 'trying';
f = F.computeFeed(E, rules, s, today);
ok(f.held.length === 1 && !f.coverage.comparable, 'role trying removes a card from totals');
ok(f.purchases.every(p => p.accountId === SAP), 'purchases on a trying card are excluded');
s = clone(base); s.accounts.push({ id: 'acct_have', product_id: 'apple-card', product_confirmed: 1, source: 'manual', sample: 0, mask: null, role: 'held' });
ok(F.computeFeed(E, rules, s, today).roleOf.acct_have === 'held', 'role held makes an empty card count as yours');
ok(F.cardRole({ id: 'x', source: 'plaid' }, { purchases: [] }) === 'held', 'Plaid-connected card is held');
ok(F.cardRole({ id: 'x', source: 'manual' }, { purchases: [{ account_id: 'x' }] }) === 'held', 'card with purchases is held');

// 4. unknown merchants earn the everyday rate instead of $0
s = clone(base); s.purchases.push({ id: 'p_unknown', account_id: SAP, amount_cents: 10000, currency: 'USD', posted_on: '2026-10-21', merchant_raw: 'ZZQX STUDIO 44', merchant_normalized: 'zzqx studio 44', kind: 'purchase', pending: 0 });
f = F.computeFeed(E, rules, s, today);
near(f.windowEarned - earned0, valueOn('chase-sapphire-preferred', F.BASE_MERCHANT, 100), 'unknown store earns the base rate');
ok(f.baseRated >= 1, 'base-rated purchases are counted for the estimate note');

// 5. receipts with no bank transaction: counted once, never trades, never duplicates
const doc = (id, ex, subject) => ({ id, kind: 'email', subject: subject || 'Your receipt', doc_date: ex.purchase_date, extracted: JSON.stringify(Object.assign({ is_purchase_document: true, document_type: 'receipt', currency: 'USD', items: [] }, ex)) });
s = clone(base); s.documents = [
  doc('d_ok', { merchant: 'Blue Bottle Coffee', purchase_date: '2026-10-21', total_cents: 1175, payment_last4: '4821' }),
  doc('d_trade', { merchant: 'Robinhood', purchase_date: '2026-10-21', total_cents: 560760, document_type: 'order_confirmation' }, 'Your order has been executed'),
  doc('d_dupe', { merchant: 'Sweetgreen', purchase_date: '2026-10-22', total_cents: 1685, payment_last4: '1234' }),
  doc('d_ship', { merchant: 'Zenni', purchase_date: '2026-10-21', total_cents: 3000, document_type: 'shipping' }),
  doc('d_nocard', { merchant: 'Corner Deli', purchase_date: '2026-10-20', total_cents: 900 })];
f = F.computeFeed(E, rules, s, today);
ok(f.receipts.counted === 1, 'only the real unbanked receipt is counted');
ok(f.receipts.unassigned === 1, 'a receipt with no card and two held cards is not guessed');
near(f.receipts.spent, 11.75, 'receipt amount');
near(f.windowEarned - earned0, valueOn('chase-sapphire-preferred', F.receiptView(s.documents[0], s, rules, E, 'cash').merchant, 11.75), 'receipt earns on the card it names');
s.accounts = s.accounts.filter(a => a.id === SAP); s.purchases = s.purchases.filter(p => p.account_id === SAP);
ok(F.computeFeed(E, rules, s, today).receipts.counted === 2, 'with one held card, a receipt without a card is assumed on it');

console.log('decision tests: ' + n + ' passed');
