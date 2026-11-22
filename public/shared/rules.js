// Game configuration and pure rules, shared by the kiosk and the dashboard.
// Tweak points, cooldowns and happiness here.

export const TIMEZONE = 'America/New_York'; // "today" boundaries
export const HAPPINESS_DECAY_PER_HOUR = 4;
export const STARTING_HAPPINESS = 60;
export const SESSION_TTL_SEC = 90;

export const PETS = {
  cs: { id: 'cs', name: 'Byte', species: 'pocket robot', major: 'Computer Science', short: 'CS', color: '#22b8a7' },
  ds: { id: 'ds', name: 'Sigma', species: 'data owl', major: 'Data Science', short: 'DS', color: '#8b5cf6' },
};

// tier: small | medium | large. `celebrate` triggers the party animation.
// `kiosk: false` means it isn't a button (check-in happens on the ID tap).
export const ACTIONS = {
  checkin: { label: 'Checked in', emoji: '👋', points: 10, happiness: 6, tier: 'small', cooldownSec: 0, oncePerDay: true, kiosk: false },
  pet: { label: 'Pet & play', emoji: '🫶', points: 2, happiness: 3, tier: 'small', cooldownSec: 20 },
  snack: { label: 'Shared a snack', emoji: '🍪', points: 3, happiness: 4, tier: 'small', cooldownSec: 60 },
  assignment: { label: 'Finished an assignment', emoji: '📝', points: 25, happiness: 12, tier: 'medium', cooldownSec: 300 },
  met_someone: { label: 'Met someone new in Spark', emoji: '🤝', points: 25, happiness: 12, tier: 'medium', cooldownSec: 300 },
  helped: { label: 'Helped a classmate', emoji: '🙌', points: 20, happiness: 10, tier: 'medium', cooldownSec: 300 },
  event: { label: 'Went to a Spark event', emoji: '🎤', points: 20, happiness: 10, tier: 'medium', cooldownSec: 600 },
  shipped: { label: 'Shipped a product', emoji: '🚀', points: 100, happiness: 35, tier: 'large', cooldownSec: 1800, celebrate: true },
};

// Demo mode (kiosk opened with ?demo=1) caps cooldowns at 3s for live demos.
export function cooldownFor(actionId, demo = false) {
  const base = ACTIONS[actionId]?.cooldownSec ?? 0;
  return demo ? Math.min(base, 3) : base;
}

// Level n starts at 50*n*(n-1) points: 0, 100, 300, 600, 1000, 1500...
export function levelInfo(points) {
  let level = 1;
  while (50 * (level + 1) * level <= points) level++;
  const floor = 50 * level * (level - 1);
  const next = 50 * (level + 1) * level;
  return { level, floor, next, progress: (points - floor) / (next - floor) };
}

export function moodFor(happiness) {
  if (happiness >= 80) return 'ecstatic';
  if (happiness >= 55) return 'happy';
  if (happiness >= 30) return 'okay';
  if (happiness >= 12) return 'sad';
  return 'gloomy';
}

export function decayedHappiness(happiness, happinessAt, now = Date.now()) {
  const hours = Math.max(0, now - happinessAt) / 3_600_000;
  return Math.max(0, Math.min(100, happiness - hours * HAPPINESS_DECAY_PER_HOUR));
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = (ms = Date.now()) => dayFmt.format(new Date(ms)); // YYYY-MM-DD

// NFC readers report ids as "04:a2:3b:..", "04A23B..", or decimal; compare on
// uppercase alphanumerics only.
export const normalizeUid = (uid) => String(uid || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Someone';

// Seeded demo students so the kiosk's "Demo cards" work without hardware.
export const DEMO_STUDENTS = [
  { uid: '04A1CS000001', name: 'Ada Lovelace', major: 'cs' },
  { uid: '04A1CS000002', name: 'Alan Turing', major: 'cs' },
  { uid: '04A1CS000003', name: 'Grace Hopper', major: 'cs' },
  { uid: '04B2DS000001', name: 'Florence Nightingale', major: 'ds' },
  { uid: '04B2DS000002', name: 'John Tukey', major: 'ds' },
  { uid: '04B2DS000003', name: 'Hadley Wickham', major: 'ds' },
];
