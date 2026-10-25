/* Benny+ Gmail helper. Lives in YOUR OWN Mana workspace (Benny+ puts it here when you press Import from Gmail).
   Here you are the owner, so it can read your Gmail through your own Google connection without a Mana sandbox.
   Read-only: it searches receipt and order emails, sends each to your own Benny+ records (same reader and matching as an
   uploaded email) and deletes anything that isn't a purchase. Settings in ./config (api, days, returnUrl). */
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

const PALS = { light: { bg: '#F3F2E8', surface: '#FBFAF3', ink: '#16241C', muted: '#58675C', line: 'rgba(22,36,28,0.14)', accent: '#1E6A48', accentInk: '#fff', danger: '#A23B2A' },
  dark: { bg: '#0C1511', surface: '#111D17', ink: '#E3EBDC', muted: '#97A898', line: 'rgba(227,235,220,0.14)', accent: '#86BC7A', accentInk: '#0C1511', danger: '#E58468' } };
async function bpCall(api, method, path, body) {
  const tok = await FS.auth.currentUser.getIdToken();
  const r = await fetch(api + path, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error((d && (d.message || d.error)) || ('Request failed (' + r.status + ')')); return d;
}
function UserDiv() {
  const { theme } = useTheme(); const P = PALS[theme === 'light' ? 'light' : 'dark'];
  const [cfg, setCfg] = React.useState(null); const [linked, setLinked] = React.useState(null); const [s, setS] = React.useState(null); const [err, setErr] = React.useState(null);
  const started = React.useRef(false);
  const gm = useSymbolicProxyUrl({ name: 'gmail', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages', method: 'GET', allowSubpaths: true, headers: { authorization: 'Bearer ${secrets.GOOGLE_OAUTH_TOKEN}' } });
  React.useEffect(() => FS.onValue(FS.ref(FS.db, relPathAddress('config')), x => setCfg(x.val() || {})), []);
  React.useEffect(() => { let on = true; Promise.resolve(checkOAuthStatus(userId)).then(v => on && setLinked(!!v)).catch(() => on && setLinked(false)); return () => { on = false; }; }, []);
  const days = (cfg && cfg.days) || 90;
  const run = async () => {
    if (started.current) return; started.current = true; setErr(null);
    let st = { state: 'running', found: 0, processed: 0, imported: 0, matched: 0, duplicates: 0, skipped: 0, failed: 0 }; const push = x => { st = { ...st, ...x }; setS(st); };
    try {
      if (!cfg || !cfg.api) throw new Error('Open Benny+ and press Import from Gmail again.');
      push({});
      const ids = []; let page = null;
      while (ids.length < GM_MAX) {
        const q = new URLSearchParams({ q: GM_QUERY(days), maxResults: String(GM_MAX - ids.length) }); if (page) q.set('pageToken', page);
        const r = await fetch(gm.url + '?' + q);
        if (r.status === 401 || r.status === 403) { const t = await r.text(); push({ state: 'error', noAccess: true, message: 'Google said no to reading Gmail (' + r.status + '). ' + (/insufficient|scope/i.test(t) ? 'Your Google connection doesn’t include Gmail access.' : '') }); started.current = false; return; }
        if (!r.ok) throw new Error('Gmail search failed (' + r.status + ')');
        const d = await r.json(); for (const m of d.messages || []) ids.push(m.id); page = d.nextPageToken; if (!page) break;
      }
      push({ found: ids.length }); let k = 0;
      const worker = async () => { while (k < ids.length) { const id = ids[k++]; let res = 'failed';
        try { const r = await fetch(gm.url + '/' + id + '?format=full');
          if (r.ok) { const x = await bpCall(cfg.api, 'POST', '/v1/documents', { kind: 'eml', content: gmEml(await r.json()), file_name: 'Gmail', discard_non_purchase: true });
            if (x.duplicate) res = 'duplicate';
            else if (x.skipped || !(x.extracted || {}).is_purchase_document) res = 'skipped';
            else res = (x.link || {}).confirmed ? 'matched' : 'imported'; } } catch (e) {}
        push({ processed: st.processed + 1, imported: st.imported + (res === 'imported' || res === 'matched' ? 1 : 0), matched: st.matched + (res === 'matched' ? 1 : 0),
          duplicates: st.duplicates + (res === 'duplicate' ? 1 : 0), skipped: st.skipped + (res === 'skipped' ? 1 : 0), failed: st.failed + (res === 'failed' ? 1 : 0) }); } };
      await Promise.all(Array.from({ length: 8 }, worker));
      push({ state: 'done' });
    } catch (e) { setErr(String(e.message || e).slice(0, 220)); setS(null); started.current = false; }
  };
  // Start on its own when Benny+ just sent you here and everything is ready.
  React.useEffect(() => { if (cfg && cfg.api && linked && gm.url && !started.current && cfg.requestedAt && Date.now() - cfg.requestedAt < 5 * 60 * 1000) run(); }, [cfg, linked, gm.url]);
  const back = () => { if (cfg && cfg.returnUrl) window.location.href = cfg.returnUrl; };
  React.useEffect(() => { if (s && s.state === 'done' && cfg && cfg.returnUrl && cfg.requestedAt && Date.now() - cfg.requestedAt < 15 * 60 * 1000) { const t = setTimeout(back, 2500); return () => clearTimeout(t); } }, [s && s.state]);
  const connect = () => connectGoogleOAuth(userId, { onSuccess: () => { setLinked(true); setTimeout(() => window.location.reload(), 800); }, onError: e => setErr('Google didn’t connect' + (e && e.message ? ': ' + e.message : '.')) });
  const pct = s && s.found ? Math.round(100 * s.processed / s.found) : 0;
  const btn = (primary) => ({ background: primary ? P.accent : 'transparent', color: primary ? P.accentInk : P.ink, border: `1px solid ${primary ? P.accent : P.line}`, borderRadius: 9999, padding: '8px 16px', fontSize: 13, fontWeight: 500 });
  return (
    <div className="w-full py-8" style={{ color: P.ink }}>
      <div className="mx-auto max-w-xl rounded-2xl p-6" style={{ background: P.surface, border: `1px solid ${P.line}` }}>
        <div style={{ fontFamily: 'ui-serif, Georgia, serif', fontSize: 26, fontWeight: 600 }}>Benny+ · Gmail import</div>
        <div className="mt-2 text-[13.5px] leading-6" style={{ color: P.muted }}>Benny+ searches your Gmail (read-only) for receipts and order confirmations from the last {days} days and adds them to your Benny+ purchases. Other emails are skipped; nothing is sent or changed. This page lives in your own Mana space because that’s where your Google connection can be used.</div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {linked === false && <button style={btn(true)} onClick={connect}>Connect Google</button>}
          {linked && !s && <button style={{ ...btn(true), opacity: gm.url ? 1 : 0.5 }} disabled={!gm.url} onClick={run}>{gm.url ? 'Import from Gmail' : 'Getting Google ready…'}</button>}
          {cfg && cfg.returnUrl && <button style={btn(false)} onClick={back}>Back to Benny+</button>}
        </div>
        {gm.error && linked && <div className="mt-3 text-[13px]" style={{ color: P.danger }}>Google isn’t ready: {gm.error.message}. Reload this page once.</div>}
        {s && s.state === 'running' && <div className="mt-5"><div className="h-1.5 overflow-hidden rounded-full" style={{ background: P.line }}><div className="h-full rounded-full transition-all" style={{ width: Math.max(4, pct) + '%', background: P.accent }} /></div>
          <div className="mt-2 text-[13px]" style={{ color: P.muted }}>{s.found ? `Reading ${s.processed} of ${s.found} emails · ${s.imported} receipt${s.imported === 1 ? '' : 's'} so far${s.matched ? `, ${s.matched} matched to a transaction` : ''}` : 'Searching your Gmail…'}</div></div>}
        {s && s.state === 'done' && <div className="mt-5 text-[14px]" style={{ color: P.accent }}>{s.found ? `Checked ${s.found} email${s.found === 1 ? '' : 's'}: ${s.imported} receipt${s.imported === 1 ? '' : 's'} added${s.matched ? ` (${s.matched} matched to a card transaction)` : ''}${s.duplicates ? `, ${s.duplicates} already there` : ''}${s.skipped ? `, ${s.skipped} weren’t purchases` : ''}${s.failed ? `, ${s.failed} couldn’t be read` : ''}.` : `No receipt emails found in the last ${days} days.`}{cfg && cfg.returnUrl ? ' Taking you back to Benny+…' : ''}</div>}
        {s && s.state === 'error' && <div className="mt-5 text-[13px] leading-5" style={{ color: P.danger }}>{s.message} <button className="underline" onClick={connect}>Reconnect Google</button> and allow Gmail access, or download receipt emails (Gmail ⋮ → Download message) and add them in Benny+.</div>}
        {err && <div className="mt-4 text-[13px]" style={{ color: P.danger }}>{err}</div>}
      </div>
    </div>
  );
}
