// Validates the built-in word packs: duplicates, NFC, character set, Vietnamese syllable shape and tone rules.
import { CATEGORY_LABELS, WORD_DATA } from '../shared/words/data.ts';
import { stripAccents } from '../shared/text.ts';

const MIN_TOTAL = 800;
/** Established loanwords / brand-like spellings that are not Vietnamese syllables. */
const LOAN = new Set(['pizza', 'flan', 'lego', 'rubik', 'karate', 'katê', 'com', 'lê', 'ê', 'ke']);

const TONES = /[̣̀́̃̉]/g;
const ONSET = '(?:ngh|ng|nh|ph|th|tr|ch|gh|gi|kh|qu|b|c|d|đ|g|h|k|l|m|n|p|r|s|t|v|x)?';
const VOWELS = '[aăâeêioôơuưy]{1,3}';
const CODA = '(?:ch|ng|nh|c|m|n|p|t)?';
const SYLLABLE = new RegExp(`^${ONSET}${VOWELS}${CODA}$`);

export function checkSyllable(syl: string): string | null {
  const lower = syl.toLowerCase();
  if (LOAN.has(lower)) return null;
  const nfd = lower.normalize('NFD');
  const tones = nfd.match(TONES) ?? [];
  if (tones.length > 1) return 'more than one tone mark';
  const bare = nfd.replace(TONES, '').normalize('NFC');
  if (!SYLLABLE.test(bare)) return 'not a valid Vietnamese syllable shape';
  if (/(?:ch|c|p|t)$/.test(bare) && !/(?:gi|qu)$/.test(bare)) {
    // stop-final syllables only carry sắc (U+0301) or nặng (U+0323)
    if (!(tones.length === 1 && (tones[0] === '́' || tones[0] === '̣'))) return 'stop-final syllable needs sắc or nặng';
  }
  return null;
}

export function checkWord(w: string): string[] {
  const errs: string[] = [];
  if (w !== w.normalize('NFC')) errs.push('not NFC');
  if (!/^[\p{L} \-']+$/u.test(w) || w.includes("'")) errs.push('bad characters');
  if (w !== w.trim() || /\s{2,}/.test(w)) errs.push('whitespace');
  if (w.length < 2 || w.length > 40) errs.push('length');
  for (const syl of w.split(/[\s-]+/)) {
    const e = checkSyllable(syl);
    if (e) errs.push(`"${syl}": ${e}`);
  }
  return errs;
}

function main(): void {
  const seen = new Map<string, string>();
  let total = 0, problems = 0;
  const rows: string[] = [];
  for (const [cat, pack] of Object.entries(WORD_DATA)) {
    const counts: number[] = [];
    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const words = pack[diff].split(',').map((s) => s.trim()).filter(Boolean);
      counts.push(words.length);
      for (const w of words) {
        total++;
        const errs = checkWord(w);
        const key = stripAccents(w.toLowerCase()).replace(/[^a-z0-9]/g, '');
        const prev = seen.get(key);
        if (prev) errs.push(`duplicate of ${prev}`);
        else seen.set(key, `${cat}/${diff}`);
        for (const e of errs) { problems++; console.error(`${cat}/${diff}: "${w}" -> ${e}`); }
      }
    }
    rows.push(`${(CATEGORY_LABELS as Record<string, string>)[cat].padEnd(22)} easy ${counts[0]}  medium ${counts[1]}  hard ${counts[2]}  = ${counts[0] + counts[1] + counts[2]}`);
  }
  console.log(rows.join('\n'));
  console.log(`total words: ${total}, unique keys: ${seen.size}, problems: ${problems}`);
  if (total < MIN_TOTAL) { console.error(`need at least ${MIN_TOTAL} words`); process.exit(1); }
  if (problems) process.exit(1);
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
