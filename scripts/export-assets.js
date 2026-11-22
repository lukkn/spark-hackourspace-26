// Writes static SVGs of every pet/mood to public/assets (for slides, stickers, README).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPet } from '../public/shared/pets.js';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
fs.mkdirSync(out, { recursive: true });
for (const pet of ['cs', 'ds']) {
  for (const mood of ['ecstatic', 'happy', 'okay', 'sad', 'gloomy']) {
    fs.writeFileSync(path.join(out, `${pet}-${mood}.svg`), renderPet(pet, mood));
  }
  fs.writeFileSync(path.join(out, `${pet}-celebrate.svg`), renderPet(pet, 'ecstatic', { celebrate: true }));
}
console.log('Wrote pet SVGs to', out);
