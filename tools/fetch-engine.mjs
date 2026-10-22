// Download every file of one engine into a folder, checking each sha256.
// Used by the "Mirror an engine" workflow, and handy for making the vendor\ copy
// that ships inside KoalaCut.
//   node tools/fetch-engine.mjs --engine face-yunet --out out/face-yunet
//   node tools/fetch-engine.mjs --engine face-yunet --out out --flat   (file names only, for release assets)
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { readManifest, checkUrl, args } from './lib.mjs';

const a = args();
const e = readManifest().engines[a.engine];
if (!e) { console.error(`No engine "${a.engine}" in manifest.json`); process.exit(1); }
const out = a.out || join('out', a.engine);

const names = new Set();
for (const f of e.files) {
  const name = a.flat ? basename(f.path) : f.path;
  if (names.has(name)) { console.error(`Two files would both be called ${name}`); process.exit(1); }
  names.add(name);

  let data = null;
  for (const url of [f.url, ...(f.mirrors || [])]) {
    if (checkUrl(url)) continue;
    const res = await fetch(url, { headers: { 'User-Agent': 'koalacut-engines-tools' } });
    if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === f.size && createHash('sha256').update(buf).digest('hex') === f.sha256) { data = buf; break; }
  }
  if (!data) { console.error(`✗ ${f.path}: no link gave the right file`); process.exit(1); }
  const dest = join(out, name);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, data);
  console.log(`✓ ${name} (${data.length} bytes)`);
}

// Same sha256 list format as the whisper.cpp builds use.
const sums = e.files.map((f) => `${f.sha256}  ${a.flat ? basename(f.path) : f.path}`).join('\n') + '\n';
writeFileSync(join(out, 'SHA256SUMS.txt'), sums);
writeFileSync(join(out, 'BUILD-INFO.txt'),
  `engine: ${a.engine}\nversion: ${e.version}\nlicence: ${e.license || ''}\n` +
  e.files.map((f) => `${f.path} <- ${f.url}`).join('\n') + '\n');
console.log(`Saved to ${out}`);
