/**
 * generate-messages.mjs
 *
 * Merges per-namespace fragments under messages/fragments/{ja,en}/*.json into
 * the generated messages/{ja,en}.json consumed by IntlProvider. Each feature
 * adds one fragment file instead of editing the shared ja.json/en.json, so two
 * independent features never touch the same JSON object (see task #675).
 *
 * Exits non-zero if two fragments declare the same top-level namespace key,
 * to avoid a silent overwrite during the merge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const LOCALES = ['ja', 'en'];

/**
 * Reads all fragment files in a locale directory and merges them into a
 * single object, sorted by filename. Throws if two fragments share a
 * top-level key.
 * @param {string} fragmentsDir - Absolute path to messages/fragments/<locale>
 * @returns {{ merged: Record<string, unknown>, fileCount: number }}
 */
export function mergeFragments(fragmentsDir) {
  const files = fs
    .readdirSync(fragmentsDir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const merged = {};
  for (const file of files) {
    const fragment = JSON.parse(fs.readFileSync(path.join(fragmentsDir, file), 'utf8'));
    for (const key of Object.keys(fragment)) {
      if (Object.prototype.hasOwnProperty.call(merged, key)) {
        throw new Error(
          `generate-messages: duplicate top-level key "${key}" (from ${file}) — ` +
            `each namespace must live in exactly one fragment file`,
        );
      }
      merged[key] = fragment[key];
    }
  }
  return { merged, fileCount: files.length };
}

function mergeLocale(locale) {
  const fragmentsDir = path.join(ROOT, 'messages', 'fragments', locale);
  const { merged, fileCount } = mergeFragments(fragmentsDir);
  const outPath = path.join(ROOT, 'messages', `${locale}.json`);
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return { locale, namespaceCount: fileCount };
}

function main() {
  const results = LOCALES.map(mergeLocale);
  for (const { locale, namespaceCount } of results) {
    console.log(`generate-messages: ${locale}.json <- ${namespaceCount} fragments`);
  }
}

// NOTE: Guards CLI execution so the module can be imported as pure functions in tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
