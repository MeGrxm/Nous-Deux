// ─────────────────────────────────────────────────────────────
//  Nous deux — service calendrier (Cloudflare Worker)
//  À coller dans un Cloudflare Worker (voir LISEZMOI.md).
//
//  Ce service fait deux choses :
//   1. un lien d'abonnement .ics (pour le Calendrier de l'iPhone) ;
//   2. la connexion directe à Google Agenda : après une autorisation unique,
//      il recopie l'agenda de l'appli dans un agenda Google « Nous deux »
//      (toutes les 15 minutes, et tout de suite après chaque modification).
//
//  Variables à définir dans Cloudflare (Settings > Variables and Secrets) :
//    FIREBASE_API_KEY      même valeur que apiKey dans config.js
//    FIREBASE_PROJECT_ID   même valeur que projectId dans config.js
//    ROBOT_EMAIL           e-mail du compte « robot »
//    ROBOT_PASSWORD        son mot de passe — type « Secret »
//  Pour Google Agenda (facultatif) :
//    GOOGLE_CLIENT_ID      identifiant du client OAuth Google
//    GOOGLE_CLIENT_SECRET  son code secret — type « Secret »
//  + un déclencheur Cron : */15 * * * *
//
//  Ce que le service peut faire dans Google : uniquement créer ses propres agendas
//  et gérer leurs événements (autorisation « calendar.app.created »). Il ne peut pas
//  lire votre agenda personnel, vos e-mails ni vos contacts.
// ─────────────────────────────────────────────────────────────

const TZ = 'Europe/Paris';
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const GCAL = 'https://www.googleapis.com/calendar/v3';
// Couleurs de l'appli → couleurs d'événement Google Agenda
const GCOLORS = { corail: '6', sauge: '2', ocean: '9', lavande: '3', framboise: '4', moutarde: '5', turquoise: '7', ardoise: '8' };
const CORS = { 'access-control-allow-origin': '*' };

let cachedToken = null; // jeton du robot, réutilisé tant qu'il est valide

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/google/')) return await googleRoute(request, url, env, ctx);
      if (request.method !== 'GET' && request.method !== 'HEAD') return text('Méthode non autorisée', 405);
      const m = url.pathname.match(/^\/([A-Za-z0-9_-]{24,64})\.ics$/);
      if (!m) return text('Introuvable', 404);

      const c = newCtx(env);
      await signIn(c);
      const [config, events, users] = await Promise.all([getDoc(c, 'config/feed'), listDocs(c, 'events'), listDocs(c, 'users')]);
      if (!config?.token || !safeEqual(m[1], config.token)) return text('Introuvable', 404);

      const body = buildCalendar(events, users, url.searchParams.get('pour') || '');
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300', 'x-robots-tag': 'noindex' },
      });
    } catch (e) {
      return text('Service momentanément indisponible', 502);
    }
  },

  // Déclencheur Cron : synchronisation régulière avec Google Agenda.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(syncGoogle(newCtx(env)).catch(() => {}));
  },
};

/* ───────── Petits utilitaires ───────── */
function text(msg, status, extra = {}) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...extra } });
}
const htmlEsc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function page(title, msg, status = 200) {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nous deux</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#FBF7F2;color:#2A2420;font:17px/1.5 system-ui,-apple-system,sans-serif;padding:24px;box-sizing:border-box}main{max-width:420px;background:#fff;border:1px solid #E8DED4;border-radius:24px;padding:28px 24px;box-shadow:0 6px 20px rgba(42,36,32,.06)}h1{font-size:24px;margin:0 0 10px}p{margin:0;color:#776B62}@media(prefers-color-scheme:dark){body{background:#151210;color:#F3ECE5}main{background:#1F1A17;border-color:#342C27}p{color:#A3978D}}</style>
</head><body><main><h1>${htmlEsc(title)}</h1><p>${htmlEsc(msg)}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' },
  });
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ───────── Contexte d'exécution : 50 sous-requêtes maximum (offre gratuite) ───────── */
function newCtx(env) { return { env, left: 48, idToken: null }; }
async function sub(c, url, opts) {
  if (c.left <= 0) throw new Error('budget de requêtes épuisé');
  c.left--;
  return fetch(url, opts);
}

/* ───────── Firebase (API REST, compte robot) ───────── */
async function signIn(c) {
  if (cachedToken && cachedToken.exp > Date.now() + 60e3) { c.idToken = cachedToken.idToken; return; }
  const res = await sub(c, `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${c.env.FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: c.env.ROBOT_EMAIL, password: c.env.ROBOT_PASSWORD, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error('connexion robot refusée');
  const j = await res.json();
  cachedToken = { idToken: j.idToken, exp: Date.now() + Number(j.expiresIn || 3600) * 1000 };
  c.idToken = j.idToken;
}

const fsBase = env => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const authz = c => ({ authorization: `Bearer ${c.idToken}` });

async function getDoc(c, path) {
  const res = await sub(c, `${fsBase(c.env)}/${path}`, { headers: authz(c) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('lecture refusée');
  return fromFields((await res.json()).fields || {});
}

async function listDocs(c, col) {
  const out = [];
  let pageToken = '';
  do {
    const res = await sub(c, `${fsBase(c.env)}/${col}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { headers: authz(c) });
    if (!res.ok) throw new Error('lecture refusée');
    const j = await res.json();
    for (const d of j.documents || []) out.push({ id: d.name.split('/').pop(), ...fromFields(d.fields || {}) });
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

// merge = true : ne modifie que les champs fournis.
async function setDoc(c, path, obj, merge = false) {
  const mask = merge ? '?' + Object.keys(obj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&') : '';
  const res = await sub(c, `${fsBase(c.env)}/${path}${mask}`, {
    method: 'PATCH',
    headers: { ...authz(c), 'content-type': 'application/json' },
    body: JSON.stringify({ fields: toFields(obj) }),
  });
  if (!res.ok) throw new Error('écriture refusée');
}
const setStatus = (c, obj) => setDoc(c, 'gsync/status', obj, true);

function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
function fromFields(f) {
  const o = {};
  for (const [k, v] of Object.entries(f)) o[k] = fromValue(v);
  return o;
}
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: toFields(v) } };
}
function toFields(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)])); }

/* ───────── Chiffrement du jeton Google et signature du « state » OAuth ───────── */
const te = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), ch => ch.charCodeAt(0));

async function keys(env) {
  const seed = `${env.GOOGLE_CLIENT_SECRET}|${env.ROBOT_PASSWORD}`;
  const derive = label => crypto.subtle.digest('SHA-256', te.encode(`nous-deux|${label}|${seed}`));
  return {
    hmac: await crypto.subtle.importKey('raw', await derive('hmac'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
    aes: await crypto.subtle.importKey('raw', await derive('aes'), 'AES-GCM', false, ['encrypt', 'decrypt']),
  };
}
async function encrypt(env, plain) {
  const { aes } = await keys(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, te.encode(plain));
  return `${b64u(iv)}.${b64u(ct)}`;
}
async function decrypt(env, packed) {
  const { aes } = await keys(env);
  const [iv, ct] = packed.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, aes, unb64u(ct));
  return new TextDecoder().decode(pt);
}
async function makeState(env) {
  const { hmac } = await keys(env);
  const payload = `${Date.now()}.${b64u(crypto.getRandomValues(new Uint8Array(9)))}`;
  return `${payload}.${b64u(await crypto.subtle.sign('HMAC', hmac, te.encode(payload)))}`;
}
async function checkState(env, state) {
  const parts = String(state).split('.');
  if (parts.length !== 3) return false;
  const [ts, nonce, sig] = parts;
  if (!/^\d+$/.test(ts) || Date.now() - Number(ts) > 15 * 60e3) return false;
  try {
    const { hmac } = await keys(env);
    return await crypto.subtle.verify('HMAC', hmac, unb64u(sig), te.encode(`${ts}.${nonce}`));
  } catch { return false; }
}

/* ───────── Google : routes ───────── */
async function googleRoute(request, url, env, ctx) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return page('Google Agenda n’est pas encore configuré', 'Ajoutez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET dans les réglages du service Cloudflare (voir le guide).', 503);
  }
  const route = url.pathname.slice('/google/'.length);
  const redirectUri = `${url.origin}/google/callback`;
  if (route === 'callback' && request.method === 'GET') return googleCallback(url, env, redirectUri);

  // Les autres routes exigent le lien secret de l'appli.
  const c = newCtx(env);
  await signIn(c);
  const config = await getDoc(c, 'config/feed');
  if (!config?.token || !safeEqual(url.searchParams.get('k') || '', config.token)) return text('Introuvable', 404, CORS);

  if (route === 'start' && request.method === 'GET') {
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state: await makeState(env),
    });
    return new Response(null, { status: 302, headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' } });
  }
  if (route === 'sync' && request.method === 'POST') {
    ctx.waitUntil(syncGoogle(c).catch(() => {}));
    return new Response(null, { status: 202, headers: CORS });
  }
  if (route === 'disconnect' && request.method === 'POST') {
    await disconnectGoogle(c);
    return new Response(null, { status: 204, headers: CORS });
  }
  return text('Introuvable', 404, CORS);
}

async function googleCallback(url, env, redirectUri) {
  if (url.searchParams.get('error')) return page('Connexion annulée', 'Google Agenda n’a pas été connecté. Vous pouvez réessayer depuis les Réglages de Nous deux.', 400);
  const code = url.searchParams.get('code') || '';
  if (!code || !(await checkState(env, url.searchParams.get('state') || ''))) {
    return page('Lien expiré', 'Recommencez depuis les Réglages de Nous deux (bouton « Connecter Google Agenda »).', 400);
  }
  const c = newCtx(env);
  const res = await sub(c, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!res.ok) return page('Échec de la connexion', 'Google a refusé l’autorisation. Réessayez depuis les Réglages de Nous deux.', 502);
  const tok = await res.json();
  if (!String(tok.scope || '').split(' ').includes(SCOPE)) {
    return page('Autorisation incomplète', 'Sur l’écran de Google, il faut autoriser l’accès à Google Agenda. Réessayez depuis les Réglages de Nous deux.', 400);
  }
  if (!tok.refresh_token) return page('Autorisation incomplète', 'Google n’a pas fourni d’autorisation durable. Réessayez depuis les Réglages de Nous deux.', 400);

  await signIn(c);
  const old = await getDoc(c, 'gsync/secret');
  let cal = old?.cal || '', map = old?.map || {};
  if (cal) { // Reconnexion au même compte : on garde le même agenda.
    const r = await gapi(c, tok.access_token, 'GET', `/calendars/${encodeURIComponent(cal)}`);
    if (!r.ok) { cal = ''; map = {}; }
  }
  if (!cal) {
    cal = await createCalendar(c, tok.access_token);
    if (!cal) return page('Échec', 'Impossible de créer l’agenda « Nous deux » dans Google Agenda. Réessayez plus tard.', 502);
    map = {};
  }
  await setDoc(c, 'gsync/secret', { rt: await encrypt(env, tok.refresh_token), cal, map });
  await setDoc(c, 'gsync/status', { connected: true, since: Date.now(), lastSync: 0, count: Object.keys(map).length, pending: 0, failed: 0, error: '' });
  return page('Google Agenda est connecté ✅', 'Un agenda « Nous deux » a été ajouté à ce compte Google. Les événements y arrivent dans quelques minutes. Vous pouvez fermer cette page et revenir dans Nous deux.');
}

async function disconnectGoogle(c) {
  const secret = await getDoc(c, 'gsync/secret');
  if (secret?.rt) {
    try {
      const rt = await decrypt(c.env, secret.rt);
      await sub(c, 'https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: rt }) });
    } catch { /* jeton déjà invalide */ }
    // On garde l'agenda et la correspondance : une reconnexion au même compte reprend là où on en était.
    await setDoc(c, 'gsync/secret', { rt: '', cal: secret.cal || '', map: secret.map || {} });
  }
  await setStatus(c, { connected: false, error: '', pending: 0 });
}

/* ───────── Google : API ───────── */
function gapi(c, token, method, path, body) {
  return sub(c, GCAL + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function createCalendar(c, token) {
  const r = await gapi(c, token, 'POST', '/calendars', { summary: 'Nous deux', description: 'Agenda partagé, géré par l’appli Nous deux. Modifiez les événements dans l’appli.', timeZone: TZ });
  return r.ok ? (await r.json()).id : '';
}
async function accessToken(c, rt) {
  const r = await sub(c, 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.env.GOOGLE_CLIENT_ID, client_secret: c.env.GOOGLE_CLIENT_SECRET, refresh_token: rt, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { token: j.access_token } : { error: j.error || `http_${r.status}` };
}

// Identifiant d'événement Google stable, dérivé de l'identifiant de l'appli
// (caractères autorisés par Google : a-v et 0-9).
const gid = id => 'nd' + Array.from(te.encode(id), b => b.toString(16).padStart(2, '0')).join('');
async function hashOf(obj) {
  const d = await crypto.subtle.digest('SHA-256', te.encode(JSON.stringify(obj)));
  return Array.from(new Uint8Array(d).slice(0, 10), b => b.toString(16).padStart(2, '0')).join('');
}

function googleBody(ev, users, pour) {
  if (!isDate(ev.date) || !ev.title) return null;
  if (pour && ev.who !== 'both' && ev.who !== pour) return null;
  const who = whoName(ev, users);
  const t = timing(ev);
  const b = {
    id: gid(ev.id), status: 'confirmed',
    summary: who ? `${who} – ${ev.title}` : ev.title,
    description: ev.note || '',
    transparency: 'opaque',
    reminders: { useDefault: false }, // les rappels viennent de Nous deux : pas d'alerte en double
  };
  if (t.allDay) { b.start = { date: t.sd }; b.end = { date: t.ed }; }
  else { b.start = { dateTime: `${t.sd}T${t.st}:00`, timeZone: TZ }; b.end = { dateTime: `${t.ed}T${t.et}:00`, timeZone: TZ }; }
  const r = rrule(ev);
  if (r) b.recurrence = [`RRULE:${r}`, ...exdates(ev, t.allDay)];
  const color = ev.who !== 'both' && GCOLORS[users.find(u => u.id === ev.who)?.color];
  if (color) b.colorId = color;
  return b;
}

/* ───────── Google : synchronisation par différence ───────── */
async function syncGoogle(c) {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return;
  await signIn(c);
  const secret = await getDoc(c, 'gsync/secret');
  if (!secret?.rt) return; // pas connecté
  const [config, events, users] = await Promise.all([getDoc(c, 'config/feed'), listDocs(c, 'events'), listDocs(c, 'users')]);

  let rt;
  try { rt = await decrypt(c.env, secret.rt); }
  catch { await setStatus(c, { connected: false, error: 'Autorisation illisible : reconnectez Google Agenda.' }); return; }
  const at = await accessToken(c, rt);
  if (at.error) {
    if (at.error === 'invalid_grant') {
      await setDoc(c, 'gsync/secret', { rt: '', cal: secret.cal || '', map: secret.map || {} });
      await setStatus(c, { connected: false, error: 'Google a retiré l’autorisation (ou elle a expiré) : reconnectez Google Agenda.' });
    }
    return;
  }

  let cal = secret.cal || '', map = { ...(secret.map || {}) }, changed = false;
  if (!cal) {
    cal = await createCalendar(c, at.token);
    if (!cal) return;
    map = {}; changed = true;
  } else {
    // L'agenda existe-t-il toujours ? (il a pu être supprimé à la main dans Google Agenda)
    const chk = await gapi(c, at.token, 'GET', `/calendars/${encodeURIComponent(cal)}`);
    if (chk.status === 404) { await calendarGone(c, rt); return; }
  }

  const pour = config?.gpour && config.gpour !== 'all' ? config.gpour : '';
  const work = [];
  const wanted = new Set();
  for (const ev of events) {
    const b = googleBody(ev, users, pour);
    if (!b) continue;
    wanted.add(b.id);
    const h = await hashOf(b);
    if (map[b.id] !== h) work.push({ op: 'up', id: b.id, b, h });
  }
  for (const id of Object.keys(map)) if (!wanted.has(id)) work.push({ op: 'del', id });

  const calPath = `/calendars/${encodeURIComponent(cal)}/events`;
  let done = 0, failed = 0, gone = false, throttled = false;
  for (const w of work) {
    if (c.left < 4) break; // on garde de quoi enregistrer l'état
    if (w.op === 'del') {
      const r = await gapi(c, at.token, 'DELETE', `${calPath}/${w.id}`);
      if ([200, 204, 404, 410].includes(r.status)) { delete map[w.id]; changed = true; done++; }
      else if (r.status === 403 || r.status === 429) { throttled = true; break; }
      else failed++;
      continue;
    }
    let r;
    if (map[w.id]) {
      r = await gapi(c, at.token, 'PUT', `${calPath}/${w.id}`, w.b);
      if (r.status === 404 && c.left >= 4) r = await gapi(c, at.token, 'POST', calPath, w.b);
    } else {
      r = await gapi(c, at.token, 'POST', calPath, w.b);
      if (r.status === 409 && c.left >= 4) r = await gapi(c, at.token, 'PUT', `${calPath}/${w.id}`, w.b); // existe déjà (ou supprimé) : on le remplace
    }
    if (r.ok) { map[w.id] = w.h; changed = true; done++; }
    else if (r.status === 404) { gone = true; break; } // l'agenda a été supprimé côté Google
    else if (r.status === 403 || r.status === 429) { throttled = true; break; }
    else failed++;
  }

  if (gone) { await calendarGone(c, rt); return; }
  if (changed) await setDoc(c, 'gsync/secret', { rt: secret.rt, cal, map });
  await setStatus(c, {
    connected: true, lastSync: Date.now(), count: Object.keys(map).length,
    pending: Math.max(0, work.length - done - failed), failed,
    error: throttled ? 'Google limite temporairement les envois : la suite arrivera au prochain passage.' : '',
  });
}

// L'agenda a été supprimé dans Google : on respecte ce choix et on se déconnecte proprement.
async function calendarGone(c, rt) {
  try { await sub(c, 'https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: rt }) }); } catch { /* déjà invalide */ }
  await setDoc(c, 'gsync/secret', { rt: '', cal: '', map: {} });
  await setStatus(c, { connected: false, pending: 0, error: 'L’agenda « Nous deux » a été supprimé dans Google Agenda. Reconnectez Google Agenda pour le recréer.' });
}

/* ───────── Événements : dates, répétitions ───────── */
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Paris',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];
const escapeText = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = s => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s);
const d8 = s => s.replaceAll('-', '');
const t6 = s => s.replace(':', '') + '00';
function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function addMinutes(date, time, minutes) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d, h, mi + minutes));
  return [x.toISOString().slice(0, 10), x.toISOString().slice(11, 16)];
}
function timing(ev) {
  const allDay = !!ev.allDay || !isTime(ev.start);
  if (allDay) return { allDay, sd: ev.date, ed: addDays(ev.date, 1) };
  let [ed, et] = [ev.date, ev.end];
  if (!isTime(et)) [ed, et] = addMinutes(ev.date, ev.start, 60);   // sans heure de fin : 1 h
  else if (et <= ev.start) ed = addDays(ev.date, 1);                // horaire de nuit : finit le lendemain
  return { allDay, sd: ev.date, st: ev.start, ed, et };
}
function rrule(ev) {
  const map = {
    daily: 'FREQ=DAILY',
    weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    weekly: 'FREQ=WEEKLY',
    biweekly: 'FREQ=WEEKLY;INTERVAL=2',
    monthly: `FREQ=MONTHLY;BYMONTHDAY=${Number(ev.date.slice(8))}`,
  };
  const r = map[ev.repeat];
  if (!r) return null;
  // Avec un fuseau horaire, UNTIL doit être en UTC : 21:59:59Z reste le même jour à Paris, été comme hiver.
  if (isDate(ev.until)) return `${r};UNTIL=${ev.allDay || !isTime(ev.start) ? d8(ev.until) : d8(ev.until) + 'T215959Z'}`;
  return r;
}
function exdates(ev, allDay) {
  return (Array.isArray(ev.skip) ? ev.skip : []).filter(isDate)
    .map(s => allDay ? `EXDATE;VALUE=DATE:${d8(s)}` : `EXDATE;TZID=${TZ}:${d8(s)}T${t6(ev.start)}`);
}
function whoName(ev, users) {
  if (ev.who === 'both') return 'Nous deux';
  return users.find(u => u.id === ev.who)?.name || '';
}

/* ───────── Fichier .ics (abonnement iPhone) ───────── */
function fold(line) { // repli des lignes à 75 octets (norme iCalendar), sans couper un caractère
  if (te.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '', size = 0, limit = 75;
  for (const ch of line) {
    const n = te.encode(ch).length;
    if (size + n > limit) { parts.push(cur); cur = ''; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function buildCalendar(events, users, pour) {
  const pourName = pour ? users.find(u => u.id === pour)?.name : '';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nous deux//Agenda//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${pourName ? `Nous deux · ${escapeText(pourName)}` : 'Nous deux'}`,
    'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M', 'X-PUBLISHED-TTL:PT15M',
    ...VTIMEZONE,
  ];
  for (const ev of events) {
    if (!isDate(ev.date) || !ev.title) continue;
    if (pour && ev.who !== 'both' && ev.who !== pour) continue;
    const who = whoName(ev, users);
    const t = timing(ev);
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@nous-deux`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeText(who ? `${who} – ${ev.title}` : ev.title)}`);
    if (t.allDay) lines.push(`DTSTART;VALUE=DATE:${d8(t.sd)}`, `DTEND;VALUE=DATE:${d8(t.ed)}`);
    else lines.push(`DTSTART;TZID=${TZ}:${d8(t.sd)}T${t6(t.st)}`, `DTEND;TZID=${TZ}:${d8(t.ed)}T${t6(t.et)}`);
    const r = rrule(ev);
    if (r) lines.push(`RRULE:${r}`, ...exdates(ev, t.allDay));
    if (ev.note) lines.push(`DESCRIPTION:${escapeText(ev.note)}`);
    lines.push('TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
