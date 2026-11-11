// Dev helper: search the built-in library from the command line.
// Usage: node tools/find.mjs "chicken breast" ["second query" ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDB, searchDB } from '../js/fooddb.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
initDB(JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8')));
const limit = Number(process.env.LIMIT || 8);
for (const q of process.argv.slice(2)) {
  console.log(`\n## ${q}`);
  for (const f of searchDB(q, limit)) {
    const p = f.per100;
    console.log(`${f.id.slice(5).padStart(8)} ${f.source.slice(5)} | ${f.name} | ${p.kcal} kcal P${p.protein} C${p.carbs} F${p.fat} Na${p.sodium} K${p.potassium} | ${f.portions.slice(0, 2).map((x) => `${x.label}=${x.grams}g`).join('; ')}`);
  }
}
