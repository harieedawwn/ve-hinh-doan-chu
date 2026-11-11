import { describe, expect, it } from 'vitest';
import { Harness, lobby, drawerOf, pickFirst } from './helpers.ts';

describe('room creation and joining', () => {
  it('creates a room, the creator is host, others join by code', () => {
    const h = new Harness();
    const [host, a] = lobby(h, 2);
    expect(host.room!.hostId).toBe(host.pid);
    expect(a.room!.players.map((p) => p.name)).toEqual(['Host', 'P1']);
    expect(h.d.phase).toBe('lobby');
    expect(host.of('welcome')[0].token).toBeTruthy();
  });
  it('rejects joining a room that does not exist and creating one that exists', () => {
    const h = new Harness();
    const x = h.connect('X');
    expect(x.closed?.reason).toBe('noRoom');
    const [host] = lobby(h, 1);
    expect(host.pid).toBe('p1');
    const y = h.connect('Y', { create: true });
    expect(y.closed?.reason).toBe('exists');
  });
  it('dedupes names, enforces max players, lock and ban', () => {
    const h = new Harness();
    const [host, a] = lobby(h, 2, { maxPlayers: 3 });
    const b = h.connect('P1');
    expect(b.room!.players.map((p) => p.name)).toEqual(['Host', 'P1', 'P1 2']);
    expect(h.connect('late').closed?.reason).toBe('full');
    host.send({ t: 'settings', patch: { maxPlayers: 10, locked: true } });
    expect(h.connect('late').closed?.reason).toBe('locked');
    host.send({ t: 'settings', patch: { locked: false } });
    host.send({ t: 'kick', id: a.pid });
    expect(a.closed?.code).toBe(4002);
    expect(a.of('kicked').length).toBe(1);
    const back = h.connect('P1', { token: a.token });
    expect(back.closed?.reason).toBe('banned');
  });
  it('only the host can change settings; values are clamped', () => {
    const h = new Harness();
    const [host, a] = lobby(h, 2);
    a.send({ t: 'settings', patch: { drawTime: 100 } });
    expect(h.d.settings.drawTime).toBe(80);
    expect(a.of('notice').some((n) => n.code === 'notHost')).toBe(true);
    host.send({ t: 'settings', patch: { drawTime: 9999, wordChoices: 0, hints: 99, maxPlayers: 999, mode: 'bogus', rounds: -3 } });
    expect(h.d.settings.drawTime).toBe(240);
    expect(h.d.settings.wordChoices).toBe(1);
    expect(h.d.settings.hints).toBe(5);
    expect(h.d.settings.maxPlayers).toBe(50);
    expect(h.d.settings.mode).toBe('rotate');
    expect(h.d.settings.rounds).toBe(1);
    expect(JSON.stringify(a.room)).not.toContain('customWords');
    host.send({ t: 'settings', patch: { customWords: 'con mèo\nbí mật' } });
    expect(host.of('customWords').pop()!.words).toEqual(['con mèo', 'bí mật']);
    expect(a.room!.settings.customWordCount).toBe(2);
    expect(a.raw.some((r) => r.includes('bí mật'))).toBe(false);
  });
  it('a start needs two players', () => {
    const h = new Harness();
    const [host] = lobby(h, 1);
    host.send({ t: 'start' });
    expect(h.d.phase).toBe('lobby');
    expect(host.of('notice').some((n) => n.code === 'needPlayers')).toBe(true);
  });
});

describe('rotate mode: full game', () => {
  it('everyone draws once per round, scores accumulate, podium, play again', () => {
    const h = new Harness(7);
    const cs = lobby(h, 4, { rounds: 1, drawTime: 60, hints: 0 });
    cs[0].send({ t: 'start' });
    const drawn: string[] = [];
    for (let turn = 0; turn < 4; turn++) {
      expect(h.d.phase).toBe('choosing');
      const dr = drawerOf(h, cs);
      drawn.push(dr.pid);
      expect(dr.secret?.choices?.length).toBe(3);
      dr.send({ t: 'pick', i: 1 });
      expect(h.d.phase).toBe('drawing');
      const word = h.d.game.word!;
      // everybody else guesses right
      cs.filter((c) => c !== dr).forEach((c) => c.chat(word));
      expect(h.d.phase).toBe('reveal');
      expect(h.d.reveal!.reason).toBe('allGuessed');
      expect(h.d.reveal!.word).toBe(word);
      h.advance(7001);
    }
    expect(new Set(drawn).size).toBe(4);
    expect(h.d.phase).toBe('podium');
    expect(h.d.podium!.length).toBe(4);
    expect(h.d.podium![0].rank).toBe(1);
    expect(cs[1].room!.podium).not.toBeNull();
    cs[1].send({ t: 'again' });
    expect(h.d.phase).toBe('podium'); // not host
    cs[0].send({ t: 'again' });
    expect(h.d.phase).toBe('lobby');
    expect(h.d.players.every((p) => p.score === 0)).toBe(true);
    // second game in the same room works
    cs[0].send({ t: 'start' });
    expect(h.d.phase).toBe('choosing');
  });
  it('auto-picks a word when the drawer is too slow, and ends the turn when time is up', () => {
    const h = new Harness(3);
    const cs = lobby(h, 3, { rounds: 1, drawTime: 30, chooseTime: 5, hints: 0 });
    cs[0].send({ t: 'start' });
    expect(h.d.phase).toBe('choosing');
    h.advance(5001);
    expect(h.d.phase).toBe('drawing');
    expect(h.d.game.word).toBeTruthy();
    h.advance(30_001);
    expect(h.d.phase).toBe('reveal');
    expect(h.d.reveal!.reason).toBe('timeUp');
    expect(h.d.reveal!.deltas).toEqual([]);
  });
});
