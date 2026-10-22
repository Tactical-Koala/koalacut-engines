// KoalaCut side of koalacut-engines. Copy to server/engineManifest.ts in KoalaCut.
// Reads the signed manifest, then downloads engine files from wherever it points,
// checking every file's sha256. Node 18+ only, no npm packages.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, isAbsolute } from 'node:path';

// ---- Settings -----------------------------------------------------------------
const REPO_RAW = 'https://raw.githubusercontent.com/Tactical-Koala/koalacut-engines/main';
export const MANIFEST_URL = process.env.KOALACUT_ENGINES_MANIFEST || `${REPO_RAW}/manifest.json`;
export const SIGNATURE_URL = `${MANIFEST_URL}.sig`;

// Paste the output of `node tools/keygen.mjs` here (tools/public-key.pem in the repo).
export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
PASTE-YOUR-PUBLIC-KEY-HERE
-----END PUBLIC KEY-----
`;

// Keep identical to ALLOWED_HOSTS in the repo's tools/lib.mjs.
export const ALLOWED_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'media.githubusercontent.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'cdn.jsdelivr.net',
  'registry.npmjs.org',
  'storage.googleapis.com',
]);

// ---- Types --------------------------------------------------------------------
export interface EngineFile { path: string; url: string; sha256: string; size: number; mirrors?: string[] }
export interface EngineEntry {
  title: string; version: string; label?: string; notes?: string; license?: string;
  requires?: string[]; files: EngineFile[];
}
export interface EnginesManifest { schema: 1; updated: string; minKoalaCut?: string; engines: Record<string, EngineEntry> }
export interface LoadedManifest { manifest: EnginesManifest; source: 'online' | 'cached' | 'bundled' }

// ---- Manifest -----------------------------------------------------------------
function signatureOk(bytes: Buffer, sigText: string): boolean {
  try {
    const sig = Buffer.from(sigText.trim(), 'base64');
    return sig.length === 64 && verify(null, bytes, createPublicKey(PUBLIC_KEY_PEM), sig);
  } catch { return false; }
}

function parse(bytes: Buffer, appVersion: string): EnginesManifest {
  const m = JSON.parse(bytes.toString('utf8')) as EnginesManifest;
  if (m.schema !== 1) throw new Error(`Unknown manifest schema ${m.schema}`);
  if (m.minKoalaCut && compareVersions(appVersion, m.minKoalaCut) < 0)
    throw new Error(`This manifest needs KoalaCut ${m.minKoalaCut} or newer`);
  return m;
}

async function fetchBytes(url: string, timeoutMs = 15000): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'Cache-Control': 'no-cache' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Online copy first; then the last good copy on this PC; then the copy shipped in vendor\.
 * A copy is only used if its signature checks out.
 *   cacheDir:  e.g. %LOCALAPPDATA%\KoalaCut\face-engines
 *   vendorDir: KoalaCut's vendor folder (holds engines-manifest.json + .sig)
 */
export async function loadManifest(opts: { cacheDir: string; vendorDir: string; appVersion: string }): Promise<LoadedManifest> {
  const cached = join(opts.cacheDir, 'engines-manifest.json');
  try {
    const [bytes, sig] = await Promise.all([fetchBytes(MANIFEST_URL), fetchBytes(SIGNATURE_URL)]);
    if (!signatureOk(bytes, sig.toString('utf8')))
      throw new Error('signature check failed (the manifest may be mid-update; try again in a few minutes)');
    const manifest = parse(bytes, opts.appVersion);
    await mkdir(opts.cacheDir, { recursive: true });
    await writeFile(cached, bytes);
    await writeFile(`${cached}.sig`, sig);
    return { manifest, source: 'online' };
  } catch (onlineErr) {
    for (const [file, source] of [[cached, 'cached'], [join(opts.vendorDir, 'engines-manifest.json'), 'bundled']] as const) {
      try {
        const bytes = await readFile(file);
        const sig = await readFile(`${file}.sig`, 'utf8');
        if (signatureOk(bytes, sig)) return { manifest: parse(bytes, opts.appVersion), source };
      } catch { /* try the next one */ }
    }
    throw new Error(`Couldn't read the engine list: ${(onlineErr as Error).message}`);
  }
}

// ---- Versions -----------------------------------------------------------------
// Numbers only, so "v1.23.0", "1.23.0" and "2026.5.0" all compare properly.
export function compareVersions(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b).replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export function engineDownloadSize(m: EnginesManifest, id: string): number {
  const e = m.engines[id];
  return e ? e.files.reduce((n, f) => n + f.size, 0) : 0;
}

// ---- Downloads ----------------------------------------------------------------
function allowed(url: string): boolean {
  try { const u = new URL(url); return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname); }
  catch { return false; }
}

function safeJoin(root: string, rel: string): string {
  const p = normalize(rel);
  if (isAbsolute(p) || p.startsWith('..')) throw new Error(`Unsafe file path in manifest: ${rel}`);
  return join(root, p);
}

export interface Progress { file: string; done: number; total: number; bytesPerSec: number }

/** Fetch one URL, following redirects only to allowed hosts, streaming to `dest`. Returns the sha256. */
async function downloadTo(url: string, dest: string, expectSize: number, signal: AbortSignal,
  onBytes: (n: number) => void): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    if (!allowed(current)) throw new Error(`Blocked link: ${new URL(current).hostname}`);
    const res = await fetch(current, { redirect: 'manual', signal });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const hash = createHash('sha256');
    const out = createWriteStream(dest);
    let got = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        got += chunk.length;
        if (got > expectSize) throw new Error('File is bigger than expected');
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        onBytes(chunk.length);
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    return hash.digest('hex');
  }
  throw new Error('Too many redirects');
}

/**
 * Download all files of one engine into `<installRoot>\<engineId>\<version>.new`, checking each
 * file, then rename to `<version>`. The caller runs the self-test and updates installed.json,
 * and deletes the new folder (keeping the old version) if the self-test fails.
 */
export async function installEngine(opts: {
  manifest: EnginesManifest; engineId: string; installRoot: string;
  signal: AbortSignal; onProgress?: (p: Progress) => void;
}): Promise<string> {
  const e = opts.manifest.engines[opts.engineId];
  if (!e) throw new Error(`No engine called ${opts.engineId}`);
  const finalDir = join(opts.installRoot, opts.engineId, e.version);
  const tmpDir = `${finalDir}.new`;
  await rm(tmpDir, { recursive: true, force: true });

  const total = e.files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  const started = Date.now();
  const tick = (file: string) => (n: number) => {
    done += n;
    const secs = Math.max((Date.now() - started) / 1000, 0.001);
    opts.onProgress?.({ file, done, total, bytesPerSec: done / secs });
  };

  try {
    for (const f of e.files) {
      const dest = safeJoin(tmpDir, f.path);
      await mkdir(dirname(dest), { recursive: true });
      const before = done;
      let lastErr = '';
      let ok = false;
      for (const url of [f.url, ...(f.mirrors ?? [])]) {
        done = before;                         // restart this file's share of the bar
        try {
          const sha = await downloadTo(url, dest, f.size, opts.signal, tick(f.path));
          if (sha === f.sha256 && done - before === f.size) { ok = true; break; }
          lastErr = 'checksum mismatch';
        } catch (err) {
          if (opts.signal.aborted) throw err;
          lastErr = (err as Error).message;
        }
      }
      if (!ok) throw new Error(`${f.path}: ${lastErr}`);
    }
    await rm(finalDir, { recursive: true, force: true });
    await rename(tmpDir, finalDir);
    return finalDir;
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true });
    throw err;
  }
}
