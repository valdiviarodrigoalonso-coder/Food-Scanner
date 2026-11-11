// Dev helper: regex search over library names. Usage: node tools/grep.mjs "^Egg, whole" ...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = JSON.parse(fs.readFileSync(path.join(root, 'data', 'foods.json'), 'utf8'));
const limit = Number(process.env.LIMIT || 6);
for (const pat of process.argv.slice(2)) {
  const re = new RegExp(pat, 'i');
  const hits = db.foods.filter((f) => re.test(f[1])).sort((a, b) => a[1].length - b[1].length).slice(0, limit);
  console.log(`## /${pat}/`);
  for (const f of hits) console.log(`${String(f[0]).padStart(8)} ${f[2]} | ${f[1]} | ${f[4]}kcal P${f[5]} C${f[6]} F${f[7]} Na${f[11]} K${f[12]} | ${(f[14] || []).slice(0, 3).map((x) => x[0] + '=' + x[1]).join('; ')}`);
}
