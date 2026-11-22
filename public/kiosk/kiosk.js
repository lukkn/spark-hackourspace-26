// Kiosk: the "physical" home of one pet. Students tap an NFC ID card here,
// then log actions. Writes go to Firestore as the password-protected kiosk account.
import { renderPet, MOOD_LABEL } from '/shared/pets.js';
import { confetti } from '/shared/confetti.js';
import { PETS, ACTIONS, SESSION_TTL_SEC } from '/shared/rules.js';
import {
  listenState, onKioskAuth, kioskLogin, kioskLogout, seedDemoStudents, demoCards, registerCard, tap, logAction,
} from '/shared/data.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------- Device configuration ----------
const params = new URLSearchParams(location.search);
if (params.get('pet')) store.set('spark.pet', params.get('pet'));
if (params.has('demo')) store.set('spark.demo', params.get('demo') === '1' ? '1' : '');
if (params.has('pet') || params.has('demo')) history.replaceState(null, '', location.pathname);

let petId = store.get('spark.pet');
const demo = store.get('spark.demo') === '1';
let deviceId = store.get('spark.device');
if (!deviceId) { deviceId = `kiosk-${Math.random().toString(36).slice(2, 8)}`; store.set('spark.device', deviceId); }

let petState = null;
let session = null; // { uid, student, cooldowns, cooldownAt, expires }
let celebrating = false;
let started = false;

function friendlyError(e) {
  console.error(e);
  if (e?.code === 'permission-denied') return 'This kiosk is not signed in. Unlock it again.';
  if (e?.code === 'unavailable') return 'Offline. Check the internet connection.';
  return 'Something went wrong. Try again.';
}

// ---------- Login / setup screen ----------
let setupWired = false;
function showSetup() {
  $('setup').hidden = false;
  $('kiosk').hidden = true;
  if (setupWired) return;
  setupWired = true;
  document.querySelectorAll('[data-art]').forEach((el) => { el.innerHTML = renderPet(el.dataset.art, 'happy'); });
  let chosen = PETS[petId] ? petId : null;
  const pick = (id) => {
    chosen = id;
    document.querySelectorAll('.pet-pick button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.pet === id)));
  };
  if (chosen) pick(chosen);
  document.querySelectorAll('.pet-pick button').forEach((b) => b.addEventListener('click', () => {
    pick(b.dataset.pet);
    $('setup-password').focus();
  }));

  $('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('setup-error');
    err.hidden = true;
    if (!chosen) { err.textContent = 'Pick which pet lives here.'; err.hidden = false; return; }
    $('setup-go').disabled = true;
    const res = await kioskLogin($('setup-password').value);
    $('setup-go').disabled = false;
    if (!res.ok) {
      err.textContent = res.message;
      err.hidden = false;
      $('setup-password').select();
      return;
    }
    $('setup-password').value = '';
    store.set('spark.pet', chosen);
    petId = chosen; // onKioskAuth fires next and starts the kiosk
  });
  $('setup-password').focus();
}

$('lock').addEventListener('click', async () => { await kioskLogout(); location.reload(); });

// ---------- Rendering ----------
function drawPet({ boop = false } = {}) {
  const mood = petState?.mood || 'happy';
  const wrap = $('pet-art');
  wrap.innerHTML = renderPet(petId, mood, { celebrate: celebrating });
  if (boop) {
    const svg = wrap.querySelector('svg');
    svg.classList.add('booped');
    setTimeout(() => svg.classList.remove('booped'), 500);
  }
}

function drawStatus() {
  if (!petState) return;
  $('happy-bar').style.width = `${petState.happiness}%`;
  $('mood-label').textContent = celebrating ? 'Celebrating!' : MOOD_LABEL[petState.mood];
  $('level').textContent = `Lv ${petState.level.level}`;
  $('xp-bar').style.width = `${Math.round(petState.level.progress * 100)}%`;
  $('points').textContent = `${petState.points.toLocaleString()} pts`;
}

let lastMood = null;
function applyState(state) {
  petState = state.pets[petId];
  if (petState.mood !== lastMood) { lastMood = petState.mood; if (!celebrating) drawPet(); }
  drawStatus();
}

function floatPoints(text, anchor) {
  const r = (anchor || $('pet-art')).getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'float-pts';
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top + r.height * 0.25}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

let toastTimer;
function toast(msg, { kind = '', ms = 2600 } = {}) {
  const t = $('toast');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function showModal({ title, body, art, html = false, ms, extra }) {
  $('modal-title').textContent = title;
  $('modal-body')[html ? 'innerHTML' : 'textContent'] = body;
  $('modal-art').innerHTML = art || '';
  $('modal-art').hidden = !art;
  $('modal-extra').innerHTML = '';
  if (extra) $('modal-extra').appendChild(extra);
  $('modal').hidden = false;
  clearTimeout(showModal.timer);
  if (ms) showModal.timer = setTimeout(hideModal, ms);
}
function hideModal() { $('modal').hidden = true; }
$('modal-ok').addEventListener('click', hideModal);

// ---------- Sound (tiny WebAudio chirps) ----------
let audio;
function chirp(notes) {
  try {
    audio ||= new AudioContext();
    let t = audio.currentTime;
    for (const [freq, dur] of notes) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t + dur);
      t += dur * 0.8;
    }
  } catch { /* audio not available */ }
}
const SOUNDS = {
  tap: [[660, 0.12], [880, 0.16]],
  action: [[784, 0.1], [988, 0.14]],
  error: [[300, 0.18], [220, 0.25]],
  party: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.3], [784, 0.1], [1047, 0.4]],
};

// ---------- Registering unknown cards (organizers) ----------
function registerButton(uid) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ghost';
  b.textContent = 'Organizer: register this card';
  b.addEventListener('click', () => openRegister(uid));
  return b;
}

function openRegister(uid) {
  hideModal();
  $('reg-uid').textContent = uid;
  $('reg-name').value = '';
  $('reg-major').value = petId;
  $('reg-password').value = '';
  $('reg-error').hidden = true;
  $('register').hidden = false;
  $('reg-name').focus();
}
$('reg-cancel').addEventListener('click', () => { $('register').hidden = true; });
$('reg-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('reg-save').disabled = true;
  const res = await registerCard({
    uid: $('reg-uid').textContent,
    name: $('reg-name').value,
    major: $('reg-major').value,
    password: $('reg-password').value,
  }).catch((err) => ({ ok: false, message: friendlyError(err) }));
  $('reg-save').disabled = false;
  $('reg-password').value = '';
  if (!res.ok) { $('reg-error').textContent = res.message; $('reg-error').hidden = false; return; }
  $('register').hidden = true;
  toast(`Card registered for ${$('reg-name').value.trim()}. Tap it again!`, { ms: 4000 });
  lastTap = { uid: null, at: 0 };
});

// ---------- Taps ----------
let lastTap = { uid: null, at: 0 };
let tapping = false;
async function handleTap(rawUid) {
  const uid = String(rawUid || '').trim();
  if (!uid || tapping || !$('register').hidden) return;
  const now = Date.now();
  if (uid === lastTap.uid && now - lastTap.at < 2500) return; // reader double-fire
  lastTap = { uid, at: now };
  hideModal();

  tapping = true;
  let res;
  try {
    res = await tap({ petId, rawUid: uid, demo, deviceId });
  } catch (e) {
    res = { ok: false, message: friendlyError(e) };
  } finally {
    tapping = false;
  }

  if (!res.ok) {
    chirp(SOUNDS.error);
    if (res.error === 'wrong_major') {
      showModal({
        title: `Sorry ${res.student.name.split(' ')[0]}, wrong pet!`,
        body: res.message,
        art: renderPet(res.student.major, 'happy'),
        ms: 6000,
      });
    } else if (res.error === 'unknown_card') {
      showModal({
        title: 'Card not registered',
        body: `${res.message}<br><br>Card id: <code>${res.uid}</code>`,
        html: true,
        art: renderPet(petId, 'okay'),
        extra: registerButton(res.uid),
      });
    } else {
      toast(res.message || 'Something went wrong', { kind: 'bad' });
    }
    return;
  }

  chirp(SOUNDS.tap);
  startSession(res);
  drawPet({ boop: true });
  if (res.checkin) floatPoints(`+${res.checkin.points}`);
}

// ---------- Session ----------
function startSession(res) {
  session = {
    uid: res.uid,
    student: res.student,
    cooldowns: res.cooldowns,
    cooldownAt: Date.now(),
    expires: Date.now() + SESSION_TTL_SEC * 1000,
  };
  const first = res.student.name.split(' ')[0];
  $('greet').textContent = res.checkin ? `Hi ${first}! Thanks for checking in` : `Welcome back, ${first}!`;
  $('greet-sub').textContent = res.checkin
    ? `+${res.checkin.points} points for ${PETS[petId].name}. What else did you do?`
    : 'You already checked in today. Log what you\'ve been up to:';
  $('idle').hidden = true;
  $('session').hidden = false;
  renderActions();
}

function endSession() {
  session = null;
  $('session').hidden = true;
  $('idle').hidden = false;
}
$('done').addEventListener('click', () => { chirp(SOUNDS.action); endSession(); });

function cooldownRemaining(id) {
  const base = session.cooldowns[id] || 0;
  if (base <= 0) return 0;
  return Math.max(0, base - Math.floor((Date.now() - session.cooldownAt) / 1000));
}

function renderActions() {
  const el = $('actions');
  el.innerHTML = '';
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.kiosk === false) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `action ${a.tier}`;
    b.dataset.action = id;
    b.innerHTML = `<span class="e">${a.emoji}</span><span class="l">${a.label}</span><span class="p">+${a.points} pts</span><span class="cd"></span>`;
    b.addEventListener('click', () => doAction(id, b));
    el.appendChild(b);
  }
  tickActions();
}

function tickActions() {
  if (!session) return;
  for (const b of document.querySelectorAll('.action')) {
    const left = cooldownRemaining(b.dataset.action);
    b.disabled = left > 0 || b.dataset.busy === '1';
    b.querySelector('.cd').textContent = left > 0 ? (left >= 60 ? `${Math.ceil(left / 60)}m` : `${left}s`) : '';
  }
  const pct = Math.max(0, (session.expires - Date.now()) / (SESSION_TTL_SEC * 1000));
  $('session-bar').style.width = `${pct * 100}%`;
  if (pct <= 0) endSession();
}
setInterval(tickActions, 1000);

async function doAction(id, button) {
  if (!session) return;
  const s = session;
  button.dataset.busy = '1';
  button.disabled = true;
  let res;
  try {
    res = await logAction({ petId, uid: s.uid, name: s.student.name, actionId: id, demo, deviceId });
  } catch (e) {
    res = { ok: false, message: friendlyError(e) };
  } finally {
    button.dataset.busy = '';
  }
  if (session !== s) return; // session ended meanwhile
  if (res.cooldowns) { s.cooldowns = res.cooldowns; s.cooldownAt = Date.now(); }
  if (!res.ok) {
    toast(res.message || 'Could not log that', { kind: 'bad' });
    chirp(SOUNDS.error);
    tickActions();
    return;
  }
  s.expires = Date.now() + SESSION_TTL_SEC * 1000;
  const a = ACTIONS[id];
  floatPoints(`+${a.points}`, button);
  if (res.celebrate) celebrate(s.student.name.split(' ')[0], a);
  else { chirp(SOUNDS.action); drawPet({ boop: true }); toast(`${a.emoji} ${a.label}! +${a.points}`); }
  tickActions();
}

function celebrate(who, action) {
  celebrating = true;
  drawPet();
  drawStatus();
  chirp(SOUNDS.party);
  const r = $('pet-art').getBoundingClientRect();
  confetti({ origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
  setTimeout(() => confetti({ count: 120 }), 700);
  toast(`${action.emoji} ${who} ${action.label.toLowerCase()}! +${action.points}`, { kind: 'big', ms: 5000 });
  clearTimeout(celebrate.timer);
  celebrate.timer = setTimeout(() => { celebrating = false; drawPet(); drawStatus(); }, 6000);
}

// Petting the pet on screen is just for fun (no points without a session).
$('pet-art').addEventListener('click', () => {
  drawPet({ boop: true });
  if (!session) toast('Tap your ID first so I know who you are! 🪪', { ms: 1800 });
});

// ---------- NFC input ----------
// 1) Web NFC (Chrome on Android, needs HTTPS).
let nfcOn = false;
async function startWebNfc() {
  if (nfcOn) return;
  try {
    const reader = new window.NDEFReader();
    await reader.scan();
    nfcOn = true;
    reader.addEventListener('reading', (e) => {
      let uid = e.serialNumber;
      // Fallback: a text record written on the tag (e.g. "student:1234").
      if (!uid) {
        for (const r of e.message.records) {
          if (r.recordType === 'text') uid = new TextDecoder(r.encoding || 'utf-8').decode(r.data).replace(/^student:/, '');
        }
      }
      handleTap(uid);
    });
    reader.addEventListener('readingerror', () => toast('Could not read that card. Try again.', { kind: 'bad' }));
    $('nfc-start').hidden = true;
    $('idle-sub').textContent = 'Hold your card against the back of this phone.';
  } catch (err) {
    toast(`NFC unavailable: ${err.message}`, { kind: 'bad', ms: 4000 });
  }
}
if ('NDEFReader' in window) {
  $('nfc-start').hidden = false;
  $('nfc-start').addEventListener('click', startWebNfc);
  // If permission was granted before, Chrome lets us resume without a gesture.
  navigator.permissions?.query({ name: 'nfc' }).then((p) => { if (p.state === 'granted') startWebNfc(); }).catch(() => {});
}

// 2) USB NFC readers in "keyboard wedge" mode type the card id + Enter very fast.
let buf = '';
let lastKey = 0;
document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, textarea, select')) return;
  const now = performance.now();
  if (now - lastKey > 120) buf = '';
  lastKey = now;
  if (e.key === 'Enter') {
    if (buf.length >= 4) handleTap(buf);
    buf = '';
  } else if (/^[0-9a-zA-Z:]$/.test(e.key)) {
    buf += e.key;
  }
});

// 3) Demo cards (simulated taps for devices with no reader).
$('demo-toggle').addEventListener('click', async () => {
  const d = $('demo');
  d.hidden = !d.hidden;
  if (d.hidden) return;
  let cards = [];
  try { cards = await demoCards(); } catch (e) { toast(friendlyError(e), { kind: 'bad' }); }
  $('demo-cards').innerHTML = '';
  for (const c of cards) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span>${c.name}</span><small class="${c.major}">${c.major.toUpperCase()}</small>`;
    b.addEventListener('click', () => { lastTap = { uid: null, at: 0 }; handleTap(c.uid); });
    $('demo-cards').appendChild(b);
  }
});

// ---------- Boot ----------
function startKiosk() {
  if (started) return;
  started = true;
  const pet = PETS[petId];
  document.body.dataset.pet = petId;
  document.title = `${pet.name} · Spark Pets Kiosk`;
  $('pet-name').textContent = pet.name;
  $('pet-major').textContent = `the ${pet.major} pet`;
  $('setup').hidden = true;
  $('kiosk').hidden = false;
  if (demo) $('demo-mode').hidden = false;
  drawPet();
  listenState(applyState, {
    onError: () => $('conn').classList.add('off'),
  });
  seedDemoStudents().catch((e) => console.warn('Could not seed demo students', e));
}

onKioskAuth((user) => {
  if (user && PETS[petId]) startKiosk();
  else if (started) location.reload(); // signed out elsewhere
  else showSetup();
});
