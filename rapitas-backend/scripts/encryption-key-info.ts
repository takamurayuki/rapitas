/**
 * encryption-key-info
 *
 * CLI helper: prints where the master encryption key is loaded from
 * (env / keychain / file / legacy-file / generated). Run with:
 *   bun run rapitas-backend/scripts/encryption-key-info.ts
 */
import { resolveEncryptionKey, getKeySource } from '../utils/common/encryption-key-resolver';

const key = resolveEncryptionKey();
const source = getKeySource();

console.log(`Encryption key source: ${source}`);
console.log(`Key fingerprint: ${key.slice(0, 8)}…${key.slice(-4)} (length=${key.length})`);

if (source === 'legacy-file') {
  console.warn(
    '\n[WARN] Legacy in-repo key file is still present. The key has been ' +
      'mirrored to the OS keychain / user file; you may delete the legacy ' +
      'file once you have verified normal operation.',
  );
}
