// Game rules: happiness decay, awarding points, cooldowns and stats snapshots.
import { all, get, run, lastInsertId } from './db.js';
import {
  ACTIONS, PETS, TIMEZONE, HAPPINESS_DECAY_PER_HOUR, cooldownFor, levelInfo, moodFor,
} from './config.js';

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
export const dayKey = (ms = Date.now()) => dayFmt.format(new Date(ms)); // YYYY-MM-DD

function decayed(row, now = Date.now()) {
  const hours = Math.max(0, now - row.happiness_at) / 3_600_000;
  return Math.max(0, Math.min(100, row.happiness - hours * HAPPINESS_DECAY_PER_HOUR));
}

export function currentHappiness(petId) {
  return decayed(get('SELECT * FROM pets WHERE id = ?', [petId]));
}

export function findStudent(uid) {
  return get('SELECT * FROM students WHERE uid = ?', [uid]);
}

/** Seconds until the student may do this action again for this pet (0 = allowed). */
export function cooldownLeft(studentUid, actionId, now = Date.now()) {
  const action = ACTIONS[actionId];
  if (action.oncePerDay) {
    const done = get('SELECT 1 AS x FROM events WHERE student_uid = ? AND action = ? AND day = ?', [
      studentUid, actionId, dayKey(now),
    ]);
    return done ? -1 : 0; // -1 => "already done today"
  }
  const cd = cooldownFor(actionId);
  if (!cd) return 0;
  const last = get(
    'SELECT MAX(created_at) AS t FROM events WHERE student_uid = ? AND action = ?',
    [studentUid, actionId],
  );
  if (!last?.t) return 0;
  return Math.max(0, Math.ceil((last.t + cd * 1000 - now) / 1000));
}

/** Records an interaction and bumps the pet's happiness. Returns the event. */
export function recordEvent({ petId, studentUid, actionId, deviceId }) {
  const action = ACTIONS[actionId];
  const now = Date.now();
  const before = currentHappiness(petId);
  const after = Math.min(100, before + action.happiness);
  run('UPDATE pets SET happiness = ?, happiness_at = ? WHERE id = ?', [after, now, petId]);
  run(
    `INSERT INTO events (pet_id, student_uid, action, points, happiness_delta, device_id, created_at, day)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [petId, studentUid, actionId, action.points, after - before, deviceId || null, now, dayKey(now)],
  );
  return { id: lastInsertId(), petId, action: actionId, points: action.points, happiness: after, at: now };
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'Someone';
}

/** Full read-only snapshot used by the dashboard (and kiosks for display). */
export function snapshot() {
  const now = Date.now();
  const today = dayKey(now);
  const weekDays = [];
  for (let i = 6; i >= 0; i--) weekDays.push(dayKey(now - i * 86_400_000));

  const totals = all('SELECT pet_id, action, COUNT(*) AS n, SUM(points) AS pts FROM events GROUP BY pet_id, action');
  const todays = all(
    'SELECT pet_id, action, COUNT(*) AS n, SUM(points) AS pts FROM events WHERE day = ? GROUP BY pet_id, action',
    [today],
  );
  const visitors = all(
    'SELECT pet_id, COUNT(DISTINCT student_uid) AS today FROM events WHERE day = ? GROUP BY pet_id',
    [today],
  );
  const allVisitors = all('SELECT pet_id, COUNT(DISTINCT student_uid) AS n FROM events GROUP BY pet_id');
  const week = all(
    'SELECT pet_id, day, SUM(points) AS pts, COUNT(*) AS n FROM events WHERE day >= ? GROUP BY pet_id, day',
    [weekDays[0]],
  );
  const recent = all(
    `SELECT e.id, e.pet_id, e.action, e.points, e.created_at, s.name
       FROM events e LEFT JOIN students s ON s.uid = e.student_uid
      ORDER BY e.id DESC LIMIT 20`,
  );
  const petRows = all('SELECT * FROM pets');

  const pets = {};
  for (const pet of Object.values(PETS)) {
    const row = petRows.find((r) => r.id === pet.id);
    const happiness = decayed(row, now);
    const actions = {};
    let points = 0;
    let pointsToday = 0;
    for (const id of Object.keys(ACTIONS)) {
      const t = totals.find((r) => r.pet_id === pet.id && r.action === id);
      const d = todays.find((r) => r.pet_id === pet.id && r.action === id);
      actions[id] = { total: t?.n || 0, today: d?.n || 0 };
      points += t?.pts || 0;
      pointsToday += d?.pts || 0;
    }
    pets[pet.id] = {
      ...pet,
      happiness: Math.round(happiness * 10) / 10,
      mood: moodFor(happiness),
      points,
      pointsToday,
      level: levelInfo(points),
      visitorsToday: visitors.find((r) => r.pet_id === pet.id)?.today || 0,
      visitorsTotal: allVisitors.find((r) => r.pet_id === pet.id)?.n || 0,
      interactionsToday: Object.values(actions).reduce((a, x) => a + x.today, 0),
      interactionsTotal: Object.values(actions).reduce((a, x) => a + x.total, 0),
      actions,
      week: weekDays.map((day) => {
        const w = week.find((r) => r.pet_id === pet.id && r.day === day);
        return { day, points: w?.pts || 0, interactions: w?.n || 0 };
      }),
    };
  }

  return {
    generatedAt: now,
    today,
    pets,
    recent: recent.map((r) => ({
      id: r.id,
      pet: r.pet_id,
      action: r.action,
      points: r.points,
      at: r.created_at,
      who: firstName(r.name), // first names only on the public screen
    })),
  };
}
