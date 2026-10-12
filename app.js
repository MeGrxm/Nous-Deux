// Nous deux — listes partagées à deux, avec notifications via ntfy.
import { firebaseConfig } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const NTFY_SERVER = 'https://ntfy.sh';
const APP_URL = new URL('./', location.href).href;
const DEFAULT_LISTS = [
  { id: 'a-faire', name: 'À faire', emoji: '🏠', order: 1 },
  { id: 'courses', name: 'Courses', emoji: '🛒', order: 2 },
  { id: 'sorties', name: 'Sorties & idées', emoji: '✨', order: 3 },
];

let app, auth, db;

const S = {
  me: null,          // utilisateur Firebase connecté
  users: {},         // uid -> { name, topic, details, notifyDone, createdAt }
  lists: [],
  tasks: [],
  current: storageGet('nd:list'),
  showDone: false,
  draft: { due: '', for: 'both' },
  unsubs: [],
  seeded: false,
  onboardingShown: false,
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
function initial(name) { return (Array.from((name || '?').trim())[0] || '?').toUpperCase(); }

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
function dayStr(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dueLabel(d) {
  if (d === dayStr(0)) return 'Aujourd’hui';
  if (d === dayStr(1)) return 'Demain';
  if (d === dayStr(-1)) return 'Hier';
  return new Date(d + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}
function dueClass(d, done) {
  if (done || !d) return '';
  if (d < dayStr(0)) return 'pill-late';
  if (d === dayStr(0)) return 'pill-today';
  return '';
}

/* ───────── Personnes ───────── */
function people() {
  return Object.entries(S.users)
    .map(([uid, u]) => ({ uid, ...u }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
function partner() { return people().find(p => p.uid !== S.me?.uid) || null; }
function myName() { return S.users[S.me?.uid]?.name || (S.me?.email || '').split('@')[0] || 'Moi'; }
function nameOf(uid) {
  if (!uid) return '';
  if (S.users[uid]?.name) return S.users[uid].name;
  return uid === S.me?.uid ? 'Moi' : '…';
}
function toneOf(uid) { return people().findIndex(p => p.uid === uid) === 1 ? 'b' : 'a'; }
function listOf(id) { return S.lists.find(l => l.id === id); }
function listTitle(l) { return l ? `${l.emoji || ''} ${l.name}`.trim() : 'Nous deux'; }

/* ───────── Notifications (ntfy) ───────── */
// Chaque personne reçoit sur SON sujet ntfy ; on n'envoie jamais à soi-même.
function notify(kind, { title, full, short }) {
  for (const p of people()) {
    if (p.uid === S.me.uid || !p.topic) continue;
    if (kind === 'done' && !p.notifyDone) continue;
    const message = p.details === false ? short : full;
    // Envoi JSON à la racine du serveur, sans en-tête personnalisé (requête « simple », pas de pré-vérification CORS).
    fetch(NTFY_SERVER, { method: 'POST', body: JSON.stringify({ topic: p.topic, title, message, click: APP_URL }) })
      .catch(() => { /* hors ligne : la tâche est quand même enregistrée */ });
  }
}

/* ───────── Écrans, toast, feuilles ───────── */
function showScreen(name) {
  for (const s of ['loading', 'setup', 'login', 'denied', 'app']) {
    $('#screen-' + s).hidden = s !== name;
  }
}

let toastTimer;
function toast(msg, action) {
  const el = $('#toast'), btn = $('#toast-action');
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
function forOptions() {
  const opts = [['both', 'Nous deux'], [S.me.uid, 'Moi']];
  const p = partner();
  if (p) opts.push([p.uid, p.name || 'L’autre']);
  return opts;
}

/* ───────── Rendu ───────── */
const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

function renderAll() {
  if (!S.me) return;
  renderDuo();
  renderLists();
  renderTasks();
  renderComposer();
}

function renderDuo() {
  $('#duo').innerHTML = people()
    .map(p => `<span class="av tone-${toneOf(p.uid)}" title="${esc(p.name)}">${esc(initial(p.name))}</span>`)
    .join('');
}

function renderLists() {
  $('#lists').innerHTML = S.lists.map(l => {
    const n = S.tasks.filter(t => t.list === l.id && !t.done).length;
    return `<button class="chip ${l.id === S.current ? 'is-on' : ''}" data-list="${esc(l.id)}">`
      + `<span>${esc(l.emoji || '•')}</span>${esc(l.name)}`
      + (n ? `<span class="chip-count">${n}</span>` : '')
      + '</button>';
  }).join('') + '<button class="chip chip-add" data-action="add-list" aria-label="Nouvelle liste">+</button>';
}

function taskHTML(t) {
  const meta = [];
  if (t.done) {
    meta.push(`<span>Fait par <span class="who tone-${toneOf(t.doneBy)}">${esc(nameOf(t.doneBy))}</span> · ${esc(ago(t.doneTs))}</span>`);
  } else {
    meta.push(`<span><span class="who tone-${toneOf(t.by)}">${esc(nameOf(t.by))}</span> · ${esc(ago(t.ts))}</span>`);
    if (t.due) meta.push(`<span class="pill ${dueClass(t.due, t.done)}">${esc(dueLabel(t.due))}</span>`);
    if (t.for && t.for !== 'both') meta.push(`<span class="pill pill-for tone-${toneOf(t.for)}">Pour ${esc(t.for === S.me.uid ? 'moi' : nameOf(t.for))}</span>`);
  }
  return `<li class="task ${t.done ? 'is-done' : ''}" data-id="${esc(t.id)}">`
    + `<button class="check" data-action="toggle" aria-label="${t.done ? 'Décocher' : 'Cocher'}">${CHECK_SVG}</button>`
    + `<button class="task-body" data-action="edit"><span class="task-text">${esc(t.text)}</span><span class="task-meta">${meta.join('')}</span></button>`
    + '</li>';
}

function renderTasks() {
  const l = listOf(S.current);
  $('#list-title').textContent = l ? listTitle(l) : '';
  $('#edit-list').hidden = !l;

  const inList = S.tasks.filter(t => t.list === S.current);
  const todo = inList.filter(t => !t.done).sort((a, b) => {
    if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : (b.ts || 0) - (a.ts || 0);
    if (a.due) return -1;
    if (b.due) return 1;
    return (b.ts || 0) - (a.ts || 0);
  });
  const done = inList.filter(t => t.done).sort((a, b) => (b.doneTs || 0) - (a.doneTs || 0));

  $('#todo').innerHTML = todo.map(taskHTML).join('');
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
  $('#new-task').placeholder = l ? `Ajouter à ${l.name}…` : 'Ajouter…';
  const due = S.draft.due;
  $('#due-label').textContent = due ? dueLabel(due) : 'Date';
  $('#due-input').value = due;
  $('#due-clear').hidden = !due;
  $('#opt-date').classList.toggle('is-on', !!due);
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
  const t = {
    text, list: S.current, done: false,
    by: S.me.uid, ts: Date.now(),
    due: S.draft.due || '', for: S.draft.for || 'both',
    doneBy: null, doneTs: null,
  };
  addDoc(collection(db, 'tasks'), t).catch(fail);

  const p = partner();
  let full = `${myName()} a ajouté : ${text}`;
  if (t.due) full += ` (${dueLabel(t.due).toLowerCase()})`;
  if (p && t.for === p.uid) full += ' — pour toi';
  notify('add', { title: listTitle(listOf(t.list)), full, short: `${myName()} a ajouté une tâche` });
}

function toggleTask(t) {
  const done = !t.done;
  updateDoc(doc(db, 'tasks', t.id), {
    done, doneBy: done ? S.me.uid : null, doneTs: done ? Date.now() : null,
  }).catch(fail);
  if (done) {
    notify('done', {
      title: listTitle(listOf(t.list)),
      full: `${myName()} a coché : ${t.text}`,
      short: `${myName()} a coché une tâche`,
    });
  }
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
  const listOpts = S.lists.map(l => `<option value="${esc(l.id)}" ${l.id === t.list ? 'selected' : ''}>${esc(listTitle(l))}</option>`).join('');
  let forValue = t.for || 'both';
  openSheet(`
    <h2 tabindex="-1" autofocus>Modifier</h2>
    <label class="field"><span>Tâche</span><input id="e-text" maxlength="200" value="${esc(t.text)}"></label>
    <label class="field"><span>Liste</span><select id="e-list">${listOpts}</select></label>
    <label class="field"><span>Date</span><input type="date" id="e-due" value="${esc(t.due || '')}"></label>
    <div class="field seg-field"><span>Pour</span><div class="seg" id="e-for">${segHTML(forValue, forOptions())}</div></div>
    <p class="muted small">Ajoutée par ${esc(nameOf(t.by))} · ${esc(ago(t.ts))}</p>
    <div class="sheet-actions">
      <button class="btn danger" data-act="delete">Supprimer</button>
      <button class="btn primary" data-act="save">Enregistrer</button>
    </div>`, body => {
    $('#e-for', body).addEventListener('click', e => {
      const b = e.target.closest('[data-for]'); if (!b) return;
      forValue = b.dataset.for;
      $('#e-for', body).innerHTML = segHTML(forValue, forOptions());
    });
    $('[data-act="delete"]', body).onclick = () => { closeSheet(); deleteTask(t); };
    $('[data-act="save"]', body).onclick = () => {
      const text = $('#e-text', body).value.trim();
      if (!text) { $('#e-text', body).focus(); return; }
      updateDoc(doc(db, 'tasks', t.id), {
        text, list: $('#e-list', body).value, due: $('#e-due', body).value || '', for: forValue,
      }).catch(fail);
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
        setDoc(ref, { name, emoji, order }).catch(fail);
        closeSheet();
        setCurrent(ref.id);
      } else {
        updateDoc(doc(db, 'lists', list.id), { name, emoji }).catch(fail);
        closeSheet();
      }
    });
  });
}

/* ───────── Profil, réglages ───────── */
function openOnboarding() {
  openSheet(`
    <h2>Bienvenue 👋</h2>
    <p class="muted">Comment tu t’appelles ? Ton prénom apparaîtra sur tes tâches et dans les notifications de l’autre.</p>
    <label class="field"><span>Ton prénom</span><input id="o-name" maxlength="30" autocomplete="given-name"></label>
    <button class="btn primary block" data-act="go">C’est parti</button>`, body => {
    const go = () => {
      const name = $('#o-name', body).value.trim();
      if (!name) { $('#o-name', body).focus(); return; }
      setDoc(doc(db, 'users', S.me.uid), {
        name, email: S.me.email || '', topic: genTopic(),
        details: true, notifyDone: false, createdAt: Date.now(),
      }).catch(fail);
      closeSheet();
      setTimeout(openSettings, 250); // enchaîne sur la configuration des notifications
    };
    $('[data-act="go"]', body).onclick = go;
    $('#o-name', body).addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }, { locked: true });
}

function openSettings() {
  const me = S.users[S.me.uid] || {};
  const p = partner();
  const partnerLine = p
    ? `${esc(p.name)} a rejoint l’appli : tes ajouts lui seront notifiés.`
    : 'En attente de la première connexion de l’autre compte.';
  openSheet(`
    <h2 tabindex="-1" autofocus>Réglages</h2>
    <label class="field"><span>Ton prénom</span><input id="s-name" maxlength="30" value="${esc(me.name || '')}"></label>
    <section class="box">
      <h3>Notifications sur ce téléphone</h3>
      <ol class="steps">
        <li>Installe l’appli gratuite <b>ntfy</b> (App Store ou Play Store).</li>
        <li>Appuie sur <b>+</b>, garde le serveur <b>ntfy.sh</b> et abonne-toi à ce sujet :</li>
      </ol>
      <div class="code-row"><code class="code" id="s-topic">${esc(me.topic || '…')}</code><button class="btn small" data-act="copy">Copier</button></div>
      <button class="btn block" data-act="test">Envoyer une notification de test</button>
    </section>
    <label class="switch-row"><span>Voir le contenu des tâches dans mes notifications</span><input type="checkbox" class="switch" id="s-details" ${me.details !== false ? 'checked' : ''}></label>
    <label class="switch-row"><span>Me prévenir aussi quand l’autre coche une tâche</span><input type="checkbox" class="switch" id="s-done" ${me.notifyDone ? 'checked' : ''}></label>
    <p class="muted small">${partnerLine}</p>
    <div class="sheet-actions">
      <button class="btn" data-act="logout">Se déconnecter</button>
      <button class="btn primary" data-act="close">Fermer</button>
    </div>`, body => {
    const ref = doc(db, 'users', S.me.uid);
    $('#s-name', body).addEventListener('change', e => {
      const name = e.target.value.trim();
      if (name) updateDoc(ref, { name }).catch(fail);
    });
    $('#s-details', body).addEventListener('change', e => updateDoc(ref, { details: e.target.checked }).catch(fail));
    $('#s-done', body).addEventListener('change', e => updateDoc(ref, { notifyDone: e.target.checked }).catch(fail));
    $('[data-act="copy"]', body).onclick = async () => {
      try { await navigator.clipboard.writeText(me.topic || ''); toast('Sujet copié'); }
      catch { toast('Copie impossible : sélectionne le texte à la main.'); }
    };
    $('[data-act="test"]', body).onclick = async () => {
      if (!me.topic) return;
      try {
        const res = await fetch(NTFY_SERVER, { method: 'POST', body: JSON.stringify({ topic: me.topic, title: 'Nous deux', message: 'Les notifications fonctionnent 🎉', click: APP_URL }) });
        toast(res.ok ? 'Envoyée : regarde ton téléphone.' : `Le serveur ntfy a répondu ${res.status}.`);
      } catch {
        toast('Envoi impossible à confirmer : regarde ton téléphone.');
      }
    };
    $('[data-act="logout"]', body).onclick = () => { closeSheet(); signOut(auth); };
    $('[data-act="close"]', body).onclick = closeSheet;
  });
}

/* ───────── Session ───────── */
function onDbError(err) {
  console.error(err);
  if (err.code === 'permission-denied') showScreen('denied');
  else toast('Problème de synchronisation, nouvel essai en cours…');
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
    if (!S.users[user.uid] && !snap.metadata.fromCache && !S.onboardingShown) {
      S.onboardingShown = true;
      openOnboarding();
    }
    renderAll();
  }, onDbError));

  S.unsubs.push(onSnapshot(collection(db, 'lists'), meta, snap => {
    S.lists = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (snap.empty && !snap.metadata.fromCache && !S.seeded) { S.seeded = true; seedLists(); }
    if (!S.lists.some(l => l.id === S.current) && S.lists[0]) S.current = S.lists[0].id;
    renderAll();
  }, onDbError));

  S.unsubs.push(onSnapshot(collection(db, 'tasks'), snap => {
    S.tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  }, onDbError));
}

function stopSession() {
  S.unsubs.forEach(u => u());
  Object.assign(S, { unsubs: [], me: null, users: {}, lists: [], tasks: [], seeded: false, onboardingShown: false, showDone: false, draft: { due: '', for: 'both' } });
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
    try {
      await signInWithEmailAndPassword(auth, $('#login-email').value.trim(), $('#login-pass').value);
    } catch (x) {
      err.textContent = AUTH_ERRORS[x.code] || 'Connexion impossible.';
      err.hidden = false;
    } finally { btn.disabled = false; }
  });

  $('#forgot').addEventListener('click', async () => {
    const email = $('#login-email').value.trim();
    if (!email) { toast('Indique d’abord ton e-mail.'); $('#login-email').focus(); return; }
    try { await sendPasswordResetEmail(auth, email); toast('E-mail de réinitialisation envoyé.'); }
    catch (x) { toast(AUTH_ERRORS[x.code] || 'Envoi impossible.'); }
  });

  $('#denied-logout').addEventListener('click', () => signOut(auth));
  $('#open-settings').addEventListener('click', openSettings);
  $('#edit-list').addEventListener('click', () => { const l = listOf(S.current); if (l) openListSheet(l); });

  $('#lists').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.action === 'add-list') openListSheet();
    else if (b.dataset.list) setCurrent(b.dataset.list);
  });

  $('#main').addEventListener('click', e => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    const li = b.closest('.task');
    const t = li && S.tasks.find(x => x.id === li.dataset.id);
    if (!t) return;
    if (b.dataset.action === 'toggle') toggleTask(t);
    else if (b.dataset.action === 'edit') openEditTask(t);
  });

  $('#done-toggle').addEventListener('click', () => { S.showDone = !S.showDone; renderTasks(); });
  $('#clear-done').addEventListener('click', clearDone);

  $('#composer').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#new-task');
    const text = input.value.trim();
    if (!text || !S.current) return;
    addTask(text);
    input.value = '';
    S.draft = { due: '', for: 'both' };
    renderComposer();
    input.focus();
  });
  $('#due-input').addEventListener('change', e => { S.draft.due = e.target.value; renderComposer(); });
  $('#due-clear').addEventListener('click', () => { S.draft.due = ''; renderComposer(); });
  $('#for-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-for]'); if (!b) return;
    S.draft.for = b.dataset.for; renderComposer();
  });

  // Rafraîchit les « il y a 5 min » et les dates.
  setInterval(() => { if (S.me) renderTasks(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) renderTasks(); });
}

/* ───────── Démarrage ───────── */
function configured() {
  return firebaseConfig?.apiKey && !String(firebaseConfig.apiKey).startsWith('REMPLACER');
}

function main() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!configured()) { showScreen('setup'); return; }

  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    db = getFirestore(app);
  }
  bindUI();
  onAuthStateChanged(auth, user => {
    if (user) startSession(user);
    else { stopSession(); showScreen('login'); }
  });
}

main();
