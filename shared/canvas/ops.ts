// Canvas operation model. The op log is the single source of truth for a turn's drawing.
//
//  b  begin stroke   {k:'b', t:0|1 (pen|eraser), c:rgb int, w:brush size, x, y}
//  m  more points    {k:'m', p:[dx0,dy0,dx1,dy1,...]}  deltas from the previous point of the open stroke
//  f  flood fill     {k:'f', x, y, c}
//  u  undo           {k:'u'}
//  r  redo           {k:'r'}
//  x  clear          {k:'x'}   (itself undoable)
//
// A stroke = one `b` followed by zero or more `m` ops. It is "open" until any other op arrives.

import { CANVAS_H, CANVAS_W, MAX_BRUSH, MIN_BRUSH } from '../constants.ts';

export type BeginOp = { k: 'b'; t: 0 | 1; c: number; w: number; x: number; y: number };
export type MoreOp = { k: 'm'; p: number[] };
export type FillOp = { k: 'f'; x: number; y: number; c: number };
export type UndoOp = { k: 'u' };
export type RedoOp = { k: 'r' };
export type ClearOp = { k: 'x' };
export type Op = BeginOp | MoreOp | FillOp | UndoOp | RedoOp | ClearOp;

export const WHITE = 0xffffff;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const inX = (v: unknown): v is number => isInt(v) && v >= 0 && v <= CANVAS_W;
const inY = (v: unknown): v is number => isInt(v) && v >= 0 && v <= CANVAS_H;
const isColor = (v: unknown): v is number => isInt(v) && v >= 0 && v <= 0xffffff;

/** Shape check of a single op (state-independent). Returns an error string or null. */
export function checkOpShape(op: unknown): string | null {
  if (typeof op !== 'object' || op === null) return 'op';
  const o = op as Record<string, unknown>;
  switch (o.k) {
    case 'b':
      if (o.t !== 0 && o.t !== 1) return 'b.t';
      if (!isColor(o.c)) return 'b.c';
      if (!isInt(o.w) || o.w < MIN_BRUSH || o.w > MAX_BRUSH) return 'b.w';
      if (!inX(o.x) || !inY(o.y)) return 'b.xy';
      return null;
    case 'm': {
      const p = o.p;
      if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0) return 'm.p';
      for (const v of p) if (!isInt(v) || v < -CANVAS_W || v > CANVAS_W) return 'm.p';
      return null;
    }
    case 'f':
      if (!inX(o.x) || !inY(o.y) || !isColor(o.c)) return 'f';
      return null;
    case 'u': case 'r': case 'x':
      return null;
    default:
      return 'k';
  }
}

/** Canonical string of an op, fed into the log hash. Never change without bumping PROTOCOL_VERSION. */
export function opToString(op: Op): string {
  switch (op.k) {
    case 'b': return `b${op.t},${op.c},${op.w},${op.x},${op.y}`;
    case 'm': return `m${op.p.join(',')}`;
    case 'f': return `f${op.x},${op.y},${op.c}`;
    default: return op.k;
  }
}

export function colorToCss(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
}

/** Rough size in points of an op (stroke work). */
export function opUnits(op: Op): number {
  return op.k === 'm' ? op.p.length / 2 : 1;
}
