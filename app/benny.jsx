
const { useState, useEffect, useMemo, useRef } = React;
const DAYMS = 86400000;
const MODEL = 'gemini-3.8-flash';
const CONF_OK = 0.8;

function palette(theme) {
  return theme === 'dark'
    ? { bg: '#0B0B0C', surface: '#161618', raised: '#1E1E21', line: 'rgba(255,255,255,.09)', ink: '#F4F4F5', muted: '#A1A1AA', faint: '#71717A', accent: '#3DD39A', accentInk: '#0B0B0C', accentSoft: 'rgba(61,211,154,.12)', warn: '#F59E0B', warnSoft: 'rgba(245,158,11,.12)', bad: '#F87171', badSoft: 'rgba(248,113,113,.12)', btn: '#F4F4F5', btnInk: '#0B0B0C' }
    : { bg: '#F6F6F4', surface: '#FFFFFF', raised: '#F1F1EF', line: 'rgba(24,24,27,.09)', ink: '#18181B', muted: '#5F5F67', faint: '#9A9AA2', accent: '#0E7A55', accentInk: '#FFFFFF', accentSoft: 'rgba(14,122,85,.08)', warn: '#B45309', warnSoft: 'rgba(180,83,9,.08)', bad: '#B42318', badSoft: 'rgba(180,35,24,.07)', btn: '#18181B', btnInk: '#FFFFFF' };
}
const money = n => '$' + (Math.round((n || 0) * 100) / 100).toFixed(2);
const money0 = n => { const v = Math.round((n || 0) * 100) / 100; return '$' + (Number.isInteger(v) ? v.toString() : v.toFixed(2)); };
const fmtDate = (t, opts) => new Date(typeof t === 'number' ? t : Date.parse(t + 'T12:00:00Z')).toLocaleDateString('en-US', Object.assign({ month: 'short', day: 'numeric', timeZone: 'UTC' }, opts || {}));
const fmtMonthYear = t => fmtDate(t, { month: 'short', year: 'numeric', day: undefined });
const uid8 = () => Math.random().toString(36).slice(2, 10);
const asArr = v => Array.isArray(v) ? v.filter(x => x != null) : (v && typeof v === 'object' ? Object.values(v) : []);
const cardSlug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
async function sha256hex(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(b)).map(v => v.toString(16).padStart(2, '0')).join(''); }
function dueLabel(d) { if (d == null) return ''; if (d < 0) return 'expired'; if (d === 0) return 'today'; if (d === 1) return 'tomorrow'; if (d <= 14) return d + ' days'; return ''; }

/* ---------- receipt images: this device only (IndexedDB) ---------- */
const IDB = {
  p: null,
  open() { if (!this.p) this.p = new Promise((res, rej) => { const r = indexedDB.open('benny-receipts', 1); r.onupgradeneeded = () => r.result.createObjectStore('receipts'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); return this.p; },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('receipts', mode); const s = t.objectStore('receipts'); const out = fn(s); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); },
  put(k, v) { return this.tx('readwrite', s => { s.put(v, k); }); },
  get(k) { return this.tx('readonly', s => s.get(k)); },
  async keys(prefix) { const ks = await this.tx('readonly', s => s.getAllKeys()); return (ks || []).filter(k => String(k).startsWith(prefix)); },
  async removePrefix(prefix) { const ks = await this.keys(prefix); await this.tx('readwrite', s => { ks.forEach(k => s.delete(k)); }); return ks.length; },
};
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

/* ---------- Gemini: reads and writes; never decides ---------- */
async function gemini(url, parts, schema, validate) {
  if (!url) throw new Error('AI is still connecting. Try again in a moment.');
  const res = await fetch(url + '/models/' + MODEL + ':generateContent', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 } }),
  });
  if (res.status === 402) throw new Error('Out of Mana credits for AI.');
  if (!res.ok) throw new Error('AI request failed (' + res.status + ').');
  const j = await res.json();
  const txt = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || '').join('');
  let o; try { o = JSON.parse(txt); } catch (e) { throw new Error('AI returned malformed output. Rejected; nothing was saved.'); }
  const err = validate ? validate(o) : null;
  if (err) throw new Error('AI output rejected (' + err + '). Nothing was saved.');
  return o;
}
const F = (t, extra) => Object.assign({ type: 'OBJECT', properties: { value: Object.assign({ type: t, nullable: true }, extra || {}), confidence: { type: 'NUMBER' } }, required: ['value', 'confidence'] });
const RECEIPT_SCHEMA = { type: 'OBJECT', properties: {
  isReceipt: { type: 'BOOLEAN' }, merchant: F('STRING'), date: F('STRING'), total: F('NUMBER'), cardHint: F('STRING'),
  items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, price: { type: 'NUMBER', nullable: true }, confidence: { type: 'NUMBER' }, durable: { type: 'BOOLEAN' } }, required: ['name', 'price', 'confidence', 'durable'] } },
  returnPolicy: { type: 'OBJECT', properties: { text: { type: 'STRING', nullable: true }, days: { type: 'INTEGER', nullable: true }, confidence: { type: 'NUMBER' } }, required: ['text', 'days', 'confidence'] },
}, required: ['isReceipt', 'merchant', 'date', 'total', 'cardHint', 'items', 'returnPolicy'] };
function validateReceipt(o) {
  if (!o || typeof o.isReceipt !== 'boolean') return 'missing isReceipt';
  for (const k of ['merchant', 'date', 'total', 'cardHint']) if (!o[k] || typeof o[k].confidence !== 'number') return 'missing ' + k;
  if (o.date.value && !/^\d{4}-\d{2}-\d{2}$/.test(o.date.value)) return 'bad date';
  if (o.total.value != null && typeof o.total.value !== 'number') return 'bad total';
  if (!Array.isArray(o.items)) return 'items not a list';
  return null;
}
const INCIDENTS = ['product_failure', 'damage', 'theft', 'lost', 'trip_delay', 'other'];
const CLAIM_SCHEMA = { type: 'OBJECT', properties: {
  incidentType: { type: 'STRING', enum: INCIDENTS }, purchaseId: { type: 'STRING', nullable: true }, purchaseConfidence: { type: 'NUMBER' },
  incidentDate: { type: 'STRING', nullable: true }, delayHours: { type: 'NUMBER', nullable: true }, overnight: { type: 'BOOLEAN', nullable: true },
  delayCause: { type: 'STRING', enum: ['equipment', 'weather', 'strike', 'other', 'unknown'], nullable: true }, summary: { type: 'STRING' },
}, required: ['incidentType', 'purchaseId', 'purchaseConfidence', 'incidentDate', 'delayHours', 'overnight', 'delayCause', 'summary'] };
const PACKET_SCHEMA = { type: 'OBJECT', properties: {
  narrative: { type: 'STRING' }, answers: { type: 'ARRAY', items: { type: 'OBJECT', properties: { q: { type: 'STRING' }, a: { type: 'STRING' } }, required: ['q', 'a'] } },
}, required: ['narrative', 'answers'] };
const STORE_SCHEMA = { type: 'OBJECT', properties: {
  merchantName: { type: 'STRING' }, categories: { type: 'ARRAY', items: { type: 'STRING', enum: ['dining', 'grocery', 'online_grocery', 'gas', 'ev_charging', 'travel', 'airline', 'hotel_direct', 'rideshare', 'streaming', 'drugstore', 'department', 'wholesale', 'electronics', 'home_improvement', 'online', 'other'] } },
  mcc: { type: 'STRING', nullable: true }, confidence: { type: 'NUMBER' },
}, required: ['merchantName', 'categories', 'mcc', 'confidence'] };

/* ---------- a messy demo receipt (thermal paper, angle, crease) ---------- */
function makeDemoReceipt(dateStr) {
  return new Promise(resolve => {
    const W = 760, H = 1040, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#5b5248'); bg.addColorStop(1, '#2f2a25'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, H / 2); g.rotate(-0.06); g.translate(-250, -470);
    const paper = g.createLinearGradient(0, 0, 500, 0); paper.addColorStop(0, '#f1ece0'); paper.addColorStop(0.55, '#fbf8f0'); paper.addColorStop(1, '#e4ddcc');
    g.fillStyle = paper; g.fillRect(0, 0, 500, 940);
    g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(0, 410, 500, 3); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, 413, 500, 2);
    const ink = a => 'rgba(40,36,34,' + a + ')';
    let y = 60; const line = (t, x, a, f, al) => { g.font = f || '20px "Courier New", monospace'; g.fillStyle = ink(a == null ? 0.82 : a); g.textAlign = al || 'left'; g.fillText(t, x, y); };
    line('BEST BUY #0617', 250, .9, 'bold 30px "Courier New", monospace', 'center'); y += 32;
    line('2675 EL CAMINO REAL', 250, .7, '18px "Courier New", monospace', 'center'); y += 24;
    line('REDWOOD CITY CA 94061', 250, .7, '18px "Courier New", monospace', 'center'); y += 34;
    line('** DEMO RECEIPT · BENNY **', 250, .9, 'bold 17px "Courier New", monospace', 'center'); y += 38;
    line(dateStr.slice(5, 7) + '/' + dateStr.slice(8, 10) + '/' + dateStr.slice(2, 4) + '  14:37  REG 04  TRN 8821', 30, .65); y += 40;
    const items = [['SONY WH1000XM6 HDPHN BLK', '449.99'], ['  6501239  ', ''], ['USB-C CBL 2M 2PK', '19.99'], ['GEEK SQUAD PROTECT DECL', '0.00']];
    items.forEach(([a, b], i) => { line(a, 30, i === 1 ? .45 : .8); if (b) line(b, 470, .8, null, 'right'); y += 30; });
    y += 10; line('SUBTOTAL', 30, .7); line('469.98', 470, .7, null, 'right'); y += 28;
    line('TAX 9.375%', 30, .55); line('44.06', 470, .55, null, 'right'); y += 34;
    line('TOTAL', 30, .95, 'bold 24px "Courier New", monospace'); line('514.04', 470, .95, 'bold 24px "Courier New", monospace', 'right'); y += 40;
    line('CHASE VISA', 30, .6); line('514.04', 470, .6, null, 'right'); y += 26;
    line('CONTACTLESS  APPR 044129', 30, .4); y += 46;
    line('RETURNS & EXCHANGES WITHIN 15', 30, .55, '17px "Courier New", monospace'); y += 22;
    line('DAYS WITH RECEIPT. SEE BESTBUY', 30, .55, '17px "Courier New", monospace'); y += 22;
    line('.COM/RETURNPOLICY', 30, .55, '17px "Courier New", monospace'); y += 50;
    line('THANK YOU FOR SHOPPING', 250, .5, '18px "Courier New", monospace', 'center');
    const fade = g.createLinearGradient(0, 0, 500, 940); fade.addColorStop(0, 'rgba(255,255,255,0)'); fade.addColorStop(0.7, 'rgba(255,250,235,.28)'); fade.addColorStop(1, 'rgba(255,250,235,.5)');
    g.fillStyle = fade; g.fillRect(0, 0, 500, 940); g.restore();
    const shade = g.createRadialGradient(W * 0.3, H * 0.2, 50, W * 0.5, H * 0.5, W); shade.addColorStop(0, 'rgba(255,255,255,0)'); shade.addColorStop(1, 'rgba(0,0,0,.35)'); g.fillStyle = shade; g.fillRect(0, 0, W, H);
    c.toBlob(b => resolve(new File([b], 'demo-receipt.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.82);
  });
}

/* ---------- shared pieces ---------- */
function CardArt({ card, size, dim }) {
  const a = (card && card.art) || { from: '#444', to: '#777', ink: '#fff', sub: 'rgba(255,255,255,.7)' };
  const S = { xs: [44, 28, 4], sm: [76, 48, 6], md: [184, 116, 12], lg: [300, 189, 18] }[size || 'md'];
  const pad = S[0] * 0.07; const fs = S[0] / 300;
  return (
    <div style={{ width: S[0], height: S[1], borderRadius: S[2], background: `linear-gradient(135deg, ${a.from}, ${a.to})`, color: a.ink, position: 'relative', overflow: 'hidden', flex: 'none', opacity: dim ? 0.45 : 1, boxShadow: size === 'lg' ? '0 18px 40px -18px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.12)' : 'inset 0 0 0 1px rgba(255,255,255,.14)' }}>
      {a.style === 'metal' && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, transparent 35%, rgba(255,255,255,.14) 48%, transparent 60%)' }} />}
      {a.style === 'globe' && <svg viewBox="0 0 100 100" style={{ position: 'absolute', right: '-12%', top: '-30%', width: '75%', opacity: 0.16 }}><g fill="none" stroke="#fff" strokeWidth="1.2"><circle cx="50" cy="50" r="46" /><ellipse cx="50" cy="50" rx="20" ry="46" /><path d="M4 50h92M10 28h80M10 72h80" /></g></svg>}
      {a.style === 'costco' && <div style={{ position: 'absolute', left: 0, right: 0, top: '58%', height: '9%', background: '#005DAA', opacity: 0.85 }} />}
      {S[0] >= 76 && <>
        <div style={{ position: 'absolute', left: pad, top: pad, fontSize: Math.max(7, 13 * fs * 1.6), fontWeight: 600, letterSpacing: '.02em', color: a.style === 'costco' ? '#E31837' : a.sub }}>{a.style === 'costco' ? 'COSTCO' : card.issuer}</div>
        <div style={{ position: 'absolute', left: pad, top: '34%', width: S[0] * 0.13, height: S[0] * 0.1, borderRadius: S[0] * 0.018, background: 'linear-gradient(135deg,#d9c38a,#a8915a)', opacity: 0.9 }} />
        <div style={{ position: 'absolute', left: pad, bottom: pad, right: pad, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 6 }}>
          <div style={{ fontSize: Math.max(8, 16 * fs * 1.5), fontWeight: 600, lineHeight: 1.1 }}>{card.short || card.name}</div>
          <div style={{ fontSize: Math.max(7, 14 * fs * 1.5), fontWeight: 800, fontStyle: 'italic', letterSpacing: '.02em', color: a.sub }}>{{ 'American Express': 'AMEX', Mastercard: 'mastercard', Discover: 'DISCOVER', Visa: 'VISA' }[card.network] || ''}</div>
        </div>
      </>}
    </div>
  );
}
function FinePrint({ P, s, label }) {
  const [open, setOpen] = useState(false);
  if (!s) return null;
  const kind = s.kind === 'issuer' ? 'Issuer' : s.kind === 'review' ? 'Review site' : s.kind === 'estimate' ? 'Benny estimate' : 'Source';
  return (
    <div className="mt-2">
      <button onClick={e => { e.stopPropagation(); setOpen(!open); }} className="text-[11.5px] font-medium inline-flex items-center gap-1" style={{ color: P.muted }}>
        <span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>{label || 'Fine print'} · {kind}{s.asOf ? ' · ' + s.asOf : ''}
      </button>
      {open && <div className="mt-1.5 pl-3 text-[12.5px] leading-[1.5]" style={{ borderLeft: `2px solid ${P.line}`, color: P.ink }}>
        {s.quote ? <div style={{ fontFamily: 'ui-serif, Georgia, serif' }}>“{s.quote}”</div> : <div style={{ color: P.muted }}>No quote stored for this value.</div>}
        {s.note && <div className="mt-1 text-[11.5px]" style={{ color: P.warn }}>{s.note}</div>}
        {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11.5px] underline" style={{ color: P.muted }}>{s.url.replace(/^https?:\/\//, '').slice(0, 60)}…</a>}
      </div>}
    </div>
  );
}
function Pill({ P, children, tone }) {
  const t = { warn: [P.warnSoft, P.warn], bad: [P.badSoft, P.bad], good: [P.accentSoft, P.accent] }[tone] || [P.raised, P.muted];
  return <span className="inline-flex items-center rounded-full px-2 py-[2px] text-[11px] font-semibold whitespace-nowrap" style={{ background: t[0], color: t[1] }}>{children}</span>;
}
function Btn({ P, onClick, children, kind, disabled, className, type }) {
  const st = kind === 'ghost' ? { background: 'transparent', color: P.ink, boxShadow: `inset 0 0 0 1px ${P.line}` } : kind === 'soft' ? { background: P.raised, color: P.ink } : kind === 'accent' ? { background: P.accent, color: P.accentInk } : { background: P.btn, color: P.btnInk };
  return <button type={type || 'button'} disabled={disabled} onClick={onClick} className={'rounded-full px-4 h-10 text-[13.5px] font-semibold transition-opacity disabled:opacity-40 active:opacity-80 ' + (className || '')} style={st}>{children}</button>;
}
function Section({ P, title, right, children }) {
  return <div className="mt-7"><div className="flex items-baseline justify-between mb-2.5"><div className="text-[12px] font-semibold uppercase tracking-[.08em]" style={{ color: P.faint }}>{title}</div>{right}</div>{children}</div>;
}
function Panel({ P, children, className, style, onClick }) {
  return <div onClick={onClick} className={'rounded-2xl ' + (className || '')} style={Object.assign({ background: P.surface, boxShadow: `0 0 0 1px ${P.line}` }, style || {})}>{children}</div>;
}
function DemoTag({ P }) { return <Pill P={P}>Demo receipt</Pill>; }

/* ---------- Home ---------- */
function HomeView({ x }) {
  const { P, E, rules, st, summary } = x;
  const [claimText, setClaimText] = useState('');
  const walletIds = Object.keys(st.wallet);
  if (!walletIds.length) return (
    <div className="pt-10 text-center">
      <div className="text-[28px] font-semibold tracking-[-0.02em]" style={{ color: P.ink }}>Your cards owe you money.</div>
      <div className="mt-2 text-[14.5px]" style={{ color: P.muted }}>Add the cards in your wallet. Benny finds the credits and protections you already pay for.</div>
      <div className="mt-6 flex gap-2 justify-center flex-wrap"><Btn P={P} onClick={() => x.go('cards')}>Add my cards</Btn><Btn P={P} kind="ghost" onClick={x.loadDemo}>Load the demo wallet</Btn></div>
    </div>
  );
  const loc = st.settings.location ? rules.mcc.find(m => m.id === st.settings.location) : null;
  const locRec = loc && loc.confidence === 'high' ? E.recommend(rules, walletIds, loc, 50, x.mode) : null;
  const locPerk = loc ? summary.actions.find(a => (a.kind === 'certificate' && loc.certificateOk) || (a.kind === 'credit' && asArr(a.credit.match && a.credit.match.merchants).includes(loc.id))) : null;
  const recent = st.purchases.slice().sort((a, b) => (b.date + (b.createdAt || '')).localeCompare(a.date + (a.createdAt || ''))).slice(0, 5);
  return (
    <div>
      <div className="pt-4">
        <div className="text-[14px] font-medium" style={{ color: P.muted }}>Your cards owe you</div>
        <div className="text-[56px] leading-[1.02] font-semibold tracking-[-0.035em] tabular-nums" style={{ color: P.ink }}>{money0(summary.total)}</div>
        <div className="mt-1 text-[13px]" style={{ color: P.faint }}>{summary.actions.length} things to use or claim · {walletIds.length} cards</div>
      </div>
      {locRec && locRec.top && (
        <button onClick={() => x.go('which', { m: loc.id })} className="mt-4 w-full text-left rounded-2xl px-3.5 py-3 flex items-center gap-3" style={{ background: P.accentSoft }}>
          <CardArt card={rules.cards[locRec.top.cardId]} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold" style={{ color: P.accent }}>At {loc.name} {st.settings.location ? '· simulated' : ''}</div>
            <div className="text-[14px] font-semibold" style={{ color: P.ink }}>{locRec.tie ? 'Any card ties here' : 'Tap ' + locRec.top.short}{locPerk ? ' · your ' + money0(locPerk.amountUsd) + ' ' + (locPerk.kind === 'certificate' ? 'certificate works here' : locPerk.credit.short + ' applies') : ''}</div>
          </div>
          <span style={{ color: P.accent }}>›</span>
        </button>
      )}
      <form onSubmit={e => { e.preventDefault(); if (claimText.trim()) x.go('claim', { text: claimText.trim() }); }} className="mt-5 flex items-center gap-2 rounded-full pl-4 pr-1.5 h-12" style={{ background: P.surface, boxShadow: `0 0 0 1px ${P.line}` }}>
        <input value={claimText} onChange={e => setClaimText(e.target.value)} placeholder="Something went wrong? “my blender stopped working”" className="flex-1 min-w-0 bg-transparent outline-none text-[14px]" style={{ color: P.ink }} />
        <button type="submit" disabled={!claimText.trim()} className="h-9 px-3.5 rounded-full text-[13px] font-semibold disabled:opacity-30" style={{ background: P.btn, color: P.btnInk }}>Check</button>
      </form>
      {st.purchases.some(p => !p.cardId && p.raw) && <Section P={P} title="Which card was this?">
        <Panel P={P}>{st.purchases.filter(p => !p.cardId && p.raw).map((p, i) => <div key={p.id} className="px-4 py-3" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
          <div className="text-[13.5px]" style={{ color: P.ink }}>{p.merchant} · {money(p.total)} <span style={{ color: P.muted }}>· your iPhone called the card “{p.raw.card || 'unknown'}”</span></div>
          <div className="mt-2 flex gap-2 flex-wrap">{walletIds.map(id => <button key={id} onClick={() => x.save(Object.assign({ ['purchases/' + p.id + '/cardId']: id }, p.raw.card ? { ['settings/cardAliases/' + cardSlug(p.raw.card)]: id } : {}))} className="flex items-center gap-2 rounded-full pl-1 pr-3 h-9" style={{ background: P.raised }}><CardArt card={rules.cards[id]} size="xs" /><span className="text-[12.5px] font-medium" style={{ color: P.ink }}>{rules.cards[id].short}</span></button>)}</div>
          <div className="mt-1.5 text-[11.5px]" style={{ color: P.faint }}>Benny remembers this name for next time.</div>
        </div>)}</Panel>
      </Section>}
      <Section P={P} title="Use it or lose it">
        {summary.actions.length ? <Panel P={P}>{summary.actions.map((a, i) => <ActionRow key={a.id} x={x} a={a} first={i === 0} />)}</Panel>
          : <div className="text-[13.5px]" style={{ color: P.muted }}>Nothing waiting. Nice.</div>}
      </Section>
      {summary.protected.length > 0 && <Section P={P} title="Protected purchases">
        <Panel P={P}>{summary.protected.map((p, i) => {
          const item = asArr(p.purchase.items)[0]; const card = rules.cards[p.purchase.cardId];
          return <div key={p.purchase.id} className="px-4 py-3 flex items-center gap-3" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
            <CardArt card={card} size="xs" />
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium truncate" style={{ color: P.ink }}>{item ? item.name : p.purchase.merchant}</div>
              <div className="text-[12px]" style={{ color: P.muted }}>{p.prot.label}{p.prot.status === 'manufacturer' ? ' (after the manufacturer’s ends ' + fmtMonthYear(p.prot.start) + ')' : ''} · {card.short}{p.next ? ' · then ' + p.next.label.toLowerCase() + ' to ' + fmtMonthYear(p.next.until) : ''}</div>
            </div>
            <div className="text-right"><div className="text-[11px]" style={{ color: P.faint }}>until</div><div className="text-[13px] font-semibold tabular-nums" style={{ color: P.ink }}>{fmtMonthYear(p.until)}</div></div>
          </div>;
        })}</Panel>
      </Section>}
      <Section P={P} title="Recent purchases" right={<button className="text-[12px] font-medium" style={{ color: P.muted }} onClick={() => x.go('you')}>All</button>}>
        <Panel P={P}>{recent.map((p, i) => <PurchaseRow key={p.id} x={x} p={p} first={i === 0} />)}</Panel>
      </Section>
    </div>
  );
}
function ActionRow({ x, a, first }) {
  const { P, rules } = x; const [open, setOpen] = useState(false);
  const card = rules.cards[a.cardId]; const due = dueLabel(a.daysLeft); const urgent = a.daysLeft != null && a.daysLeft <= 7;
  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${P.line}` }}>
      <button onClick={() => setOpen(!open)} className="w-full text-left px-4 py-3 flex items-center gap-3">
        <CardArt card={card} size="xs" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium truncate" style={{ color: P.ink }}>{a.kind === 'certificate' ? card.short + ' certificate' : a.title}</div>
          <div className="text-[12px]" style={{ color: a.status === 'needs_activation' ? P.warn : P.muted }}>{a.status === 'needs_activation' ? 'Not turned on yet' : a.kind === 'certificate' ? 'Expires ' + fmtDate(a.deadline) : 'Use by ' + fmtDate(a.deadline)} · {card.short}</div>
        </div>
        <div className="text-right flex flex-col items-end gap-0.5">
          <div className="text-[15px] font-semibold tabular-nums" style={{ color: P.ink }}>{money0(a.amountUsd)}</div>
          {due && <Pill P={P} tone={urgent ? 'warn' : null}>{a.daysLeft <= 7 && a.daysLeft > 1 ? 'gone in ' + due : due}</Pill>}
        </div>
      </button>
      {open && <div className="px-4 pb-3.5 -mt-1" style={{ paddingLeft: 72 }}>
        {a.note && <div className="text-[12.5px] mb-1" style={{ color: a.status === 'needs_activation' ? P.warn : P.muted }}>{a.note}</div>}
        {a.kind === 'credit' && a.credit.periodNote && <div className="text-[12px]" style={{ color: P.faint }}>{a.credit.periodNote}</div>}
        <FinePrint P={P} s={a.source} />
        <div className="mt-2.5 flex gap-2 flex-wrap">
          {a.status === 'needs_activation' && <>
            {a.credit.activationUrl && <a href={a.credit.activationUrl} target="_blank" rel="noreferrer"><Btn P={P} kind="soft">{a.credit.activationLabel || 'Turn it on'} ↗</Btn></a>}
            <Btn P={P} kind="ghost" onClick={() => x.save({ ['wallet/' + a.cardId + '/activated/' + a.credit.id]: true })}>Turned it on ✓</Btn>
          </>}
          {a.status === 'open' && a.kind === 'credit' && <Btn P={P} kind="ghost" onClick={() => { x.save({ ['creditUses/' + a.id]: { at: Date.now(), how: 'manual' } }); x.toast('Cleared for this period'); }}>Already used it ✓</Btn>}
          {a.kind === 'certificate' && <Btn P={P} kind="ghost" onClick={() => x.save({ ['certificates/' + a.id + '/redeemed']: Date.now() })}>Redeemed ✓</Btn>}
          {a.kind === 'certificate' && a.demo && <DemoTag P={P} />}
        </div>
      </div>}
    </div>
  );
}
function PurchaseRow({ x, p, first }) {
  const { P, E, rules, st, today } = x; const card = rules.cards[p.cardId];
  const coach = useMemo(() => card ? E.coachPurchase(rules, x.stEngine, p, x.mode, today) : { lines: [] }, [p, x.stEngine, x.mode, today]);
  const item = asArr(p.items)[0];
  return (
    <div className="px-4 py-3 flex gap-3" style={{ borderTop: first ? 'none' : `1px solid ${P.line}` }}>
      {card ? <CardArt card={card} size="xs" /> : <div style={{ width: 44 }} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2"><div className="text-[14px] font-medium truncate" style={{ color: P.ink }}>{p.merchant}</div><div className="text-[14px] tabular-nums" style={{ color: P.ink }}>{money(p.total)}</div></div>
        <div className="text-[12px] truncate" style={{ color: P.muted }}>{fmtDate(p.date, { year: 'numeric' })}{item && asArr(p.items).length ? ' · ' + item.name : ''}{p.source === 'shortcut' ? ' · from iPhone' : ''}</div>
        {coach.lines.map((l, i) => <div key={i} className="mt-1 text-[12.5px]" style={{ color: /Snap/.test(l) ? P.accent : P.warn }}>{l}</div>)}
        {p.demo && <div className="mt-1"><DemoTag P={P} /></div>}
      </div>
    </div>
  );
}

/* ---------- Cards ---------- */
function CardsView({ x }) {
  const { P, E, rules, st } = x;
  const all = Object.values(rules.cards).sort((a, b) => (b.handChecked ? 1 : 0) - (a.handChecked ? 1 : 0) || a.name.localeCompare(b.name));
  const checklist = E.activationChecklist(rules, x.stEngine);
  const toggle = id => st.wallet[id] ? x.save({ ['wallet/' + id]: null }) : x.save({ ['wallet/' + id]: { addedAt: Date.now() } });
  return (
    <div className="pt-4">
      <div className="text-[26px] font-semibold tracking-[-0.02em]" style={{ color: P.ink }}>Your cards</div>
      <div className="text-[13.5px] mt-1" style={{ color: P.muted }}>Tap the cards you carry. Benny stores product names only, never card numbers.</div>
      <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        {all.map(c => { const on = !!st.wallet[c.cardId]; return (
          <button key={c.cardId} onClick={() => toggle(c.cardId)} className="text-left rounded-2xl p-2.5 transition-shadow" style={{ background: P.surface, boxShadow: on ? `0 0 0 2px ${P.accent}` : `0 0 0 1px ${P.line}` }}>
            <div style={{ transform: 'scale(.78)', transformOrigin: 'top left', height: 92 }}><CardArt card={c} size="md" /></div>
            <div className="flex items-center justify-between gap-2"><div className="text-[13px] font-semibold truncate" style={{ color: P.ink }}>{c.name}</div>{on && <span className="text-[13px] font-bold" style={{ color: P.accent }}>✓</span>}</div>
            <div className="text-[11.5px]" style={{ color: P.muted }}>{c.annualFee == null ? 'Fee not confirmed' : c.annualFee ? '$' + c.annualFee + '/yr' : 'No annual fee'} · <span style={{ color: c.handChecked ? P.accent : P.faint }}>{c.handChecked ? 'checked by hand' : 'auto-extracted'}</span></div>
          </button>); })}
      </div>
      {checklist.length > 0 && <Section P={P} title={`You’re paying for ${checklist.length} perk${checklist.length > 1 ? 's' : ''} you haven’t turned on`}>
        <Panel P={P}>{checklist.map((c, i) => (
          <div key={c.cardId + c.perk.id} className="px-4 py-3" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
            <div className="flex items-center gap-3">
              <CardArt card={rules.cards[c.cardId]} size="xs" />
              <div className="flex-1 min-w-0"><div className="text-[14px] font-medium" style={{ color: P.ink }}>{c.perk.label}{c.perk.amountUsd ? ' · ' + money0(c.perk.amountUsd) + '/' + (c.perk.period === 'monthly' ? 'mo' : c.perk.period) : ''}</div><div className="text-[12px]" style={{ color: P.muted }}>{c.cardName}</div></div>
            </div>
            <div className="mt-2 flex gap-2 flex-wrap" style={{ paddingLeft: 56 }}>
              {c.perk.activationUrl && <a href={c.perk.activationUrl} target="_blank" rel="noreferrer"><Btn P={P} kind="soft">{c.perk.activationLabel || 'Open issuer page'} ↗</Btn></a>}
              <Btn P={P} kind="ghost" onClick={() => x.save({ ['wallet/' + c.cardId + '/activated/' + c.perk.id]: true })}>Done ✓</Btn>
            </div>
            <div style={{ paddingLeft: 56 }}><FinePrint P={P} s={c.perk.source} /></div>
          </div>))}</Panel>
      </Section>}
      <Section P={P} title="How Benny values points">
        <ValueToggle x={x} />
      </Section>
      <Section P={P} title="Rules behind each card">
        <Panel P={P}>{Object.keys(st.wallet).map((id, i) => { const c = rules.cards[id]; if (!c) return null; return (
          <div key={id} className="px-4 py-3" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
            <div className="text-[14px] font-semibold" style={{ color: P.ink }}>{c.name}</div>
            <div className="text-[12px] mt-0.5" style={{ color: P.muted }}>{c.verifiedNote}</div>
            {asArr(c.protections).map(pr => <div key={pr.type} className="mt-2"><div className="text-[13px]" style={{ color: P.ink }}>{pr.label}{pr.incomplete ? <span style={{ color: P.faint }}> · terms not confirmed, never used to decide</span> : null}</div><FinePrint P={P} s={pr.source} /></div>)}
            {c.noCoverage && Object.keys(c.noCoverage).map(k => <div key={k} className="mt-2"><div className="text-[13px]" style={{ color: P.bad }}>No {k.replace(/_/g, ' ')}</div><FinePrint P={P} s={c.noCoverage[k]} /></div>)}
          </div>); })}</Panel>
      </Section>
    </div>
  );
}
function ValueToggle({ x }) {
  const { P } = x; const m = x.mode;
  const opt = (v, t, d) => <button onClick={() => x.save({ 'settings/valueMode': v })} className="flex-1 text-left rounded-xl px-3 py-2.5" style={{ background: m === v ? P.surface : 'transparent', boxShadow: m === v ? `0 0 0 1px ${P.line}, 0 1px 2px rgba(0,0,0,.05)` : 'none' }}>
    <div className="text-[13.5px] font-semibold" style={{ color: P.ink }}>{t}</div><div className="text-[11.5px]" style={{ color: P.muted }}>{d}</div></button>;
  return <div className="flex gap-1 p-1 rounded-2xl" style={{ background: P.raised }}>{opt('cash', 'I take cash back', 'Guaranteed values, e.g. 1¢ per Chase point')}{opt('travel', 'I transfer points to travel', 'Estimates, always labelled')}</div>;
}

/* ---------- Which card here? ---------- */
function WhichView({ x }) {
  const { P, E, rules, st } = x;
  const walletIds = Object.keys(st.wallet);
  const initial = x.params.m ? rules.mcc.find(m => m.id === x.params.m) : null;
  const [q, setQ] = useState(initial ? initial.name : '');
  const [amount, setAmount] = useState('50');
  const [merchant, setMerchant] = useState(initial && !initial.ambiguous ? initial : null);
  const [ask, setAsk] = useState(initial && initial.ambiguous ? initial : null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const sugg = q.trim().length >= 2 && !merchant ? E.findMerchant(rules.mcc, q).candidates : [];
  const pick = m => { setErr(''); if (m.ambiguous) { setAsk(m); setMerchant(null); } else { setMerchant(m); setAsk(null); } setQ(m.name); };
  const submit = async () => {
    const f = E.findMerchant(rules.mcc, q); if (f.match) return pick(f.match);
    setBusy(true); setErr('');
    try {
      const o = await gemini(x.gemUrl, [{ text: 'A shopper typed this store or place name: "' + q + '". Identify the merchant and the card-network merchant category it most likely codes as (Visa MCC). Return categories from the allowed list, the 4-digit MCC if you know it, and your confidence 0-1. If unsure, say so with low confidence.' }], STORE_SCHEMA,
        o => (!o.merchantName || !Array.isArray(o.categories) || !o.categories.length) ? 'no merchant' : null);
      const cats = o.categories.slice(); if (cats.includes('airline') && !cats.includes('travel')) cats.push('travel');
      setMerchant({ id: 'ai-' + E.norm(o.merchantName).replace(/ /g, '-'), name: o.merchantName, categories: cats, mcc: o.mcc || '????', confidence: o.confidence >= 0.8 ? 'medium' : 'low', codedAs: cats[0].replace(/_/g, ' '), aiResolved: true });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const amt = Math.max(0, parseFloat(amount) || 0);
  const rec = merchant ? E.recommend(rules, walletIds, merchant, amt, x.mode) : null;
  const perk = merchant ? x.summary.actions.find(a => (a.kind === 'certificate' && merchant.certificateOk) || (a.kind === 'credit' && asArr(a.credit.match && a.credit.match.merchants).includes(merchant.id))) : null;
  return (
    <div className="pt-4">
      <div className="text-[26px] font-semibold tracking-[-0.02em]" style={{ color: P.ink }}>Which card here?</div>
      <form onSubmit={e => { e.preventDefault(); submit(); }} className="mt-3 flex gap-2">
        <div className="flex-1 min-w-0 flex items-center rounded-full px-4 h-11" style={{ background: P.surface, boxShadow: `0 0 0 1px ${P.line}` }}>
          <input autoFocus={!initial} value={q} onChange={e => { setQ(e.target.value); setMerchant(null); setAsk(null); }} placeholder="Store name, e.g. Costco gas" className="flex-1 min-w-0 bg-transparent outline-none text-[14.5px]" style={{ color: P.ink }} />
        </div>
        <div className="flex items-center rounded-full px-3 h-11 w-[96px]" style={{ background: P.surface, boxShadow: `0 0 0 1px ${P.line}` }}>
          <span style={{ color: P.faint }}>$</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-transparent outline-none text-[14.5px] tabular-nums ml-1" style={{ color: P.ink }} />
        </div>
        <Btn P={P} type="submit" disabled={!q.trim() || busy}>{busy ? '…' : 'Go'}</Btn>
      </form>
      {st.settings.location && !merchant && !ask && !q && <button onClick={() => pick(rules.mcc.find(m => m.id === st.settings.location))} className="mt-2 text-[12.5px] font-medium" style={{ color: P.accent }}>Use my location (simulated): {(rules.mcc.find(m => m.id === st.settings.location) || {}).name}</button>}
      {sugg.length > 0 && !ask && <div className="mt-2 flex gap-1.5 flex-wrap">{sugg.map(m => <button key={m.id} onClick={() => pick(m)} className="rounded-full px-3 h-8 text-[12.5px]" style={{ background: P.raised, color: P.ink }}>{m.name}</button>)}</div>}
      {err && <div className="mt-3 text-[13px]" style={{ color: P.bad }}>{err}</div>}
      {ask && <div className="mt-6 text-center">
        <div className="text-[17px] font-semibold" style={{ color: P.ink }}>{asArr(ask.ambiguous).map(a => a.label).join(' or ')}?</div>
        <div className="mt-3 flex gap-2 justify-center">{asArr(ask.ambiguous).map(a => <Btn key={a.id} P={P} kind="soft" onClick={() => { setAsk(null); setMerchant(rules.mcc.find(m => m.id === a.id)); }}>{a.label}</Btn>)}</div>
      </div>}
      {rec && rec.top && <div className="mt-6">
        <div className="flex flex-col items-center text-center">
          <CardArt card={rules.cards[rec.top.cardId]} size="lg" />
          <div className="mt-5 text-[24px] font-semibold tracking-[-0.02em]" style={{ color: P.ink }}>{rec.tie ? rec.ranking.filter(r => r.valueUsd === rec.top.valueUsd).map(r => r.short).join(' and ') + ' tie' : 'Tap ' + rec.top.short}</div>
          <div className="mt-1 text-[14px] tabular-nums" style={{ color: P.muted }}>{money(rec.top.valueUsd)} back on {money(amt)}{!rec.tie && rec.diffUsd != null ? ' · ' + money(rec.diffUsd) + ' more than ' + rec.ranking[1].short : ''}</div>
          {perk && <div className="mt-2"><Pill P={P} tone="good">Your {money0(perk.amountUsd)} {perk.kind === 'certificate' ? 'certificate works here' : perk.credit.short + ' applies'}</Pill></div>}
        </div>
        <div className="mt-5 rounded-xl px-3.5 py-2.5 text-[12.5px]" style={{ background: P.raised, color: P.muted }}>
          {merchant.name}: usually coded as <b style={{ color: P.ink }}>{merchant.codedAs || asArr(merchant.categories)[0]}</b> (MCC {merchant.mcc}), confidence {merchant.confidence}{merchant.aiResolved ? ' · identified by AI, not in Benny’s merchant table' : ''}.
          {merchant.note && <div className="mt-1">{merchant.note}</div>}
          {rec.mccNote && <div className="mt-1" style={{ color: P.warn }}>{rec.mccNote.replace(/^Usually coded as .*?\(MCC [^)]*\)\.\s*/, '')}</div>}
        </div>
        <Section P={P} title="Every card, worked out">
          <Panel P={P}>{rec.ranking.map((r, i) => (
            <div key={r.cardId} className="px-4 py-3" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
              <div className="flex items-center gap-3"><CardArt card={rules.cards[r.cardId]} size="xs" /><div className="flex-1 text-[14px] font-medium" style={{ color: P.ink }}>{r.short}</div><div className="text-[14px] font-semibold tabular-nums" style={{ color: i === 0 ? P.accent : P.ink }}>{money(r.valueUsd)}</div></div>
              <div className="mt-1.5 text-[12.5px] tabular-nums" style={{ color: P.muted, paddingLeft: 56 }}>{r.explanation}{r.unitValue.note ? ' · ' + r.unitValue.note : ''}</div>
              {r.conditional && <div className="mt-1 text-[12px]" style={{ color: P.warn, paddingLeft: 56 }}>{r.conditional.text}</div>}
              <div style={{ paddingLeft: 56 }}><FinePrint P={P} s={r.rule.source} label="Earn rule" />{r.unitValue.basis !== 'cash back' && <FinePrint P={P} s={r.unitValue.source} label={'Point value (' + r.unitValue.basis + ')'} />}</div>
            </div>))}</Panel>
        </Section>
      </div>}
    </div>
  );
}

/* ---------- Snap receipt ---------- */
async function downscale(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const s = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85)); const b64 = (await blobToDataUrl(blob)).split(',')[1];
  return { blob, b64 };
}
function cardFromHint(hint, walletIds, rules) {
  const h = String(hint || '').toUpperCase();
  const c = walletIds.filter(id => { const k = rules.cards[id]; if (/COSTCO|CITI/.test(h)) return /costco/.test(id); if (/UNITED|EXPLORER|MILEAGEPLUS/.test(h)) return /united/.test(id); if (/SAPPHIRE/.test(h)) return /sapphire/.test(id); if (/CHASE/.test(h)) return k.issuer === 'Chase'; if (/VISA/.test(h)) return k.network === 'Visa'; return false; });
  return { cardId: c.length === 1 ? c[0] : null, candidates: c.length ? c : walletIds };
}
function ReceiptView({ x }) {
  const { P, E, rules, st, today } = x;
  const walletIds = Object.keys(st.wallet);
  const [step, setStep] = useState('pick'); const [err, setErr] = useState('');
  const [preview, setPreview] = useState(null); const blobRef = useRef(null);
  const [f, setF] = useState(null); const [conf, setConf] = useState({}); const [ok, setOk] = useState({});
  const [saved, setSaved] = useState(null);
  const fileRef = useRef(null);
  const read = async file => {
    setErr(''); setStep('reading'); setSaved(null);
    try {
      const { blob, b64 } = await downscale(file); blobRef.current = blob; setPreview(URL.createObjectURL(blob));
      const o = await gemini(x.gemUrl, [
        { text: 'Read this purchase receipt photo. It may be creased, angled, faded thermal paper with abbreviated item names. Today is ' + E.iso(today) + '. For every field give confidence 0-1 that it is exactly right. Use null when unreadable; never guess. Item names: expand abbreviations only when sure (e.g. HDPHN means headphones), otherwise keep as printed. Exclude subtotal, tax and payment lines from items. durable is true for physical goods that normally carry a manufacturer warranty (electronics, appliances, tools), false for food, consumables, services, and small accessories. cardHint: only issuer, network or product words printed for the payment card (e.g. "CHASE VISA", "COSTCO VISA"), never any digits. returnPolicy: the printed return window text and days if stated.' },
        { inline_data: { mime_type: 'image/jpeg', data: b64 } }], RECEIPT_SCHEMA, validateReceipt);
      if (!o.isReceipt) throw new Error('That doesn’t look like a receipt.');
      const hint = String(o.cardHint.value || '').replace(/\d/g, '').trim();
      const ch = cardFromHint(hint, walletIds, rules);
      const items = asArr(o.items).map(i => ({ name: i.name, price: i.price, durable: !!i.durable, confidence: i.confidence })).filter(i => i.name && !(i.price === 0));
      const m = E.findMerchant(rules.mcc, o.merchant.value || '').match;
      setF({ merchant: o.merchant.value || '', merchantId: m ? m.id : null, date: o.date.value || '', total: o.total.value != null ? String(o.total.value) : '', cardId: ch.cardId, cardCands: ch.candidates, cardHint: hint, items, mfr: '12', returnDays: o.returnPolicy.days, returnText: o.returnPolicy.text || '' });
      setConf({ merchant: o.merchant.confidence, date: o.date.confidence, total: o.total.confidence, card: ch.cardId ? Math.min(o.cardHint.confidence, 0.95) : 0, mfr: 0, items: Math.min.apply(null, items.map(i => i.confidence).concat([1])) });
      setOk({}); setStep('confirm');
    } catch (e) { setErr(e.message); setStep('pick'); }
  };
  const need = k => (conf[k] == null || conf[k] < CONF_OK) && !ok[k] && !(k === 'mfr' && !(f && f.items.some(i => i.durable)));
  const pending = f ? ['merchant', 'date', 'total', 'card', 'items', 'mfr'].filter(need) : [];
  const set = (k, v, okKey) => { setF(Object.assign({}, f, { [k]: v })); setOk(Object.assign({}, ok, { [okKey || k]: true })); };
  const save = async () => {
    const id = 'r-' + Date.now().toString(36);
    const durable = f.items.filter(i => i.durable && i.price != null).sort((a, b) => b.price - a.price)[0];
    const m = f.merchantId ? rules.mcc.find(z => z.id === f.merchantId) : null;
    const p = { id, merchant: m ? m.name.replace(/ \(booked direct\)/, '') : f.merchant, merchantId: f.merchantId || 'unknown', date: f.date, total: parseFloat(f.total), cardId: f.cardId,
      items: f.items.map(i => ({ name: i.name, price: i.price, durable: i.durable })), durable: !!durable, hasReceipt: true, source: 'receipt', createdAt: Date.now() };
    if (durable) { p.itemPrice = durable.price; p.primaryItem = durable.name; p.mfrWarrantyMonths = parseInt(f.mfr, 10) || null; }
    if (f.returnDays) p.returnDays = f.returnDays; if (f.returnText) p.returnPolicy = f.returnText;
    if (!m) p.categories = ['other'];
    if (blobRef.current) { try { await IDB.put(x.idbPrefix + id, blobRef.current); } catch (e) { x.toast('Couldn’t keep the photo on this device'); } }
    await x.save({ ['purchases/' + id]: p });
    setSaved(p); setStep('saved');
  };
  const reset = () => { setStep('pick'); setF(null); setPreview(null); setSaved(null); setErr(''); };
  const fieldStyle = k => ({ background: P.surface, boxShadow: need(k) ? `0 0 0 1.5px ${P.warn}` : `0 0 0 1px ${P.line}` });
  const Confirm = ({ k }) => need(k) ? <button onClick={() => setOk(Object.assign({}, ok, { [k]: true }))} className="text-[11.5px] font-semibold rounded-full px-2.5 h-7 whitespace-nowrap" style={{ background: P.warnSoft, color: P.warn }}>Looks right ✓</button> : null;
  if (!walletIds.length) return <div className="pt-8 text-center text-[14px]" style={{ color: P.muted }}>Add your cards first. <button className="underline" onClick={() => x.go('cards')}>Add cards</button></div>;
  return (
    <div className="pt-4">
      <div className="text-[26px] font-semibold tracking-[-0.02em]" style={{ color: P.ink }}>Snap a receipt</div>
      <div className="text-[13.5px] mt-1" style={{ color: P.muted }}>The photo stays on this device. Only the fields below are saved.</div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const file = e.target.files && e.target.files[0]; e.target.value = ''; if (file) read(file); }} />
      {step === 'pick' && <div className="mt-5 flex gap-2 flex-wrap">
        <Btn P={P} onClick={() => fileRef.current && fileRef.current.click()}>Take or choose a photo</Btn>
        <Btn P={P} kind="ghost" onClick={async () => read(await makeDemoReceipt(E.iso(today - 2 * DAYMS)))}>Use a messy demo receipt</Btn>
      </div>}
      {err && <div className="mt-3 text-[13px]" style={{ color: P.bad }}>{err}</div>}
      {step === 'reading' && <div className="mt-5 flex gap-4 items-center">{preview && <img src={preview} className="w-20 rounded-lg" style={{ boxShadow: `0 0 0 1px ${P.line}` }} />}<div className="text-[14px]" style={{ color: P.muted }}>Reading the receipt…</div></div>}
      {step === 'confirm' && f && <div className="mt-5">
        <div className="flex gap-4 items-start">
          {preview && <img src={preview} className="w-24 rounded-lg flex-none" style={{ boxShadow: `0 0 0 1px ${P.line}` }} />}
          <div className="text-[13px] leading-[1.5]" style={{ color: P.muted }}>{pending.length ? <span><b style={{ color: P.warn }}>{pending.length} field{pending.length > 1 ? 's' : ''}</b> need a look. AI wasn’t sure, so Benny won’t use them until you confirm.</span> : 'Everything checks out.'}</div>
        </div>
        <div className="mt-4 grid gap-2.5">
          <Field P={P} label="Store" st={fieldStyle('merchant')} right={<Confirm k="merchant" />}>
            <input value={f.merchant} onChange={e => { const v = e.target.value; const mm = E.findMerchant(rules.mcc, v).match; setF(Object.assign({}, f, { merchant: v, merchantId: mm ? mm.id : null })); setOk(Object.assign({}, ok, { merchant: true })); }} className="w-full bg-transparent outline-none text-[14.5px]" style={{ color: P.ink }} />
            <div className="text-[11px]" style={{ color: P.faint }}>{f.merchantId ? 'Matched: ' + rules.mcc.find(m => m.id === f.merchantId).name : 'Not in merchant table; coded as other'}</div>
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field P={P} label="Date" st={fieldStyle('date')} right={<Confirm k="date" />}><input type="date" value={f.date} onChange={e => set('date', e.target.value)} className="w-full bg-transparent outline-none text-[14px]" style={{ color: P.ink }} /></Field>
            <Field P={P} label="Total" st={fieldStyle('total')} right={<Confirm k="total" />}><input inputMode="decimal" value={f.total} onChange={e => set('total', e.target.value)} className="w-full bg-transparent outline-none text-[14.5px] tabular-nums" style={{ color: P.ink }} /></Field>
          </div>
          <Field P={P} label={'Paid with' + (f.cardHint ? ' · receipt says “' + f.cardHint + '”' : '')} st={fieldStyle('card')}>
            <div className="flex gap-2 flex-wrap mt-1">{(f.cardCands.length > 1 || !f.cardId ? walletIds : [f.cardId]).map(id => <button key={id} onClick={() => set('cardId', id, 'card')} className="flex items-center gap-2 rounded-full pl-1 pr-3 h-9" style={{ background: f.cardId === id && (ok.card || conf.card >= CONF_OK) ? P.accentSoft : P.raised, boxShadow: f.cardId === id ? `0 0 0 1.5px ${P.accent}` : 'none' }}><CardArt card={rules.cards[id]} size="xs" /><span className="text-[12.5px] font-medium" style={{ color: P.ink }}>{rules.cards[id].short}</span></button>)}</div>
          </Field>
          <Field P={P} label="Items" st={fieldStyle('items')} right={<Confirm k="items" />}>
            {f.items.map((it, i) => <div key={i} className="flex items-center gap-2 py-1">
              <input value={it.name} onChange={e => { const items = f.items.slice(); items[i] = Object.assign({}, it, { name: e.target.value }); set('items', items); }} className="flex-1 min-w-0 bg-transparent outline-none text-[13.5px]" style={{ color: it.confidence < CONF_OK && !ok.items ? P.warn : P.ink }} />
              <span className="text-[13px] tabular-nums" style={{ color: P.ink }}>{it.price != null ? money(it.price) : '—'}</span>
              <button onClick={() => { const items = f.items.slice(); items[i] = Object.assign({}, it, { durable: !it.durable }); set('items', items); }} className="text-[11px] rounded-full px-2 h-6" style={{ background: it.durable ? P.accentSoft : P.raised, color: it.durable ? P.accent : P.muted }}>{it.durable ? 'protect' : 'skip'}</button>
            </div>)}
          </Field>
          {f.items.some(i => i.durable) && <Field P={P} label="Manufacturer warranty (months) · not on receipts, assumed 12" st={fieldStyle('mfr')} right={<Confirm k="mfr" />}><input inputMode="numeric" value={f.mfr} onChange={e => set('mfr', e.target.value)} className="w-full bg-transparent outline-none text-[14.5px]" style={{ color: P.ink }} /></Field>}
          {f.returnText && <div className="text-[12px] px-1" style={{ color: P.muted }}>Return policy on receipt: “{f.returnText}”</div>}
        </div>
        <div className="mt-4 flex gap-2"><Btn P={P} onClick={save} disabled={pending.length > 0 || !f.cardId || !f.date || !parseFloat(f.total)}>Save purchase</Btn><Btn P={P} kind="ghost" onClick={reset}>Start over</Btn></div>
      </div>}
      {step === 'saved' && saved && <ReceiptResult x={x} p={saved} onAgain={reset} />}
    </div>
  );
}
function Field({ P, label, st, right, children }) {
  return <div className="rounded-xl px-3.5 py-2" style={st}><div className="flex items-center justify-between gap-2"><div className="text-[11px] font-medium" style={{ color: P.faint }}>{label}</div>{right}</div>{children}</div>;
}
function ReceiptResult({ x, p, onAgain }) {
  const { P, E, rules, today } = x; const card = rules.cards[p.cardId];
  const merchant = E.merchantOf(rules, p); const sc = E.scoreCard(card, merchant, p.total, x.mode);
  const prots = E.protectionsForPurchase(p, card, today);
  const credits = E.creditStatuses(rules, x.stEngine, today).filter(c => c.note && c.note.includes(p.merchant) && c.status === 'used');
  const coach = E.coachPurchase(rules, x.stEngine, p, x.mode, today);
  const protectedUsd = Math.max(0, ...prots.filter(z => z.status === 'active' || z.status === 'manufacturer').map(z => z.cap ? z.cap.maxUsd : 0));
  const cr = credits.reduce((s, c) => s + c.amountUsd, 0);
  return (
    <div className="mt-5">
      <Panel P={P} className="p-4">
        <div className="text-[12px] font-semibold uppercase tracking-[.08em]" style={{ color: P.faint }}>What this receipt is worth</div>
        <div className="mt-1 text-[34px] font-semibold tracking-[-0.03em] tabular-nums" style={{ color: P.ink }}>{money(sc.valueUsd + cr)}<span className="text-[15px] font-medium" style={{ color: P.muted }}> earned{protectedUsd ? ' · ' + money0(protectedUsd) + ' protected' : ''}</span></div>
        <div className="text-[12.5px] mt-0.5" style={{ color: P.muted }}>{p.merchant} · {fmtDate(p.date, { year: 'numeric' })} · {card.short}</div>
      </Panel>
      <Section P={P} title="Earned">
        <Panel P={P} className="px-4 py-3"><div className="text-[13.5px] tabular-nums" style={{ color: P.ink }}>{sc.explanation}</div>{sc.unitValue.note && <div className="text-[12px] mt-1" style={{ color: P.muted }}>{sc.unitValue.note}</div>}<FinePrint P={P} s={sc.rule.source} label="Earn rule" />
          {credits.map(c => <div key={c.id} className="mt-2 text-[13.5px]" style={{ color: P.accent }}>+ {money(c.amountUsd)} {c.title} used this period<FinePrint P={P} s={c.source} /></div>)}</Panel>
      </Section>
      <Section P={P} title={'Protections' + (p.primaryItem ? ' · ' + p.primaryItem : '')}>
        <Panel P={P}>{prots.length ? prots.map((z, i) => <div key={z.type} className="px-4 py-3" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
          <div className="flex items-baseline justify-between gap-2"><div className="text-[14px] font-medium" style={{ color: P.ink }}>{z.label}</div>
            <div className="text-[12.5px] tabular-nums" style={{ color: z.status === 'active' || z.status === 'manufacturer' ? P.accent : P.muted }}>{z.end ? (z.status === 'manufacturer' ? fmtMonthYear(z.start) + ' – ' : 'until ') + fmtDate(z.end, { year: 'numeric' }) : z.status.replace('_', ' ')}</div></div>
          <div className="text-[12.5px] mt-0.5" style={{ color: P.muted }}>{z.reason || (z.cap ? z.cap.text : '')}{z.status === 'manufacturer' ? '. Starts when the manufacturer’s warranty ends.' : ''}</div>
          <FinePrint P={P} s={z.pr.source} />
        </div>) : <div className="px-4 py-3 text-[13px]" style={{ color: P.muted }}>{card.short} has no purchase protections for this.</div>}</Panel>
      </Section>
      {coach.lines.filter(l => !/Snap/.test(l)).map((l, i) => <div key={i} className="mt-3 text-[13px]" style={{ color: P.warn }}>{l}</div>)}
      <div className="mt-3 text-[11.5px]" style={{ color: P.faint }}>AI read the receipt; Benny’s calculator made every decision above from the card rules.</div>
      <div className="mt-4 flex gap-2"><Btn P={P} onClick={onAgain}>Snap another</Btn><Btn P={P} kind="ghost" onClick={() => x.go('home')}>Done</Btn></div>
    </div>
  );
}

/* ---------- Claims ---------- */
const CLAIM_EXAMPLES = ['my blender stopped working', 'my phone got stolen', 'my flight’s delayed 8 hours', 'the mixer from Costco died'];
function ClaimView({ x }) {
  const { P, E, rules, st, today } = x;
  const [text, setText] = useState(x.params.text || '');
  const [step, setStep] = useState('input'); const [err, setErr] = useState('');
  const [interp, setInterp] = useState(null); const [pid, setPid] = useState(null);
  const [extra, setExtra] = useState({}); const [packet, setPacket] = useState(null); const [packetBusy, setPacketBusy] = useState(false);
  const [img, setImg] = useState(null); const ran = useRef(false);
  const purchase = pid ? st.purchases.find(p => p.id === pid) : null;
  const incident = interp ? { type: interp.incidentType, date: interp.incidentDate || E.iso(today), delayHours: extra.delayHours != null ? extra.delayHours : interp.delayHours, overnight: extra.overnight != null ? extra.overnight : interp.overnight, delayCause: interp.delayCause } : null;
  const result = interp && purchase ? E.evaluateClaim(rules, st, incident, purchase, today) : null;
  const interpret = async t => {
    setErr(''); setStep('thinking'); setPacket(null); setExtra({});
    try {
      const list = st.purchases.map(p => ({ id: p.id, merchant: p.merchant, date: p.date, items: asArr(p.items).map(i => i.name).join('; '), card: (rules.cards[p.cardId] || {}).name, kind: p.kind || 'goods' }));
      const o = await gemini(x.gemUrl, [{ text: 'You help a cardholder start a credit-card benefit claim. Today is ' + E.iso(today) + '. They wrote: "' + t + '".\nClassify the incident: product_failure (stopped working, broke on its own), damage (dropped, cracked, spilled), theft (stolen), lost (misplaced, can\'t find it), trip_delay (flight/train delayed or cancelled), other.\nPick the single most likely purchase from this list by id, or null if none fits: ' + JSON.stringify(list) + '\nincidentDate as YYYY-MM-DD only if stated or clearly implied (e.g. "today" is ' + E.iso(today) + '), else null. For delays, extract delayHours, overnight (true/false/null) and delayCause (equipment, weather, strike, other, unknown). Do not decide coverage. summary: one short neutral sentence of what happened.' }],
        CLAIM_SCHEMA, o => !INCIDENTS.includes(o.incidentType) ? 'bad incident type' : (o.purchaseId && !st.purchases.some(p => p.id === o.purchaseId)) ? 'unknown purchase id' : (o.incidentDate && !/^\d{4}-\d{2}-\d{2}$/.test(o.incidentDate)) ? 'bad date' : null);
      setInterp(o);
      if (o.purchaseId && o.purchaseConfidence >= 0.6) { setPid(o.purchaseId); setStep('result'); } else { setPid(null); setStep('pick'); }
    } catch (e) { setErr(e.message); setStep('input'); }
  };
  useEffect(() => { if (x.params.text && !ran.current && x.gemUrl) { ran.current = true; interpret(x.params.text); } }, [x.gemUrl]);
  useEffect(() => { setImg(null); if (purchase && purchase.source === 'receipt') IDB.get(x.idbPrefix + purchase.id).then(b => b && setImg(URL.createObjectURL(b))).catch(() => {}); }, [pid]);
  const decisionKey = result ? result.decision + (result.payout ? result.payout.maxUsd : '') + pid : '';
  useEffect(() => {
    if (!result || !(result.decision === 'covered' || result.decision === 'manufacturer')) return;
    let dead = false; setPacketBusy(true); setPacket(null);
    gemini(x.gemUrl, [{ text: 'Write the cardholder\'s claim narrative and pre-filled answers for a ' + (result.protection ? result.protection.label : 'benefit') + ' claim. The coverage decision was already made by rules and is final: ' + result.decision + '. Use only these facts; do not add facts, amounts or promises. Facts: ' + JSON.stringify({ whatTheySaid: text, summary: interp.summary, incident, purchase: { merchant: purchase.merchant, date: purchase.date, items: purchase.items, total: purchase.total, card: rules.cards[purchase.cardId].name }, limits: result.payout && result.payout.text }) + '. narrative: 3-4 first-person sentences, plain and factual. answers: 5-7 likely claim-form questions with answers from the facts; write "[fill in]" where a fact is unknown.' }],
      PACKET_SCHEMA, o => (!o.narrative || !Array.isArray(o.answers)) ? 'incomplete packet' : null)
      .then(o => { if (!dead) setPacket(o); }).catch(e => { if (!dead) setPacket({ error: e.message }); }).finally(() => { if (!dead) setPacketBusy(false); });
    return () => { dead = true; };
  }, [decisionKey]);
  useEffect(() => {
    if (!result || !interp) return;
    const id = 'c-' + (interp._id || (interp._id = Date.now().toString(36)));
    x.save({ ['claims/' + id]: { id, text, incident, purchaseId: pid, cardId: purchase.cardId, decision: result.decision, protection: result.protection ? result.protection.type : null, payoutMaxUsd: result.payout ? result.payout.maxUsd : null, deadlines: result.deadlines, narrative: packet && !packet.error ? packet.narrative : null, answers: packet && !packet.error ? packet.answers : null, createdAt: Date.now() } });
  }, [decisionKey, packet]);
  const head = result && { covered: ['Covered', P.accent], not_covered: ['Not covered', P.bad], manufacturer: ['Claim with the manufacturer first', P.warn], needs_info: ['One more detail', P.warn] }[result.decision];
  return (
    <div className="pt-4">
      <div className="text-[26px] font-semibold tracking-[-0.02em]" style={{ color: P.ink }}>What happened?</div>
      <form onSubmit={e => { e.preventDefault(); if (text.trim()) interpret(text.trim()); }} className="mt-3 flex items-center gap-2 rounded-full pl-4 pr-1.5 h-12" style={{ background: P.surface, boxShadow: `0 0 0 1px ${P.line}` }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Say it plainly" className="flex-1 min-w-0 bg-transparent outline-none text-[14.5px]" style={{ color: P.ink }} />
        <button type="submit" disabled={!text.trim() || step === 'thinking'} className="h-9 px-3.5 rounded-full text-[13px] font-semibold disabled:opacity-30" style={{ background: P.btn, color: P.btnInk }}>Check</button>
      </form>
      {step === 'input' && <div className="mt-3 flex gap-1.5 flex-wrap">{CLAIM_EXAMPLES.map(t => <button key={t} onClick={() => { setText(t); interpret(t); }} className="rounded-full px-3 h-8 text-[12.5px]" style={{ background: P.raised, color: P.ink }}>{t}</button>)}</div>}
      {err && <div className="mt-3 text-[13px]" style={{ color: P.bad }}>{err}</div>}
      {step === 'thinking' && <div className="mt-6 text-[14px]" style={{ color: P.muted }}>Finding the receipt and the clause…</div>}
      {step === 'pick' && <div className="mt-5">
        <div className="text-[14px] font-medium" style={{ color: P.ink }}>Which purchase was it?</div>
        <Panel P={P} className="mt-2">{st.purchases.slice().sort((a, b) => b.date.localeCompare(a.date)).map((p, i) => <button key={p.id} onClick={() => { setPid(p.id); setStep('result'); }} className="w-full text-left px-4 py-2.5 flex items-center gap-3" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}><CardArt card={rules.cards[p.cardId]} size="xs" /><div className="flex-1 min-w-0"><div className="text-[13.5px] truncate" style={{ color: P.ink }}>{(asArr(p.items)[0] || {}).name || p.merchant}</div><div className="text-[11.5px]" style={{ color: P.muted }}>{p.merchant} · {fmtDate(p.date, { year: 'numeric' })}</div></div></button>)}</Panel>
      </div>}
      {step === 'result' && result && <div className="mt-5">
        <Panel P={P} className="p-4">
          <div className="text-[12px]" style={{ color: P.faint }}>{interp.summary}</div>
          <div className="mt-1 text-[30px] font-semibold tracking-[-0.025em]" style={{ color: head[1] }}>{head[0]}</div>
          <div className="text-[13.5px] mt-0.5" style={{ color: P.ink }}>{result.protection ? result.protection.label : 'No matching benefit'} · {result.card ? result.card.name : ''}{result.payout && result.decision === 'covered' ? ' · ' + result.payout.text : ''}</div>
          <div className="mt-3 flex items-center gap-3 rounded-xl p-2.5" style={{ background: P.raised }}>
            {img ? <img src={img} className="w-10 h-12 object-cover rounded" /> : <CardArt card={rules.cards[purchase.cardId]} size="xs" />}
            <div className="flex-1 min-w-0 text-[12.5px]"><div className="truncate font-medium" style={{ color: P.ink }}>{(asArr(purchase.items)[0] || {}).name || purchase.merchant}</div><div style={{ color: P.muted }}>{purchase.merchant} · {fmtDate(purchase.date, { year: 'numeric' })} · {money(purchase.total)}</div></div>
            {purchase.demo ? <DemoTag P={P} /> : purchase.hasReceipt ? <Pill P={P} tone="good">Receipt found</Pill> : null}
            <button className="text-[11.5px] underline" style={{ color: P.muted }} onClick={() => setStep('pick')}>change</button>
          </div>
          {result.clause && <div className="mt-3.5 pl-3" style={{ borderLeft: `2px solid ${head[1]}` }}>
            <div className="text-[13.5px] leading-[1.55]" style={{ color: P.ink, fontFamily: 'ui-serif, Georgia, serif' }}>“{result.clause.quote}”</div>
            <div className="mt-1 text-[11.5px]" style={{ color: P.muted }}>{result.clause.kind === 'issuer' ? 'Issuer terms' : 'Review site'}{result.clause.asOf ? ', effective ' + result.clause.asOf : ''} · {result.clause.url && <a className="underline" href={result.clause.url} target="_blank" rel="noreferrer">source</a>}</div>
          </div>}
          <div className="mt-3.5 grid gap-1.5">{result.reasons.map((r, i) => <div key={i} className="flex gap-2 text-[13px]"><span className="flex-none w-4 text-center font-bold" style={{ color: r.ok ? P.accent : P.bad }}>{r.ok ? '✓' : '✗'}</span><span style={{ color: P.ink }}>{r.text}</span></div>)}</div>
          {result.decision === 'needs_info' && result.ask === 'mfrWarrantyMonths' && <AskWarranty x={x} p={purchase} />}
          {result.kind === 'trip_delay' && result.decision !== 'covered' && <div className="mt-3 flex items-center gap-2 flex-wrap text-[13px]" style={{ color: P.ink }}>
            Delay now <input inputMode="decimal" defaultValue={incident.delayHours || ''} onChange={e => setExtra(Object.assign({}, extra, { delayHours: parseFloat(e.target.value) || null }))} className="w-14 rounded-lg px-2 h-8 tabular-nums" style={{ background: P.raised, color: P.ink }} /> hours
            <label className="flex items-center gap-1.5 ml-2"><input type="checkbox" checked={!!incident.overnight} onChange={e => setExtra(Object.assign({}, extra, { overnight: e.target.checked }))} /> forces an overnight stay</label>
          </div>}
          {result.hindsight.map((h, i) => <div key={i} className="mt-2.5 text-[12.5px]" style={{ color: P.warn }}>{h}</div>)}
        </Panel>
        {result.deadlines.length > 0 && <Section P={P} title="Deadlines">
          <Panel P={P}>{result.deadlines.map((d, i) => <div key={i} className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
            <div className="text-[13.5px]" style={{ color: P.ink }}>{d.label}</div>
            {d.date && <div className="text-right"><div className="text-[17px] font-semibold tabular-nums" style={{ color: d.daysLeft <= 14 ? P.warn : P.ink }}>{d.daysLeft} days</div><div className="text-[11.5px]" style={{ color: P.muted }}>by {fmtDate(d.date, { year: 'numeric' })}</div></div>}
          </div>)}</Panel>
        </Section>}
        {result.docs.length > 0 && <Section P={P} title="Documents">
          <Panel P={P} className="px-4 py-2">{result.docs.map(d => <div key={d.id} className="flex items-center gap-2.5 py-1.5 text-[13.5px]"><span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: d.have ? P.accentSoft : P.raised, color: d.have ? P.accent : P.faint }}>{d.have ? '✓' : '✗'}</span><span style={{ color: d.have ? P.ink : P.muted }}>{d.label}</span></div>)}</Panel>
        </Section>}
        {(packetBusy || packet) && <Section P={P} title="Pre-filled answers" right={packet && packet.narrative ? <button className="text-[12px] font-medium" style={{ color: P.muted }} onClick={async () => { const r = await copyText(packet.narrative + '\n\n' + packet.answers.map(a => a.q + '\n' + a.a).join('\n\n')); x.toast(r === 'failed' ? 'Couldn’t copy' : 'Copied'); }}>Copy</button> : null}>
          <Panel P={P} className="p-4">{packetBusy ? <div className="text-[13px]" style={{ color: P.muted }}>Writing the claim…</div> : packet.error ? <div className="text-[13px]" style={{ color: P.bad }}>{packet.error}</div> : <>
            <div className="text-[13.5px] leading-[1.6]" style={{ color: P.ink }}>{packet.narrative}</div>
            <div className="mt-3 grid gap-2.5">{packet.answers.map((a, i) => <div key={i}><div className="text-[11.5px] font-medium" style={{ color: P.faint }}>{a.q}</div><div className="text-[13.5px]" style={{ color: P.ink }}>{a.a}</div></div>)}</div>
          </>}</Panel>
        </Section>}
        {result.claimsUrl && result.decision !== 'not_covered' && <div className="mt-5 flex items-center gap-3 flex-wrap">
          <a href={result.claimsUrl} target="_blank" rel="noreferrer"><Btn P={P} kind="accent">Open the claims site ↗</Btn></a>
          {result.phone && <span className="text-[12.5px]" style={{ color: P.muted }}>or call {result.phone}</span>}
        </div>}
        <div className="mt-3 text-[11.5px]" style={{ color: P.faint }}>Benny doesn’t submit claims. AI read your words and wrote the text; the calculator made the decision from the card’s terms.</div>
      </div>}
    </div>
  );
}
function AskWarranty({ x, p }) {
  const { P } = x; const [v, setV] = useState('12');
  return <div className="mt-3 flex items-center gap-2 text-[13px]" style={{ color: P.ink }}>Manufacturer warranty <input value={v} onChange={e => setV(e.target.value)} className="w-14 rounded-lg px-2 h-8" style={{ background: P.raised, color: P.ink }} /> months <Btn P={P} kind="soft" onClick={() => x.save({ ['purchases/' + p.id + '/mfrWarrantyMonths']: parseInt(v, 10) || 12 })}>Use</Btn></div>;
}


/* ---------- iPhone purchase feed (iOS Shortcut) ---------- */
function NotificationMock({ P, text }) {
  return <div className="rounded-[20px] p-3 flex gap-3 items-start" style={{ background: 'rgba(245,245,247,.92)', boxShadow: '0 10px 30px -12px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.06)', color: '#111' }}>
    <span className="w-9 h-9 flex-none rounded-[9px] flex items-center justify-center text-[16px] font-bold" style={{ background: '#18181B', color: '#fff' }}>b</span>
    <div className="min-w-0 flex-1"><div className="flex justify-between text-[12.5px]"><b>Benny</b><span style={{ color: '#888' }}>now</span></div><div className="text-[13.5px] leading-[1.35] mt-0.5">{text}</div></div>
  </div>;
}
function IphoneFeed({ x }) {
  const { P, st } = x; const lsKey = 'benny-shortcut-key:' + userId;
  const [feed, setFeed] = useState(null); const [key, setKey] = useState(() => { try { return localStorage.getItem(lsKey); } catch (e) { return null; } });
  const [busy, setBusy] = useState(false); const [reply, setReply] = useState(null); const [err, setErr] = useState('');
  const [t, setT] = useState({ merchant: 'Instacart', amount: '$42.18', card: 'Chase Sapphire Preferred' });
  useEffect(() => FS.onValue(FS.ref(FS.db, relPathAddress('feed')), s => setFeed(s.val())), []);
  const connected = !!(st.shortcut && st.shortcut.keyHash);
  const keyValid = key && connected; // a key from this device; server rejects it if it was replaced elsewhere
  const link = feed && feed.url && keyValid ? feed.url + '/tx?k=' + key : null;
  const connect = async () => {
    setBusy(true); setErr('');
    try {
      const k = btoa(String.fromCharCode.apply(null, crypto.getRandomValues(new Uint8Array(18)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const h = await sha256hex(k); const old = st.shortcut && st.shortcut.keyHash; const u = { [h]: { uid: userId, createdAt: Date.now() } }; if (old && old !== h) u[old] = null;
      await FS.update(FS.ref(FS.db, relPathAddress('shortcutKeys')), u);
      await x.save({ 'shortcut/keyHash': h, 'shortcut/createdAt': Date.now() });
      try { localStorage.setItem(lsKey, k); } catch (e) {} setKey(k);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const disconnect = async () => { const old = st.shortcut && st.shortcut.keyHash; if (old) await FS.update(FS.ref(FS.db, relPathAddress('shortcutKeys')), { [old]: null }); await x.save({ shortcut: null }); try { localStorage.removeItem(lsKey); } catch (e) {} setKey(null); setReply(null); };
  const test = async () => { setBusy(true); setErr(''); setReply(null); try { const r = await fetch(link, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(t) }); setReply(await r.text()); } catch (e) { setErr('Couldn’t reach the feed: ' + e.message); } finally { setBusy(false); } };
  const inp = (k, w) => <input value={t[k]} onChange={e => setT(Object.assign({}, t, { [k]: e.target.value }))} className={'rounded-full px-3 h-9 text-[13px] ' + w} style={{ background: P.raised, color: P.ink }} />;
  const step = (n, title, body) => <div className="flex gap-3"><span className="w-6 h-6 flex-none rounded-full flex items-center justify-center text-[12px] font-semibold" style={{ background: P.raised, color: P.ink }}>{n}</span><div className="min-w-0"><div className="text-[13.5px] font-medium" style={{ color: P.ink }}>{title}</div>{body && <div className="text-[12.5px] mt-0.5 leading-[1.5]" style={{ color: P.muted }}>{body}</div>}</div></div>;
  if (!feed || !feed.url) return <div className="text-[13px]" style={{ color: P.muted }}>The feed endpoint isn’t running yet.</div>;
  return (
    <div>
      <Panel P={P} className="p-4">
        <div className="text-[14px] font-semibold" style={{ color: P.ink }}>Coaching after you tap</div>
        <div className="text-[12.5px] mt-0.5" style={{ color: P.muted }}>An iPhone Shortcut sends Benny the merchant, amount and card each time you pay with Apple Pay. Benny answers with a notification like this:</div>
        <div className="mt-3"><NotificationMock P={P} text={reply || 'Costco Visa would’ve earned $0.96 more.'} /></div>
        {!keyValid ? <div className="mt-4 flex gap-2 flex-wrap items-center">
          <Btn P={P} onClick={connect} disabled={busy}>{connected ? 'Make a new link for this phone' : 'Connect my iPhone'}</Btn>
          {connected && <span className="text-[12px]" style={{ color: P.muted }}>Connected from another device. A new link turns the old one off.</span>}
        </div> : <div className="mt-4">
          <div className="text-[11px] font-medium" style={{ color: P.faint }}>Your Benny link (private: it can add purchases to your account)</div>
          <div className="mt-1 flex gap-2 items-center"><div className="flex-1 min-w-0 rounded-full px-3 h-9 flex items-center text-[12px] truncate" style={{ background: P.raised, color: P.muted, fontFamily: 'ui-monospace, monospace' }}>…/benny-feed/tx?k={key.slice(0, 6)}…</div>
            <Btn P={P} kind="soft" onClick={async () => { const r = await copyText(link); x.toast(r === 'failed' ? 'Couldn’t copy' : 'Link copied'); }}>Copy link</Btn></div>
        </div>}
        {err && <div className="mt-2 text-[12.5px]" style={{ color: P.bad }}>{err}</div>}
      </Panel>
      {keyValid && <>
        <div className="mt-4 grid gap-3.5 px-1">
          {step(1, 'Shortcuts › Automation › + › Transaction', 'Pick the cards you added to Benny, keep Any Merchant, and choose Run Immediately.')}
          {step(2, 'Add “Get Contents of URL”', 'Paste your Benny link. Method POST. Request Body JSON with three Text fields: merchant = Merchant, amount = Amount, card = Card or Pass.')}
          {step(3, 'Add “Show Notification”', 'Set its text to Contents of URL. Done: tap to pay and Benny replies.')}
        </div>
        <Section P={P} title="Send a test tap">
          <div className="flex gap-2 flex-wrap items-center">{inp('merchant', 'w-36')}{inp('amount', 'w-24')}{inp('card', 'flex-1 min-w-[160px]')}<Btn P={P} onClick={test} disabled={busy}>{busy ? 'Sending…' : 'Send'}</Btn></div>
          <div className="mt-1.5 text-[11.5px]" style={{ color: P.faint }}>Goes through the real endpoint, exactly like the Shortcut, and saves the purchase.</div>
        </Section>
      </>}
      <div className="mt-3 flex items-center justify-between gap-3 px-1 flex-wrap">
        <div className="text-[11.5px]" style={{ color: P.faint }}>{st.shortcut && st.shortcut.lastSeen ? 'Last purchase from iPhone ' + new Date(st.shortcut.lastSeen).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No purchases from iPhone yet'} · link works until {fmtDate(feed.expiresAt, { year: 'numeric' })}</div>
        {connected && <button onClick={disconnect} className="text-[12px] underline" style={{ color: P.muted }}>Disconnect</button>}
      </div>
    </div>
  );
}

/* ---------- What we know about you ---------- */
function YouView({ x }) {
  const { P, E, rules, st } = x;
  const [imgCount, setImgCount] = useState(null); const [confirm, setConfirm] = useState(false); const [open, setOpen] = useState(null);
  const [tap, setTap] = useState({ m: 'instacart', amt: '42.18', card: Object.keys(st.wallet)[0] || '' });
  useEffect(() => { IDB.keys(x.idbPrefix).then(k => setImgCount(k.length)).catch(() => setImgCount(0)); }, [st.purchases.length]);
  const rows = [
    ['cards', 'Card product names', Object.keys(st.wallet).length, Object.keys(st.wallet).map(id => (rules.cards[id] || {}).name || id)],
    ['purchases', 'Purchases: store, amount, date, card, items', st.purchases.length, st.purchases.slice().sort((a, b) => b.date.localeCompare(a.date)).map(p => p.date + ' · ' + p.merchant + ' · ' + money(p.total) + ' · ' + ((rules.cards[p.cardId] || {}).short || '') + (p.demo ? ' · demo' : ''))],
    ['claims', 'Claim packets', st.claims.length, st.claims.map(c => fmtDate(c.createdAt) + ' · “' + c.text + '” · ' + c.decision.replace('_', ' '))],
    ['credits', 'Credits you marked used', Object.keys(st.creditUses).length, Object.keys(st.creditUses).map(k => k.split('__').slice(1).join(' · '))],
    ['iphone', 'iPhone feed link', st.shortcut ? 1 : 0, st.shortcut ? ['A hash of your link key (the key itself stays on your phone and this browser)'] : []],
    ['certs', 'Reward certificates', st.certificates.length, st.certificates.map(c => money0(c.amountUsd) + ' · expires ' + c.expires + (c.demo ? ' · demo' : ''))],
  ];
  const exportReceipts = async () => {
    const out = { exportedAt: new Date().toISOString(), app: 'Benny', purchases: [] };
    for (const p of st.purchases) { let image = null; try { const b = await IDB.get(x.idbPrefix + p.id); if (b) image = await blobToDataUrl(b); } catch (e) {} out.purchases.push(Object.assign({}, p, { image })); }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' })); a.download = 'benny-receipts-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); a.remove();
  };
  const wipe = async () => { await FS.remove(FS.ref(FS.db, x.userPath)); try { await IDB.removePrefix(x.idbPrefix); } catch (e) {} setConfirm(false); x.toast('Deleted everything'); x.go('home'); };
  const simulateTap = () => {
    const m = rules.mcc.find(z => z.id === tap.m); const id = 's-' + Date.now().toString(36);
    const p = { id, merchant: m.name.replace(/ \(booked direct\)/, ''), merchantId: m.id, date: E.iso(x.today), total: parseFloat(tap.amt) || 0, cardId: tap.card, items: [], durable: !/dining|grocery|gas|rideshare|streaming/.test(m.categories.join(' ')), source: 'shortcut', createdAt: Date.now() };
    const coach = E.coachPurchase(rules, Object.assign({}, st, { purchases: st.purchases.concat([p]) }), p, x.mode, x.today);
    x.save({ ['purchases/' + id]: p });
    x.toast(coach.lines[0] || ('Nice, ' + (rules.cards[p.cardId] || {}).short + ' was the right card.'));
  };
  return (
    <div className="pt-4">
      <div className="text-[26px] font-semibold tracking-[-0.02em]" style={{ color: P.ink }}>What we know about you</div>
      <div className="text-[13.5px] mt-1" style={{ color: P.muted }}>Everything Benny stores, and nothing else.</div>
      <Section P={P} title="Saved in Benny’s database">
        <Panel P={P}>{rows.map(([k, label, n, list], i) => <div key={k} style={{ borderTop: i ? `1px solid ${P.line}` : 'none' }}>
          <button onClick={() => setOpen(open === k ? null : k)} className="w-full px-4 py-3 flex items-center justify-between text-left"><span className="text-[13.5px]" style={{ color: P.ink }}>{label}</span><span className="text-[13px] tabular-nums" style={{ color: P.muted }}>{n} ›</span></button>
          {open === k && <div className="px-4 pb-3 -mt-1 grid gap-1">{list.length ? list.map((t, j) => <div key={j} className="text-[12.5px]" style={{ color: P.muted }}>{t}</div>) : <div className="text-[12.5px]" style={{ color: P.faint }}>Nothing</div>}</div>}
        </div>)}</Panel>
      </Section>
      <Section P={P} title="Only on this device">
        <Panel P={P} className="px-4 py-3 flex justify-between"><span className="text-[13.5px]" style={{ color: P.ink }}>Receipt photos</span><span className="text-[13px] tabular-nums" style={{ color: P.muted }}>{imgCount == null ? '…' : imgCount}</span></Panel>
        <div className="mt-2 text-[12px] px-1" style={{ color: P.warn }}>Receipt photos live in this browser only. Clearing browser data deletes them; export a backup.</div>
      </Section>
      <Section P={P} title="Never stored">
        <div className="text-[13px] px-1" style={{ color: P.muted }}>Card numbers, your location, screenshots. Location and screenshots are used once to answer, then discarded.</div>
      </Section>
      <div className="mt-5 flex gap-2 flex-wrap">
        <Btn P={P} kind="soft" onClick={exportReceipts}>Export my receipts</Btn>
        {!confirm ? <Btn P={P} kind="ghost" onClick={() => setConfirm(true)}>Delete everything</Btn>
          : <div className="flex items-center gap-2 rounded-full pl-3 pr-1 h-10" style={{ background: P.badSoft }}><span className="text-[12.5px]" style={{ color: P.bad }}>Delete all data and photos?</span><button onClick={wipe} className="rounded-full px-3 h-8 text-[12.5px] font-semibold" style={{ background: P.bad, color: '#fff' }}>Delete</button><button onClick={() => setConfirm(false)} className="rounded-full px-3 h-8 text-[12.5px]" style={{ color: P.ink }}>Cancel</button></div>}
      </div>
      <Section P={P} title="iPhone purchase feed"><IphoneFeed x={x} /></Section>
      <Section P={P} title="How Benny values points"><ValueToggle x={x} /></Section>
      <Section P={P} title="Demo controls">
        <Panel P={P} className="p-4 grid gap-3.5">
          <div className="flex items-center justify-between gap-3 flex-wrap"><div className="text-[13px]" style={{ color: P.ink }}>Clock: {fmtDate(x.today, { weekday: 'short', year: 'numeric' })}{st.settings.demoDays ? ' (+' + st.settings.demoDays + ' days)' : ''}</div>
            <div className="flex gap-2"><Btn P={P} kind="soft" onClick={() => x.save({ 'settings/demoDays': (st.settings.demoDays || 0) + 3 })}>Simulate 3 days later</Btn>{st.settings.demoDays ? <Btn P={P} kind="ghost" onClick={() => x.save({ 'settings/demoDays': 0 })}>Reset</Btn> : null}</div></div>
          <div className="flex items-center justify-between gap-3 flex-wrap"><div className="text-[13px]" style={{ color: P.ink }}>Simulated location</div>
            <select value={st.settings.location || ''} onChange={e => x.save({ 'settings/location': e.target.value || null })} className="rounded-full px-3 h-9 text-[13px]" style={{ background: P.raised, color: P.ink }}>
              <option value="">None</option>{['costco', 'costco-gas', 'target', 'whole-foods', 'shell', 'starbucks'].map(id => <option key={id} value={id}>{(rules.mcc.find(m => m.id === id) || {}).name}</option>)}
            </select></div>
          <div>
            <div className="text-[13px]" style={{ color: P.ink }}>Simulate a tap from the iPhone Shortcut</div>
            <div className="mt-2 flex gap-2 flex-wrap items-center">
              <select value={tap.m} onChange={e => setTap(Object.assign({}, tap, { m: e.target.value }))} className="rounded-full px-3 h-9 text-[13px]" style={{ background: P.raised, color: P.ink }}>{['instacart', 'costco-gas', 'costco', 'chipotle', 'uber', 'united-airlines', 'best-buy', 'shell'].map(id => <option key={id} value={id}>{rules.mcc.find(m => m.id === id).name}</option>)}</select>
              <input value={tap.amt} onChange={e => setTap(Object.assign({}, tap, { amt: e.target.value }))} className="w-20 rounded-full px-3 h-9 text-[13px] tabular-nums" style={{ background: P.raised, color: P.ink }} />
              <select value={tap.card} onChange={e => setTap(Object.assign({}, tap, { card: e.target.value }))} className="rounded-full px-3 h-9 text-[13px]" style={{ background: P.raised, color: P.ink }}>{Object.keys(st.wallet).map(id => <option key={id} value={id}>{rules.cards[id].short}</option>)}</select>
              <Btn P={P} kind="soft" onClick={simulateTap} disabled={!tap.card}>Send</Btn>
            </div>
          </div>
          <div className="flex gap-2"><Btn P={P} kind="ghost" onClick={x.loadDemo}>Reload demo data</Btn></div>
        </Panel>
      </Section>
    </div>
  );
}

/* ---------- shell ---------- */
const VIEWS = ['home', 'cards', 'receipt', 'claim', 'which', 'you'];
function readUrl() { const u = new URL(window.location.href); const v = u.searchParams.get('benny'); return { view: VIEWS.includes(v) ? v : 'home', params: { m: u.searchParams.get('bm') || null, text: u.searchParams.get('bq') || null } }; }
function UserDiv() {
  const { theme } = useTheme(); const P = palette(theme);
  const rulesPath = relPathAddress('rules'), enginePath = relPathAddress('engine', 'code'), demoPath = relPathAddress('demo'), userPath = relPathAddress('users', userId);
  const gem = useManaRouter('gemini');
  const [rules, setRules] = useState(null); const [src, setSrc] = useState(null); const [raw, setRaw] = useState(undefined); const [demo, setDemo] = useState(null);
  const [nav, setNav] = useState(readUrl); const [toast, setToastS] = useState(''); const tRef = useRef(null); const scrollRef = useRef(null);
  useEffect(() => {
    if (!rulesPath) return;
    const offs = [FS.onValue(FS.ref(FS.db, rulesPath), s => { const v = s.val(); try { setRules(v && v.json ? JSON.parse(v.json) : null); } catch (e) { console.error('rules parse failed', e); } }), FS.onValue(FS.ref(FS.db, enginePath), s => setSrc(s.val())), FS.onValue(FS.ref(FS.db, userPath), s => setRaw(s.val() || {}))];
    FS.get(FS.ref(FS.db, demoPath)).then(s => { const v = s.val(); setDemo(v && v.json ? JSON.parse(v.json) : null); });
    return () => offs.forEach(f => f());
  }, [rulesPath, userPath]);
  useEffect(() => { const h = () => setNav(readUrl()); window.addEventListener('popstate', h); return () => window.removeEventListener('popstate', h); }, []);
  const E = useMemo(() => { if (!src) return null; try { const m = { exports: {} }; new Function('module', 'exports', src)(m, m.exports); return m.exports; } catch (e) { console.error('engine load failed', e); return null; } }, [src]);
  const st = useMemo(() => { const r = raw || {}; return { wallet: r.wallet || {}, purchases: asArr(r.purchases), certificates: asArr(r.certificates), creditUses: r.creditUses || {}, claims: asArr(r.claims).sort((a, b) => b.createdAt - a.createdAt), settings: r.settings || {}, shortcut: r.shortcut || null }; }, [raw]);
  const today = useMemo(() => { if (!E) return 0; return E.parse(new Date().toLocaleDateString('en-CA')) + (st.settings.demoDays || 0) * DAYMS; }, [E, st.settings.demoDays]);
  const mode = st.settings.valueMode === 'travel' ? 'travel' : 'cash';
  const summary = useMemo(() => (E && rules ? E.owedSummary(rules, st, today) : null), [E, rules, st, today]);
  const go = (view, params) => {
    const u = new URL(window.location.href); u.searchParams.set('benny', view); u.searchParams.delete('bm'); u.searchParams.delete('bq');
    if (params && params.m) u.searchParams.set('bm', params.m); if (params && params.text) u.searchParams.set('bq', params.text);
    window.history.pushState({}, '', u.toString()); setNav({ view, params: params || {} }); if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };
  const showToast = m => { setToastS(m); clearTimeout(tRef.current); tRef.current = setTimeout(() => setToastS(''), 3600); };
  const save = partial => FS.update(FS.ref(FS.db, userPath), partial);
  const loadDemo = async () => { if (!demo) return; const d = Object.assign({}, demo); const keep = raw || {}; await FS.set(FS.ref(FS.db, userPath), Object.assign({}, d, keep.shortcut ? { shortcut: keep.shortcut } : {}, { settings: Object.assign({}, demo.settings, { valueMode: mode }, (keep.settings || {}).cardAliases ? { cardAliases: keep.settings.cardAliases } : {}) })); showToast('Demo wallet loaded'); go('home'); };
  if (!rules || !E || raw === undefined || !summary) return <div className="w-full flex items-center justify-center" style={{ height: 'var(--mana-app-height, 82vh)', color: P.muted, background: P.bg }}>{src && !E ? 'Benny’s engine failed to load.' : 'Opening Benny…'}</div>;
  const x = { P, E, rules, st, stEngine: st, today, mode, summary, save, go, params: nav.params, gemUrl: gem.url, toast: showToast, loadDemo, userPath, idbPrefix: userId + ':' };
  const V = { home: HomeView, cards: CardsView, receipt: ReceiptView, claim: ClaimView, which: WhichView, you: YouView }[nav.view];
  const tab = (v, label) => <button onClick={() => go(v)} className="flex-1 h-9 text-[12px] font-semibold rounded-full" style={{ color: nav.view === v ? P.ink : P.faint, background: nav.view === v ? P.raised : 'transparent' }}>{label}</button>;
  return (
    <div className="w-full flex flex-col relative" style={{ height: 'var(--mana-app-height, 82vh)', background: P.bg, color: P.ink }}>
      <div className="flex-none w-full"><div className="mx-auto max-w-[560px] px-5 pt-3 flex items-center justify-between">
        <button onClick={() => go('home')} className="flex items-center gap-2"><span className="w-6 h-6 rounded-[7px] flex items-center justify-center text-[13px] font-bold" style={{ background: P.btn, color: P.btnInk }}>b</span><span className="text-[15px] font-semibold tracking-[-0.01em]">Benny</span></button>
        <div className="flex items-center gap-2">{st.settings.demoDays ? <Pill P={P} tone="warn">+{st.settings.demoDays} days</Pill> : null}<span className="text-[12px] tabular-nums" style={{ color: P.faint }}>{fmtDate(today, { weekday: 'short' })}</span></div>
      </div></div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto w-full"><div className="mx-auto max-w-[560px] px-5 pb-8">
        {gem.error && <div className="mt-3 text-[12px]" style={{ color: P.bad }}>AI unavailable: {gem.error.message}</div>}{!gem.url && !gem.error && <div className="mt-3 text-[11.5px]" style={{ color: P.faint }}>Connecting AI…</div>}
        <V x={x} />
      </div></div>
      <div className="flex-none w-full" style={{ borderTop: `1px solid ${P.line}`, background: P.bg }}><div className="mx-auto max-w-[560px] px-4 pt-2.5 pb-2">
        <div className="flex gap-2">
          <button onClick={() => go('which')} className="flex-1 h-11 rounded-full text-[14px] font-semibold" style={{ background: P.surface, color: P.ink, boxShadow: `0 0 0 1px ${P.line}` }}>Which card here?</button>
          <button onClick={() => go('receipt')} className="flex-1 h-11 rounded-full text-[14px] font-semibold" style={{ background: P.btn, color: P.btnInk }}>Snap receipt</button>
        </div>
        <div className="mt-1.5 flex gap-1">{tab('home', 'Home')}{tab('cards', 'Cards')}{tab('claim', 'Claims')}{tab('you', 'You')}</div>
      </div></div>
      {toast && <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[118px] max-w-[90%] rounded-full px-4 py-2.5 text-[13px] font-medium shadow-lg" style={{ background: P.btn, color: P.btnInk }}>{toast}</div>}
    </div>
  );
}
