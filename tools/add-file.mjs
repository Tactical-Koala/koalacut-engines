// Add or update one file in manifest.json. It downloads the file, works out the
// sha256 and size itself, and writes them in. Run tools/sign.mjs afterwards.
//
// A file from any allowed URL:
//   node tools/add-file.mjs --engine face-mediapipe --path face_landmarker.task \
//     --url https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
//
// A file from an npm package (exact version, served by jsDelivr). Also sets the engine version:
//   node tools/add-file.mjs --engine onnxruntime-web --path ort-wasm-simd-threaded.wasm \
//     --npm onnxruntime-web@1.23.0 --file dist/ort-wasm-simd-threaded.wasm
//
// Other jobs:
//   --latest <npm-package>           print the newest version on npm
//   --list <npm-package>@<version>   list the files in that version (to find exact names)
//   --engine X --version V [--label L]  set an engine's version by hand
//   --engine X --path P --mirror URL    add a backup link (must be the identical file)
//   --engine X --path P --remove        remove a file
//   --normalise                      rewrite manifest.json with LF line endings
import { readManifest, writeManifest, downloadAndHash, isLfsPointer, checkUrl, args } from './lib.mjs';

const a = args();
const m = readManifest();

if (a.latest) {
  const res = await fetch(`https://registry.npmjs.org/${a.latest}/latest`);
  if (!res.ok) throw new Error(`npm: HTTP ${res.status}`);
  const d = await res.json();
  console.log(`${d.name} latest = ${d.version}`);
  process.exit(0);
}

if (a.list) {
  const res = await fetch(`https://data.jsdelivr.com/v1/packages/npm/${a.list}?structure=flat`);
  if (!res.ok) throw new Error(`jsDelivr: HTTP ${res.status} (is the version right?)`);
  const d = await res.json();
  for (const f of d.files) console.log(`${String(f.size).padStart(10)}  ${f.name.replace(/^\//, '')}`);
  process.exit(0);
}

if (a.normalise) {
  writeManifest(m);
  console.log('manifest.json rewritten with LF line endings. Sign it again.');
  process.exit(0);
}

if (!a.engine) {
  console.error('Missing --engine. See the comments at the top of tools/add-file.mjs.');
  process.exit(1);
}
const engine = (m.engines[a.engine] ||= { title: a.engine, version: 'FILL', files: [] });

if (a.version) {
  engine.version = String(a.version);
  if (a.label) engine.label = String(a.label);
  if (!a.path) { writeManifest(m); console.log(`${a.engine} version = ${engine.version}`); process.exit(0); }
}

// After the "Mirror an engine" workflow has made a release, add its copies as backups:
//   node tools/add-file.mjs --engine face-yunet --mirror-release mirror-face-yunet-2026.5.0
if (a['mirror-release']) {
  const repo = a.repo || 'Tactical-Koala/koalacut-engines';
  let added = 0;
  for (const f of engine.files) {
    const asset = f.path.split('/').pop();
    const murl = `https://github.com/${repo}/releases/download/${a['mirror-release']}/${asset}`;
    process.stdout.write(`Checking ${asset} ... `);
    try {
      const r = await downloadAndHash(murl);
      if (r.sha256 !== f.sha256 || r.size !== f.size) { console.log('different file, skipped'); continue; }
      f.mirrors = [...new Set([...(f.mirrors || []), murl])];
      added++;
      console.log('ok');
    } catch (err) { console.log(err.message); }
  }
  writeManifest(m);
  console.log(`${added}/${engine.files.length} mirrors added. Sign the manifest again.`);
  process.exit(added === engine.files.length ? 0 : 1);
}

if (!a.path) {
  console.error('Missing --path (the file name inside the engine folder, e.g. wasm/vision_wasm_internal.wasm).');
  process.exit(1);
}
let entry = engine.files.find((f) => f.path === a.path);

if (a.remove) {
  engine.files = engine.files.filter((f) => f.path !== a.path);
  writeManifest(m);
  console.log(`Removed ${a.engine}/${a.path}. Sign the manifest again.`);
  process.exit(0);
}

if (a.mirror) {
  if (!entry || entry.sha256 === 'FILL') throw new Error('Add the main link first, then the mirror.');
  console.log(`Checking mirror ${a.mirror} ...`);
  const r = await downloadAndHash(a.mirror);
  if (r.sha256 !== entry.sha256 || r.size !== entry.size) {
    console.error(`Mirror is a different file (sha256 ${r.sha256}, ${r.size} bytes). Not added.`);
    process.exit(1);
  }
  entry.mirrors = [...new Set([...(entry.mirrors || []), a.mirror])];
  writeManifest(m);
  console.log('Mirror added. Sign the manifest again.');
  process.exit(0);
}

let url = a.url;
let npmVersion = null;
if (a.npm) {
  if (!a.file) throw new Error('--npm needs --file (the path inside the package, e.g. dist/ort.wasm.min.mjs)');
  const at = a.npm.lastIndexOf('@');
  npmVersion = at > 0 ? a.npm.slice(at + 1) : null;
  if (!npmVersion || !/^\d/.test(npmVersion)) throw new Error('--npm must include an exact version, e.g. onnxruntime-web@1.23.0');
  url = `https://cdn.jsdelivr.net/npm/${a.npm}/${String(a.file).replace(/^\//, '')}`;
}
if (!url) throw new Error('Give --url, or --npm with --file.');
const bad = checkUrl(url);
if (bad) throw new Error(bad);

console.log(`Downloading ${url} ...`);
const r = await downloadAndHash(url);
if (isLfsPointer(r.head)) {
  console.error('That link returned a Git LFS pointer, not the real file.');
  console.error('For LFS files use https://media.githubusercontent.com/media/<owner>/<repo>/<commit>/<path> instead.');
  process.exit(1);
}
if (r.finalUrl !== url) console.log(`  (redirected to ${new URL(r.finalUrl).hostname})`);

const fresh = { path: a.path, url, sha256: r.sha256, size: r.size, mirrors: [] };
if (entry) {
  // Same file moved? Keep the mirrors. New file? Old mirrors no longer match, so drop them.
  fresh.mirrors = entry.sha256 === r.sha256 ? entry.mirrors || [] : [];
  Object.assign(entry, fresh);
} else {
  engine.files.push(fresh);
}
if (npmVersion && !a.version) engine.version = npmVersion;

writeManifest(m);
console.log(`  ${a.engine}/${a.path}`);
console.log(`  sha256 ${r.sha256}`);
console.log(`  size   ${r.size} bytes`);
if (npmVersion) console.log(`  ${a.engine} version = ${engine.version}`);
console.log('Done. When all changes are in: node tools/sign.mjs');
