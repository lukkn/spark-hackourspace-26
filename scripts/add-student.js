// Register a real NFC card:  npm run add-student -- <uid> <cs|ds> "Full Name"
// Tip: tap an unregistered card on a kiosk — it shows the uid to use here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [uid, major, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim();
if (!uid || !['cs', 'ds'].includes(major) || !name) {
  console.error('Usage: npm run add-student -- <uid> <cs|ds> "Full Name"');
  process.exit(1);
}
const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'students.json');
const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
const norm = (u) => String(u).toUpperCase().replace(/[^0-9A-Z]/g, '');
const existing = list.find((s) => norm(s.uid) === norm(uid));
if (existing) Object.assign(existing, { name, major });
else list.push({ uid, name, major });
fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
console.log(`${existing ? 'Updated' : 'Added'} ${name} (${major}) -> ${uid}. Restart the server to load it.`);
