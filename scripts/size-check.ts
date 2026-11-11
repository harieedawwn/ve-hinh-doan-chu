// Initial JS budget: gzip size of every script/modulepreload that dist/index.html loads at start (fonts and lazy chunks excluded).
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

export function initialJs(limitKb = 150): { files: { f: string; gz: number }[]; totalKb: number; ok: boolean } {
  const html = readFileSync('dist/index.html', 'utf8');
  const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  const files = urls.map((u) => ({ f: u, gz: gzipSync(readFileSync('dist' + u)).length }));
  const total = files.reduce((a, b) => a + b.gz, 0) / 1024;
  return { files, totalKb: total, ok: total < limitKb };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = initialJs();
  for (const x of r.files) console.log(`${x.f}: ${(x.gz / 1024).toFixed(1)} KB gzip`);
  console.log(`initial JS: ${r.totalKb.toFixed(1)} KB gzip (limit 150) ${r.ok ? 'OK' : 'TOO BIG'}`);
  process.exit(r.ok ? 0 : 1);
}
