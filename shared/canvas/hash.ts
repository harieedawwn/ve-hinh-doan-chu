// Small chained non-cryptographic hash (two 32-bit FNV-1a lanes) for op-log integrity checks.

export class ChainHash {
  private a = 0x811c9dc5;
  private b = 0x01000193 ^ 0xdeadbeef;
  update(s: string): void {
    let a = this.a, b = this.b;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ (c + 0x9e37), 0x85ebca6b) >>> 0;
      b ^= b >>> 13;
    }
    // op separator so ["ab"] differs from ["a","b"]
    a = Math.imul(a ^ 0x7c, 0x01000193) >>> 0;
    b = Math.imul(b ^ 0x7c, 0x85ebca6b) >>> 0;
    this.a = a; this.b = b;
  }
  hex(): string {
    return this.a.toString(16).padStart(8, '0') + this.b.toString(16).padStart(8, '0');
  }
  clone(): ChainHash {
    const h = new ChainHash(); h.a = this.a; h.b = this.b; return h;
  }
}
