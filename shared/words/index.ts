import { CATEGORY_LABELS, WORD_DATA, type CategoryId, type Difficulty } from './data.ts';
import { stripAccents } from '../text.ts';

export { CATEGORY_LABELS, type CategoryId, type Difficulty };
export const CATEGORY_IDS = Object.keys(CATEGORY_LABELS) as CategoryId[];
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export interface WordEntry { text: string; cat: CategoryId; diff: Difficulty }

export const ALL_WORDS: WordEntry[] = [];
for (const cat of CATEGORY_IDS) {
  for (const diff of DIFFICULTIES) {
    for (const w of WORD_DATA[cat][diff].split(',')) {
      const text = w.trim().normalize('NFC');
      if (text) ALL_WORDS.push({ text, cat, diff });
    }
  }
}

/** Stable identity of a word for "already used" bookkeeping. */
export function wordKey(w: string): string {
  return stripAccents(w.toLowerCase()).replace(/[^a-z0-9]/g, '');
}

export function builtinPool(categories: readonly CategoryId[], difficulties: readonly Difficulty[]): string[] {
  const cats = new Set(categories), diffs = new Set(difficulties);
  return ALL_WORDS.filter((w) => cats.has(w.cat) && diffs.has(w.diff)).map((w) => w.text);
}

/**
 * Pick `n` distinct words from `pool` that are not in `used` (keys). If fewer than `n` unused words remain,
 * the used set is cleared first (caller passes a mutable Set). Always returns min(n, pool distinct) words.
 */
export function pickWords(pool: readonly string[], n: number, used: Set<string>, rnd: () => number): string[] {
  let avail = pool.filter((w) => !used.has(wordKey(w)));
  if (avail.length < n) { used.clear(); avail = pool.slice(); }
  const out: string[] = [];
  const seen = new Set<string>();
  while (out.length < n && avail.length) {
    const i = Math.floor(rnd() * avail.length);
    const w = avail.splice(i, 1)[0];
    const k = wordKey(w);
    if (seen.has(k)) continue;
    seen.add(k); out.push(w);
  }
  return out;
}
