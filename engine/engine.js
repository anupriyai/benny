/* Benny engine v0.1: every money and coverage decision, made from the rules JSON.
   Pure functions: no framework, no I/O, no AI. Gemini only supplies inputs (fields, incident type); it never decides here.
   Lives at apps/benny/app/engine (code node). The app loads it with new Function('module','exports',src);
   Node runs it for tests: node /workspace/benny/engine.test.js.  Owner: Engine + Demo person. */
'use strict';
const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
const parse = s => { if (typeof s === 'number') return s; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (t, n) => t + n * DAY;
function addMonths(t, n) { const d = new Date(t); const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate(); r.setUTCDate(Math.min(d.getUTCDate(), last)); return r.getTime(); }
const daysLeft = (from, to) => Math.round((to - from) / DAY);
const r2 = n => Math.round(n * 100) / 100;
const usd = n => '$' + r2(n).toFixed(2);
const arr = v => Array.isArray(v) ? v.filter(x => x != null) : (v && typeof v === 'object' ? Object.values(v) : []);
const norm = s => String(s || '').toLowerCase().replace(/[’'`.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cardsOf = (rules, ids) => arr(ids).map(id => rules.cards[id]).filter(Boolean);

/* ---------- merchants ---------- */
function findMerchant(mccTable, query) {
  const q = norm(query); if (!q) return { match: null, candidates: [] };
  const scored = [];
  for (const m of arr(mccTable)) {
    const names = [m.name].concat(arr(m.aliases)).map(norm);
    let s = 0;
    for (const n of names) {
      if (n === q) s = Math.max(s, 100);
      else if (q.includes(n) && n.length >= 3) s = Math.max(s, 60 + n.length);
      else if (n.includes(q) && q.length >= 3) s = Math.max(s, 40 + q.length);
    }
    if (s) scored.push({ m, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return { match: scored[0] ? scored[0].m : null, candidates: scored.slice(0, 5).map(x => x.m) };
}
function merchantOf(rules, purchase) {
  const m = arr(rules.mcc).find(x => x.id === purchase.merchantId);
  return m || { id: purchase.merchantId || 'unknown', name: purchase.merchant, categories: arr(purchase.categories).length ? arr(purchase.categories) : [purchase.category || 'other'], confidence: 'low' };
}

/* ---------- earning ---------- */
function unitValue(card, mode) {
  const c = card.currency || {}; const vc = c.valueCents || {};
  if (c.unit === 'cashback') return { cents: 1, basis: 'cash back', source: c.source, note: null };
  if (mode === 'travel' && vc.travel != null) return { cents: vc.travel, basis: 'travel estimate', source: c.travelSource || c.source, note: 'Estimate; actual value depends on what you book.' };
  if (vc.cash != null) return { cents: vc.cash, basis: 'guaranteed cash value', source: c.source, note: null };
  return { cents: 0, basis: 'no guaranteed cash value', source: c.source, note: (c.unitLabel || 'Miles') + ' have no fixed cash value. Switch to “I transfer points to travel” to use an estimate.' };
}
function earnRule(card, merchant, wantConditional) {
  const cats = arr(merchant.categories); let best = null;
  for (const r of arr(card.earn)) {
    if (!!r.conditional !== !!wantConditional) continue;  // conditional rates (chosen/rotating/top category) are never counted
    if (arr(r.excludeMerchants).includes(merchant.id)) continue;
    const rc = arr(r.categories);
    const hit = rc.includes('*') || arr(r.merchants).includes(merchant.id) || rc.some(c => cats.includes(c));
    if (hit && (!best || r.rate > best.rate)) best = r;
  }
  return best;
}
function scoreCard(card, merchant, amount, mode) {
  const rule = earnRule(card, merchant) || { rate: 0, label: 'no matching rule' };
  const uv = unitValue(card, mode); const cash = card.currency.unit === 'cashback';
  const earned = cash ? amount * rule.rate / 100 : amount * rule.rate;
  const valueUsd = cash ? earned : earned * uv.cents / 100;
  const unitLabel = card.currency.unitLabel || 'points';
  const explanation = cash
    ? `${rule.rate}% ${rule.label} × ${usd(amount)} = ${usd(valueUsd)}${card.currency.note ? ' (' + card.currency.noteShort + ')' : ''}`
    : `${rule.rate}x ${rule.label} × ${usd(amount)} = ${Math.round(earned)} ${unitLabel} × ${uv.cents}¢ (${uv.basis}) = ${usd(valueUsd)}`;
  const cond = earnRule(card, merchant, true);
  const conditional = cond && cond.rate > rule.rate ? { rate: cond.rate, condition: cond.condition || 'conditional', label: cond.label, source: cond.source,
    text: `Up to ${cond.rate}${cash ? '%' : 'x'} if ${String(cond.condition || 'a condition is met').replace(/^only |^if /i, '')} (not counted)` } : null;
  return { cardId: card.cardId, name: card.name, short: card.short || card.name, rate: rule.rate, rule, valueUsd: r2(valueUsd), earned, unitValue: uv, explanation, conditional };
}
function rank(cards, merchant, amount, mode) {
  return cards.map(c => scoreCard(c, merchant, amount, mode)).sort((a, b) => b.valueUsd - a.valueUsd || b.rate - a.rate);
}
function recommend(rules, walletIds, merchant, amount, mode) {
  const cards = cardsOf(rules, walletIds);
  const ranking = rank(cards, merchant, amount, mode);
  const top = ranking[0], second = ranking[1];
  const out = { merchant, amount, mode, ranking, top, diffUsd: top && second ? r2(top.valueUsd - second.valueUsd) : null, tie: !!(top && second && top.valueUsd === second.valueUsd), mccNote: null, alt: null };
  if (merchant.alt) {
    const altM = Object.assign({}, merchant, { categories: arr(merchant.alt.categories), mcc: merchant.alt.mcc });
    const altRank = rank(cards, altM, amount, mode); const at = altRank[0];
    const primaryTopInAlt = altRank.find(x => x.cardId === (top && top.cardId));
    out.alt = { label: merchant.alt.label, ranking: altRank };
    if (at && primaryTopInAlt) {
      const usual = `Usually coded as ${merchant.codedAs || arr(merchant.categories)[0]} (MCC ${merchant.mcc}).`;
      if (at.cardId !== top.cardId && at.valueUsd > primaryTopInAlt.valueUsd) out.mccNote = `${usual} If it codes as ${merchant.alt.label}, ${at.short} wins by ${usd(at.valueUsd - primaryTopInAlt.valueUsd)}.`;
      else if (at.valueUsd !== top.valueUsd) out.mccNote = `${usual} If it codes as ${merchant.alt.label}, ${at.short} earns ${usd(at.valueUsd)} instead of ${usd(top.valueUsd)}.`;
      else out.mccNote = `${usual} Coding as ${merchant.alt.label} wouldn’t change the answer.`;
    }
  }
  return out;
}

/* ---------- credits ---------- */
function period(credit, today) {
  const d = new Date(today), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (credit.period === 'monthly') return { key: `${y}-${String(m + 1).padStart(2, '0')}`, start: Date.UTC(y, m, 1), end: Date.UTC(y, m + 1, 0) };
  if (credit.period === 'quarterly') { const q = Math.floor(m / 3); return { key: `${y}-Q${q + 1}`, start: Date.UTC(y, q * 3, 1), end: Date.UTC(y, q * 3 + 3, 0) }; }
  if (credit.period === 'semiannual') { const h = m < 6 ? 0 : 1; return { key: `${y}-H${h + 1}`, start: Date.UTC(y, h * 6, 1), end: Date.UTC(y, h * 6 + 6, 0) }; }
  return { key: String(y), start: Date.UTC(y, 0, 1), end: Date.UTC(y, 11, 31) };
}
const useKey = (cardId, creditId, key) => `${cardId}__${creditId}__${key}`;
function creditStatuses(rules, state, today) {
  const out = []; const wallet = state.wallet || {}; const purchases = arr(state.purchases); const uses = state.creditUses || {};
  for (const id of Object.keys(wallet)) {
    const card = rules.cards[id]; if (!card) continue;
    for (const cr of arr(card.credits)) {
      if (cr.amountUsd == null) continue;
      const p = period(cr, today);
      const matched = purchases.find(pu => pu.cardId === id && arr(cr.match && cr.match.merchants).includes(pu.merchantId) && parse(pu.date) >= p.start && parse(pu.date) <= p.end);
      const manual = uses[useKey(id, cr.id, p.key)];
      const activated = !!(wallet[id].activated && wallet[id].activated[cr.id]);
      let status = 'open', note = null;
      if (cr.requiresActivation && !activated) { status = 'needs_activation'; if (matched) note = `You paid ${matched.merchant} with this card on ${matched.date}, but the credit isn’t turned on, so it won’t pay out.`; }
      else if (matched) { status = 'used'; note = `Matched ${matched.merchant} ${usd(matched.total)} on ${matched.date}.`; }
      else if (manual) { status = 'used'; note = 'You marked this used.'; }
      out.push({ kind: 'credit', id: useKey(id, cr.id, p.key), cardId: id, credit: cr, periodKey: p.key, amountUsd: cr.amountUsd, deadline: p.end, daysLeft: daysLeft(today, p.end), status, note, title: cr.label, source: cr.source });
    }
  }
  return out;
}
function activationChecklist(rules, state) {
  const wallet = state.wallet || {}; const out = [];
  for (const id of Object.keys(wallet)) {
    const card = rules.cards[id]; if (!card) continue;
    for (const cr of arr(card.credits).concat(arr(card.perks))) {
      if (!cr.requiresActivation) continue;
      if (wallet[id].activated && wallet[id].activated[cr.id]) continue;
      out.push({ cardId: id, cardName: card.short || card.name, perk: cr });
    }
  }
  return out;
}

/* ---------- protections ---------- */
function capFor(pr, price) {
  if (pr.perItemCapUsd == null) return { maxUsd: price, capKnown: false, text: `Up to the amount charged (${usd(price)}); per-item cap not confirmed` };
  const m = Math.min(price, pr.perItemCapUsd);
  return { maxUsd: m, capKnown: true, text: m < price ? `Up to ${usd(pr.perItemCapUsd)} per item (you paid ${usd(price)})` : `Up to the amount charged, ${usd(price)}` };
}
function protectionsForPurchase(purchase, card, today) {
  const out = []; if (!card || purchase.kind === 'fare' || purchase.durable === false) return out;  // goods only: no groceries, fuel, rides, meals
  const bought = parse(purchase.date); const price = purchase.itemPrice != null ? purchase.itemPrice : purchase.total;
  for (const pr of arr(card.protections)) {
    if (pr.incomplete) continue;  // listed by the issuer but terms not confirmed: never used to decide
    if (pr.type === 'purchase_protection') {
      const end = addDays(bought, pr.windowDays);
      out.push({ type: pr.type, label: pr.label, start: bought, end, status: today <= end ? 'active' : 'expired', cap: capFor(pr, price), pr });
    } else if (pr.type === 'extended_warranty') {
      if (purchase.durable === false) continue;
      const mw = purchase.mfrWarrantyMonths;
      if (mw == null) { out.push({ type: pr.type, label: pr.label, status: 'needs_info', reason: 'Manufacturer warranty length unknown', pr }); continue; }
      if (mw > pr.maxOriginalWarrantyMonths) { out.push({ type: pr.type, label: pr.label, status: 'not_eligible', reason: `Manufacturer warranty of ${mw} months exceeds the ${pr.maxOriginalWarrantyMonths}-month limit`, pr }); continue; }
      const start = addMonths(bought, mw); const end = Math.min(addMonths(start, pr.addsMonths), addMonths(bought, pr.maxTotalMonths));
      out.push({ type: pr.type, label: pr.label, start, end, status: today < start ? 'manufacturer' : today <= end ? 'active' : 'expired', cap: capFor(pr, price), pr });
    }
  }
  return out;
}

/* ---------- claims ---------- */
const CLAIM_KIND = { product_failure: 'extended_warranty', damage: 'purchase_protection', theft: 'purchase_protection', lost: 'purchase_protection', trip_delay: 'trip_delay' };
const DOC_LABEL = { receipt: 'Itemized receipt', purchase_record: 'Purchase record (Benny)', statement: 'Card statement showing the charge', warranty: 'Manufacturer’s warranty', repair_estimate: 'Repair estimate or failure report', police_report: 'Police report (theft)', itinerary: 'Travel itinerary', carrier_statement: 'Airline’s written reason for the delay', expense_receipts: 'Receipts for meals, hotel, essentials', claim_form: 'Completed claim form' };
function docsFor(pr, purchase, incident) {
  const ids = ['purchase_record'].concat(arr(pr.requiredDocs));
  if (incident.type === 'theft' && pr.type === 'purchase_protection' && !ids.includes('police_report')) ids.push('police_report');
  const have = { purchase_record: true, receipt: !!purchase.hasReceipt, itinerary: purchase.kind === 'fare', warranty: !!purchase.warrantyDoc };
  return ids.map(id => ({ id, label: DOC_LABEL[id] || id, have: !!have[id] }));
}
function deadlinesFor(pr, incidentT, today) {
  const c = pr.claim || {}; const out = [];
  if (c.notifyDays != null) { const t = addDays(incidentT, c.notifyDays); out.push({ label: `Tell the benefit administrator (within ${c.notifyDays} days)`, date: iso(t), daysLeft: daysLeft(today, t) }); }
  else out.push({ label: 'Tell the benefit administrator as soon as possible', date: null, daysLeft: null });
  if (c.docsDays != null) { const t = addDays(incidentT, c.docsDays); out.push({ label: `Send documents (within ${c.docsDays} days)`, date: iso(t), daysLeft: daysLeft(today, t) }); }
  return out;
}
function evaluateCore(incident, purchase, card, today) {
  const kind = CLAIM_KIND[incident.type];
  const res = { decision: 'not_covered', kind, card: card ? { cardId: card.cardId, name: card.name, short: card.short } : null, reasons: [], clause: null, payout: null, deadlines: [], docs: [], claimsUrl: card && card.claims ? card.claims.url : null, phone: card && card.claims ? card.claims.phone : null };
  if (!kind) { res.decision = 'needs_info'; res.reasons.push({ ok: false, text: 'Benny couldn’t match this to a card protection. Describe what happened (broke, damaged, stolen, delayed).' }); return res; }
  if (!card) { res.decision = 'needs_info'; res.reasons.push({ ok: false, text: 'Which card paid for this? Coverage depends on the card used.' }); return res; }
  const pr = arr(card.protections).find(p => p.type === kind);
  const incidentT = incident.date ? parse(incident.date) : today;
  if (!pr) {
    const nc = card.noCoverage && card.noCoverage[kind];
    res.reasons.push({ ok: false, text: `${card.short || card.name} has no ${kind.replace(/_/g, ' ')} benefit.` });
    if (nc) res.clause = nc;
    if (kind === 'extended_warranty') res.reasons.push({ ok: true, text: 'Your manufacturer’s warranty and the store’s return policy still apply.' });
    return res;
  }
  res.clause = pr.source; res.protection = { type: pr.type, label: pr.label };
  if (pr.incomplete) {
    res.decision = 'needs_info';
    res.reasons.push({ ok: true, text: `${card.short || card.name} lists ${pr.label.toLowerCase()}.` });
    res.reasons.push({ ok: false, text: `Benny hasn’t confirmed its terms (${arr(pr.incomplete).join(', ')}), so it won’t guess coverage. Check the card’s Guide to Benefits or call the administrator.` });
    return res;
  }
  res.claimsUrl = pr.claimsUrl || res.claimsUrl;
  const paidOk = { ok: true, text: `Paid with ${card.short || card.name} on ${purchase.date}.` };
  if (kind === 'extended_warranty') {
    res.reasons.push(paidOk);
    const ps = protectionsForPurchase(purchase, card, incidentT).find(p => p.type === kind);
    if (!ps || ps.status === 'needs_info') { res.decision = 'needs_info'; res.reasons.push({ ok: false, text: 'How long was the manufacturer’s warranty? Coverage starts when it ends.' }); res.ask = 'mfrWarrantyMonths'; return res; }
    if (ps.status === 'not_eligible') { res.reasons.push({ ok: false, text: ps.reason + '.' }); return res; }
    res.reasons.push({ ok: true, text: `Manufacturer warranty: ${purchase.mfrWarrantyMonths} months (limit ${pr.maxOriginalWarrantyMonths}).` });
    if (ps.status === 'manufacturer') { res.decision = 'manufacturer'; res.reasons.push({ ok: false, text: `Still under the manufacturer’s warranty until ${iso(ps.start)}. Claim with the manufacturer first; the card’s extra year starts after that and runs to ${iso(ps.end)}.` }); return res; }
    if (ps.status === 'expired') { res.reasons.push({ ok: false, text: `Card coverage ended ${iso(ps.end)}.` }); return res; }
    res.reasons.push({ ok: true, text: `Card’s extra year runs ${iso(ps.start)} to ${iso(ps.end)}; failure on ${iso(incidentT)} is inside it.` });
    res.decision = 'covered'; res.payout = ps.cap;
  } else if (kind === 'purchase_protection') {
    res.reasons.push(paidOk);
    if (incident.type === 'lost') { res.reasons.push({ ok: false, text: 'Items that are lost or “mysteriously disappear” are excluded.' }); if (pr.lostExclusion) res.clause = pr.lostExclusion; return res; }
    const end = addDays(parse(purchase.date), pr.windowDays);
    if (incidentT > end) { res.reasons.push({ ok: false, text: `Coverage lasts ${pr.windowDays} days from purchase and ended ${iso(end)}.` }); return res; }
    res.reasons.push({ ok: true, text: `${incident.type === 'theft' ? 'Theft' : 'Damage'} on ${iso(incidentT)} is within ${pr.windowDays} days of purchase (until ${iso(end)}).` });
    if (pr.secondary) res.reasons.push({ ok: true, text: 'Secondary to other insurance (homeowner’s, renter’s); it covers what they don’t, including your deductible.' });
    res.decision = 'covered'; res.payout = capFor(pr, purchase.itemPrice != null ? purchase.itemPrice : purchase.total);
  } else if (kind === 'trip_delay') {
    if (purchase.kind !== 'fare') { res.decision = 'needs_info'; res.reasons.push({ ok: false, text: 'Trip delay needs the flight purchase. Which ticket was it?' }); return res; }
    res.reasons.push({ ok: true, text: `Fare paid with ${card.short || card.name} on ${purchase.date}.` });
    const h = incident.delayHours;
    if (h == null && incident.overnight == null) { res.decision = 'needs_info'; res.reasons.push({ ok: false, text: 'How long was the delay, and did it force an overnight stay?' }); return res; }
    if (!((h != null && h > pr.minDelayHours) || incident.overnight)) {
      res.reasons.push({ ok: false, text: `Delay of ${h} hours. Coverage needs more than ${pr.minDelayHours} hours or an overnight stay.` });
      res.reasons.push({ ok: true, text: `If the delay passes ${pr.minDelayHours} hours or forces an overnight stay, it qualifies. Keep meal and hotel receipts now.` });
      res.deadlines = deadlinesFor(pr, incidentT, today); return res;
    }
    res.reasons.push({ ok: true, text: incident.overnight ? 'The delay forced an overnight stay.' : `Delay of ${h} hours is over ${pr.minDelayHours}.` });
    const cause = incident.delayCause || 'unknown';
    if (cause === 'other') { res.decision = 'needs_info'; res.reasons.push({ ok: false, text: 'Only equipment failure, weather, strike or hijacking qualify. Ask the airline for the written reason.' }); }
    else { if (cause === 'unknown') res.reasons.push({ ok: true, text: 'Cause must be equipment failure, weather, strike or hijacking; get it in writing from the airline.' }); res.decision = cause === 'unknown' ? 'covered' : 'covered'; }
    res.payout = { maxUsd: pr.perTravelerCapUsd, capKnown: true, text: `Up to ${usd(pr.perTravelerCapUsd)} per traveler for meals, lodging, toiletries and medication` };
  }
  res.deadlines = deadlinesFor(pr, incidentT, today);
  res.docs = docsFor(pr, purchase, incident);
  return res;
}
function evaluateClaim(rules, state, incident, purchase, today) {
  const card = purchase ? rules.cards[purchase.cardId] : null;
  const res = evaluateCore(incident, purchase || {}, card, today);
  res.hindsight = [];
  if (purchase && card) {
    for (const other of cardsOf(rules, Object.keys(state.wallet || {}))) {
      if (other.cardId === card.cardId) continue;
      const alt = evaluateCore(incident, Object.assign({}, purchase, { cardId: other.cardId }), other, today);
      if (alt.decision === 'covered' && res.decision !== 'covered') res.hindsight.push(`Paying with ${other.short || other.name} would have covered this.`);
      else if (alt.decision === 'covered' && res.payout && alt.payout && alt.payout.maxUsd > res.payout.maxUsd) res.hindsight.push(`With ${other.short || other.name} the limit would have been ${usd(alt.payout.maxUsd)}.`);
    }
  }
  return res;
}

/* ---------- summaries ---------- */
function owedSummary(rules, state, today) {
  const credits = creditStatuses(rules, state, today);
  const certs = arr(state.certificates).filter(c => !c.redeemed && today <= parse(c.expires)).map(c => {
    const card = rules.cards[c.cardId] || {}; const rule = card.certificate || {};
    return { kind: 'certificate', id: c.id, cardId: c.cardId, amountUsd: c.amountUsd, deadline: parse(c.expires), daysLeft: daysLeft(today, parse(c.expires)), status: 'open', title: rule.label || 'Reward certificate', source: rule.source, demo: !!c.demo, note: rule.where || null };
  });
  const actions = credits.filter(c => c.status !== 'used').concat(certs).sort((a, b) => a.deadline - b.deadline);
  const protectedItems = [];
  for (const p of arr(state.purchases)) {
    const card = rules.cards[p.cardId]; if (!card || !(state.wallet || {})[p.cardId]) continue;
    for (const ps of protectionsForPurchase(p, card, today)) if ((ps.status === 'active' || ps.status === 'manufacturer') && ps.end) protectedItems.push({ purchase: p, prot: ps, until: ps.end });
  }
  const byPurchase = new Map();
  for (const x of protectedItems) { const k = x.purchase.id; if (!byPurchase.has(k)) byPurchase.set(k, []); byPurchase.get(k).push(x); }
  const rows = [];
  for (const list of byPurchase.values()) {
    list.sort((a, b) => a.until - b.until);
    const now = list.find(x => x.prot.status === 'active') || list[0];
    const next = list.filter(x => x !== now && x.until > now.until).pop() || null;
    rows.push(Object.assign({}, now, { next: next ? { label: next.prot.label, until: next.until } : null }));
  }
  return { total: r2(actions.reduce((s, a) => s + a.amountUsd, 0)), actions, used: credits.filter(c => c.status === 'used'), protected: rows.sort((a, b) => a.until - b.until) };
}
function coachPurchase(rules, state, purchase, mode, today) {
  const merchant = merchantOf(rules, purchase); const ids = Object.keys(state.wallet || {});
  const rec = recommend(rules, ids, merchant, purchase.total, mode);
  const usedScore = rec.ranking.find(r => r.cardId === purchase.cardId);
  const lines = [];
  if (usedScore && rec.top && rec.top.cardId !== purchase.cardId && rec.top.valueUsd - usedScore.valueUsd >= 0.01) lines.push(`${rec.top.short} would’ve earned ${usd(rec.top.valueUsd - usedScore.valueUsd)} more.`);
  for (const c of creditStatuses(rules, state, today)) {
    if (c.status === 'used' || c.cardId === purchase.cardId) continue;
    if (arr(c.credit.match && c.credit.match.merchants).includes(purchase.merchantId)) lines.push(`${(rules.cards[c.cardId] || {}).short} has a ${usd(c.amountUsd)} ${c.credit.short || 'credit'} this period. Pay ${purchase.merchant} with it next time.`);
  }
  const card = rules.cards[purchase.cardId];
  const prots = protectionsForPurchase(purchase, card, today).filter(p => p.status === 'active' || p.status === 'manufacturer' || p.status === 'needs_info');
  const worth = purchase.kind !== 'fare' && purchase.durable !== false && purchase.total >= 50 && prots.length > 0;
  if (worth && !purchase.hasReceipt) lines.push('Snap the receipt to lock in coverage.');
  return { lines, rec, usedScore, worthProtecting: worth };
}

module.exports = { version: '0.1.0', DAY, iso, parse, addDays, addMonths, daysLeft, usd, arr, norm, findMerchant, merchantOf, unitValue, earnRule, scoreCard, recommend, period, useKey, creditStatuses, activationChecklist, protectionsForPurchase, evaluateClaim, owedSummary, coachPurchase, DOC_LABEL };
