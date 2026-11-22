// Firestore data layer.
//
//   pets/{cs|ds}        { happiness, happinessAt, points, counts: {action: n} }   public read
//   days/{day}_{pet}    { day, pet, points, counts: {action: n} }                 public read
//   events/{auto}       { pet, action, points, who (first name), at, day }        public read
//   students/{uid}      { name, major, demo }                                     kiosk only
//   activity/{uid}      { checkinDay, last: {action: ms} }                        kiosk only
//
// Only the signed-in kiosk account can write (see firestore.rules).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, onSnapshot, query, where, orderBy, limit,
  runTransaction, increment,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, reauthenticateWithCredential, EmailAuthProvider,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { firebaseConfig, KIOSK_EMAIL } from './firebase-config.js';
import {
  PETS, ACTIONS, STARTING_HAPPINESS, DEMO_STUDENTS, cooldownFor, levelInfo, moodFor, decayedHappiness, dayKey,
  firstName, normalizeUid,
} from './rules.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ---------------------------------------------------------------- Reading
/**
 * Subscribes to live pet stats. Calls onState(snapshot) on every change and
 * every 30s (so happiness decay keeps moving), and onEvent(event) for each
 * event that arrives after the initial load. Returns an unsubscribe function.
 */
export function listenState(onState, { onEvent, onError } = {}) {
  const raw = { pets: {}, days: [], events: [] };
  const ready = { pets: false, days: false, events: false };
  const seen = new Set();
  let firstEvents = true;
  let unsubDays = null;
  let daysFrom = null;

  const emit = () => { if (ready.pets && ready.days && ready.events) onState(buildSnapshot(raw)); };
  const err = (e) => { console.error(e); onError?.(e); };

  const unsubPets = onSnapshot(collection(db, 'pets'), (snap) => {
    raw.pets = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
    ready.pets = true;
    emit();
  }, err);

  function subscribeDays() {
    daysFrom = dayKey(Date.now() - 7 * 86_400_000);
    unsubDays?.();
    unsubDays = onSnapshot(query(collection(db, 'days'), where('day', '>=', daysFrom)), (snap) => {
      raw.days = snap.docs.map((d) => d.data());
      ready.days = true;
      emit();
    }, err);
  }
  subscribeDays();

  const unsubEvents = onSnapshot(query(collection(db, 'events'), orderBy('at', 'desc'), limit(20)), (snap) => {
    raw.events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    for (const e of raw.events) {
      if (!seen.has(e.id) && !firstEvents) onEvent?.(e);
      seen.add(e.id);
    }
    firstEvents = false;
    ready.events = true;
    emit();
  }, err);

  const timer = setInterval(() => {
    if (dayKey(Date.now() - 7 * 86_400_000) !== daysFrom) subscribeDays(); // midnight rollover
    emit();
  }, 30_000);

  return () => { unsubPets(); unsubDays?.(); unsubEvents(); clearInterval(timer); };
}

function buildSnapshot(raw, now = Date.now()) {
  const today = dayKey(now);
  const weekDays = [];
  for (let i = 6; i >= 0; i--) weekDays.push(dayKey(now - i * 86_400_000));

  const pets = {};
  for (const pet of Object.values(PETS)) {
    const p = raw.pets[pet.id] || {};
    const happiness = p.happinessAt ? decayedHappiness(p.happiness, p.happinessAt, now) : STARTING_HAPPINESS;
    const todayDoc = raw.days.find((d) => d.pet === pet.id && d.day === today) || {};
    const actions = {};
    for (const id of Object.keys(ACTIONS)) {
      actions[id] = { total: p.counts?.[id] || 0, today: todayDoc.counts?.[id] || 0 };
    }
    const points = p.points || 0;
    pets[pet.id] = {
      ...pet,
      happiness: Math.round(happiness * 10) / 10,
      mood: moodFor(happiness),
      points,
      pointsToday: todayDoc.points || 0,
      level: levelInfo(points),
      visitorsToday: actions.checkin.today, // check-in is once per student per day
      interactionsToday: Object.values(actions).reduce((a, x) => a + x.today, 0),
      interactionsTotal: Object.values(actions).reduce((a, x) => a + x.total, 0),
      actions,
      week: weekDays.map((day) => {
        const d = raw.days.find((x) => x.pet === pet.id && x.day === day);
        return { day, points: d?.points || 0, interactions: Object.values(d?.counts || {}).reduce((a, n) => a + n, 0) };
      }),
    };
  }
  return {
    generatedAt: now,
    today,
    pets,
    recent: raw.events.map((e) => ({ id: e.id, pet: e.pet, action: e.action, points: e.points, at: e.at, who: e.who })),
  };
}

// ---------------------------------------------------------------- Kiosk auth
export const onKioskAuth = (cb) => onAuthStateChanged(auth, (user) => cb(user?.email === KIOSK_EMAIL ? user : null));

export async function kioskLogin(password) {
  try {
    await signInWithEmailAndPassword(auth, KIOSK_EMAIL, password);
    return { ok: true };
  } catch (e) {
    const map = {
      'auth/invalid-credential': 'Wrong password.',
      'auth/wrong-password': 'Wrong password.',
      'auth/user-not-found': 'The kiosk account does not exist yet (see README).',
      'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
      'auth/network-request-failed': 'Could not reach Firebase.',
      'auth/operation-not-allowed': 'Email/password sign-in is not enabled in Firebase yet.',
    };
    return { ok: false, message: map[e.code] || e.message };
  }
}

export const kioskLogout = () => signOut(auth);

async function confirmPassword(password) {
  try {
    await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(KIOSK_EMAIL, password));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Kiosk writes
export async function seedDemoStudents() {
  const first = await getDoc(doc(db, 'students', DEMO_STUDENTS[0].uid));
  if (first.exists()) return;
  await Promise.all(DEMO_STUDENTS.map((s) => setDoc(doc(db, 'students', s.uid), { name: s.name, major: s.major, demo: true })));
}

export async function demoCards() {
  const snap = await getDocs(query(collection(db, 'students'), where('demo', '==', true)));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => a.major.localeCompare(b.major) || a.name.localeCompare(b.name));
}

/** Organizer flow: register an unknown card. Requires re-entering the kiosk password. */
export async function registerCard({ uid, name, major, password }) {
  if (!(await confirmPassword(password))) return { ok: false, message: 'Wrong password.' };
  const id = normalizeUid(uid);
  if (!id || !name.trim() || !PETS[major]) return { ok: false, message: 'Fill in every field.' };
  await setDoc(doc(db, 'students', id), { name: name.trim(), major, demo: false });
  return { ok: true };
}

async function cooldownsFor(uid, demo, activity) {
  const a = activity ?? (await getDoc(doc(db, 'activity', uid))).data() ?? {};
  const now = Date.now();
  const out = {};
  for (const id of Object.keys(ACTIONS)) {
    if (ACTIONS[id].oncePerDay) { out[id] = a.checkinDay === dayKey(now) ? -1 : 0; continue; }
    const last = a.last?.[id];
    const cd = cooldownFor(id, demo);
    out[id] = last && cd ? Math.max(0, Math.ceil((last + cd * 1000 - now) / 1000)) : 0;
  }
  return out;
}

/** Writes one interaction atomically. Throws {code:'cooldown', secondsLeft} if not allowed yet. */
async function recordEvent({ petId, uid, name, actionId, demo, deviceId }) {
  const action = ACTIONS[actionId];
  const petRef = doc(db, 'pets', petId);
  const actRef = doc(db, 'activity', uid);
  return runTransaction(db, async (tx) => {
    const [petSnap, actSnap] = await Promise.all([tx.get(petRef), tx.get(actRef)]);
    const now = Date.now();
    const day = dayKey(now);
    const left = (await cooldownsFor(uid, demo, actSnap.data() || {}))[actionId];
    if (left !== 0) throw Object.assign(new Error('cooldown'), { code: 'cooldown', secondsLeft: left });

    const p = petSnap.data();
    const before = p?.happinessAt ? decayedHappiness(p.happiness, p.happinessAt, now) : STARTING_HAPPINESS;
    const after = Math.min(100, before + action.happiness);
    const counts = { [actionId]: increment(1) };

    tx.set(petRef, { happiness: after, happinessAt: now, points: increment(action.points), counts }, { merge: true });
    tx.set(doc(db, 'days', `${day}_${petId}`), { day, pet: petId, points: increment(action.points), counts }, { merge: true });
    tx.set(doc(collection(db, 'events')), {
      pet: petId, action: actionId, points: action.points, who: firstName(name), at: now, day, device: deviceId,
    });
    tx.set(actRef, { last: { [actionId]: now }, ...(action.oncePerDay ? { checkinDay: day } : {}) }, { merge: true });
    return { action: actionId, points: action.points, happiness: after, at: now };
  });
}

/** A student tapped their card on a kiosk. */
export async function tap({ petId, rawUid, demo, deviceId }) {
  const uid = normalizeUid(rawUid);
  if (!uid) return { ok: false, error: 'bad_uid' };
  const snap = await getDoc(doc(db, 'students', uid));
  if (!snap.exists()) {
    return { ok: false, error: 'unknown_card', uid, message: 'This card is not registered yet. Ask an organizer to add it.' };
  }
  const student = snap.data();
  if (student.major !== petId) {
    const theirs = PETS[student.major];
    return {
      ok: false, error: 'wrong_major', uid, student,
      message: `${PETS[petId].name} belongs to ${PETS[petId].major}. Go visit ${theirs.name}, the ${theirs.major} pet!`,
    };
  }
  let checkin = null;
  try {
    checkin = await recordEvent({ petId, uid, name: student.name, actionId: 'checkin', demo, deviceId });
  } catch (e) {
    if (e.code !== 'cooldown') throw e; // already checked in today
  }
  return { ok: true, uid, student, checkin, cooldowns: await cooldownsFor(uid, demo) };
}

/** A student logged an action during their kiosk session. */
export async function logAction({ petId, uid, name, actionId, demo, deviceId }) {
  const action = ACTIONS[actionId];
  if (!action || action.kiosk === false) return { ok: false, message: 'Unknown action.' };
  try {
    const event = await recordEvent({ petId, uid, name, actionId, demo, deviceId });
    return { ok: true, event, celebrate: !!action.celebrate, cooldowns: await cooldownsFor(uid, demo) };
  } catch (e) {
    if (e.code === 'cooldown') {
      return {
        ok: false, error: 'cooldown', secondsLeft: e.secondsLeft, cooldowns: await cooldownsFor(uid, demo),
        message: `You can log "${action.label}" again in ${e.secondsLeft}s.`,
      };
    }
    throw e;
  }
}
