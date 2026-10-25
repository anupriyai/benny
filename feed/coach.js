// Runs the Benny engine (loaded live from Firebase) for the iPhone feed. stdin JSON -> stdout JSON.
const fs = require('fs'); const I = JSON.parse(fs.readFileSync(0, 'utf8'));
const m = { exports: {} }; new Function('module', 'exports', I.engineSrc)(m, m.exports); const E = m.exports;
const { rules, state } = I; const today = E.parse(I.todayIso); const walletIds = Object.keys(state.wallet || {});
const STOP = new Set(['card', 'visa', 'the', 'credit', 'by', 'and', 'mastercard', 'amex']);
function matchCard(text) {
  const t = E.norm(text).split(' ').filter(Boolean); if (!t.length) return { cardId: null, candidates: [] };
  const scored = walletIds.map(id => { const c = rules.cards[id];
    const strong = new Set(E.norm([c.name, c.short, id.replace(/-/g, ' ')].join(' ')).split(' ').filter(w => w.length > 2 && !STOP.has(w) && w !== E.norm(c.issuer)));
    let s = 0; for (const w of t) { if (strong.has(w)) s += 3; else if (w === E.norm(c.issuer)) s += 1; } return { id, s }; }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  if (!scored.length) return { cardId: null, candidates: [] };
  if (scored[1] && scored[1].s === scored[0].s) return { cardId: null, candidates: scored.filter(x => x.s === scored[0].s).map(x => x.id) };
  return { cardId: scored[0].id, candidates: [scored[0].id] };
}
let out;
if (I.stage === 'resolve') {
  const f = E.findMerchant(rules.mcc, I.merchant);
  out = { card: matchCard(I.card), merchant: f.match };
} else {
  const p = I.purchase; const st = Object.assign({}, state, { purchases: E.arr(state.purchases).concat([p]) });
  const co = E.coachPurchase(rules, st, p, I.mode, today);
  const used = co.usedScore; const lines = [];
  const better = co.lines.find(l => /would’ve earned/.test(l));
  if (better) lines.push(better);
  else if (used && co.rec.top && !co.lines.some(l => /credit this period/.test(l))) lines.push(co.rec.tie && used.valueUsd === co.rec.top.valueUsd ? `Good tap. ${used.short} earns ${E.usd(used.valueUsd)} here.` : `Right card ✓ ${used.short} earns ${E.usd(used.valueUsd)} here.`);
  const credit = E.creditStatuses(rules, st, today).find(c => c.cardId === p.cardId && c.status === 'used' && c.note && c.note.includes(p.date) && E.arr(c.credit.match && c.credit.match.merchants).includes(p.merchantId));
  if (credit) lines.push(`That uses your ${E.usd(credit.amountUsd)} ${credit.credit.short} this period ✓`);
  const off = E.creditStatuses(rules, st, today).find(c => c.cardId === p.cardId && c.status === 'needs_activation' && E.arr(c.credit.match && c.credit.match.merchants).includes(p.merchantId));
  if (off) lines.push(`Your ${E.usd(off.amountUsd)} ${off.credit.short} isn’t turned on, so this won’t count. Turn it on in Benny.`);
  co.lines.filter(l => l !== better && !/Snap/.test(l)).forEach(l => lines.unshift(l));
  if (co.worthProtecting) lines.push('Snap the receipt to lock in coverage.');
  out = { lines, best: co.rec.top && co.rec.top.cardId, mccNote: co.rec.mccNote };
}
process.stdout.write(JSON.stringify(out));
