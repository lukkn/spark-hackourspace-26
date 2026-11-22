# Spark Pets 🐾

Two physical-digital pets live in the Spark space, one per major:

| Pet | Major | Who |
|---|---|---|
| **Byte** | Computer Science | a teal pocket robot |
| **Sigma** | Data Science | a purple data owl |

Each pet lives on a **kiosk** (a tablet, phone or laptop). Students tap their **NFC student ID**
to check in and log what they've done. Every interaction makes the pet happier and earns points,
and gets stored in a database. A **read-only web dashboard** shows both pets and their stats live.

```
 ┌──────────── kiosk (CS) ───────┐                    ┌──── dashboard (view only) ───┐
 │ NFC tap → check-in → actions  │──POST /api/device──▶│ GET /api/stream (live SSE)   │
 └───────────────────────────────┘   (device key)  │   │ pets · happiness · counts    │
 ┌──────────── kiosk (DS) ───────┐                 ▼   └──────────────────────────────┘
 │ NFC tap → check-in → actions  │──────────▶  Node server  ──▶  SQLite (data/spark.db)
 └───────────────────────────────┘
```

## Run it

```powershell
npm install
npm start          # or: npm run demo   (cooldowns cut to 3s for live demos)
```

The console prints the links:

- Dashboard: <http://localhost:3000/>
- CS kiosk: <http://localhost:3000/kiosk/?pet=cs&key=spark-dev-key>
- DS kiosk: <http://localhost:3000/kiosk/?pet=ds&key=spark-dev-key>

A kiosk remembers its pet and key after the first visit, so you can bookmark `/kiosk/`.
No NFC reader? Click **Demo cards** in the corner of a kiosk to fake a tap with a seeded student.

Other scripts: `npm test` (API smoke test on a temporary DB), `npm run reset` (wipe activity),
`npm run export-assets` (regenerate pet SVGs), `npm run add-student`.

## Rules

- A student can only interact with **their own major's pet**. Tapping the other kiosk shows a
  "wrong pet" screen pointing them to the right one.
- **The first tap each day is a check-in** (+10). Later taps that day open a session without awarding it again.
- During a session (90s, renewed on every action) the student logs actions:

| Action | Points | Tier | Cooldown |
|---|---|---|---|
| 👋 Check in (on tap) | 10 | small | once a day |
| 🫶 Pet & play | 2 | small | 20s |
| 🍪 Shared a snack | 3 | small | 1m |
| 📝 Finished an assignment | 25 | medium | 5m |
| 🤝 Met someone new in Spark | 25 | medium | 5m |
| 🙌 Helped a classmate | 20 | medium | 5m |
| 🎤 Went to a Spark event | 20 | medium | 10m |
| 🚀 **Shipped a product** | 100 | large | 30m, **triggers a celebration** on the kiosk and dashboard |

- **Happiness** (0–100) goes up with each action and drains about 4 points per hour, so the pet's
  mood (over the moon → happy → okay → lonely → misses you) shows how recently people visited.
- **Level** is based on all-time points: Lv 2 at 100, Lv 3 at 300, Lv 4 at 600, and so on.

All numbers live in [server/config.js](server/config.js).

## Dashboard

Read-only by design: it has no device key and calls only `GET` endpoints. It shows, for each pet:
- live pet art (mood animations, party when someone ships)
- happiness, level/XP, points (all-time and today), students today, interactions today
- **the count of every interaction type, for today and all-time**
- a 7-day points chart (hover for values, or open the table view), today's CS-vs-DS rivalry bar, and a live activity feed (first names only)

## NFC

The kiosk takes card taps three ways:

1. **Web NFC** (Chrome on Android). Tap **Enable phone NFC reader** once. The tag's serial number is the
   student's id (or a text record such as `student:1234`). Web NFC only works over **HTTPS or localhost**.
   For a phone on the LAN, either run `adb reverse tcp:3000 tcp:3000` and open `http://localhost:3000/kiosk/...`
   on the phone, or put the server behind an HTTPS tunnel.
2. **USB readers in keyboard mode** (they type the card id and press Enter). These work on any kiosk with no setup.
3. **Demo cards** for testing without hardware.

**Registering cards:** tap an unregistered card and the kiosk shows its id. Then run:

```powershell
npm run add-student -- 04:A2:3B:11:22:33:44 cs "Ada Lovelace"
```

Restart the server to load it. The roster is [data/students.json](data/students.json), and ids are
matched case- and separator-insensitively.

## Configuration (env vars)

| Var | Default | |
|---|---|---|
| `PORT` | 3000 | |
| `DEVICE_KEY` | `spark-dev-key` | **change this for a real event**; kiosks need it to write |
| `DEMO_MODE` | off | `1` caps cooldowns at 3s |
| `TZ_NAME` | `America/New_York` | timezone for "today" |
| `HAPPINESS_DECAY_PER_HOUR` | 4 | |
| `DB_FILE` | `data/spark.db` | |

## Layout

```
server/      index.js (API + SSE), game.js (rules/stats), db.js (SQLite via sql.js), config.js
public/
  kiosk/     local-device app (NFC, actions, celebrations)
  dashboard/ read-only live stats
  shared/    pets.js (parametric SVG pets), pets.css (animations), confetti.js
  assets/    exported pet SVGs + mood sheet at /assets/
data/        students.json (roster); spark.db is created at runtime
scripts/     smoke-test, add-student, reset-db, export-assets
```

The database uses `sql.js` (SQLite compiled to WebAssembly), so there's no native build step on any OS.
To move it to a hosted database (Supabase, Firebase and similar), swap out `server/db.js`. The kiosks and
dashboard only talk to the HTTP API.
