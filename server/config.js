// Central game configuration: pets, actions, points and timing.
// Tweak numbers here — both the kiosk and dashboard read them from /api/config.

export const PORT = Number(process.env.PORT || 3000);

// Shared secret the kiosks send with every write. The dashboard never has it,
// so the web app physically cannot interact with the pets.
export const DEVICE_KEY = process.env.DEVICE_KEY || 'spark-dev-key';

// Day boundaries ("today" stats) are computed in this timezone.
export const TIMEZONE = process.env.TZ_NAME || 'America/New_York';

// DEMO_MODE=1 shrinks cooldowns to a few seconds so judges can mash buttons.
export const DEMO_MODE = process.env.DEMO_MODE === '1' || process.argv.includes('--demo');

// Happiness slowly drains so the pets need regular visits.
export const HAPPINESS_DECAY_PER_HOUR = Number(process.env.HAPPINESS_DECAY_PER_HOUR || 4);
export const STARTING_HAPPINESS = 60;

// How long a kiosk session lasts after an ID tap (seconds of inactivity).
export const SESSION_TTL_SEC = 90;

export const PETS = {
  cs: {
    id: 'cs',
    name: 'Byte',
    species: 'pocket robot',
    major: 'Computer Science',
    short: 'CS',
    color: '#22b8a7',
  },
  ds: {
    id: 'ds',
    name: 'Sigma',
    species: 'data owl',
    major: 'Data Science',
    short: 'DS',
    color: '#8b5cf6',
  },
};

// tier: small | medium | large. `celebrate` triggers the party animation.
// `kiosk: false` means the action is not a button (check-in happens on tap).
export const ACTIONS = {
  checkin: {
    label: 'Checked in',
    emoji: '👋',
    points: 10,
    happiness: 6,
    tier: 'small',
    cooldownSec: 0,
    oncePerDay: true,
    kiosk: false,
  },
  pet: {
    label: 'Pet & play',
    emoji: '🫶',
    points: 2,
    happiness: 3,
    tier: 'small',
    cooldownSec: 20,
  },
  snack: {
    label: 'Shared a snack',
    emoji: '🍪',
    points: 3,
    happiness: 4,
    tier: 'small',
    cooldownSec: 60,
  },
  assignment: {
    label: 'Finished an assignment',
    emoji: '📝',
    points: 25,
    happiness: 12,
    tier: 'medium',
    cooldownSec: 300,
  },
  met_someone: {
    label: 'Met someone new in Spark',
    emoji: '🤝',
    points: 25,
    happiness: 12,
    tier: 'medium',
    cooldownSec: 300,
  },
  helped: {
    label: 'Helped a classmate',
    emoji: '🙌',
    points: 20,
    happiness: 10,
    tier: 'medium',
    cooldownSec: 300,
  },
  event: {
    label: 'Went to a Spark event',
    emoji: '🎤',
    points: 20,
    happiness: 10,
    tier: 'medium',
    cooldownSec: 600,
  },
  shipped: {
    label: 'Shipped a product',
    emoji: '🚀',
    points: 100,
    happiness: 35,
    tier: 'large',
    cooldownSec: 1800,
    celebrate: true,
  },
};

export function cooldownFor(actionId) {
  const base = ACTIONS[actionId]?.cooldownSec ?? 0;
  return DEMO_MODE ? Math.min(base, 3) : base;
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
