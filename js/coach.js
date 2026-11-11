// The four coaches and everything they say. Pure data: no DOM, no storage (covered by tests).
// Ground rule for every personality, including the tough one: push the habit of logging,
// never shame a food choice or a number.

export const COACHES = [
  { id: 'llama', emoji: '🦙', name: 'Paco', animal: 'Llama', style: 'Easygoing & kind', blurb: 'Calm, warm and always on your side. Celebrates the small wins.' },
  { id: 'lion', emoji: '🦁', name: 'Leo', animal: 'Lion', style: 'Tough love', blurb: 'Direct and intense. Expects you to show up, and respects it when you do.' },
  { id: 'owl', emoji: '🦉', name: 'Olive', animal: 'Owl', style: 'Calm & analytical', blurb: 'Just the facts. Explains the numbers and keeps the drama out of it.' },
  { id: 'fox', emoji: '🦊', name: 'Zorro', animal: 'Fox', style: 'Playful & witty', blurb: 'Quick with a joke, never boring. Makes tracking feel like a game.' },
];
export const DEFAULT_COACH = 'llama';
export const getCoach = (id) => COACHES.find((c) => c.id === id) || COACHES[0];

const days = (n) => `${n} day${n === 1 ? '' : 's'}`;

// Each entry: one line per coach. A line is a string, a list (rotated or picked at random),
// or a function of the situation's numbers.
export const LINES = {
  // ----- introductions -----
  hello: {
    llama: 'Hola! I’m Paco. No stress — we’ll take it one meal at a time.',
    lion: 'I’m Leo. You log every bite, I keep you honest. Deal?',
    owl: 'I’m Olive. Give me accurate entries and I’ll give you clear numbers.',
    fox: 'Zorro here. I make food logging weirdly fun. Try me.',
  },
  setupDone: {
    llama: 'All set! Tap ＋ whenever you’re ready.',
    lion: 'Set. Tap ＋ and log your first food.',
    owl: 'Setup complete. Tap ＋ to log your first food.',
    fox: 'We’re in business! Tap ＋ and log something tasty.',
  },

  // ----- the line at the top of the day -----
  pastLogged: {
    llama: 'Looking back. Every logged day is a little gift to future you.',
    lion: 'Reviewing the tape. Good. Learn from it.',
    owl: 'Reviewing a past day. Logged days feed your weekly averages.',
    fox: 'Time travel! Here’s what past-you ate.',
  },
  pastEmpty: {
    llama: 'Nothing logged here. That’s alright — the next meal is what counts.',
    lion: 'Nothing logged this day. It’s behind you. Win today.',
    owl: 'No entries on this day, so it is left out of your averages.',
    fox: 'Nothing here. Past-you was being mysterious.',
  },
  done: {
    llama: 'Day complete. Rest well — I’m proud of you.',
    lion: 'Day complete. Good work. Same again tomorrow.',
    owl: 'Day closed. Your data is saved for the weekly averages.',
    fox: 'Day complete! I’d high-five you, but… paws.',
  },
  emptyStreak: {
    llama: (v) => `${v.n}-day streak going. Log your first meal and keep it cozy.`,
    lion: (v) => `${days(v.n)} straight. Don’t break the chain — log your first meal.`,
    owl: (v) => `Current streak: ${days(v.n)}. One entry today keeps it running.`,
    fox: (v) => `${v.n}-day streak on the line. No pressure. (Some pressure.)`,
  },
  emptyMorning: {
    llama: 'Good morning! Breakfast first, then we log it together.',
    lion: 'Morning. The day starts now — log breakfast.',
    owl: 'Good morning. Logging breakfast early makes the rest of the day easier to plan.',
    fox: 'Morning! Tell me what’s for breakfast. I’m nosy.',
  },
  emptyLater: {
    llama: 'Ready when you are. Log your first meal of the day.',
    lion: 'Nothing logged yet. Fix that — log your first meal.',
    owl: 'No entries yet today. Start with your most recent meal while you remember it.',
    fox: 'The log is empty and I’m bored. Feed me data.',
  },
  sodiumOver: {
    llama: 'Sodium is past your limit. Maybe skip the salty extras for the rest of today.',
    lion: 'Sodium is over your limit. Sauces and salty snacks are done for today.',
    owl: 'Sodium has passed your limit. Tap the sodium meter to see which foods it came from.',
    fox: 'Sodium alert! The salt shaker is officially in time-out for today.',
  },
  kcalOver: {
    llama: 'A little over today, and that’s okay. You logged it — that’s what matters. Fresh start tomorrow.',
    lion: 'Over target. You logged it anyway — that’s discipline. Reset and hit it tomorrow.',
    owl: 'Calories are above target today. One day barely moves a weekly average. Keep logging.',
    fox: 'Went a bit over. Good news: you didn’t hide it from me. Tomorrow we play again.',
  },
  perfect: {
    llama: 'Protein reached and calories on target. What a lovely day.',
    lion: 'Protein hit. Calories on target. That’s how it’s done.',
    owl: 'Protein goal met and calories within 5% of target. Textbook day.',
    fox: 'Protein: check. Calories: bullseye. Honestly, are you showing off?',
  },
  proteinHit: {
    llama: 'Protein goal reached. Nicely done!',
    lion: 'Protein goal: done. Keep the rest of the day tight.',
    owl: 'Protein goal met. Your remaining calories can go to carbs and fat.',
    fox: 'Protein goal reached. Your muscles send their regards.',
  },
  proteinEvening: {
    llama: (v) => `${v.left} g of protein to go tonight. You’ve got this.`,
    lion: (v) => `${v.left} g of protein left. Finish the job.`,
    owl: (v) => `${v.left} g of protein remaining for today.`,
    fox: (v) => `${v.left} g of protein still at large. Go catch it.`,
  },
  generic: {
    llama: ['Nice — every entry helps.', 'Logged. You’re doing great.', 'One meal at a time. Keep going.', 'Lovely. Next meal, same thing.'],
    lion: ['Logged. Keep moving.', 'Good. Every entry counts.', 'That’s the work. Next meal, same standard.', 'On track. Stay sharp.'],
    owl: ['Entry recorded. More data, clearer picture.', 'Logged. Totals are up to date.', 'Noted. Consistent logging beats perfect logging.', 'Recorded. Tap any meter to see where it comes from.'],
    fox: ['Logged! I saw that. I see everything.', 'Noted. Delicious, I assume.', 'Another one in the books.', 'Got it. You’re on a roll. (Not a dinner roll.)'],
  },

  // ----- pop-up messages -----
  logged: {
    llama: ['Logged ✔ Nice one.', 'Got it 💙', 'Logged — well done.'],
    lion: ['Logged.', 'Done. Next.', 'Logged. Good.'],
    owl: ['Entry saved ✔', 'Recorded ✔', 'Logged ✔ Totals updated.'],
    fox: ['Logged! 🦊', 'Yoink. Logged.', 'Noted ✔'],
  },
  firstOfDay: {
    llama: (v) => `Logged! ${days(v.n)} in a row 🔥`,
    lion: (v) => `Logged. ${days(v.n)} straight 🔥`,
    owl: (v) => `Logged. Streak: ${days(v.n)} 🔥`,
    fox: (v) => `Logged! ${v.n}-day streak. Look at you 🔥`,
  },
  streakStart: {
    llama: 'Logged! Your streak starts today 🔥',
    lion: 'Logged. Day one. Build on it 🔥',
    owl: 'Logged. Streak counter started 🔥',
    fox: 'Logged! A streak is born 🔥',
  },
  proteinGoal: {
    llama: 'Protein goal reached! 💪',
    lion: 'Protein goal smashed! 💪',
    owl: 'Protein goal met ✔ 💪',
    fox: 'Protein goal reached! Flex responsibly 💪',
  },
  waterGoal: {
    llama: 'Water goal reached 💧 Lovely.',
    lion: 'Water goal hit 💧',
    owl: 'Water goal met 💧',
    fox: 'Water goal reached 💧 Glug glug.',
  },
  dayDone: {
    llama: (v) => (v.streak > 1 ? `Day done! ${days(v.streak)} in a row 🔥` : `Day done! That’s ${days(v.total)} tracked 🎉`),
    lion: (v) => (v.streak > 1 ? `Day done. ${days(v.streak)} straight 🔥 Keep it.` : `Day done. ${days(v.total)} tracked. Build on it 🎉`),
    owl: (v) => (v.streak > 1 ? `Day closed. Streak: ${days(v.streak)} 🔥` : `Day closed. ${days(v.total)} tracked so far 🎉`),
    fox: (v) => (v.streak > 1 ? `Day done! ${days(v.streak)} in a row 🔥 Show-off.` : `Day done! ${days(v.total)} tracked 🎉 It begins.`),
  },
  weightLogged: {
    llama: 'Weight logged ⚖️ Thanks for checking in.',
    lion: 'Weight logged ⚖️',
    owl: 'Weight recorded ⚖️ Watch the 7-day average, not today.',
    fox: 'Weight logged ⚖️ The scale and I had a little chat.',
  },

  // ----- progress page -----
  streakLogged: {
    llama: 'Today is logged. See you tomorrow 👋',
    lion: 'Today is logged. Show up again tomorrow.',
    owl: 'Today is logged. Your streak is safe until tomorrow.',
    fox: 'Today is logged. Same time tomorrow? 👋',
  },
  streakKeep: {
    llama: 'Log something today to keep your streak going.',
    lion: 'Log today or the streak ends. Your call.',
    owl: 'No entry yet today. One entry keeps the streak.',
    fox: 'Your streak is giving me puppy eyes. Log something.',
  },
  streakNone: {
    llama: 'Log a meal today to start a streak.',
    lion: 'No streak yet. Start one today.',
    owl: 'Log one meal today to start a streak.',
    fox: 'No streak yet. Let’s start some trouble.',
  },
};

/**
 * What coach `id` says in situation `key`. `vars` carries the numbers a line needs;
 * `vars.i` picks from a list in rotation (otherwise a list entry is chosen at random).
 */
export function lineFor(id, key, vars = {}) {
  const set = LINES[key];
  if (!set) return '';
  let line = set[getCoach(id).id];
  if (Array.isArray(line)) line = line[(vars.i != null ? Math.abs(vars.i) : Math.floor(Math.random() * line.length)) % line.length];
  return typeof line === 'function' ? line(vars) : line;
}
