// Checks what KoalaCut users would get: the signature, then every link and mirror
// (downloaded in full, size and sha256 compared). Exit code 1 if anything is wrong.
//   node tools/check-links.mjs           everything
//   node tools/check-links.mjs --quick   signature and manifest only, no downloads
import { readFileSync, existsSync } from 'node:fs';
import {
  readManifest, readManifestBytes, verifyManifestSignature, downloadAndHash, isLfsPointer,
  checkUrl, args, SIGNATURE, PUBLIC_KEY,
} from './lib.mjs';

const a = args();
const failures = [];
const fail = (msg) => { failures.push(msg); console.log('  ✗ ' + msg); };

console.log('Signature');
if (!existsSync(PUBLIC_KEY)) fail('tools/public-key.pem is missing');
else if (!existsSync(SIGNATURE)) fail('manifest.json.sig is missing');
else if (!verifyManifestSignature(readManifestBytes(), readFileSync(SIGNATURE, 'utf8'), readFileSync(PUBLIC_KEY, 'utf8')))
  fail('manifest.json.sig does not match manifest.json (sign it again after every change)');
else console.log('  ✓ manifest.json is signed');

const m = readManifest();
for (const [id, e] of Object.entries(m.engines)) {
  console.log(`\n${id} ${e.version}`);
  if (!e.version || e.version === 'FILL') fail(`${id}: version not filled in`);
  for (const f of e.files) {
    if (f.url === 'FILL' || f.sha256 === 'FILL') { fail(`${id}/${f.path}: not filled in`); continue; }
    for (const url of [f.url, ...(f.mirrors || [])]) {
      const label = url === f.url ? 'link' : 'mirror';
      const bad = checkUrl(url);
      if (bad) { fail(`${id}/${f.path} ${label}: ${bad}`); continue; }
      if (a.quick) continue;
      try {
        const r = await downloadAndHash(url);
        if (isLfsPointer(r.head)) fail(`${id}/${f.path} ${label}: returns a Git LFS pointer, not the file`);
        else if (r.size !== f.size) fail(`${id}/${f.path} ${label}: size ${r.size}, manifest says ${f.size}`);
        else if (r.sha256 !== f.sha256) fail(`${id}/${f.path} ${label}: sha256 differs (the file behind the link changed)`);
        else console.log(`  ✓ ${f.path} (${label})`);
      } catch (err) {
        fail(`${id}/${f.path} ${label}: ${err.message}`);
      }
    }
  }
}

console.log(failures.length ? `\n${failures.length} problem(s). KoalaCut users may not be able to download these.` : '\nAll good.');
process.exit(failures.length ? 1 : 0);
