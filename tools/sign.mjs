// Sign manifest.json after every change.
//   node tools/sign.mjs            (uses %USERPROFILE%\.koalacut\manifest-signing.pem)
//   node tools/sign.mjs --key <path>
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  DEFAULT_PRIVATE_KEY, PUBLIC_KEY, SIGNATURE, args,
  readManifest, readManifestBytes, verifyManifestSignature, checkUrl,
} from './lib.mjs';

const a = args();
const privPath = a.key || DEFAULT_PRIVATE_KEY;
if (!existsSync(privPath)) {
  console.error(`No private key at ${privPath}. Run: node tools/keygen.mjs (first time only).`);
  process.exit(1);
}

// Refuse to sign a manifest that still has gaps or bad links.
const m = readManifest();
const problems = [];
if (m.schema !== 1) problems.push('schema must be 1');
for (const [id, e] of Object.entries(m.engines || {})) {
  if (!e.version || e.version === 'FILL') problems.push(`${id}: version not filled in`);
  for (const f of e.files || []) {
    if (f.url === 'FILL' || f.sha256 === 'FILL' || !f.size) problems.push(`${id}/${f.path}: not filled in`);
    else {
      for (const u of [f.url, ...(f.mirrors || [])]) {
        const bad = checkUrl(u);
        if (bad) problems.push(`${id}/${f.path}: ${bad}`);
      }
      if (!/^[0-9a-f]{64}$/.test(f.sha256)) problems.push(`${id}/${f.path}: sha256 must be 64 lowercase hex characters`);
    }
  }
}
if (problems.length && !a['allow-incomplete']) {
  console.error('Not signed. Fix these first (or add --allow-incomplete while testing):');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

const bytes = readManifestBytes();
if (bytes.includes(13)) {
  console.error('manifest.json has Windows (CRLF) line endings. Run: node tools/add-file.mjs --normalise');
  process.exit(1);
}
const sig = sign(null, bytes, createPrivateKey(readFileSync(privPath)));
writeFileSync(SIGNATURE, sig.toString('base64') + '\n');

const ok = existsSync(PUBLIC_KEY) &&
  verifyManifestSignature(bytes, readFileSync(SIGNATURE, 'utf8'), readFileSync(PUBLIC_KEY, 'utf8'));
if (!ok) {
  console.error('Signed, but the signature does NOT match tools/public-key.pem. Wrong key?');
  process.exit(1);
}
console.log('Signed manifest.json -> manifest.json.sig (checked against tools/public-key.pem).');
console.log('Now commit both files together:  git add manifest.json manifest.json.sig');
