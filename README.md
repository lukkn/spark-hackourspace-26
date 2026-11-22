# Spark Pets 🐾

Two physical-digital pets live in the Spark space, one per major:

| Pet | Major | Who |
|---|---|---|
| **Byte** | Computer Science | a teal pocket robot |
| **Sigma** | Data Science | a purple data owl |

Each pet lives on a **kiosk** (a phone, tablet or laptop). Students tap their **NFC student ID**
to check in and log what they've done. Every interaction makes the pet happier, earns points and
is saved to **Firestore**. A **read-only dashboard** shows both pets and their stats live.

**Live:** dashboard <https://spark-pets-hackourspace.web.app/> ·
kiosks <https://spark-pets-hackourspace.web.app/kiosk/?pet=cs> and `…/kiosk/?pet=ds`

```
 ┌─ kiosk (CS) ─┐  signed in as the kiosk account   ┌──────────────┐   live listeners   ┌─ dashboard ─┐
 │ NFC → actions│ ─────────────────────────────────▶ │  Firestore   │ ─────────────────▶ │  view only  │
 └──────────────┘          (password)                │ (rules gate  │   (no sign-in,     └─────────────┘
 ┌─ kiosk (DS) ─┐ ─────────────────────────────────▶ │  all writes) │    read-only)
 └──────────────┘                                    └──────────────┘
          everything is static files on Firebase Hosting (HTTPS, so phone NFC works)
```

## Firebase setup

Project: `spark-pets-hackourspace` (free Spark plan: Hosting, Firestore, Auth; no Cloud Functions needed).

One-time console steps (already done for the live project, except where noted):

1. **Authentication → Sign-in method → Email/Password → Enable.**
2. **Authentication → Users → Add user**: email `kiosk@spark-pets.app`, password = **the kiosk password**.
   To change the password later, reset it on that user.
3. Optional hardening: **Authentication → Settings → User actions**: untick *Enable create (sign-up)* so
   nobody can create other accounts. (They couldn't write anyway; the rules only trust the kiosk email.)

Deploy after changes:

```powershell
npx firebase deploy --only hosting,firestore
```

Run locally (uses the same live Firestore): `npm run dev`, then open <http://localhost:5000/>.

## Using a kiosk

1. Open `/kiosk/?pet=cs` (or `ds`) on the device, choose the pet, and enter the kiosk password.
   The device stays unlocked until someone presses **Lock kiosk** (in the Demo cards panel).
2. **Android phone:** in Chrome, tap **Enable phone NFC reader**, then hold a card to the back of the phone.
3. Add `?demo=1` to the kiosk URL to cap cooldowns at 3 seconds for live demos (`?demo=0` turns it off).
4. **Registering a real card:** tap it. The kiosk shows "Card not registered" and its id. Press
   **Organizer: register this card**, enter the name, major and the kiosk password.
5. No reader? **Demo cards** in the corner fakes taps with six seeded students (3 CS, 3 DS).

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

- **Happiness** (0–100) goes up with each action and drains about 4 points per hour.
- **Level** is based on all-time points: Lv 2 at 100, Lv 3 at 300, Lv 4 at 600, and so on.

All numbers live in [public/shared/rules.js](public/shared/rules.js).

## Security model

- [firestore.rules](firestore.rules): anyone may **read** `pets`, `days` and `events` (the dashboard).
  Only the signed-in `kiosk@spark-pets.app` account may **write**, or read `students` and `activity`.
  Event documents are append-only and checked for valid pets, actions and point ranges.
- The game rules (major lock, cooldowns, once-a-day check-in) run in the kiosk page inside a Firestore
  transaction. Anyone who has the kiosk password is trusted. Moving that logic into Cloud Functions
  would need the paid Blaze plan.
- The dashboard shows first names only. Card ids and full names stay in kiosk-only collections.

## Data model (Firestore)

| Collection | Doc | Fields |
|---|---|---|
| `pets` | `cs`, `ds` | happiness, happinessAt, points, counts{action} |
| `days` | `YYYY-MM-DD_pet` | day, pet, points, counts{action} |
| `events` | auto | pet, action, points, who, at, day, device |
| `students` | card id | name, major, demo |
| `activity` | card id | checkinDay, last{action: ms} |

## Layout

```
public/
  kiosk/       local-device app (login, NFC, actions, card registration, celebrations)
  dashboard/   read-only live stats
  shared/      rules.js (game config), data.js (Firestore + Auth), firebase-config.js,
               pets.js (parametric SVG pets), pets.css (animations), confetti.js
  assets/      exported pet SVGs + mood sheet at /assets/
firestore.rules, firebase.json, .firebaserc
scripts/export-assets.js   regenerate the SVGs (npm run export-assets)
```
