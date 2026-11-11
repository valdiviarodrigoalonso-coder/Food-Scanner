// Photo estimates: ask Claude what is on a plate and roughly how much it weighs.
// The AI only names the food and estimates grams. Every nutrition number still comes from the
// app's own food data, so a wrong guess can shift the weight but can never invent a sodium value.
// This file has no DOM code so the tests can run it in Node.

export const PHOTO_MODEL = 'claude-opus-5-5';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.8.0/+esm';

/** Plain sides and add-ons the AI may pick, each tied to one checked USDA entry in foods.json. */
export const SIDES = [
  [2708404, 'White rice, cooked the usual way (with oil and salt)'],
  [168878, 'White rice, cooked plain (no oil or salt)'],
  [170440, 'Boiled potato'],
  [2709458, 'French fries (papas fritas)'],
  [168484, 'Sweet potato (camote), boiled'],
  [2709709, 'Sweet potato (camote), fried'],
  [169999, 'Corn (choclo), boiled'],
  [173424, 'Hard-boiled egg'],
  [173423, 'Fried egg'],
  [169094, 'Black olives'],
  [168199, 'Fried plantain'],
  [171705, 'Avocado (palta)'],
  [169247, 'Lettuce'],
  [170457, 'Tomato'],
  [170000, 'Raw red onion / salsa criolla'],
  [168409, 'Cucumber'],
  [170379, 'Broccoli'],
  [170393, 'Carrot'],
  [170420, 'Peas'],
  [173752, 'Canary / yellow beans, cooked'],
  [172421, 'Lentils, cooked'],
  [168917, 'Quinoa, cooked'],
  [169737, 'Spaghetti / noodles, cooked plain'],
  [171477, 'Chicken breast, cooked, no skin'],
  [173617, 'Chicken leg, cooked, with skin (no bone)'],
  [168635, 'Beef steak (sirloin), cooked'],
  [167847, 'Pork shoulder, braised'],
  [2707610, 'Bread roll (pan francés)'],
  [2647442, 'Queso fresco'],
  [2710204, 'Mayonnaise'],
];

export const sideRef = (id) => 'side:' + id;

export const PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short name the person would use, e.g. "Ají de gallina with rice"' },
          ref: { type: 'string', description: 'A ref from the list in the instructions, or "" when nothing on the list fits' },
          grams: { type: 'number', description: 'Best estimate of the edible weight in grams' },
          low: { type: 'number', description: 'Low end of the likely range, grams' },
          high: { type: 'number', description: 'High end of the likely range, grams' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          note: { type: 'string', description: 'One short sentence on what the estimate is based on, or ""' },
        },
        required: ['name', 'ref', 'grams', 'low', 'high', 'confidence', 'note'],
        additionalProperties: false,
      },
    },
    scale_cue: { type: 'string', description: 'What was used to judge size (plate, fork, hand…), or "none visible"' },
    note: { type: 'string', description: 'One short sentence for the person, or "". If there is no food in the photo, say so here.' },
  },
  required: ['items', 'scale_cue', 'note'],
  additionalProperties: false,
};

/** dishes: [{ id, name, plate }] from dishes.json */
export function buildSystemPrompt(dishes) {
  const dishLines = dishes.map((d) => `${d.id} | ${d.name} | ${d.plate}`).join('\n');
  const sideLines = SIDES.map(([id, label]) => `${sideRef(id)} | ${label}`).join('\n');
  return `You estimate food portions from one photo for a nutrition-tracking app. The person is an athlete who tracks macros and sodium closely and mostly photographs Peruvian home cooking served by family, so they do not know the weights. They will review and correct your numbers before logging.

Your job: say what is on the plate and estimate the weight in grams of each part as served. Weight means the cooked, edible food only: no plate, bones, shells or peels.

How to judge size
- Look for scale: plate or bowl size (a dinner plate is usually 26-28 cm across, a deep plate about 22 cm), cutlery (a dinner fork is about 19 cm long), a hand, a glass, the table setting.
- Judge volume, not just area: how high the food is piled, how deep the bowl is, how much is hidden under sauce.
- Useful anchors: a level cup of cooked rice is about 160-180 g; a medium boiled potato about 150 g; a large egg about 50 g; a palm-sized piece of cooked meat about 100-120 g; a ladle of stew about 120-150 g.
- Give your single best estimate plus an honest low-high range. Make the range wide when there is no scale cue, the food is piled or covered, or the photo is dark, cropped or taken from a low angle. Do not narrow the range to look confident; the person relies on it to decide whether to weigh the food.

How to name what you see
The app can only calculate nutrition for the foods below, so match to this list whenever something fits.

Dishes (ref | name | what ONE item of this dish covers):
${dishLines}

Plain sides and add-ons (ref | food):
${sideLines}

Rules for matching
- When the plate is one of the dishes, return ONE item with that dish's ref, and make its weight cover everything in that dish's description that is on the plate (for example the stew and its rice and its potato together). Do not list those parts again as separate items.
- Anything on the plate the dish description does not cover (an extra egg, a salad, bread, a second side) is its own item with a side ref.
- If the plate is not one of the dishes, break it into the plain sides that fit.
- If a food has no fitting ref, still return it with ref "" and a clear name, so the person can pick the food themselves. Never force a poor match: a wrong food gives wrong sodium.
- Drinks and sauces served separately count only if clearly visible.
- If the photo shows no food, return an empty items list and explain in note.

If the person adds a comment with the photo, treat it as information about the food (it may name the dish or the plate size) and trust it over your own guess about what the dish is.

Reply with the JSON object only.`;
}

export function buildUserText(hint) {
  const h = String(hint || '').trim().slice(0, 300);
  return h ? `Estimate this plate. The person's comment about it: "${h}"` : 'Estimate this plate.';
}

const round5 = (g) => (g < 30 ? Math.round(g) : Math.round(g / 5) * 5);

/**
 * Turn the model's reply into safe, tidy items. Anything malformed is dropped rather than trusted.
 * knownRefs: Set of refs the app can resolve. Returns { items, scaleCue, note }.
 */
export function parseEstimate(text, knownRefs) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('The reply could not be read. Try again.');
  let data;
  try {
    data = JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    throw new Error('The reply could not be read. Try again.');
  }
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const items = [];
  for (const it of Array.isArray(data.items) ? data.items.slice(0, 12) : []) {
    if (!it || typeof it !== 'object') continue;
    const grams = Number(it.grams);
    if (!Number.isFinite(grams) || grams <= 0 || grams > 3000) continue;
    const name = str(it.name, 80);
    if (!name) continue;
    let low = Number(it.low);
    let high = Number(it.high);
    if (!Number.isFinite(low) || low <= 0 || low > grams) low = grams * 0.75;
    if (!Number.isFinite(high) || high < grams || high > 6000) high = grams * 1.25;
    const ref = knownRefs && knownRefs.has(it.ref) ? it.ref : '';
    const confidence = ['low', 'medium', 'high'].includes(it.confidence) ? it.confidence : 'low';
    items.push({ name, ref, grams: round5(grams), low: round5(low), high: round5(high), confidence, note: str(it.note, 200) });
  }
  return { items, scaleCue: str(data.scale_cue, 120), note: str(data.note, 240) };
}

/** Plain-language message for a failed request. `Anthropic` is the SDK class (for its typed errors). */
export function explainError(e, Anthropic) {
  if (Anthropic) {
    if (e instanceof Anthropic.AuthenticationError) return 'That Claude key was not accepted. Check it in Settings.';
    if (e instanceof Anthropic.PermissionDeniedError) return 'This Claude key is not allowed to do that. Check the key in the Claude Console.';
    if (e instanceof Anthropic.RateLimitError) return 'Too many requests right now. Wait a minute and try again.';
    if (e instanceof Anthropic.APIConnectionError) return 'Could not reach Claude. Check your internet connection and try again.';
    if (e instanceof Anthropic.BadRequestError) return /credit|billing|balance/i.test(e.message || '') ? 'Your Claude account is out of credit. Add credit in the Claude Console, then try again.' : `Claude could not use that photo. (${String(e.message || '').slice(0, 140)})`;
    if (e instanceof Anthropic.APIError) return e.status >= 500 ? 'Claude is having trouble right now. Try again in a minute.' : `Claude returned an error (${e.status}). Try again.`;
  }
  return e && e.message ? e.message : 'Something went wrong. Try again.';
}

let sdkPromise = null;
const loadSDK = () => (sdkPromise ||= import(SDK_URL).then((m) => m.default || m.Anthropic, (e) => {
  sdkPromise = null;
  throw new Error('Could not load the Claude library. Check your internet connection and try again.');
}));

/**
 * Send one photo to Claude. image: { data (base64, no prefix), mediaType }.
 * Returns the parsed estimate. Throws an Error with a message that is safe to show.
 */
export async function estimatePhoto({ apiKey, image, hint, dishes, knownRefs }) {
  const Anthropic = await loadSDK();
  // The key belongs to the person using the app and never leaves their phone except to reach Anthropic.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 120000 });
  const base = {
    model: PHOTO_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: buildSystemPrompt(dishes),
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: buildUserText(hint) },
      ],
    }],
  };
  let res;
  try {
    try {
      // First choice: a guaranteed-shape JSON reply, with the server-side fallback model if the request is declined.
      res = await client.beta.messages.create({
        ...base,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: PHOTO_SCHEMA } },
      });
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError) || /credit|billing|balance/i.test(e.message || '')) throw e;
      // The account or region may not accept those options: ask again the plain way (the prompt still demands JSON).
      res = await client.messages.create(base);
    }
  } catch (e) {
    throw new Error(explainError(e, Anthropic));
  }
  if (res.stop_reason === 'refusal') throw new Error('Claude declined to look at that photo. Try a different picture of the plate.');
  if (res.stop_reason === 'max_tokens') throw new Error('The reply was cut off. Try again.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseEstimate(text, knownRefs);
}
