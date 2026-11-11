import { describe, expect, it } from 'vitest';
import { buildMask, cleanText, compactKey, editDistance, judgeGuess, leaksWord, maskableIndexes, normalizeText, stripAccents } from '../shared/text.ts';
import { ALL_WORDS, builtinPool, pickWords, wordKey } from '../shared/words/index.ts';
import { checkWord } from '../scripts/check-words.ts';
import { applySettingsPatch, DEFAULT_SETTINGS, isParseError, parseClientMessage } from '../shared/protocol.ts';
import { ROOM_CODE_ALPHABET, ROOM_CODE_RE } from '../shared/constants.ts';

describe('text normalization', () => {
  it('strips diacritics incl. đ', () => {
    expect(stripAccents('đường phố Hà Nội'.toLowerCase())).toBe('duong pho ha noi');
    expect(stripAccents('ươ ấ ề ỹ ặ')).toBe('uo a e y a');
  });
  it('normalizes case, spaces, punctuation and NFD input', () => {
    expect(normalizeText('  Con   MÈO!! ', false)).toBe('con mèo');
    expect(normalizeText('Con mèo', false)).toBe('con mèo'); // decomposed input
    expect(compactKey('con-mèo, ', true)).toBe('conmeo');
  });
  it('edit distance', () => {
    expect(editDistance('mèo', 'meo')).toBe(1);
    expect(editDistance('abc', 'abd')).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBeGreaterThan(1);
    expect(editDistance('', 'ab')).toBe(2);
  });
  it('judges guesses: correct / close / wrong', () => {
    expect(judgeGuess('CON MEO', 'con mèo', true)).toBe('correct');
    expect(judgeGuess('con meo', 'con mèo', false)).toBe('close');
    expect(judgeGuess('con mao', 'con mèo', true)).toBe('close');
    expect(judgeGuess('con chó', 'con mèo', true)).toBe('wrong');
    expect(judgeGuess('đường', 'duong', true)).toBe('correct');
    expect(judgeGuess('dương', 'đường', true)).toBe('correct'); // đ/d and ư/u fold together
    expect(judgeGuess('duon', 'đường', true)).toBe('close');
    expect(judgeGuess('', 'mèo', true)).toBe('wrong');
    expect(judgeGuess('ốn', 'ốc', true)).toBe('wrong');   // 2-letter keys never "close"
    expect(judgeGuess('bánh mì', 'banh mi', true)).toBe('correct');
  });
  it('leak detection is stricter than judging', () => {
    expect(leaksWord('mình đoán là con mèo nha', 'con mèo')).toBe(true);
    expect(leaksWord('CON MEO', 'con mèo')).toBe(true);
    expect(leaksWord('hello', 'con mèo')).toBe(false);
  });
  it('builds masks', () => {
    expect(buildMask('con mèo', [])).toBe('___ ___');
    expect(buildMask('con mèo', [0, 5])).toBe('c__ _è_');
    expect(buildMask('Hồ Gươm', [])).toBe('__ ____');
    expect(maskableIndexes('xe-ôm').length).toBe(4);
    expect(buildMask('xe-ôm', new Set([3]))).toBe('__-ô_');
  });
  it('cleans text', () => {
    expect(cleanText('  a\u0000b ‮ c  ', 10)).toBe('ab c');
    expect(cleanText(5, 10)).toBe('');
    expect(Array.from(cleanText('x'.repeat(50), 20)).length).toBe(20);
  });
});

describe('word packs', () => {
  it('has at least 800 unique, well-formed Vietnamese words in every category', () => {
    expect(ALL_WORDS.length).toBeGreaterThanOrEqual(800);
    expect(new Set(ALL_WORDS.map((w) => wordKey(w.text))).size).toBe(ALL_WORDS.length);
    for (const w of ALL_WORDS) expect(checkWord(w.text), w.text).toEqual([]);
    const cats = new Set(ALL_WORDS.map((w) => w.cat));
    expect(cats.size).toBeGreaterThanOrEqual(10);
    for (const c of cats) for (const d of ['easy', 'medium', 'hard']) expect(ALL_WORDS.some((w) => w.cat === c && w.diff === d), `${c}/${d}`).toBe(true);
  });
  it('the diacritic checker catches malformed words', () => {
    expect(checkWord('con mèo')).toEqual([]);
    expect(checkWord('bánh mì')).toEqual([]);
    expect(checkWord('cát').length).toBe(0);
    expect(checkWord('cat').length).toBeGreaterThan(0);          // "c-a-t" needs a tone
    expect(checkWord('cạt́').length).toBeGreaterThan(0);    // two tone marks
    expect(checkWord('con  mèo').length).toBeGreaterThan(0);
    expect(checkWord('bus').length).toBeGreaterThan(0);
    expect(checkWord('còn').length).toBe(0);               // decomposed input is flagged as not NFC
  });
  it('pool filters and picks distinct unused words', () => {
    const pool = builtinPool(['animal'], ['easy']);
    expect(pool.length).toBeGreaterThan(20);
    let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const used = new Set<string>();
    const a = pickWords(pool, 3, used, rnd);
    expect(new Set(a).size).toBe(3);
    a.forEach((w) => used.add(wordKey(w)));
    const b = pickWords(pool, 3, used, rnd);
    expect(b.some((w) => a.includes(w))).toBe(false);
    // when the pool is exhausted the used set resets
    const all = pickWords(pool, pool.length, new Set(pool.map(wordKey)), rnd);
    expect(all.length).toBe(pool.length);
  });
});

describe('protocol', () => {
  it('room code alphabet has no 0 O 1 I L and 31 symbols', () => {
    expect(ROOM_CODE_ALPHABET.length).toBe(31);
    for (const c of '01OIL') expect(ROOM_CODE_ALPHABET.includes(c)).toBe(false);
    expect(ROOM_CODE_RE.test('AB2CD')).toBe(true);
    expect(ROOM_CODE_RE.test('AB0CD')).toBe(false);
    expect(ROOM_CODE_RE.test('abcde')).toBe(false);
  });
  it('parses and rejects client messages', () => {
    expect(parseClientMessage('{"t":"ping","c":5}')).toEqual({ t: 'ping', c: 5 });
    expect(isParseError(parseClientMessage('{"t":"ping"}'))).toBe(true);
    expect(isParseError(parseClientMessage('[1]'))).toBe(true);
    expect(isParseError(parseClientMessage('{"t":"fly"}'))).toBe(true);
    expect(isParseError(parseClientMessage(new ArrayBuffer(3)))).toBe(true);
    const hello = parseClientMessage(JSON.stringify({ t: 'hello', name: '  Lan   Anh  ', avatar: -1, create: true }));
    expect(hello).toMatchObject({ t: 'hello', name: 'Lan Anh', avatar: 23, create: true });
    expect(isParseError(parseClientMessage(JSON.stringify({ t: 'chat', text: 'x'.repeat(2000) })))).toBe(true);
    expect(isParseError(parseClientMessage('{"t":"mute","id":"p1"}'))).toBe(true);
  });
  it('settings patches are clamped and sanitized', () => {
    const s = applySettingsPatch(DEFAULT_SETTINGS, { drawTime: 5, hints: 3.6, categories: ['animal', 'bogus'], difficulties: [], customWords: 'a\nCon cua; con cua\nb', onlyCustom: 'yes', mode: 'hostMC', evil: 1 });
    expect(s.drawTime).toBe(30);
    expect(s.hints).toBe(4);
    expect(s.categories).toEqual(['animal']);
    expect(s.difficulties).toEqual(['easy', 'medium']);
    expect(s.customWords).toEqual(['Con cua']);
    expect(s.onlyCustom).toBe(false);
    expect(s.mode).toBe('hostMC');
    expect('evil' in s).toBe(false);
    expect(DEFAULT_SETTINGS.drawTime).toBe(80);                  // original untouched
    const live = applySettingsPatch(DEFAULT_SETTINGS, { drawTime: 200, locked: true }, ['locked']);
    expect(live.drawTime).toBe(80); expect(live.locked).toBe(true);
  });
});
