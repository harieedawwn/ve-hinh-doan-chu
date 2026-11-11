import { describe, expect, it } from 'vitest';
import { Harness, lobby, drawerOf, pickFirst, type TClient } from './helpers.ts';

function playTurn(h: Harness, cs: TClient[], guessAll = true): string {
  const dr = drawerOf(h, cs);
  dr.send({ t: 'pick', i: 0 });
  const word = h.d.game.word!;
  if (guessAll) cs.filter((c) => c !== dr).forEach((c) => c.chat(word));
  return word;
}

describe('fair drawer selection', () => {
  it('nobody draws twice before everyone has drawn once (8 players, 2 rounds)', () => {
    const h = new Harness(11);
    const cs = lobby(h, 8, { rounds: 2, hints: 0, endBy: 'rounds' });
    cs[0].send({ t: 'start' });
    const seq: string[] = [];
    for (let i = 0; i < 16; i++) {
      expect(h.d.phase).toBe('choosing');
      const counts = h.d.players.map((p) => p.drawn);
      const dr = drawerOf(h, cs);
      expect(h.d.players.find((p) => p.id === dr.pid)!.drawn).toBe(Math.min(...counts));
      seq.push(dr.pid);
      playTurn(h, cs);
      h.advance(7001);
    }
    expect(h.d.phase).toBe('podium');
    expect(new Set(seq.slice(0, 8)).size).toBe(8);
    expect(new Set(seq.slice(8)).size).toBe(8);
  });
  it('rooms over 12 players default to a fixed number of turns; each turn a different drawer', () => {
    const h = new Harness(5);
    const cs = lobby(h, 14, { turns: 6, hints: 0, drawTime: 30 });
    expect(cs[0].room!.endMode).toBe('turns');
    cs[0].send({ t: 'start' });
    const seq: string[] = [];
    for (let i = 0; i < 6; i++) { seq.push(drawerOf(h, cs).pid); playTurn(h, cs, false); h.advance(30_001); h.advance(7001); }
    expect(h.d.phase).toBe('podium');
    expect(new Set(seq).size).toBe(6);
    expect(h.d.game.turnNo).toBe(6);
  });
  it('small rooms default to rounds; late joiner is not made to draw several turns in a row', () => {
    const h = new Harness(2);
    const cs = lobby(h, 4, { rounds: 3, hints: 0 });
    expect(cs[0].room!.endMode).toBe('rounds');
    cs[0].send({ t: 'start' });
    for (let i = 0; i < 6; i++) { playTurn(h, cs); h.advance(7001); }
    const late = h.connect('Muộn');
    expect(h.d.players.find((p) => p.id === late.pid)!.drawn).toBe(1); // = min of the others
    const all = [...cs, late];
    for (let i = 0; i < 5; i++) {
      const dr = drawerOf(h, all);
      const counts = h.d.players.map((p) => p.drawn);
      expect(h.d.players.find((p) => p.id === dr.pid)!.drawn).toBe(Math.min(...counts));
      playTurn(h, all); h.advance(7001);
      const after = h.d.players.map((p) => p.drawn);
      expect(Math.max(...after) - Math.min(...after)).toBeLessThanOrEqual(1);
    }
  });
});

describe('Chỉ host vẽ (hostOnly)', () => {
  it('host draws every turn, can type a custom word, game ends after N turns', () => {
    const h = new Harness(4);
    const cs = lobby(h, 3, { mode: 'hostOnly', turns: 3, hints: 0 });
    cs[0].send({ t: 'start' });
    for (let i = 0; i < 3; i++) {
      expect(h.d.game.drawerId).toBe(cs[0].pid);
      expect(cs[0].secret?.canCustom).toBe(true);
      if (i === 0) {
        cs[1].send({ t: 'pick', word: 'trộm' });          // non-drawer cannot pick
        expect(h.d.phase).toBe('choosing');
        cs[0].send({ t: 'pick', word: '  Con  mèo  ' });
        expect(h.d.game.word).toBe('Con mèo');
      } else cs[0].send({ t: 'pick', i: 0 });
      cs[1].chat(h.d.game.word!); cs[2].chat(h.d.game.word!);
      expect(h.d.phase).toBe('reveal');
      h.advance(7001);
    }
    expect(h.d.phase).toBe('podium');
    expect(h.d.players.find((p) => p.id === cs[0].pid)!.drawn).toBe(3);
  });
  it('custom word is refused in other modes', () => {
    const h = new Harness(4);
    const cs = lobby(h, 3, { hints: 0 });
    cs[0].send({ t: 'start' });
    const dr = drawerOf(h, cs);
    dr.send({ t: 'pick', word: 'tự chọn' });
    expect(h.d.phase).toBe('choosing');
  });
});

describe('Host không vẽ (hostMC)', () => {
  it('host never draws, may be excluded from guessing, can pause / skip / end', () => {
    const h = new Harness(9);
    const cs = lobby(h, 4, { mode: 'hostMC', hostGuesses: false, rounds: 1, hints: 0, drawTime: 60 });
    cs[0].send({ t: 'start' });
    const drawers: string[] = [];
    // turn 1: the MC is not needed for "everyone guessed"
    drawers.push(drawerOf(h, cs).pid);
    playTurn(h, cs.filter((c) => c !== cs[0]) , true);
    expect(h.d.phase).toBe('reveal');
    expect(h.d.reveal!.reason).toBe('allGuessed');
    h.advance(7001);
    // turn 2: MC pauses, time stops, resumes
    drawers.push(drawerOf(h, cs).pid);
    pickFirst(h, cs);
    const endsAt = h.d.timers.phase;
    h.advance(10_000);
    cs[0].send({ t: 'pause' });
    expect(h.d.paused).not.toBeNull();
    expect(cs[1].room!.paused).toBe(true);
    expect(cs[1].room!.phaseEndsAt).toBeNull();
    h.advance(120_000);
    expect(h.d.phase).toBe('drawing');
    // guesses are ignored while paused
    const guesser = cs.find((c) => c.pid !== drawers[1] && c !== cs[0])!;
    guesser.chat(h.d.game.word!);
    expect(h.d.players.find((p) => p.id === guesser.pid)!.guessedAt).toBeNull();
    cs[0].send({ t: 'pause' });
    expect(h.d.paused).toBeNull();
    expect(h.d.timers.phase - h.t).toBeGreaterThan(49_000);
    expect(h.d.timers.phase).toBeGreaterThan(endsAt);
    // skip: no points
    cs[0].send({ t: 'skip' });
    expect(h.d.phase).toBe('reveal');
    expect(h.d.reveal!.reason).toBe('skipped');
    h.advance(7001);
    drawers.push(drawerOf(h, cs).pid);
    // non-host cannot skip/end
    cs[1].send({ t: 'skip' });
    expect(h.d.phase).toBe('choosing');
    cs[0].send({ t: 'end' });
    expect(h.d.phase).toBe('podium');
    expect(drawers).not.toContain(cs[0].pid);
    expect(new Set(drawers).size).toBe(3);
  });
  it('MC who does not guess is a spectator and cannot leak the word; with hostGuesses he is a guesser', () => {
    const h = new Harness(9);
    const cs = lobby(h, 3, { mode: 'hostMC', hostGuesses: false, hints: 0 });
    cs[0].send({ t: 'start' });
    pickFirst(h, cs);
    expect(cs[0].room!.players.find((p) => p.id === cs[0].pid)!.spectator).toBe(true);
    const word = h.d.game.word!;
    cs[1].clear(); cs[2].clear();
    cs[0].chat(word);
    expect(cs[1].of('chat').length + cs[2].of('chat').length).toBe(0);
    expect(cs[0].of('notice').some((n) => n.code === 'noWord')).toBe(true);
    cs[0].chat('xin chào');
    expect(cs[1].of('chat').some((m) => m.text === 'xin chào')).toBe(true);
    // mode with hostGuesses
    const h2 = new Harness(9);
    const c2 = lobby(h2, 3, { mode: 'hostMC', hostGuesses: true, hints: 0 });
    c2[0].send({ t: 'start' }); pickFirst(h2, c2);
    c2[0].chat(h2.d.game.word!);
    expect(h2.d.players.find((p) => p.id === c2[0].pid)!.guessedAt).not.toBeNull();
  });
  it('needs at least one drawer besides the MC', () => {
    const h = new Harness();
    const cs = lobby(h, 2, { mode: 'hostMC' });
    cs[0].send({ t: 'start' });
    expect(h.d.phase).toBe('choosing'); // host + 1 other player is enough
    expect(h.d.game.drawerId).toBe(cs[1].pid);
  });
});

describe('scoring', () => {
  it('guessers earn by speed and order, drawer by share of correct guessers', () => {
    const h = new Harness(1);
    const cs = lobby(h, 4, { drawTime: 60, hints: 0, rounds: 1 });
    cs[0].send({ t: 'start' });
    const dr = drawerOf(h, cs);
    pickFirst(h, cs);
    const g = cs.filter((c) => c !== dr);
    const word = h.d.game.word!;
    g[0].chat(word);                              // instant: 100 + 300 + 50
    h.advance(30_000);
    g[1].chat(word);                              // half time: 100 + 150 + 40
    const sc = (c: TClient) => h.d.players.find((p) => p.id === c.pid)!.score;
    expect(sc(g[0])).toBe(450);
    expect(sc(g[1])).toBe(290);
    expect(g[0].of('guessOk')[0].pts).toBe(450);
    expect(h.d.phase).toBe('drawing');
    h.advance(30_001);                            // g[2] never guesses
    expect(h.d.phase).toBe('reveal');
    expect(sc(g[2])).toBe(0);
    expect(sc(dr)).toBe(200);                     // 2 of 3 guessers => 300*2/3
    expect(h.d.reveal!.deltas.length).toBe(3);
    // a repeated correct guess does not score twice, and nothing scores after the turn ended
    g[0].chat(word);
    expect(sc(g[0])).toBe(450);
  });
  it('turn ends early when everyone has guessed, and when the last unguessed player disconnects', () => {
    const h = new Harness(1);
    const cs = lobby(h, 4, { drawTime: 60, hints: 0 });
    cs[0].send({ t: 'start' });
    const dr = drawerOf(h, cs); pickFirst(h, cs);
    const g = cs.filter((c) => c !== dr);
    g[0].chat(h.d.game.word!); g[1].chat(h.d.game.word!);
    expect(h.d.phase).toBe('drawing');
    g[2].disconnect();
    expect(h.d.phase).toBe('reveal');
    expect(h.d.reveal!.reason).toBe('allGuessed');
  });
});

describe('hints', () => {
  it('reveals letters on an even automatic schedule, never the whole word', () => {
    const h = new Harness(6);
    const cs = lobby(h, 3, { drawTime: 60, hints: 2 });
    cs[0].send({ t: 'start' });
    const dr = drawerOf(h, cs); pickFirst(h, cs);
    const watcher = cs.find((c) => c !== dr)!;
    const word = h.d.game.word!;
    const hidden = (m: string) => Array.from(m).filter((c) => c === '_').length;
    const letters = Array.from(word).filter((c) => /\p{L}/u.test(c)).length;
    expect(watcher.room!.mask).toBe(Array.from(word).map((c) => (/\p{L}/u.test(c) ? '_' : c)).join(''));
    expect(watcher.room!.hintsTotal).toBe(2);
    h.advance(20_001);
    expect(hidden(watcher.room!.mask!)).toBe(letters - 1);
    expect(watcher.room!.hintsGiven).toBe(1);
    h.advance(20_000);
    expect(hidden(watcher.room!.mask!)).toBe(letters - 2);
    h.advance(19_000);
    expect(watcher.room!.hintsGiven).toBe(2);
    // every revealed char is the real char at that position
    Array.from(watcher.room!.mask!).forEach((c, i) => { if (c !== '_') expect(c).toBe(Array.from(word)[i]); });
  });
  it('hints = 0 reveals nothing; short words get fewer hints', () => {
    const h = new Harness(6);
    const cs = lobby(h, 3, { drawTime: 60, hints: 0 });
    cs[0].send({ t: 'start' }); pickFirst(h, cs);
    h.advance(59_000);
    expect(cs[1].room!.hintsGiven).toBe(0);
    const h2 = new Harness(6);
    const c2 = lobby(h2, 3, { drawTime: 60, hints: 5, customWords: ['ốc'], onlyCustom: true, wordChoices: 1 });
    c2[0].send({ t: 'start' });
    expect(h2.d.game.word).toBe('ốc');
    expect(h2.d.game.hintsTotal).toBe(0);
  });
});

describe('guesses, near-miss and privacy', () => {
  function start(settings: Record<string, unknown> = {}, seed = 21) {
    const h = new Harness(seed);
    const cs = lobby(h, 4, { hints: 0, customWords: ['con mèo'], onlyCustom: true, wordChoices: 1, ...settings });
    cs[0].send({ t: 'start' });
    const dr = drawerOf(h, cs);
    const g = cs.filter((c) => c !== dr);
    return { h, cs, dr, g };
  }
  it('accepts answers without diacritics, any case and extra spaces/punctuation', () => {
    const { h, g } = start();
    expect(h.d.game.word).toBe('con mèo');
    g[0].chat('  CON   MEO!! ');
    expect(h.d.players.find((p) => p.id === g[0].pid)!.guessedAt).not.toBeNull();
    g[1].chat('conmèo');
    expect(h.d.players.find((p) => p.id === g[1].pid)!.guessedAt).not.toBeNull();
  });
  it('strict mode requires diacritics; the unaccented guess is only "gần đúng" and stays private', () => {
    const { h, g } = start({ accentInsensitive: false });
    g[0].chat('con meo');
    expect(h.d.players.find((p) => p.id === g[0].pid)!.guessedAt).toBeNull();
    expect(g[0].of('close').length).toBe(1);
    expect(g[1].of('chat').some((m) => m.text === 'con meo')).toBe(false);
    g[0].chat('con mèo');
    expect(h.d.players.find((p) => p.id === g[0].pid)!.guessedAt).not.toBeNull();
  });
  it('shows "Gần đúng" only to that guesser; the near-miss text never reaches other guessers', () => {
    const { h, dr, g } = start();
    g[0].chat('con mao');            // distance 1 -> close
    expect(g[0].of('close').length).toBe(1);
    expect(g[0].of('chat').some((m) => m.ch === 'self' && m.text === 'con mao')).toBe(true);
    for (const o of [g[1], g[2]]) expect(o.raw.some((r) => r.includes('con mao'))).toBe(false);
    expect(dr.raw.some((r) => r.includes('con mao'))).toBe(true); // drawer sees it, may help
    g[0].chat('con chó');            // plain wrong guess: public to everyone
    expect(g[1].of('chat').some((m) => m.ch === 'all' && m.text === 'con chó')).toBe(true);
    expect(g[0].of('close').length).toBe(1);
  });
  it('showClose = false hides the indicator but still hides the text', () => {
    const { g } = start({ showClose: false });
    g[0].chat('con mao');
    expect(g[0].of('close').length).toBe(0);
    expect(g[1].raw.some((r) => r.includes('con mao'))).toBe(false);
  });
  it('correct guesses are hidden from players still guessing; guessed players and the drawer share a private channel', () => {
    const { h, dr, g } = start();
    g[0].chat('con mèo');
    // everyone is told *that* g[0] guessed (name only), nobody sees the text
    expect(g[1].of('chat').some((m) => m.ch === 'sys' && m.code === 'guessed')).toBe(true);
    expect(g[1].raw.some((r) => r.includes('con mèo'))).toBe(false);
    g[0].clear(); dr.clear(); g[1].clear();
    g[0].chat('ai biết con gì nè');
    expect(dr.of('chat').some((m) => m.ch === 'team')).toBe(true);
    expect(g[1].raw.length).toBe(0);
    dr.chat('mình vẽ khó quá');
    expect(g[0].of('chat').some((m) => m.ch === 'team' && m.text === 'mình vẽ khó quá')).toBe(true);
    expect(g[1].raw.length).toBe(0);
    expect(h.d.phase).toBe('drawing');
  });
  it('the drawer cannot post the word (nor a near-copy)', () => {
    const { dr, g } = start();
    g.forEach((c) => c.clear());
    dr.chat('con mèo'); dr.chat('CON MEO'); dr.chat('con mèoo');
    expect(dr.of('notice').filter((n) => n.code === 'noWord').length).toBe(3);
    expect(g.every((c) => c.raw.length === 0)).toBe(true);
  });
  it('after the reveal everybody can chat normally', () => {
    const { h, dr, g } = start();
    g.forEach((c) => c.chat('con mèo'));
    expect(h.d.phase).toBe('reveal');
    g[1].clear();
    g[0].chat('hay quá');
    expect(g[1].of('chat').some((m) => m.ch === 'all' && m.text === 'hay quá')).toBe(true);
    void dr;
  });
});

describe('word privacy', () => {
  it('non-drawers never receive the word before the reveal (any message, any phase)', () => {
    const h = new Harness(31);
    const cs = lobby(h, 5, { hints: 2, drawTime: 60, rounds: 1 });
    cs[0].send({ t: 'start' });
    const dr = drawerOf(h, cs);
    const choices = dr.secret!.choices!;
    const all = cs.filter((c) => c !== dr);
    // late joiner & reconnector as well
    pickFirst(h, cs);
    const word = h.d.game.word!;
    const late = h.connect('Muộn');
    const g = all[0]; const tok = g.token; g.disconnect();
    h.advance(5000);
    const back = h.connect('P', { token: tok });
    dr.draw([{ k: 'b', t: 0, c: 0, w: 5, x: 10, y: 10 }, { k: 'm', p: [5, 5] }]);
    h.advance(45_000); // hints appear
    all[1].chat('thử xem'); all[2].chat('con gì vậy');
    for (const c of [...all, late, back]) {
      expect(c.secret).toBeNull();
      for (const raw of c.raw) {
        expect(raw.includes(word), `leak of "${word}" to ${c.pid}: ${raw.slice(0, 120)}`).toBe(false);
        for (const w of choices) if (w !== word) expect(raw.includes(w)).toBe(false);
      }
      expect(c.of('secret').length).toBe(0);
    }
    // the drawer does know it
    expect(dr.secret?.word).toBe(word);
    // reveal shows it to everybody
    h.advance(12_000);
    expect(h.d.phase).toBe('reveal');
    expect(late.room!.reveal!.word).toBe(word);
  });
});
