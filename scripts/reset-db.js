// Wipe all activity (stop the server first):  npm run reset
import fs from 'node:fs';
import { DB_FILE } from '../server/db.js';
fs.rmSync(DB_FILE, { force: true });
console.log('Deleted', DB_FILE, '- students reload from data/students.json on next start.');
