// Kiosk: the "physical" home of one pet. Students tap an NFC ID card here,
// then log actions. All writes go to /api/device/* with the device key.
import { renderPet, MOOD_LABEL } from '/shared/pets.js';
import { confetti } from '/shared/confetti.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------- Device configuration ----------
const params = new URLSearchParams(location.search);
if (params.get('pet')) store.set('spark.pet', params.get('pet'));
if (params.get('key')) store.set('spark.key', params.get('key'));
if (params.has('pet') || params.has('key')) history.replaceState(null, '', location.pathname); // hide key from URL bar

let petId = store.get('spark.pet');
let deviceKey = store.get('spark.key');
let deviceId = store.get('spark.device');
if (!deviceId) { deviceId = `kiosk-${Math.random().toString(36).slice(2, 8)}`; store.set('spark.device', deviceId); }

let config;
let petState = null;
let session = null; // { token, student, cooldowns, expires, ttl }
let celebrating = false;

async function api(path, body) {
  const res = await fetch(`/api/device/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Device-Key': deviceKey || '', 'X-Device-Id': deviceId },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ ok: false, message: 'Server error' }));
  if (res.status === 401 && data.error === 'bad_device_key') {
    showModal({ title: 'Kiosk not authorized', body: 'The device key is wrong. Re-open the kiosk link from the server console.' });
    store.set('spark.key', '');
  }
  return data;
}

// ---------- Setup screen ----------
function showSetup() {
  $('setup').hidden = false;
  $('kiosk').hidden = true;
  document.querySelectorAll('[data-art]').forEach((el) => { el.innerHTML = renderPet(el.dataset.art, 'happy'); });
  $('setup-key').value = deviceKey || '';
  document.querySelectorAll('.pet-pick button').forEach((b) => b.addEventListener('click', () => {
    const key = $('setup-key').value.trim();
    if (!key) { $('setup-key').focus(); return; }
    store.set('spark.pet', b.dataset.pet);
    store.set('spark.key', key);
    location.reload();
  }));
}

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

function showModal({ title, body, art, html = false, ms }) {
  $('modal-title').textContent = title;
  $('modal-body')[html ? 'innerHTML' : 'textContent'] = body;
  $('modal-art').innerHTML = art || '';
  $('modal-art').hidden = !art;
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

// ---------- Taps ----------
let lastTap = { uid: null, at: 0 };
async function handleTap(rawUid) {
  const uid = String(rawUid || '').trim();
  if (!uid) return;
  const now = Date.now();
  if (uid === lastTap.uid && now - lastTap.at < 2500) return; // reader double-fire
  lastTap = { uid, at: now };
  hideModal();

  const res = await api('tap', { pet: petId, uid });
  if (!res.ok) {
    chirp(SOUNDS.error);
    if (res.error === 'wrong_major') {
      const theirs = config.pets[res.student.major];
      showModal({
        title: `Sorry ${res.student.name.split(' ')[0]}, wrong pet!`,
        body: res.message,
        art: renderPet(theirs.id, 'happy'),
        ms: 6000,
      });
    } else if (res.error === 'unknown_card') {
      showModal({
        title: 'Card not registered',
        body: `${res.message}<br><br>Card id: <code>${res.uid}</code>`,
        html: true,
        art: renderPet(petId, 'okay'),
      });
    } else if (res.error !== 'bad_device_key') {
      toast(res.message || 'Something went wrong', { kind: 'bad' });
    }
    return;
  }

  chirp(SOUNDS.tap);
  if (session) await api('end', { session: session.token }); // a new student took over
  startSession(res);
  drawPet({ boop: true });
  if (res.checkin) floatPoints(`+${res.checkin.points}`);
}

// ---------- Session ----------
function startSession(res) {
  session = {
    token: res.session,
    student: res.student,
    cooldowns: res.cooldowns,
    cooldownAt: Date.now(),
    ttl: res.sessionTtlSec,
    expires: Date.now() + res.sessionTtlSec * 1000,
  };
  const first = res.student.name.split(' ')[0];
  $('greet').textContent = res.checkin ? `Hi ${first}! Thanks for checking in` : `Welcome back, ${first}!`;
  $('greet-sub').textContent = res.checkin
    ? `+${res.checkin.points} points for ${config.pets[petId].name}. What else did you do?`
    : `You already checked in today. Log what you've been up to:`;
  $('idle').hidden = true;
  $('session').hidden = false;
  renderActions();
}

function endSession() {
  if (session) api('end', { session: session.token });
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
  for (const [id, a] of Object.entries(config.actions)) {
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
    b.disabled = left > 0;
    b.querySelector('.cd').textContent = left > 0 ? (left >= 60 ? `${Math.ceil(left / 60)}m` : `${left}s`) : '';
  }
  const pct = Math.max(0, (session.expires - Date.now()) / (session.ttl * 1000));
  $('session-bar').style.width = `${pct * 100}%`;
  if (pct <= 0) endSession();
}
setInterval(tickActions, 1000);

async function doAction(id, button) {
  if (!session) return;
  button.disabled = true;
  const res = await api('action', { session: session.token, action: id });
  if (res.cooldowns) { session.cooldowns = res.cooldowns; session.cooldownAt = Date.now(); }
  if (!res.ok) {
    if (res.error === 'session_expired') { endSession(); toast('Session ended — tap your ID again.', { kind: 'bad' }); }
    else toast(res.message || 'Could not log that', { kind: 'bad' });
    chirp(SOUNDS.error);
    tickActions();
    return;
  }
  session.expires = Date.now() + session.ttl * 1000;
  const a = config.actions[id];
  floatPoints(`+${a.points}`, button);
  if (res.celebrate) celebrate(session.student.name.split(' ')[0], a);
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
// 1) Web NFC (Chrome on Android, needs HTTPS or localhost).
async function startWebNfc() {
  try {
    const reader = new window.NDEFReader();
    await reader.scan();
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
    reader.addEventListener('readingerror', () => toast('Could not read that card — try again.', { kind: 'bad' }));
    $('nfc-start').hidden = true;
    $('idle-sub').textContent = 'Hold your card against the back of this phone.';
    store.set('spark.nfc', '1');
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
  if (e.target.matches?.('input, textarea')) return;
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

// 3) Demo cards (simulated taps for laptops with no reader).
$('demo-toggle').addEventListener('click', async () => {
  const d = $('demo');
  d.hidden = !d.hidden;
  if (d.hidden) return;
  const cards = await api('demo-cards');
  $('demo-cards').innerHTML = '';
  for (const c of Array.isArray(cards) ? cards : []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span>${c.name}</span><small class="${c.major}">${c.major.toUpperCase()}</small>`;
    b.addEventListener('click', () => { lastTap = { uid: null, at: 0 }; handleTap(c.uid); });
    $('demo-cards').appendChild(b);
  }
});

// ---------- Live state ----------
function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('open', () => $('conn').classList.remove('off'));
  es.addEventListener('error', () => $('conn').classList.add('off'));
  es.addEventListener('state', (e) => applyState(JSON.parse(e.data)));
}

// ---------- Boot ----------
async function boot() {
  config = await fetch('/api/config').then((r) => r.json());
  if (!config.pets[petId] || !deviceKey) return showSetup();
  const pet = config.pets[petId];
  document.body.dataset.pet = petId;
  document.title = `${pet.name} · Spark Pets Kiosk`;
  $('pet-name').textContent = pet.name;
  $('pet-major').textContent = `the ${pet.major} pet`;
  $('kiosk').hidden = false;
  drawPet();
  connectStream();
}
boot();
