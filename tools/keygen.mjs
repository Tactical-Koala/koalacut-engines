// One-time: create the signing key pair.
//   node tools/keygen.mjs
// Private key -> %USERPROFILE%\.koalacut\manifest-signing.pem (never commit it, back it up).
// Public key  -> tools/public-key.pem (commit it, and paste it into KoalaCut).
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_PRIVATE_KEY, PUBLIC_KEY, args } from './lib.mjs';

const a = args();
const privPath = a.key || DEFAULT_PRIVATE_KEY;

if (existsSync(privPath) && !a.force) {
  console.error(`A private key already exists at ${privPath}.`);
  console.error('Keep using it. Making a new one means every KoalaCut install needs an update');
  console.error('before it will trust the manifest again. Use --force only if the old key is lost or leaked.');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
mkdirSync(dirname(privPath), { recursive: true });
writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const pub = publicKey.export({ type: 'spki', format: 'pem' }).replace(/\r\n/g, '\n');
writeFileSync(PUBLIC_KEY, pub);

console.log(`Private key: ${privPath}`);
console.log('  -> back this file up somewhere safe (USB stick / password manager). Never commit it.');
console.log(`Public key:  ${PUBLIC_KEY}  (commit this)`);
console.log('\nPaste this into KoalaCut (server/engineManifest.ts, PUBLIC_KEY_PEM):\n');
console.log(pub);
