// Nous deux — listes et agenda partagés à deux, notifications et rappels via ntfy.
import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, writeBatch,
  terminate, clearIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { AISLES, guessAisle } from './rayons.js';

const NTFY_SERVER = 'https://ntfy.sh';
const APP_URL = new URL('./', location.href).href;
// ntfy.sh accepte une programmation jusqu'à 3 jours : on garde une marge.
const MAX_AHEAD = 3 * 86400e3 - 15 * 60e3;
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const DEFAULT_LISTS = [
  { id: 'a-faire', name: 'À faire', emoji: '🏠', order: 1, kind: 'todo' },
  { id: 'courses', name: 'Courses', emoji: '🛒', order: 2, kind: 'shop' },
  { id: 'sorties', name: 'Envies & sorties', emoji: '✨', order: 3, kind: 'wish' },
];
const LIST_KINDS = [['todo', 'Liste classique'], ['shop', 'Courses (classées par rayon)'], ['wish', 'Envies (avec tirage au sort)']];
const WISH_CATS = [['resto', '🍽️', 'Resto'], ['film', '🎬', 'Film / série'], ['sortie', '🎟️', 'Sortie'], ['voyage', '✈️', 'Voyage'], ['activite', '🎨', 'Activité'], ['autre', '✨', 'Autre']];
const PALETTE = [
  ['corail', '#D45E3D', 'Corail'], ['sauge', '#4C7A62', 'Sauge'], ['ocean', '#2F6FB0', 'Océan'],
  ['lavande', '#7B5EA7', 'Lavande'], ['framboise', '#C23B6E', 'Framboise'], ['moutarde', '#B7860B', 'Moutarde'],
  ['turquoise', '#1E8C8C', 'Turquoise'], ['ardoise', '#5A6676', 'Ardoise'],
];
const TASK_REPEAT = [['', 'Jamais'], ['daily', 'Chaque jour'], ['weekly', 'Chaque semaine'], ['biweekly', 'Toutes les 2 semaines'], ['monthly', 'Chaque mois']];
const EVENT_REPEAT = [['', 'Jamais'], ['daily', 'Chaque jour'], ['weekdays', 'Du lundi au vendredi'], ['weekly', 'Chaque semaine'], ['biweekly', 'Toutes les 2 semaines'], ['monthly', 'Chaque mois']];
const REMIND_TIMED = [['', 'Aucun'], ['0', 'À l’heure de début'], ['10', '10 min avant'], ['30', '30 min avant'], ['60', '1 h avant'], ['120', '2 h avant'], ['1440', 'La veille, même heure']];
const REMIND_ALLDAY = [['', 'Aucun'], ['d9', 'Le jour même à 9 h'], ['v18', 'La veille à 18 h']];

let app, auth, db;

const S = {
  me: null, users: {}, lists: [], tasks: [], events: [], sched: [], config: {}, gstatus: null, localDirty: {},
  loaded: {},
  view: storageGet('nd:view') === 'agenda' ? 'agenda' : 'lists',
  current: storageGet('nd:list'),
  showDone: false,
  draft: { due: '', time: '', for: 'both', aisle: 'auto', cat: 'autre' },
  cal: { month: '', sel: '', filter: 'all' },
  unsubs: [], seeded: false, onboardingShown: false, linkHandled: false,
};

/* ───────── Utilitaires ───────── */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } }
function genTopic() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return 'nousdeux-' + Array.from(bytes, b => (b % 36).toString(36)).join('');
}
function genToken() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => abc[b % abc.length]).join('');
}
function initial(name) { return (Array.from((name || '?').trim())[0] || '?').toUpperCase(); }
function optionsHTML(opts, value) { return opts.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join(''); }
function labelOf(opts, v) { return (opts.find(o => o[0] === v) || [, ''])[1]; }

/* ───────── Dates (heure locale) ───────── */
const pad = n => String(n).padStart(2, '0');
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function today() { return ymd(new Date()); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function dow(s) { return parseYmd(s).getDay(); }
function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 864e5); }
function at(dateStr, hhmm) { const [y, m, d] = dateStr.split('-').map(Number); const [h, mi] = (hhmm || '09:00').split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); }
function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const base = new Date(y, m - 1 + n, 1, 12);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(d, last));
  return ymd(base);
}

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
function ago(ts) {
  if (!ts) return '';
  const s = (ts - Date.now()) / 1000, a = Math.abs(s);
  if (a < 60) return 'à l’instant';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
function dueLabel(d) {
  if (d === today()) return 'Aujourd’hui';
  if (d === addDays(today(), 1)) return 'Demain';
  if (d === addDays(today(), -1)) return 'Hier';
  return parseYmd(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}
function dueClass(d, done) {
  if (done || !d) return '';
  if (d < today()) return 'pill-late';
  if (d === today()) return 'pill-today';
  return '';
}
function longDay(d) {
  const s = parseYmd(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ───────── Personnes et couleurs ───────── */
function people() {
  return Object.entries(S.users).map(([uid, u]) => ({ uid, ...u })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
function partner() { return people().find(p => p.uid !== S.me?.uid) || null; }
function myName() { return S.users[S.me?.uid]?.name || 'Moi'; }
function nameOf(uid) {
  if (!uid) return '';
  if (uid === 'both') return 'Nous deux';
  if (S.users[uid]?.name) return S.users[uid].name;
  return uid === S.me?.uid ? 'Moi' : '…';
}
function toneOf(uid) { return people().findIndex(p => p.uid === uid) === 1 ? 'b' : 'a'; }
function toneClass(who) { return who === 'both' ? 'p-both' : 'p-' + toneOf(who); }
function recipientsOf(who) { return who === 'both' || !who ? people().map(p => p.uid) : [who].filter(uid => S.users[uid]); }
function hexOf(colorId) { return (PALETTE.find(p => p[0] === colorId) || [])[1]; }
function applyColors() {
  const ps = people();
  const root = document.documentElement.style;
  const a = hexOf(ps[0]?.color) || PALETTE[0][1];
  const b = hexOf(ps[1]?.color) || PALETTE[1][1];
  root.setProperty('--a', a);
  root.setProperty('--b', b);
}
function forOptions() {
  const opts = [['both', 'Nous deux'], [S.me.uid, 'Moi']];
  const p = partner();
  if (p) opts.push([p.uid, p.name || 'L’autre']);
  return opts;
}
function whoOptions() { // agenda : « Moi » d'abord
  const opts = [[S.me.uid, 'Moi']];
  const p = partner();
  if (p) opts.push([p.uid, p.name || 'L’autre']);
  opts.push(['both', 'Nous deux']);
  return opts;
}
function listOf(id) { return S.lists.find(l => l.id === id); }
function listKind(l) { return l?.kind || (l?.id === 'courses' ? 'shop' : l?.id === 'sorties' ? 'wish' : 'todo'); }
function aisleOf(t) { return t.aisle && t.aisle !== 'auto' ? t.aisle : guessAisle(t.text); }
function mondayOf(d) { return addDays(d, -((dow(d) + 6) % 7)); }
function plural(n, one, many) { return `${n} ${n > 1 ? many : one}`; }
function safeUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:\/\//i.test(u)) return ''; // autre protocole : refusé
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
}
function listTitle(l) { return l ? `${l.emoji || ''} ${l.name}`.trim() : 'Nous deux'; }

/* ───────── Événements récurrents ───────── */
function occursOn(ev, d) {
  if (!ev.date || d < ev.date) return false;
  if (ev.until && d > ev.until) return false;
  if (ev.skip?.includes(d)) return false;
  switch (ev.repeat) {
    case 'daily': return true;
    case 'weekdays': { const w = dow(d); return w >= 1 && w <= 5; }
    case 'weekly': return daysBetween(ev.date, d) % 7 === 0;
    case 'biweekly': return daysBetween(ev.date, d) % 14 === 0;
    case 'monthly': return d.slice(8) === ev.date.slice(8);
    default: return d === ev.date;
  }
}
function visibleFor(who) {
  const f = S.cal.filter;
  return f === 'all' || who === 'both' || who === f;
}
function eventsOn(d) {
  return S.events
    .filter(ev => occursOn(ev, d) && visibleFor(ev.who))
    .sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (a.start || '').localeCompare(b.start || ''));
}
function nextDue(due, repeat) {
  const step = d => repeat === 'daily' ? addDays(d, 1) : repeat === 'weekly' ? addDays(d, 7) : repeat === 'biweekly' ? addDays(d, 14) : addMonths(d, 1);
  let n = step(due);
  while (n < today()) n = step(n);
  return n;
}

/* ───────── Notifications (ntfy) — jamais de contenu ───────── */
function ntfyPost(body) {
  return fetch(NTFY_SERVER, { method: 'POST', body: JSON.stringify(body) });
}
function notifyPartner(kind) {
  const msg = {
    task: `${myName()} a ajouté une tâche`,
    event: `${myName()} a ajouté un événement à l’agenda`,
    done: `${myName()} a coché une tâche`,
  }[kind];
  for (const p of people()) {
    if (p.uid === S.me.uid || !p.topic) continue;
    if (kind === 'done' ? !p.notifyDone : p.notifyAdd === false) continue;
    const body = { topic: p.topic, title: 'Nous deux', message: msg };
    if (!p.ios) body.click = APP_URL;
    ntfyPost(body).catch(() => { /* hors ligne : rien de grave */ });
  }
}

/* ───────── Rappels programmés ─────────
   ntfy.sh garde un message programmé jusqu'à 3 jours. L'appli programme donc les rappels
   des 3 prochains jours à chaque ouverture (de l'un ou de l'autre), les remplace s'ils
   changent (même « sequence_id ») et les annule si la tâche ou l'événement disparaît.
   Le suivi est gardé dans la collection « sched » pour que vos deux téléphones s'accordent. */
function dayCounts(uid, d) {
  const mine = who => !who || who === 'both' || who === uid;
  const tasks = S.tasks.filter(t => !t.done && t.due === d && mine(t.for)).length;
  const events = S.events.filter(ev => occursOn(ev, d) && mine(ev.who)).length;
  return { tasks, events };
}
function reminderJobs() {
  const jobs = [];
  for (const t of S.tasks) {
    if (t.done || !t.due || !t.remindTime) continue;
    jobs.push({ seq: `t-${t.id}`, at: at(t.due, t.remindTime), who: t.for, kind: 'task', time: t.remindTime, ref: `t=${t.id}` });
  }
  // Résumé du matin : uniquement des nombres, jamais le contenu.
  for (const p of people()) {
    if (p.digest === false) continue;
    const time = p.digestTime || '08:00';
    for (let i = 0; i <= 3; i++) {
      const d = addDays(today(), i);
      const { tasks, events } = dayCounts(p.uid, d);
      if (!tasks && !events) continue;
      const parts = [];
      if (tasks) parts.push(plural(tasks, 'tâche', 'tâches'));
      if (events) parts.push(plural(events, 'événement', 'événements'));
      jobs.push({ seq: `digest-${d.replaceAll('-', '')}`, at: at(d, time), who: p.uid, kind: 'digest', date: d,
        title: '☀️ Bonjour', msg: `Aujourd’hui : ${parts.join(' et ')}.`, ref: `v=agenda&d=${d}` });
    }
  }
  const start = addDays(today(), -1), end = addDays(today(), 4);
  for (const ev of S.events) {
    if (!ev.remind) continue;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (!occursOn(ev, d)) continue;
      let when = null;
      if (ev.allDay) {
        if (ev.remind === 'd9') when = at(d, '09:00');
        else if (ev.remind === 'v18') when = at(addDays(d, -1), '18:00');
      } else if (!isNaN(Number(ev.remind))) {
        when = at(d, ev.start) - Number(ev.remind) * 60e3;
      }
      if (when) jobs.push({ seq: `e-${ev.id}-${d.replaceAll('-', '')}`, at: when, who: ev.who, kind: 'event', allDay: !!ev.allDay, time: ev.start, date: d, ref: `e=${ev.id}&d=${d}` });
    }
  }
  for (const j of jobs) {
    if (!j.msg) j.msg = reminderMessage(j);
    if (!j.title) j.title = '🔔 Rappel';
  }
  return jobs;
}

function reminderMessage(j) {
  if (j.kind === 'task') return `Une tâche est prévue à ${j.time}. Ouvre Nous deux.`;
  const sameDay = ymd(new Date(j.at)) === j.date;
  if (j.allDay) return sameDay ? 'Un événement est prévu aujourd’hui dans l’agenda.' : 'Un événement est prévu demain dans l’agenda.';
  return `Un événement commence ${sameDay ? '' : 'demain '}à ${j.time}.`;
}

function cancelPush(topic, seq) {
  // Annulation documentée par ntfy : GET /<sujet>/<sequence_id>/delete
  fetch(`${NTFY_SERVER}/${encodeURIComponent(topic)}/${encodeURIComponent(seq)}/delete`, { mode: 'no-cors' }).catch(() => {});
}

function schedulePush(w) {
  const body = {
    topic: w.topic, title: w.title, message: w.msg,
    delay: String(Math.floor(w.at / 1000)), sequence_id: w.seq,
  };
  if (!S.users[w.uid]?.ios) body.click = APP_URL + '#' + w.ref;
  return ntfyPost(body);
}

let reconcileTimer, reconciling = false, reconcileAgain = false;
function queueReconcile() { clearTimeout(reconcileTimer); reconcileTimer = setTimeout(reconcile, 1200); }
function allLoaded() { return ['users', 'lists', 'tasks', 'events', 'sched'].every(k => S.loaded[k]); }

async function reconcile() {
  if (!S.me || !allLoaded() || !navigator.onLine) return;
  if (reconciling) { reconcileAgain = true; return; } // un passage est en cours : on refera un tour après
  reconciling = true;
  reconcileAgain = false;
  try {
    const now = Date.now();
    const want = new Map();
    for (const j of reminderJobs()) {
      if (j.at < now - 86400e3 || j.at > now + MAX_AHEAD) continue;
      for (const uid of recipientsOf(j.who)) {
        const topic = S.users[uid]?.topic;
        if (!topic) continue;
        want.set(`${j.seq}_${uid}`.replace(/[^A-Za-z0-9_-]/g, '_'), { ...j, uid, topic });
      }
    }
    const have = new Map(S.sched.map(s => [s.id, s]));
    for (const [id, s] of have) {
      const w = want.get(id);
      if (w && w.at === s.at && w.topic === s.topic && w.msg === s.msg) continue;
      if (w && w.at > now + 15e3) continue;                 // sera reprogrammé juste après
      if (s.at > now + 5e3) cancelPush(s.topic, s.seq);       // plus voulu : on annule
      deleteDoc(doc(db, 'sched', id)).catch(() => {});
    }
    for (const [id, w] of want) {
      const s = have.get(id);
      if (s && s.at === w.at && s.topic === w.topic && s.msg === w.msg) continue;
      if (w.at <= now + 15e3) continue;
      if (s && s.topic !== w.topic && s.at > now) cancelPush(s.topic, s.seq);
      try {
        const res = await schedulePush(w);
        if (res.ok) await setDoc(doc(db, 'sched', id), { uid: w.uid, topic: w.topic, seq: w.seq, at: w.at, msg: w.msg });
      } catch { /* réessai à la prochaine ouverture */ }
    }
  } finally {
    reconciling = false;
    if (reconcileAgain) queueReconcile();
  }
}

/* ───────── Écrans, toast, feuilles ───────── */
function showScreen(name) {
  for (const s of ['loading', 'setup', 'login', 'denied', 'app']) $('#screen-' + s).hidden = s !== name;
}
let toastTimer;
function toast(msg, action) {
  const el = $('#toast'), btn = $('#toast-action');
  // Une fenêtre ouverte passe au premier plan : le message doit y être placé pour rester visible.
  const host = sheet.open ? sheet : document.body;
  if (el.parentElement !== host) host.appendChild(el);
  $('#toast-msg').textContent = msg;
  btn.hidden = !action;
  btn.onclick = null;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => { el.classList.remove('show'); action.run(); };
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2600);
}
function fail(err) {
  console.error(err);
  const map = { 'permission-denied': 'Accès refusé par les règles Firestore.', 'not-found': 'Cet élément a déjà été supprimé.', 'unavailable': 'Connexion perdue, réessai automatique.' };
  toast(map[err?.code] || 'Une erreur est survenue.');
}
const sheet = $('#sheet');
function openSheet(html, mount, { locked = false } = {}) {
  $('#sheet-body').innerHTML = html;
  sheet.dataset.locked = locked ? '1' : '';
  if (!sheet.open) sheet.showModal();
  mount?.($('#sheet-body'));
}
function closeSheet() { if (sheet.open) sheet.close(); }
sheet.addEventListener('cancel', e => { if (sheet.dataset.locked) e.preventDefault(); });
sheet.addEventListener('click', e => { if (e.target === sheet && !sheet.dataset.locked) closeSheet(); });
function segHTML(value, opts) {
  return opts.map(([v, label]) => `<button type="button" data-for="${esc(v)}" class="${value === v ? 'is-on' : ''}">${esc(label)}</button>`).join('');
}
function bindSeg(el, opts, get, set) {
  el.innerHTML = segHTML(get(), opts);
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-for]'); if (!b) return;
    set(b.dataset.for);
    el.innerHTML = segHTML(get(), opts);
  });
}

/* ───────── Rendu général ───────── */
const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

function renderAll() {
  if (!S.me) return;
  applyColors();
  renderDuo();
  renderViews();
  if (S.view === 'lists') { renderLists(); renderTasks(); renderComposer(); }
  else renderAgenda();
}
function renderDuo() {
  $('#today-line').textContent = `(${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })})`;
  $('#duo').innerHTML = people().map(p => `<span class="av p-${toneOf(p.uid)}" title="${esc(p.name)}">${esc(initial(p.name))}</span>`).join('');
}
function renderViews() {
  for (const b of document.querySelectorAll('#views [data-view]')) {
    const on = b.dataset.view === S.view;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const el of document.querySelectorAll('[data-only]')) el.hidden = el.dataset.only !== S.view;
}
function setView(v) {
  S.view = v;
  storageSet('nd:view', v);
  window.scrollTo(0, 0);
  renderAll();
}

/* ───────── Vue Listes ───────── */
function renderLists() {
  $('#lists').innerHTML = S.lists.map(l => {
    const n = S.tasks.filter(t => t.list === l.id && !t.done).length;
    return `<button class="chip ${l.id === S.current ? 'is-on' : ''}" data-list="${esc(l.id)}"><span>${esc(l.emoji || '•')}</span>${esc(l.name)}${n ? `<span class="chip-count">${n}</span>` : ''}</button>`;
  }).join('') + '<button class="chip chip-add" data-action="add-list" aria-label="Nouvelle liste">+</button>';
}

function taskHTML(t) {
  const kind = listKind(listOf(t.list));
  const meta = [];
  if (t.done) {
    meta.push(`<span>Fait par <span class="who p-${toneOf(t.doneBy)}">${esc(nameOf(t.doneBy))}</span> · ${esc(ago(t.doneTs))}</span>`);
  } else {
    meta.push(`<span><span class="who p-${toneOf(t.by)}">${esc(nameOf(t.by))}</span> · ${esc(ago(t.ts))}</span>`);
    if (t.due) meta.push(`<span class="pill ${dueClass(t.due, t.done)}">${esc(dueLabel(t.due))}</span>`);
    if (t.due && t.remindTime) meta.push(`<span class="pill">🔔 ${esc(t.remindTime)}</span>`);
    if (t.repeat) meta.push(`<span class="pill">🔁 ${esc(labelOf(TASK_REPEAT, t.repeat).toLowerCase())}</span>`);
    if (kind === 'todo' && t.for && t.for !== 'both') meta.push(`<span class="pill pill-for p-${toneOf(t.for)}">Pour ${esc(t.for === S.me.uid ? 'moi' : nameOf(t.for))}</span>`);
  }
  const url = safeUrl(t.url);
  return `<li class="task ${t.done ? 'is-done' : ''}" data-id="${esc(t.id)}">`
    + `<button class="check" data-action="toggle" aria-label="${t.done ? 'Décocher' : 'Cocher'}">${CHECK_SVG}</button>`
    + `<button class="task-body" data-action="edit"><span class="task-text">${esc(t.text)}</span><span class="task-meta">${meta.join('')}</span></button>`
    + (url ? `<a class="task-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir le lien">↗</a>` : '')
    + '</li>';
}

function groupedHTML(items, kind) {
  const groups = kind === 'shop' ? AISLES : WISH_CATS;
  const keyOf = kind === 'shop' ? aisleOf : (t => t.cat || 'autre');
  return groups.map(([k, emoji, label]) => {
    const its = items.filter(t => keyOf(t) === k);
    return its.length ? `<li class="group-head">${emoji} ${esc(label)} <span>${its.length}</span></li>${its.map(taskHTML).join('')}` : '';
  }).join('');
}

function renderTasks() {
  const l = listOf(S.current);
  $('#list-title').textContent = l ? listTitle(l) : '';
  $('#edit-list').hidden = !l;
  const inList = S.tasks.filter(t => t.list === S.current);
  const todo = inList.filter(t => !t.done).sort((a, b) => {
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : (a.remindTime || '99').localeCompare(b.remindTime || '99') || (b.ts || 0) - (a.ts || 0);
    if (a.due) return -1;
    if (b.due) return 1;
    return (b.ts || 0) - (a.ts || 0);
  });
  const done = inList.filter(t => t.done).sort((a, b) => (b.doneTs || 0) - (a.doneTs || 0));
  const kind = listKind(l);
  $('#todo').innerHTML = kind === 'todo' ? todo.map(taskHTML).join('') : groupedHTML(todo, kind);
  $('#draw').hidden = kind !== 'wish' || todo.length < 2;
  $('#empty').hidden = todo.length > 0 || !l;
  $('#done-section').hidden = done.length === 0;
  $('#done-count').textContent = `Fait · ${done.length}`;
  $('#done-toggle').setAttribute('aria-expanded', String(S.showDone));
  $('#done-list').hidden = !S.showDone;
  $('#clear-done').hidden = !S.showDone;
  $('#done-list').innerHTML = S.showDone ? done.map(taskHTML).join('') : '';
}

function renderComposer() {
  const l = listOf(S.current);
  const kind = listKind(l);
  $('#new-task').placeholder = l ? (kind === 'shop' ? 'Ajouter un article…' : kind === 'wish' ? 'Ajouter une envie…' : `Ajouter à ${l.name}…`) : 'Ajouter…';
  $('#opts-todo').hidden = kind !== 'todo';
  $('#opts-shop').hidden = kind !== 'shop';
  $('#opts-wish').hidden = kind !== 'wish';
  if (kind === 'shop') {
    const typed = $('#new-task').value.trim();
    const guess = typed ? AISLES.find(a => a[0] === guessAisle(typed)) : null;
    $('#aisle-input').innerHTML = `<option value="auto">Auto${guess ? ` (${guess[1]} ${esc(guess[2])})` : ''}</option>` + AISLES.map(([k, e, lab]) => `<option value="${k}" ${S.draft.aisle === k ? 'selected' : ''}>${e} ${esc(lab)}</option>`).join('');
    if (S.draft.aisle === 'auto') $('#aisle-input').value = 'auto';
  }
  if (kind === 'wish') $('#cat-seg').innerHTML = segHTML(S.draft.cat, [WISH_CATS[WISH_CATS.length - 1], ...WISH_CATS.slice(0, -1)].map(([k, e, lab]) => [k, `${e} ${lab}`]));
  const { due, time } = S.draft;
  $('#due-label').textContent = due ? dueLabel(due) : 'Date';
  $('#due-input').value = due;
  $('#due-clear').hidden = !due;
  $('#opt-date').classList.toggle('is-on', !!due);
  $('#opt-time').hidden = !due;
  $('#time-label').textContent = time ? `Rappel ${time}` : 'Rappel';
  $('#time-input').value = time;
  $('#time-clear').hidden = !(due && time);
  $('#opt-time').classList.toggle('is-on', !!time);
  if (!forOptions().some(([v]) => v === S.draft.for)) S.draft.for = 'both';
  $('#for-seg').innerHTML = segHTML(S.draft.for, forOptions());
}

function setCurrent(id) {
  S.current = id;
  storageSet('nd:list', id);
  S.showDone = false;
  renderAll();
  $(`#lists [data-list="${CSS.escape(id)}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

/* ───────── Actions sur les tâches ───────── */
function addTask(text) {
  const kind = listKind(listOf(S.current));
  const t = {
    text, list: S.current, done: false, by: S.me.uid, ts: Date.now(),
    due: '', remindTime: '', repeat: '', for: 'both', doneBy: null, doneTs: null,
  };
  if (kind === 'todo') {
    t.due = S.draft.due || '';
    t.remindTime = S.draft.due ? (S.draft.time || '') : '';
    t.for = S.draft.for || 'both';
  } else if (kind === 'shop') {
    t.aisle = S.draft.aisle !== 'auto' ? S.draft.aisle : guessAisle(text);
  } else {
    t.cat = S.draft.cat || 'autre';
    t.url = '';
  }
  addDoc(collection(db, 'tasks'), t).catch(fail);
  notifyPartner('task');
}

function toggleTask(t) {
  const done = !t.done;
  if (done && t.repeat && t.due) {
    // Tâche récurrente : elle revient à la prochaine date au lieu d'être rangée.
    const next = nextDue(t.due, t.repeat);
    updateDoc(doc(db, 'tasks', t.id), { due: next }).catch(fail);
    toast(`Fait ! Prochaine fois : ${dueLabel(next).toLowerCase()}`);
  } else if (done) {
    updateDoc(doc(db, 'tasks', t.id), { done: true, doneBy: S.me.uid, doneTs: Date.now() }).catch(fail);
  } else {
    updateDoc(doc(db, 'tasks', t.id), { done: false, doneBy: null, doneTs: null }).catch(fail);
  }
  if (done) notifyPartner('done');
}

function deleteTask(t) {
  const { id, ...data } = t;
  deleteDoc(doc(db, 'tasks', id)).catch(fail);
  toast('Tâche supprimée', { label: 'Annuler', run: () => setDoc(doc(db, 'tasks', id), data).catch(fail) });
}

function clearDone() {
  const done = S.tasks.filter(t => t.list === S.current && t.done);
  if (!done.length || !confirm(`Effacer définitivement ${done.length} tâche${done.length > 1 ? 's' : ''} faite${done.length > 1 ? 's' : ''} ?`)) return;
  const batch = writeBatch(db);
  done.forEach(t => batch.delete(doc(db, 'tasks', t.id)));
  batch.commit().catch(fail);
}

function openEditTask(t) {
  const kind = listKind(listOf(t.list));
  const listOpts = S.lists.map(l => `<option value="${esc(l.id)}" ${l.id === t.list ? 'selected' : ''}>${esc(listTitle(l))}</option>`).join('');
  let forValue = t.for || 'both';
  const fields = {
    todo: `
      <div class="row-2">
        <label class="field grow"><span>Date</span><input type="date" id="e-due" value="${esc(t.due || '')}"></label>
        <label class="field grow"><span>Rappel à</span><input type="time" id="e-time" value="${esc(t.remindTime || '')}"></label>
      </div>
      <label class="field"><span>Répéter</span><select id="e-repeat">${optionsHTML(TASK_REPEAT, t.repeat || '')}</select></label>
      <div class="field seg-field"><span>Pour</span><div class="seg" id="e-for"></div></div>`,
    shop: `<label class="field"><span>Rayon</span><select id="e-aisle">${AISLES.map(([k, e, lab]) => `<option value="${k}" ${aisleOf(t) === k ? 'selected' : ''}>${e} ${esc(lab)}</option>`).join('')}</select></label>`,
    wish: `
      <label class="field"><span>Catégorie</span><select id="e-cat">${WISH_CATS.map(([k, e, lab]) => `<option value="${k}" ${(t.cat || 'autre') === k ? 'selected' : ''}>${e} ${esc(lab)}</option>`).join('')}</select></label>
      <label class="field"><span>Lien (facultatif)</span><input id="e-url" inputmode="url" maxlength="300" value="${esc(t.url || '')}" placeholder="Site du resto, bande-annonce…"></label>`,
  }[kind];
  openSheet(`
    <h2 tabindex="-1" autofocus>Modifier</h2>
    <label class="field"><span>${kind === 'shop' ? 'Article' : kind === 'wish' ? 'Envie' : 'Tâche'}</span><input id="e-text" maxlength="200" value="${esc(t.text)}"></label>
    <label class="field"><span>Liste</span><select id="e-list">${listOpts}</select></label>
    ${fields}
    <p class="muted small">Ajouté par ${esc(nameOf(t.by))} · ${esc(ago(t.ts))}</p>
    <div class="sheet-actions">
      <button class="btn danger" data-act="delete">Supprimer</button>
      <button class="btn primary" data-act="save">Enregistrer</button>
    </div>`, body => {
    if (kind === 'todo') bindSeg($('#e-for', body), forOptions(), () => forValue, v => { forValue = v; });
    $('[data-act="delete"]', body).onclick = () => { closeSheet(); deleteTask(t); };
    $('[data-act="save"]', body).onclick = () => {
      const text = $('#e-text', body).value.trim();
      if (!text) { $('#e-text', body).focus(); return; }
      const list = $('#e-list', body).value;
      const data = { text, list };
      if (kind === 'todo') {
        let due = $('#e-due', body).value || '';
        const remindTime = $('#e-time', body).value || '';
        const repeat = $('#e-repeat', body).value;
        if ((remindTime || repeat) && !due) due = today(); // un rappel ou une répétition a besoin d'une date
        Object.assign(data, { due, remindTime, repeat, for: forValue });
      } else if (kind === 'shop') {
        data.aisle = $('#e-aisle', body).value;
      } else {
        const raw = $('#e-url', body).value.trim();
        const url = safeUrl(raw);
        if (raw && !url) { toast('Ce lien n’est pas valide.'); return; }
        Object.assign(data, { cat: $('#e-cat', body).value, url });
      }
      // Déplacement vers une liste de courses : on devine le rayon.
      if (list !== t.list && listKind(listOf(list)) === 'shop' && !data.aisle) data.aisle = guessAisle(text);
      updateDoc(doc(db, 'tasks', t.id), data).catch(fail);
      closeSheet();
    };
  });
}

/* ───────── Listes ───────── */
function seedLists() {
  const batch = writeBatch(db);
  DEFAULT_LISTS.forEach(({ id, ...data }) => batch.set(doc(db, 'lists', id), data, { merge: true }));
  batch.commit().catch(fail);
}

function openListSheet(list) {
  const isNew = !list;
  openSheet(`
    <h2 tabindex="-1" autofocus>${isNew ? 'Nouvelle liste' : 'Modifier la liste'}</h2>
    <div class="row-2">
      <label class="field emoji-field"><span>Emoji</span><input id="l-emoji" maxlength="8" value="${esc(list?.emoji || '📝')}"></label>
      <label class="field grow"><span>Nom</span><input id="l-name" maxlength="40" value="${esc(list?.name || '')}" placeholder="Ex. Travaux, Vacances…"></label>
    </div>
    <label class="field"><span>Type</span><select id="l-kind">${optionsHTML(LIST_KINDS, listKind(list))}</select></label>
    <div class="sheet-actions">
      ${isNew ? '<button class="btn" data-act="cancel">Annuler</button>' : '<button class="btn danger" data-act="delete">Supprimer</button>'}
      <button class="btn primary" data-act="save">${isNew ? 'Créer' : 'Enregistrer'}</button>
    </div>`, body => {
    $('[data-act="cancel"]', body)?.addEventListener('click', closeSheet);
    $('[data-act="delete"]', body)?.addEventListener('click', () => {
      if (S.lists.length <= 1) { toast('Il faut garder au moins une liste.'); return; }
      const tasks = S.tasks.filter(t => t.list === list.id);
      const extra = tasks.length ? ` et ses ${tasks.length} tâche${tasks.length > 1 ? 's' : ''}` : '';
      if (!confirm(`Supprimer « ${list.name} »${extra} ?`)) return;
      const batch = writeBatch(db);
      tasks.forEach(t => batch.delete(doc(db, 'tasks', t.id)));
      batch.delete(doc(db, 'lists', list.id));
      batch.commit().catch(fail);
      closeSheet();
      setCurrent(S.lists.find(l => l.id !== list.id).id);
    });
    $('[data-act="save"]', body).addEventListener('click', () => {
      const name = $('#l-name', body).value.trim();
      const emoji = $('#l-emoji', body).value.trim() || '📝';
      if (!name) { $('#l-name', body).focus(); return; }
      if (isNew) {
        const ref = doc(collection(db, 'lists'));
        const order = Math.max(0, ...S.lists.map(l => l.order || 0)) + 1;
        setDoc(ref, { name, emoji, order, kind: $('#l-kind', body).value }).catch(fail);
        closeSheet();
        setCurrent(ref.id);
      } else {
        updateDoc(doc(db, 'lists', list.id), { name, emoji, kind: $('#l-kind', body).value }).catch(fail);
        closeSheet();
      }
    });
  });
}

/* ───────── Tirage au sort (listes d'envies) ───────── */
function openDraw(list) {
  let cat = 'all', last = null, pick = null;
  const pool = () => S.tasks.filter(t => t.list === list.id && !t.done && (cat === 'all' || (t.cat || 'autre') === cat));
  const cats = [['all', 'Tout'], ...WISH_CATS.filter(([k]) => S.tasks.some(t => t.list === list.id && !t.done && (t.cat || 'autre') === k)).map(([k, e, lab]) => [k, `${e} ${lab}`])];
  const draw = () => {
    const p = pool();
    if (!p.length) { pick = null; return; }
    const choices = p.length > 1 ? p.filter(t => t.id !== last) : p;
    pick = choices[Math.floor(Math.random() * choices.length)];
    last = pick.id;
  };
  draw();
  openSheet(`
    <h2 tabindex="-1" autofocus>🎲 Tirage au sort</h2>
    <div class="seg seg-wrap" id="d-cat">${segHTML(cat, cats)}</div>
    <div class="draw-card" id="d-card"></div>
    <div class="sheet-actions">
      <button class="btn" data-act="again">Relancer</button>
      <button class="btn primary" data-act="go">On fait ça !</button>
    </div>`, body => {
    const show = () => {
      const card = $('#d-card', body);
      card.classList.remove('spin'); void card.offsetWidth; card.classList.add('spin');
      if (!pick) { card.innerHTML = '<p class="muted">Rien dans cette catégorie.</p>'; return; }
      const c = WISH_CATS.find(x => x[0] === (pick.cat || 'autre'));
      const url = safeUrl(pick.url);
      card.innerHTML = `<span class="draw-emoji">${c[1]}</span><span class="draw-text">${esc(pick.text)}</span><span class="muted small">${esc(c[2])} · proposé par ${esc(nameOf(pick.by))}</span>${url ? `<a class="btn small" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Voir le lien ↗</a>` : ''}`;
    };
    show();
    $('#d-cat', body).addEventListener('click', e => {
      const b = e.target.closest('[data-for]'); if (!b) return;
      cat = b.dataset.for; $('#d-cat', body).innerHTML = segHTML(cat, cats); draw(); show();
    });
    $('[data-act="again"]', body).onclick = () => { draw(); show(); };
    $('[data-act="go"]', body).onclick = () => { if (pick) { toggleTask(pick); toast('Bonne sortie ! 🎉'); } closeSheet(); };
  });
}

/* ───────── Effacement de l'ancien historique (fonction « Bilan » retirée) ───────── */
function purgeOldLog() {
  let unsub = () => {}, done = false;
  unsub = onSnapshot(collection(db, 'log'), snap => {
    if (snap.metadata.fromCache || done) return;
    done = true;
    setTimeout(() => unsub(), 0);
    const ids = snap.docs.map(d => d.id);
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      ids.slice(i, i + 400).forEach(id => batch.delete(doc(db, 'log', id)));
      batch.commit().catch(() => {});
    }
  }, () => { /* rien à effacer ou accès refusé */ });
}

/* ───────── Vue Agenda ───────── */
function renderAgenda() {
  if (!S.cal.sel) S.cal.sel = today();
  if (!S.cal.month) S.cal.month = S.cal.sel.slice(0, 7);
  const [y, m] = S.cal.month.split('-').map(Number);
  const monthLabel = new Date(y, m - 1, 1, 12).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  $('#cal-month').textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  // Filtre : tous / moi / l'autre
  const p = partner();
  const filters = [['all', 'Tous'], [S.me.uid, 'Moi']];
  if (p) filters.push([p.uid, p.name || 'L’autre']);
  if (!filters.some(f => f[0] === S.cal.filter)) S.cal.filter = 'all';
  $('#cal-filter').innerHTML = segHTML(S.cal.filter, filters);

  // Grille du mois, semaine commençant le lundi
  const first = `${S.cal.month}-01`;
  const offset = (dow(first) + 6) % 7;
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = Math.ceil((offset + daysInMonth) / 7) * 7;
  let d = addDays(first, -offset);
  let html = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(x => `<div class="cal-wd">${x}</div>`).join('');
  const t0 = today();
  for (let i = 0; i < cells; i++) {
    const evs = eventsOn(d);
    const hasTask = S.tasks.some(t => !t.done && t.due === d && visibleFor(t.for));
    const dots = evs.slice(0, 3).map(e => `<i class="dot ${toneClass(e.who)}"></i>`).join('') + (hasTask && evs.length < 3 ? '<i class="dot dot-task"></i>' : '');
    const cls = ['cal-day', d.slice(0, 7) !== S.cal.month ? 'is-out' : '', d === t0 ? 'is-today' : '', d === S.cal.sel ? 'is-sel' : ''].join(' ');
    html += `<button class="${cls}" data-day="${d}" aria-label="${esc(longDay(d))}"><span class="num">${Number(d.slice(8))}</span><span class="dots">${dots}</span></button>`;
    d = addDays(d, 1);
  }
  $('#cal-grid').innerHTML = html;

  // Détail du jour choisi
  const sel = S.cal.sel;
  $('#day-title').textContent = longDay(sel) + (sel === t0 ? ' · aujourd’hui' : '');
  const evs = eventsOn(sel);
  $('#day-events').innerHTML = evs.map(ev => eventHTML(ev, sel)).join('');
  const tasks = S.tasks.filter(t => !t.done && t.due === sel && visibleFor(t.for))
    .sort((a, b) => (a.remindTime || '99').localeCompare(b.remindTime || '99'));
  $('#day-empty').hidden = evs.length > 0 || tasks.length > 0;
  $('#day-tasks').innerHTML = tasks.length ? `<h4 class="sub-title">Tâches du jour</h4><ul class="tasks">${tasks.map(t => {
    const l = listOf(t.list);
    return `<li class="task" data-id="${esc(t.id)}"><button class="check" data-action="toggle" aria-label="Cocher">${CHECK_SVG}</button><button class="task-body" data-action="edit"><span class="task-text">${esc(t.text)}</span><span class="task-meta"><span>${esc(listTitle(l))}</span>${t.remindTime ? `<span class="pill">🔔 ${esc(t.remindTime)}</span>` : ''}${t.for && t.for !== 'both' ? `<span class="pill pill-for p-${toneOf(t.for)}">Pour ${esc(t.for === S.me.uid ? 'moi' : nameOf(t.for))}</span>` : ''}</span></button></li>`;
  }).join('')}</ul>` : '';
}

function eventHTML(ev, day) {
  let time;
  if (ev.allDay) time = '<span class="ev-start">Journée</span>';
  else time = `<span class="ev-start">${esc(ev.start)}</span>${ev.end ? `<span class="ev-end">${esc(ev.end)}${ev.end <= ev.start ? ' +1' : ''}</span>` : ''}`;
  const meta = [`<span class="who ${toneClass(ev.who)}">${esc(nameOf(ev.who))}</span>`];
  if (ev.repeat) meta.push(`🔁 ${esc(labelOf(EVENT_REPEAT, ev.repeat).toLowerCase())}`);
  if (ev.remind) meta.push('🔔');
  return `<li><button class="event ${toneClass(ev.who)}" data-event="${esc(ev.id)}" data-day="${day}">`
    + '<span class="ev-bar"></span>'
    + `<span class="ev-time">${time}</span>`
    + `<span class="ev-body"><span class="ev-title">${esc(ev.title)}</span><span class="ev-meta">${meta.join(' · ')}</span>${ev.note ? `<span class="ev-note">${esc(ev.note)}</span>` : ''}</span>`
    + '</button></li>';
}

function openEventSheet(ev, day) {
  const isNew = !ev;
  const e = ev || { title: '', date: day || S.cal.sel || today(), allDay: false, start: '09:00', end: '10:00', who: S.me.uid, repeat: '', until: '', remind: '', note: '' };
  let who = e.who || S.me.uid;
  let allDay = !!e.allDay;
  openSheet(`
    <h2 tabindex="-1" autofocus>${isNew ? 'Nouvel événement' : 'Événement'}</h2>
    <label class="field"><span>Titre</span><input id="v-title" maxlength="80" value="${esc(e.title)}" placeholder="Ex. Travail, Dîner chez Paul…"></label>
    <div class="field seg-field"><span>Pour</span><div class="seg" id="v-who"></div></div>
    <label class="field"><span>Date</span><input type="date" id="v-date" value="${esc(e.date)}"></label>
    <label class="switch-row"><span>Toute la journée</span><input type="checkbox" class="switch" id="v-allday" ${allDay ? 'checked' : ''}></label>
    <div class="row-2" id="v-times">
      <label class="field grow"><span>Début</span><input type="time" id="v-start" value="${esc(e.start || '09:00')}"></label>
      <label class="field grow"><span>Fin</span><input type="time" id="v-end" value="${esc(e.end || '')}"></label>
    </div>
    <label class="field"><span>Rappel</span><select id="v-remind"></select></label>
    <div class="row-2">
      <label class="field grow"><span>Répéter</span><select id="v-repeat">${optionsHTML(EVENT_REPEAT, e.repeat || '')}</select></label>
      <label class="field grow" id="v-until-wrap"><span>Jusqu’au</span><input type="date" id="v-until" value="${esc(e.until || '')}"></label>
    </div>
    <label class="field"><span>Note</span><input id="v-note" maxlength="200" value="${esc(e.note || '')}" placeholder="Facultatif"></label>
    ${!isNew && e.repeat ? '<p class="muted small">Les modifications s’appliquent à toute la série.</p>' : ''}
    ${!isNew ? `<p class="muted small">Ajouté par ${esc(nameOf(e.by))} · ${esc(ago(e.ts))}</p>` : ''}
    <div class="sheet-actions" id="v-actions">
      ${isNew ? '<button class="btn" data-act="cancel">Annuler</button>' : '<button class="btn danger" data-act="delete">Supprimer</button>'}
      <button class="btn primary" data-act="save">${isNew ? 'Ajouter' : 'Enregistrer'}</button>
    </div>`, body => {
    bindSeg($('#v-who', body), whoOptions(), () => who, v => { who = v; });
    const remindSel = $('#v-remind', body);
    const syncAllDay = keep => {
      $('#v-times', body).hidden = allDay;
      const opts = allDay ? REMIND_ALLDAY : REMIND_TIMED;
      const cur = keep ? (e.remind || '') : remindSel.value;
      remindSel.innerHTML = optionsHTML(opts, opts.some(o => o[0] === cur) ? cur : '');
    };
    const syncRepeat = () => { $('#v-until-wrap', body).hidden = !$('#v-repeat', body).value; };
    syncAllDay(true); syncRepeat();
    $('#v-allday', body).addEventListener('change', ev2 => { allDay = ev2.target.checked; syncAllDay(false); });
    $('#v-repeat', body).addEventListener('change', syncRepeat);
    $('[data-act="cancel"]', body)?.addEventListener('click', closeSheet);

    $('[data-act="save"]', body).addEventListener('click', () => {
      const title = $('#v-title', body).value.trim();
      if (!title) { $('#v-title', body).focus(); return; }
      const date = $('#v-date', body).value || today();
      const repeat = $('#v-repeat', body).value;
      let until = repeat ? ($('#v-until', body).value || '') : '';
      if (until && until < date) until = '';
      const data = {
        title, date, allDay, who, repeat, until,
        start: allDay ? '' : ($('#v-start', body).value || '09:00'),
        end: allDay ? '' : ($('#v-end', body).value || ''),
        remind: remindSel.value, note: $('#v-note', body).value.trim(),
      };
      if (isNew) {
        addDoc(collection(db, 'events'), { ...data, skip: [], by: S.me.uid, ts: Date.now() }).catch(fail);
        notifyPartner('event');
        S.cal.sel = date; S.cal.month = date.slice(0, 7);
      } else {
        updateDoc(doc(db, 'events', ev.id), data).catch(fail);
      }
      closeSheet();
      renderAll();
    });

    $('[data-act="delete"]', body)?.addEventListener('click', () => {
      if (!e.repeat) { closeSheet(); deleteEvent(ev); return; }
      $('#v-actions', body).innerHTML = `
        <button class="btn" data-act="one">Ce jour seulement</button>
        <button class="btn danger" data-act="all">Toute la série</button>`;
      $('[data-act="one"]', body).onclick = () => {
        updateDoc(doc(db, 'events', ev.id), { skip: [...(ev.skip || []), day] }).catch(fail);
        closeSheet();
        toast('Supprimé pour ce jour-là', { label: 'Annuler', run: () => updateDoc(doc(db, 'events', ev.id), { skip: ev.skip || [] }).catch(fail) });
      };
      $('[data-act="all"]', body).onclick = () => { closeSheet(); deleteEvent(ev); };
    });
  });
}

function deleteEvent(ev) {
  const { id, ...data } = ev;
  deleteDoc(doc(db, 'events', id)).catch(fail);
  toast('Événement supprimé', { label: 'Annuler', run: () => setDoc(doc(db, 'events', id), data).catch(fail) });
}

/* ───────── Profil, réglages ───────── */
function openOnboarding() {
  openSheet(`
    <h2>Bienvenue 👋</h2>
    <p class="muted">Comment tu t’appelles ? Ton prénom apparaîtra sur tes tâches, dans l’agenda et dans les notifications de l’autre.</p>
    <label class="field"><span>Ton prénom</span><input id="o-name" maxlength="30" autocomplete="given-name"></label>
    <button class="btn primary block" data-act="go">C’est parti</button>`, body => {
    const go = () => {
      const name = $('#o-name', body).value.trim();
      if (!name) { $('#o-name', body).focus(); return; }
      const used = people().map(p => p.color);
      const color = (PALETTE.find(c => !used.includes(c[0])) || PALETTE[0])[0];
      setDoc(doc(db, 'users', S.me.uid), {
        name, topic: genTopic(), color, ios: IS_IOS,
        notifyAdd: true, notifyDone: false, digest: true, digestTime: '08:00', createdAt: Date.now(),
      }).catch(fail);
      closeSheet();
      setTimeout(openSettings, 250); // enchaîne sur la configuration des notifications
    };
    $('[data-act="go"]', body).onclick = go;
    $('#o-name', body).addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }, { locked: true });
}

function feedHTML() {
  const f = S.config.feed || {};
  if (!f.base || !f.token) {
    return `<section class="box" id="s-feed">
      <h3>Calendrier du téléphone</h3>
      <p class="muted small">Facultatif : affiche l’agenda de l’appli dans le Calendrier de vos téléphones (lecture seule). Il faut d’abord installer le petit service Cloudflare décrit dans le guide.</p>
      <label class="field"><span>Adresse du service</span><input id="s-feed-base" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(f.base || '')}" placeholder="nous-deux.votre-pseudo.workers.dev"></label>
      <p class="form-error" id="s-feed-err" hidden></p>
      <button class="btn block" data-act="feed-save">Créer les liens d’abonnement</button>
    </section>`;
  }
  const all = `${f.base}/${f.token}.ics`;
  const mine = `${all}?pour=${encodeURIComponent(S.me.uid)}`;
  const webcal = u => u.replace(/^https?:/, 'webcal:');
  const device = IS_IOS
    ? `<a class="btn block" href="${esc(webcal(all))}">S’abonner : tout l’agenda</a>
       <a class="btn block" href="${esc(webcal(mine))}">S’abonner : moi + nous deux</a>
       <p class="muted small">L’iPhone propose d’ajouter le calendrier : touchez « S’abonner ». Choisissez un seul des deux liens.</p>`
    : `<p class="muted small">Sur Android : utilisez plutôt <b>Connecter Google Agenda</b> ci-dessous (mise à jour en quelques minutes). Ces liens servent surtout pour l’iPhone.</p>`;
  return `<section class="box" id="s-feed">
    <h3>Calendrier du téléphone</h3>
    <div class="feed-row"><span>Tout l’agenda</span><button class="btn small" data-copy="${esc(all)}">Copier le lien</button></div>
    <div class="feed-row"><span>Moi + nous deux</span><button class="btn small" data-copy="${esc(mine)}">Copier le lien</button></div>
    ${device}
    <p class="muted small">Ces liens sont secrets : toute personne qui les connaît peut lire votre agenda. En cas de doute, changez-les.</p>
    <div class="feed-actions"><button class="link" data-act="feed-edit">Modifier l’adresse du service</button><button class="link danger-link" data-act="feed-new">Changer les liens</button></div>
  </section>`;
}

function googleHTML() {
  const f = S.config.feed || {};
  if (!f.base || !f.token) return '';
  const g = S.gstatus || {};
  const pourOpts = [['all', 'Tout l’agenda'], ...people().map(p => [p.uid, `${p.name || '…'} + nous deux`])];
  const select = `<label class="field"><span>Événements envoyés</span><select id="s-gpour">${optionsHTML(pourOpts, f.gpour || 'all')}</select></label>`;
  const err = g.error ? `<p class="form-error">${esc(g.error)}</p>` : '';
  if (g.connected) {
    const info = g.lastSync ? `Synchronisé ${ago(g.lastSync)} · ${plural(g.count || 0, 'événement', 'événements')}` : 'Connecté · premiers envois en cours…';
    return `<section class="box" id="s-google">
      <h3>Google Agenda</h3>
      <p class="g-ok">✅ ${esc(info)}</p>
      ${g.pending ? `<p class="muted small">Encore ${g.pending} à envoyer : ils partent au prochain passage.</p>` : ''}
      ${g.failed ? `<p class="muted small">${plural(g.failed, 'événement refusé', 'événements refusés')} par Google.</p>` : ''}
      ${err}
      ${select}
      <p class="muted small">Les événements arrivent dans l’agenda « Nous deux » du compte Google connecté, quelques instants après chaque modification. On modifie toujours dans l’appli.</p>
      <div class="feed-actions"><button class="link" data-act="g-sync">Synchroniser maintenant</button><button class="link danger-link" data-act="g-disconnect">Déconnecter</button></div>
    </section>`;
  }
  return `<section class="box" id="s-google">
    <h3>Google Agenda</h3>
    <p class="muted small">Ajoute l’agenda de l’appli directement dans Google Agenda, mis à jour en quelques minutes. À faire une seule fois, depuis n’importe quel appareil, avec le compte Google qui doit recevoir l’agenda.</p>
    ${err}
    ${select}
    <button class="btn primary block" data-act="g-connect">Connecter Google Agenda</button>
    <p class="muted small">Google peut afficher « Google n’a pas validé cette application » : c’est normal pour une appli personnelle. Touchez « Paramètres avancés », puis « Accéder à Nous deux ».</p>
  </section>`;
}

function refreshGoogleBlock() {
  const el = document.getElementById('s-google');
  if (el) el.outerHTML = googleHTML();
}

let gTimer;
function triggerGoogleSync() {
  const f = S.config.feed;
  if (!f?.base || !f?.token) return Promise.resolve(false);
  return fetch(`${f.base}/google/sync?k=${encodeURIComponent(f.token)}`, { method: 'POST' }).then(r => r.ok).catch(() => false);
}
function pushGoogleSoon(delay = 2500) {
  if (!S.gstatus?.connected) return;
  clearTimeout(gTimer);
  gTimer = setTimeout(triggerGoogleSync, delay);
}
// Synchro immédiate après une modification faite sur CE téléphone, une fois enregistrée.
function watchLocal(name, snap) {
  if (snap.metadata.hasPendingWrites) S.localDirty[name] = true;
  else if (S.localDirty[name]) { S.localDirty[name] = false; pushGoogleSoon(); }
}

function saveFeed(data) {
  S.config.feed = { ...(S.config.feed || {}), ...data };
  setDoc(doc(db, 'config', 'feed'), S.config.feed, { merge: true }).catch(fail);
}

function swatchesHTML(current) {
  const taken = partner()?.color;
  return PALETTE.map(([id, , label]) => {
    const isTaken = id === taken;
    return `<button type="button" class="swatch sw-${id} ${id === current ? 'is-on' : ''}" data-color="${id}" ${isTaken ? 'disabled' : ''} aria-label="${esc(label)}${isTaken ? ' (prise par l’autre)' : ''}" title="${esc(label)}${isTaken ? ' — déjà prise' : ''}"></button>`;
  }).join('');
}

function openSettings() {
  const me = S.users[S.me.uid] || {};
  const p = partner();
  const partnerLine = p
    ? `${esc(p.name)} a rejoint l’appli : vous recevrez les notifications de l’un et de l’autre.`
    : 'En attente de la première connexion de l’autre compte.';
  openSheet(`
    <h2 tabindex="-1" autofocus>Réglages</h2>
    <label class="field"><span>Ton prénom</span><input id="s-name" maxlength="30" value="${esc(me.name || '')}"></label>
    <div class="field"><span>Ta couleur</span><div class="swatches" id="s-colors">${swatchesHTML(me.color)}</div></div>
    <section class="box">
      <h3>Notifications sur ce téléphone</h3>
      <ol class="steps">
        <li>Installe l’appli gratuite <b>ntfy</b> (App Store ou Play Store).</li>
        <li>Appuie sur <b>+</b>, garde le serveur <b>ntfy.sh</b> et abonne-toi à ce sujet :</li>
      </ol>
      <div class="code-row"><code class="code" id="s-topic">${esc(me.topic || '…')}</code><button class="btn small" data-act="copy">Copier</button></div>
      <button class="btn block" data-act="test">Envoyer une notification de test</button>
      <p class="muted small">Les notifications ne contiennent jamais le contenu de vos tâches ni de vos événements, seulement qui a ajouté quelque chose.</p>
    </section>
    <div id="s-feed-wrap">${feedHTML()}${googleHTML()}</div>
    <label class="switch-row"><span>Me prévenir quand l’autre ajoute quelque chose</span><input type="checkbox" class="switch" id="s-add" ${me.notifyAdd !== false ? 'checked' : ''}></label>
    <label class="switch-row"><span>Me prévenir aussi quand l’autre coche une tâche</span><input type="checkbox" class="switch" id="s-done" ${me.notifyDone ? 'checked' : ''}></label>
    <label class="switch-row"><span>Résumé du matin<br><span class="muted small">Le nombre de tâches et d’événements du jour</span></span><input type="checkbox" class="switch" id="s-digest" ${me.digest !== false ? 'checked' : ''}></label>
    <label class="field" id="s-digest-time-wrap" ${me.digest === false ? 'hidden' : ''}><span>Heure du résumé</span><input type="time" id="s-digest-time" value="${esc(me.digestTime || '08:00')}"></label>
    <p class="muted small">${partnerLine}</p>
    <div class="sheet-actions">
      <button class="btn" data-act="logout">Se déconnecter</button>
      <button class="btn primary" data-act="close">Fermer</button>
    </div>`, body => {
    const ref = doc(db, 'users', S.me.uid);
    $('#s-name', body).addEventListener('change', e => { const name = e.target.value.trim(); if (name) updateDoc(ref, { name }).catch(fail); });
    $('#s-colors', body).addEventListener('click', e => {
      const b = e.target.closest('[data-color]'); if (!b || b.disabled) return;
      updateDoc(ref, { color: b.dataset.color }).catch(fail);
      $('#s-colors', body).innerHTML = swatchesHTML(b.dataset.color);
    });
    $('#s-add', body).addEventListener('change', e => updateDoc(ref, { notifyAdd: e.target.checked }).catch(fail));
    $('#s-done', body).addEventListener('change', e => updateDoc(ref, { notifyDone: e.target.checked }).catch(fail));
    $('#s-digest', body).addEventListener('change', e => {
      updateDoc(ref, { digest: e.target.checked }).catch(fail);
      $('#s-digest-time-wrap', body).hidden = !e.target.checked;
    });
    $('#s-digest-time', body).addEventListener('change', e => { if (e.target.value) updateDoc(ref, { digestTime: e.target.value }).catch(fail); });
    $('[data-act="copy"]', body).onclick = async () => {
      try { await navigator.clipboard.writeText(me.topic || ''); toast('Sujet copié'); }
      catch { toast('Copie impossible : sélectionne le texte à la main.'); }
    };
    $('[data-act="test"]', body).onclick = async () => {
      if (!me.topic) return;
      try {
        const res = await ntfyPost({ topic: me.topic, title: 'Nous deux', message: 'Les notifications fonctionnent 🎉' });
        toast(res.ok ? 'Envoyée : regarde ton téléphone.' : `Le serveur ntfy a répondu ${res.status}.`);
      } catch { toast('Envoi impossible à confirmer : regarde ton téléphone.'); }
    };
    $('[data-act="logout"]', body).onclick = () => { closeSheet(); logout(); };
    $('[data-act="close"]', body).onclick = closeSheet;
    const wrap = $('#s-feed-wrap', body);
    const refresh = () => { wrap.innerHTML = feedHTML() + googleHTML(); };
    wrap.addEventListener('change', e => {
      if (e.target.id === 's-gpour') { saveFeed({ gpour: e.target.value }); toast('Choix enregistré'); }
    });
    wrap.addEventListener('click', async e => {
      const copy = e.target.closest('[data-copy]');
      if (copy) {
        try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Lien copié'); }
        catch { toast('Copie impossible : réessaie.'); }
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'feed-save') {
        const err = $('#s-feed-err', wrap);
        let raw = $('#s-feed-base', wrap).value.trim().replace(/\s+/g, '');
        if (raw && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw; // « https:// » facultatif
        let base = '', problem = 'Collez l’adresse du service Cloudflare, par exemple nous-deux.votre-pseudo.workers.dev';
        try {
          const u = new URL(raw);
          if (!/^https?:$/.test(u.protocol)) problem = 'Cette adresse n’est pas une adresse web.';
          else if (!u.hostname.endsWith('.workers.dev')) problem = 'L’adresse doit se terminer par .workers.dev (celle affichée sur la page de votre Worker chez Cloudflare).';
          else base = 'https://' + u.hostname;
        } catch { /* adresse illisible */ }
        if (!base) { err.textContent = problem; err.hidden = false; $('#s-feed-base', wrap).focus(); return; }
        saveFeed({ base, token: S.config.feed?.token || genToken() });
        refresh();
      } else if (act === 'feed-edit') {
        saveFeed({ base: '' });
        refresh();
      } else if (act === 'feed-new') {
        if (!confirm('Les anciens liens cesseront de fonctionner : il faudra se réabonner sur les deux téléphones. Continuer ?')) return;
        saveFeed({ token: genToken() });
        refresh();
        toast('Nouveaux liens créés');
      } else if (act === 'g-connect') {
        const f = S.config.feed;
        window.open(`${f.base}/google/start?k=${encodeURIComponent(f.token)}`, '_blank', 'noopener');
        toast('Termine la connexion dans la page Google qui vient de s’ouvrir.');
      } else if (act === 'g-sync') {
        toast((await triggerGoogleSync()) ? 'Synchronisation lancée' : 'Service injoignable : réessaie plus tard.');
      } else if (act === 'g-disconnect') {
        if (!confirm('Déconnecter Google Agenda ? L’agenda « Nous deux » restera dans Google Agenda : vous pourrez le supprimer vous-même.')) return;
        const f = S.config.feed;
        try {
          const r = await fetch(`${f.base}/google/disconnect?k=${encodeURIComponent(f.token)}`, { method: 'POST' });
          toast(r.ok ? 'Google Agenda déconnecté' : 'Déconnexion impossible : réessaie.');
        } catch { toast('Service injoignable : réessaie plus tard.'); }
      }
    });
  });
}

/* ───────── Liens depuis une notification (#t=… ou #e=…&d=…) ───────── */
function handleDeepLink() {
  if (!location.hash || !allLoaded()) return;
  const q = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  const t = q.get('t') && S.tasks.find(x => x.id === q.get('t'));
  const ev = q.get('e') && S.events.find(x => x.id === q.get('e'));
  if (q.get('v') === 'agenda') {
    const d = q.get('d') || today();
    S.cal.sel = d; S.cal.month = d.slice(0, 7); setView('agenda');
  } else if (t) { S.current = t.list; setView('lists'); openEditTask(t); }
  else if (ev) {
    const d = q.get('d') || ev.date;
    S.cal.sel = d; S.cal.month = d.slice(0, 7); setView('agenda'); openEventSheet(ev, d);
  }
}

/* ───────── Session ───────── */
async function logout() {
  try { await signOut(auth); } catch { /* déjà déconnecté */ }
  stopSession();
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch { /* rien à effacer */ }
  location.reload();
}

function onDbError(err) {
  console.error(err);
  if (err.code === 'permission-denied') showScreen('denied');
  else toast('Problème de synchronisation, nouvel essai en cours…');
}

function afterSnapshot(name, snap) {
  if (!snap.metadata.fromCache) S.loaded[name] = true;
  renderAll();
  queueReconcile();
  if (allLoaded() && !S.linkHandled) { S.linkHandled = true; handleDeepLink(); purgeOldLog(); }
}

function startSession(user) {
  stopSession();
  S.me = user;
  showScreen('app');
  renderAll();
  const meta = { includeMetadataChanges: true };

  S.unsubs.push(onSnapshot(collection(db, 'users'), meta, snap => {
    S.users = {};
    snap.forEach(d => { S.users[d.id] = d.data(); });
    const mine = S.users[user.uid];
    if (!mine && !snap.metadata.fromCache && !S.onboardingShown) { S.onboardingShown = true; openOnboarding(); }
    if (mine && mine.ios !== IS_IOS && !snap.metadata.fromCache) updateDoc(doc(db, 'users', user.uid), { ios: IS_IOS }).catch(() => {});
    watchLocal('users', snap);
    afterSnapshot('users', snap);
  }, onDbError));

  S.unsubs.push(onSnapshot(collection(db, 'lists'), meta, snap => {
    S.lists = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (snap.empty && !snap.metadata.fromCache && !S.seeded) { S.seeded = true; seedLists(); }
    if (!S.lists.some(l => l.id === S.current) && S.lists[0]) S.current = S.lists[0].id;
    afterSnapshot('lists', snap);
  }, onDbError));

  S.unsubs.push(onSnapshot(collection(db, 'config'), meta, snap => {
    S.config = {};
    snap.forEach(d => { S.config[d.id] = d.data(); });
    watchLocal('config', snap);
  }, () => { /* facultatif */ }));

  S.unsubs.push(onSnapshot(doc(db, 'gsync', 'status'), snap => {
    const was = !!S.gstatus?.connected;
    S.gstatus = snap.exists() ? snap.data() : null;
    if (!was && S.gstatus?.connected && !S.gstatus.lastSync) pushGoogleSoon(500); // vient d'être connecté : premier envoi
    refreshGoogleBlock();
  }, () => { /* facultatif */ }));

  for (const name of ['tasks', 'events', 'sched']) {
    S.unsubs.push(onSnapshot(collection(db, name), meta, snap => {
      S[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (name === 'events') watchLocal('events', snap);
      afterSnapshot(name, snap);
    }, onDbError));
  }
}

function stopSession() {
  S.unsubs.forEach(u => u());
  Object.assign(S, {
    unsubs: [], me: null, users: {}, lists: [], tasks: [], events: [], sched: [], config: {}, gstatus: null, localDirty: {}, loaded: {},
    seeded: false, onboardingShown: false, linkHandled: false, showDone: false,
    draft: { due: '', time: '', for: 'both', aisle: 'auto', cat: 'autre' },
  });
  closeSheet();
}

/* ───────── Liaison de l'interface ───────── */
const AUTH_ERRORS = {
  'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
  'auth/wrong-password': 'E-mail ou mot de passe incorrect.',
  'auth/user-not-found': 'E-mail ou mot de passe incorrect.',
  'auth/invalid-email': 'Adresse e-mail invalide.',
  'auth/missing-password': 'Indique ton mot de passe.',
  'auth/too-many-requests': 'Trop de tentatives. Réessaie dans quelques minutes.',
  'auth/network-request-failed': 'Pas de connexion internet.',
  'auth/user-disabled': 'Ce compte est désactivé.',
};

function bindUI() {
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('#login-error'), btn = $('#login-btn');
    err.hidden = true; btn.disabled = true;
    try { await signInWithEmailAndPassword(auth, $('#login-email').value.trim(), $('#login-pass').value); }
    catch (x) { err.textContent = AUTH_ERRORS[x.code] || 'Connexion impossible.'; err.hidden = false; }
    finally { btn.disabled = false; }
  });
  $('#forgot').addEventListener('click', async () => {
    const email = $('#login-email').value.trim();
    if (!email) { toast('Indique d’abord ton e-mail.'); $('#login-email').focus(); return; }
    try { await sendPasswordResetEmail(auth, email); toast('E-mail de réinitialisation envoyé.'); }
    catch (x) { toast(AUTH_ERRORS[x.code] || 'Envoi impossible.'); }
  });
  $('#denied-logout').addEventListener('click', logout);
  $('#open-settings').addEventListener('click', openSettings);
  $('#draw').addEventListener('click', () => { const l = listOf(S.current); if (l) openDraw(l); });
  $('#aisle-input').addEventListener('change', e => { S.draft.aisle = e.target.value; });
  $('#new-task').addEventListener('input', () => { if (listKind(listOf(S.current)) === 'shop' && S.draft.aisle === 'auto') renderComposer(); });
  $('#cat-seg').addEventListener('click', e => { const b = e.target.closest('[data-for]'); if (!b) return; S.draft.cat = b.dataset.for; renderComposer(); });
  $('#views').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });

  // Listes
  $('#edit-list').addEventListener('click', () => { const l = listOf(S.current); if (l) openListSheet(l); });
  $('#lists').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.action === 'add-list') openListSheet();
    else if (b.dataset.list) setCurrent(b.dataset.list);
  });
  const onTaskClick = e => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    const li = b.closest('.task');
    const t = li && S.tasks.find(x => x.id === li.dataset.id);
    if (!t) return;
    if (b.dataset.action === 'toggle') toggleTask(t);
    else if (b.dataset.action === 'edit') openEditTask(t);
  };
  $('#main').addEventListener('click', onTaskClick);
  $('#done-toggle').addEventListener('click', () => { S.showDone = !S.showDone; renderTasks(); });
  $('#clear-done').addEventListener('click', clearDone);

  $('#composer').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#new-task');
    const text = input.value.trim();
    if (!text || !S.current) return;
    addTask(text);
    input.value = '';
    S.draft = { ...S.draft, due: '', time: '', for: 'both', aisle: 'auto' };
    renderComposer();
    input.focus();
  });
  $('#due-input').addEventListener('change', e => { S.draft.due = e.target.value; if (!S.draft.due) S.draft.time = ''; renderComposer(); });
  $('#due-clear').addEventListener('click', () => { S.draft.due = ''; S.draft.time = ''; renderComposer(); });
  $('#time-input').addEventListener('change', e => { S.draft.time = e.target.value; renderComposer(); });
  $('#time-clear').addEventListener('click', () => { S.draft.time = ''; renderComposer(); });
  $('#for-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-for]'); if (!b) return;
    S.draft.for = b.dataset.for; renderComposer();
  });

  // Agenda
  $('#cal-prev').addEventListener('click', () => { S.cal.month = addMonths(S.cal.month + '-01', -1).slice(0, 7); renderAgenda(); });
  $('#cal-next').addEventListener('click', () => { S.cal.month = addMonths(S.cal.month + '-01', 1).slice(0, 7); renderAgenda(); });
  $('#cal-today').addEventListener('click', () => { S.cal.sel = today(); S.cal.month = S.cal.sel.slice(0, 7); renderAgenda(); });
  $('#cal-filter').addEventListener('click', e => { const b = e.target.closest('[data-for]'); if (!b) return; S.cal.filter = b.dataset.for; renderAgenda(); });
  $('#cal-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-day]'); if (!b) return;
    S.cal.sel = b.dataset.day; S.cal.month = S.cal.sel.slice(0, 7); renderAgenda();
  });
  $('#agenda').addEventListener('click', e => {
    const evBtn = e.target.closest('[data-event]');
    if (evBtn) { const ev = S.events.find(x => x.id === evBtn.dataset.event); if (ev) openEventSheet(ev, evBtn.dataset.day); return; }
    onTaskClick(e);
  });
  $('#add-event').addEventListener('click', () => openEventSheet(null, S.cal.sel));

  // Rafraîchissements
  setInterval(() => { if (S.me) { renderAll(); queueReconcile(); } }, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) { renderAll(); queueReconcile(); } });
  window.addEventListener('online', queueReconcile);
  window.addEventListener('hashchange', handleDeepLink);
}

/* ───────── Démarrage ───────── */
function configured() { return firebaseConfig?.apiKey && !String(firebaseConfig.apiKey).startsWith('REMPLACER'); }

/* Effet de lumière : un halo part de l'endroit touché sur les boutons */
const LIT = '.btn, .send, .chip, .views button, .seg button, .draw-btn, .opt-pill, .today-btn, .icon-btn';
function lightUp(e) {
  const el = e.target.closest?.(LIT);
  if (!el || el.disabled) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--gx', `${e.clientX - r.left}px`);
  el.style.setProperty('--gy', `${e.clientY - r.top}px`);
  el.classList.remove('is-lit', 'is-swept'); void el.offsetWidth; el.classList.add('is-lit', 'is-swept');
  clearTimeout(el._lit); clearTimeout(el._swept);
  el._lit = setTimeout(() => el.classList.remove('is-lit'), 120);       // le halo s'estompe ensuite en douceur
  el._swept = setTimeout(() => el.classList.remove('is-swept'), 800);   // durée du reflet
}

function main() {
  document.addEventListener('pointerdown', lightUp, { passive: true });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!configured()) { showScreen('setup'); return; }
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch { db = getFirestore(app); }
  bindUI();
  onAuthStateChanged(auth, user => {
    if (user) startSession(user);
    else { stopSession(); showScreen('login'); }
  });
}

main();
