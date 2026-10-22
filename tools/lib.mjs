// Shared helpers for the koalacut-engines tools. Node 18+ only, no npm packages.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain one-line errors instead of stack traces.
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (err) => {
    const cause = err?.cause?.code ? ` (${err.cause.code} ${err.cause.hostname || ''})` : '';
    console.error(`Error: ${err?.message || err}${cause}`);
    process.exit(1);
  });
}

export const ROOT =join(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST = join(ROOT, 'manifest.json');
export const SIGNATURE = join(ROOT, 'manifest.json.sig');
export const PUBLIC_KEY = join(ROOT, 'tools', 'public-key.pem');
export const DEFAULT_PRIVATE_KEY =
  process.env.KOALACUT_SIGNING_KEY || join(homedir(), '.koalacut', 'manifest-signing.pem');

// The only hosts KoalaCut will download from. Keep this list identical to
// ALLOWED_HOSTS in KoalaCut's server/engineManifest.ts.
export const ALLOWED_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'media.githubusercontent.com',        // Git LFS files (e.g. the YuNet model)
  'objects.githubusercontent.com',      // release downloads
  'release-assets.githubusercontent.com',
  'cdn.jsdelivr.net',                   // npm files, by exact version
  'registry.npmjs.org',
  'storage.googleapis.com',             // MediaPipe models
]);

export function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { return `not a valid URL: ${url}`; }
  if (u.protocol !== 'https:') return `not https: ${url}`;
  if (!ALLOWED_HOSTS.has(u.hostname)) return `host not on the allowed list: ${u.hostname}`;
  return null;
}

export function readManifestBytes() {
  return readFileSync(MANIFEST);
}

export function readManifest() {
  return JSON.parse(readManifestBytes().toString('utf8'));
}

// Always LF, 2-space indent, trailing newline, so the bytes are stable for signing.
export function writeManifest(m) {
  m.updated = new Date().toISOString().slice(0, 10);
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2).replace(/\r\n/g, '\n') + '\n');
}

export function verifyManifestSignature(manifestBytes, sigText, publicKeyPem) {
  const sig = Buffer.from(String(sigText).trim(), 'base64');
  if (sig.length !== 64) return false;
  return verify(null, manifestBytes, createPublicKey(publicKeyPem), sig);
}

export function hasPublicKey() {
  return existsSync(PUBLIC_KEY);
}

// Download a URL fully, following redirects, and return { sha256, size, finalUrl, head }.
// Every redirect hop must also be an allowed https host.
export async function downloadAndHash(url, { maxBytes = 200 * 1024 * 1024 } = {}) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const bad = checkUrl(current);
    if (bad) throw new Error(bad);
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': 'koalacut-engines-tools' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${current}`);
    const hash = createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error(`bigger than ${maxBytes} bytes: ${current}`);
      if (head.length < 64) head = Buffer.concat([head, chunk]).subarray(0, 64);
      hash.update(chunk);
    }
    return { sha256: hash.digest('hex'), size, finalUrl: current, head: head.toString('latin1') };
  }
  throw new Error(`too many redirects: ${url}`);
}

export function isLfsPointer(head) {
  return head.startsWith('version https://git-lfs.github.com/spec/');
}

export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
