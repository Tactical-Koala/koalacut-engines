# koalacut-engines

**The signed list of where KoalaCut downloads its add-on engines from.**

Nothing here is compiled. `manifest.json` points at the original files (OpenCV's model zoo,
npm, Google's model storage) with each file's exact sha256 and size. KoalaCut reads this list,
checks it was signed by the KoalaCut key, downloads from the links, and refuses any file whose
checksum doesn't match.

If an upstream file moves, change its `url` here, sign, push — every KoalaCut install follows
on its next update check. No KoalaCut release needed.

| Engine id | What | Upstream |
|---|---|---|
| `face-yunet` | Face tracking · Sharper | OpenCV model zoo (`models/face_detection_yunet`), pinned to a commit |
| `onnxruntime-web` | Runs YuNet in KoalaCut's window | npm `onnxruntime-web`, exact version via jsDelivr |
| `face-mediapipe` | Face tracking · Detailed | npm `@mediapipe/tasks-vision` + Google's `face_landmarker.task` |

## Files

| File | Purpose |
|---|---|
| `manifest.json` | The list: engines, versions, links, sha256, sizes, backup links |
| `manifest.json.sig` | Ed25519 signature of `manifest.json` |
| `tools/public-key.pem` | The public half of the signing key (also built into KoalaCut) |
| `tools/keygen.mjs` | One-time: make the signing key pair |
| `tools/add-file.mjs` | Add/update a file — downloads it and fills in sha256 and size |
| `tools/sign.mjs` | Sign `manifest.json` after any change |
| `tools/check-links.mjs` | Check the signature and download every link |
| `tools/fetch-engine.mjs` | Download one engine's files (for mirrors and KoalaCut's `vendor\`) |
| `.github/workflows/check-links.yml` | Weekly link check, emails you on failure |
| `.github/workflows/mirror.yml` | Optional: publish backup copies as a release |
| `koalacut-side/engineManifest.ts` | Reference code for KoalaCut (`server/engineManifest.ts`) |

Needs Node.js 18 or newer. No npm install.

## Everyday jobs

```powershell
# A link moved (same file):
node tools/add-file.mjs --engine face-yunet --path face_detection_yunet_2026may.onnx --url <new link>
node tools/sign.mjs
git add manifest.json manifest.json.sig; git commit -m "face-yunet: new link"; git push

# New npm version:
node tools/add-file.mjs --latest onnxruntime-web
node tools/add-file.mjs --engine onnxruntime-web --path ort-wasm-simd-threaded.wasm --npm onnxruntime-web@<ver> --file dist/ort-wasm-simd-threaded.wasm
#   ...repeat for each file of that engine, then:
node tools/sign.mjs
node tools/check-links.mjs
```

Rules:
- **Always sign after editing**, and commit `manifest.json` and `manifest.json.sig` together.
- **Pin links**: a commit ID for GitHub files, an exact version for npm. Never `main` or `@latest`.
- **Git LFS files** (like the YuNet model) must use `media.githubusercontent.com/media/…`.
  A `raw.githubusercontent.com` link only returns a small pointer file — `add-file` warns you.
- **Never commit the private key.** It lives in `%USERPROFILE%\.koalacut\manifest-signing.pem`.

## Licences

The tools and docs here: MIT © 2026 Khalm Down Hobbies. The engines keep their own licences
(YuNet: MIT; ONNX Runtime: MIT; MediaPipe: Apache-2.0) and are downloaded from their publishers.
