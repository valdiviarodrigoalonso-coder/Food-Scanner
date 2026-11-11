# Sidekick

A food scanner and nutrition tracker for anyone who wants to know what they eat. No subscription, no ads, no account.
Everything you log stays on your phone.

## What it does

- **Food log** by meal (breakfast, lunch, dinner, snacks) with calories, protein, carbs, fat,
  sodium, potassium, fiber, sugar, saturated fat, cholesterol and water.
- **13,598 foods built in**, copied straight from USDA FoodData Central. Works offline.
  Search in English or Spanish ("pollo", "camote", "arroz").
- **Barcode scanner** using the phone camera. Looks the product up in Open Food Facts
  (3M+ products) and the USDA branded database, then you type grams or ounces.
- **Meals**: save the ingredients of something you make often and log it in one tap.
- **Peruvian dishes**: 30 home dishes with plate-size buttons.
- **Metric / imperial** switch in Settings.
- **Four animal coaches** to pick from at the start (and switch any time in Settings): Paco the Llama
  (easygoing), Leo the Lion (tough love), Olive the Owl (analytical) and Zorro the Fox (playful).
  Same numbers, different voice. Their lines live in `js/coach.js`.
- **Streaks, badges, goal-date countdown, weight trend, weekly averages.**

## Putting it on your iPhone

The app is a website that installs to the Home Screen. The camera only works when the site is
served over **https**, so it has to be hosted somewhere (free options: GitHub Pages, Netlify,
Cloudflare Pages). Once it is hosted:

1. Open the address in **Safari** on the iPhone.
2. Tap **Share** → **Add to Home Screen**.
3. Open Sidekick from the Home Screen and allow camera access the first time you scan.

After that it opens full screen like a normal app and works without signal (scanning new
products still needs internet).

## Free USDA key (recommended, 2 minutes)

Without a key the USDA branded database only allows about 10 lookups an hour.

1. Go to <https://fdc.nal.usda.gov/api-key-signup> and fill in the form.
2. The key arrives by email.
3. Paste it in the app under **Settings → USDA key**.

## How the numbers are kept honest

| Badge | Source | How far to trust it |
| --- | --- | --- |
| ✓ USDA | Built-in library (USDA lab and reference data) | Best available |
| USDA prepared dish | USDA estimate of a dish as normally cooked | Assumes salt and fat were added |
| Maker label · USDA | Label data sent to USDA by the manufacturer | Compare with your package once |
| Community label | Open Food Facts volunteers | Compare with your package once |
| ~ Estimate | Peruvian dishes, typical home recipes | A guide, especially for sodium |
| ✓ Checked by you | You confirmed or typed it from the label | Yours |

- A missing value is never counted as zero. Totals show **≥** and **⚠** when a food has no data
  for that nutrient, and tapping the meter lists which foods.
- Entries whose calories contradict their macros, or with impossible values, are flagged.
- When both databases know a barcode and disagree, the app says so.
- Weigh food on a scale whenever you can. US labels are legally allowed to be up to 20% off,
  so no tracker is exact.

## Backups

Settings → **Save backup file**. Do it now and then, and before changing phones.
Restore from the same screen.

## Running it on this computer

```bash
node tools/serve.mjs
```

Then open <http://localhost:5173>. (The camera will not work on plain `http` from the phone.)

## For developers

| Path | What |
| --- | --- |
| `index.html`, `styles.css`, `js/` | The app (plain JavaScript modules, no build step) |
| `js/nutrition.js` | All nutrition math and the label parsers |
| `data/foods.json` | Built-in USDA library (generated) |
| `data/dishes.json` | Peruvian dishes and starter meals, as ingredient lists |
| `tools/build-db.mjs` | Rebuilds `foods.json` from the USDA JSON downloads |
| `tests/run-tests.mjs` | 51 checks on the math, parsers and data: `node tests/run-tests.mjs` |
| `sw.js` | Offline cache. Bump `VERSION` when you change app files |

To refresh the USDA data, download the Foundation, SR Legacy and Survey (FNDDS) JSON files from
<https://fdc.nal.usda.gov/download-datasets> and run:

```bash
node tools/build-db.mjs <sr_legacy.json> <foundation.json> <survey.json>
```

## Data credits

- USDA FoodData Central (public domain).
- Open Food Facts (Open Database License). Product data © Open Food Facts contributors.

Sidekick is a tracking tool, not medical or coaching advice.
