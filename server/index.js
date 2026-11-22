import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDb, all, normalizeUid, saveNow, DB_FILE } from './db.js';
import {
  ACTIONS, PETS, PORT, DEVICE_KEY, DEMO_MODE, SESSION_TTL_SEC, TIMEZONE, HAPPINESS_DECAY_PER_HOUR,
  cooldownFor,
} from './config.js';
import { snapshot, findStudent, cooldownLeft, recordEvent } from './game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await openDb();

const app = express();
app.use(express.json({ limit: '10kb' }));

// ---------- Static pages ----------
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'dashboard', 'index.html')));

// ---------- Live stream (Server-Sent Events) ----------
const clients = new Set();

function send(res, type, data) {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(type, data) {
  for (const res of clients) send(res, type, data);
}
let pending = null;
function broadcastState() {
  // Coalesce bursts of events into one snapshot.
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    broadcast('state', snapshot());
  }, 50);
}
setInterval(() => broadcast('state', snapshot()), 30_000); // keep decay moving
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 15_000);

// ---------- Public, read-only API (dashboard) ----------
app.get('/api/config', (_req, res) => {
  res.json({
    pets: PETS,
    actions: Object.fromEntries(
      Object.entries(ACTIONS).map(([id, a]) => [id, { ...a, cooldownSec: cooldownFor(id) }]),
    ),
    timezone: TIMEZONE,
    decayPerHour: HAPPINESS_DECAY_PER_HOUR,
    demoMode: DEMO_MODE,
  });
});

app.get('/api/state', (_req, res) => res.json(snapshot()));

app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  send(res, 'state', snapshot());
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// ---------- Device API (kiosks only — requires the device key) ----------
const device = express.Router();
device.use((req, res, next) => {
  const key = req.get('x-device-key');
  if (!key || key.length !== DEVICE_KEY.length ||
      !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(DEVICE_KEY))) {
    return res.status(401).json({ ok: false, error: 'bad_device_key', message: 'This device is not authorized.' });
  }
  req.deviceId = String(req.get('x-device-id') || 'kiosk').slice(0, 64);
  next();
});

const sessions = new Map(); // token -> { uid, petId, expires }
const newExpiry = () => Date.now() + SESSION_TTL_SEC * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t);
}, 10_000);

function cooldownsFor(uid) {
  const out = {};
  for (const id of Object.keys(ACTIONS)) out[id] = cooldownLeft(uid, id);
  return out;
}

// A student tapped their ID card on a pet's kiosk.
device.post('/tap', (req, res) => {
  const petId = req.body?.pet;
  const uid = normalizeUid(req.body?.uid);
  if (!PETS[petId]) return res.status(400).json({ ok: false, error: 'bad_pet' });
  if (!uid) return res.status(400).json({ ok: false, error: 'bad_uid' });

  const student = findStudent(uid);
  if (!student) {
    return res.status(404).json({
      ok: false, error: 'unknown_card', uid,
      message: 'This card is not registered yet. Ask an organizer to add it.',
    });
  }
  if (student.major !== petId) {
    const theirs = PETS[student.major];
    return res.status(403).json({
      ok: false, error: 'wrong_major', uid,
      student: { name: student.name, major: student.major },
      message: `${PETS[petId].name} belongs to ${PETS[petId].major}. Go visit ${theirs.name}, the ${theirs.major} pet!`,
    });
  }

  // Daily check-in is the first interaction of the day.
  let checkin = null;
  if (cooldownLeft(uid, 'checkin') === 0) {
    checkin = recordEvent({ petId, studentUid: uid, actionId: 'checkin', deviceId: req.deviceId });
    broadcastState();
  }

  const token = crypto.randomBytes(16).toString('hex');
  sessions.set(token, { uid, petId, expires: newExpiry() });
  res.json({
    ok: true,
    session: token,
    sessionTtlSec: SESSION_TTL_SEC,
    student: { name: student.name, major: student.major },
    checkin, // null if they already checked in today
    cooldowns: cooldownsFor(uid),
  });
});

// A student picked an action on the kiosk during their session.
device.post('/action', (req, res) => {
  const s = sessions.get(req.body?.session);
  if (!s || s.expires < Date.now()) {
    return res.status(401).json({ ok: false, error: 'session_expired', message: 'Tap your ID again.' });
  }
  const actionId = req.body?.action;
  const action = ACTIONS[actionId];
  if (!action || action.kiosk === false) return res.status(400).json({ ok: false, error: 'bad_action' });

  s.expires = newExpiry();
  const left = cooldownLeft(s.uid, actionId);
  if (left !== 0) {
    return res.status(429).json({
      ok: false, error: 'cooldown', secondsLeft: left, cooldowns: cooldownsFor(s.uid),
      message: `You can log "${action.label}" again in ${left}s.`,
    });
  }

  const event = recordEvent({ petId: s.petId, studentUid: s.uid, actionId, deviceId: req.deviceId });
  if (action.celebrate) {
    const student = findStudent(s.uid);
    broadcast('celebrate', { pet: s.petId, action: actionId, who: student.name.split(/\s+/)[0] });
  }
  broadcastState();
  res.json({ ok: true, event, celebrate: !!action.celebrate, cooldowns: cooldownsFor(s.uid) });
});

device.post('/end', (req, res) => {
  sessions.delete(req.body?.session);
  res.json({ ok: true });
});

// Seeded demo cards, so the kiosk can simulate taps on laptops without NFC.
device.get('/demo-cards', (_req, res) => {
  res.json(all('SELECT uid, name, major FROM students WHERE demo = 1 ORDER BY major, name'));
});

app.use('/api/device', device);

// ---------- Start ----------
const server = app.listen(PORT, () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\n  Spark Pets running  (db: ${path.relative(ROOT, DB_FILE)}${DEMO_MODE ? ', DEMO_MODE' : ''})`);
  console.log(`  Dashboard  : http://localhost:${PORT}/`);
  console.log(`  CS kiosk   : http://localhost:${PORT}/kiosk/?pet=cs&key=${DEVICE_KEY}`);
  console.log(`  DS kiosk   : http://localhost:${PORT}/kiosk/?pet=ds&key=${DEVICE_KEY}`);
  for (const ip of lan) console.log(`  On LAN     : http://${ip}:${PORT}/`);
  console.log('');
});

function shutdown() {
  saveNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
