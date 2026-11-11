// Vietnamese text utilities: guess normalization, edit distance, masks.

const COMBINING = /[̀-ͯ]/g;
const NOT_WORD = /[^\p{L}\p{N}\s]/gu;

/** Strip diacritics (đ -> d) from already lower-cased text. */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(COMBINING, '').replace(/đ/g, 'd').normalize('NFC');
}

/**
 * Canonical comparison key: NFC, lower-case, punctuation removed, whitespace collapsed.
 * With accentInsensitive the diacritics are removed too (đ -> d).
 * Spaces are kept (single) so "con mèo" and "conmèo" are compared via compactKey.
 */
export function normalizeText(s: string, accentInsensitive: boolean): string {
  let t = s.normalize('NFC').toLowerCase();
  if (accentInsensitive) t = stripAccents(t);
  return t.replace(NOT_WORD, ' ').replace(/\s+/g, ' ').trim();
}

/** Same as normalizeText but with all spaces removed: spacing never matters in a guess. */
export function compactKey(s: string, accentInsensitive: boolean): string {
  return normalizeText(s, accentInsensitive).replace(/ /g, '');
}

/** Levenshtein distance with an early exit once it exceeds `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array<number>(lb + 1);
  let cur = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

export type GuessVerdict = 'correct' | 'close' | 'wrong';

/**
 * Judge a guess. `close` = edit distance 1 on the compact normalized text.
 * Near-misses are only reported for keys of 3+ characters (1-2 letter words would match everything).
 * In strict mode (accentInsensitive=false) a correct-but-unaccented guess is therefore `close`
 * (distance 1 for a single missing mark) or `wrong`.
 */
export function judgeGuess(guess: string, word: string, accentInsensitive: boolean): GuessVerdict {
  const g = compactKey(guess, accentInsensitive);
  const w = compactKey(word, accentInsensitive);
  if (!g || !w) return 'wrong';
  if (g === w) return 'correct';
  if (w.length >= 3 && editDistance(g, w, 1) <= 1) return 'close';
  return 'wrong';
}

/**
 * Privacy test for text that must never reach players who are still guessing:
 * true when the text equals or is within one edit of the word under both
 * strict and accent-insensitive comparison, or merely contains the word.
 */
export function leaksWord(text: string, word: string): boolean {
  for (const ai of [false, true]) {
    if (judgeGuess(text, word, ai) !== 'wrong') return true;
    const w = compactKey(word, ai);
    if (w.length >= 3 && compactKey(text, ai).includes(w)) return true;
  }
  return false;
}

/** True for characters that get masked (letters and digits). */
function isMaskable(ch: string): boolean {
  return /[\p{L}\p{N}]/u.test(ch);
}

/** Split a word into code points (precomposed NFC Vietnamese letters are single code points). */
export function chars(word: string): string[] {
  return Array.from(word.normalize('NFC'));
}

/** Indexes (into chars()) of letters that can be revealed as hints. */
export function maskableIndexes(word: string): number[] {
  const out: number[] = [];
  chars(word).forEach((c, i) => { if (isMaskable(c)) out.push(i); });
  return out;
}

/** Build the public mask: hidden letters -> "_", spaces/punctuation kept, revealed letters shown. */
export function buildMask(word: string, revealed: ReadonlySet<number> | readonly number[]): string {
  const set = revealed instanceof Set ? revealed : new Set(revealed);
  return chars(word).map((c, i) => (isMaskable(c) && !set.has(i) ? '_' : c)).join('');
}

/** Sanitize a display name or chat line: NFC, strip control chars, collapse spaces, cap length. */
export function cleanText(s: unknown, maxLen: number): string {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const t = s.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, maxLen).join('');
}
