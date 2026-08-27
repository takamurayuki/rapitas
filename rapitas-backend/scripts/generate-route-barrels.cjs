#!/usr/bin/env node
/**
 * generate-route-barrels
 *
 * Generates each domain's routes/<domain>/index.ts from two inputs:
 *   1. routes/route-barrel-legacy-manifest.json — a one-time transcription of
 *      the pre-existing hand-written import/export/.use() entries (see
 *      task #678 — replaces the hand-edited barrel with a build artifact so
 *      concurrent features never edit the same three lines).
 *   2. *.routes.ts files discovered by recursively scanning each domain
 *      directory — new routes are picked up automatically without ever
 *      touching this generated file.
 *
 * Usage:
 *   node scripts/generate-route-barrels.cjs           # write all 14 domain barrels
 *   node scripts/generate-route-barrels.cjs --check    # exit 1 if any barrel is out of sync
 */
const fs = require('fs');
const path = require('path');
const prettier = require('prettier');

const ROUTES_DIR = path.resolve(__dirname, '..', 'routes');
const MANIFEST_PATH = path.join(ROUTES_DIR, 'route-barrel-legacy-manifest.json');

// Fixed domain key list — `routes/index.ts` / `register-routes.ts` (out of
// scope for this generator) enumerate the same 14 domains.
const DOMAINS = [
  'organization',
  'tasks',
  'agents',
  'ai',
  'scheduling',
  'learning',
  'system',
  'workflow',
  'social',
  'analytics',
  'lifestyle',
  'memory',
  'self-improvement',
  'self-learning',
];

const HEADER = [
  '/**',
  ' * AUTO-GENERATED — DO NOT EDIT.',
  ' *',
  ' * Run `bun run generate:route-barrels` to regenerate from',
  ' * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery',
  ' * (see scripts/generate-route-barrels.cjs).',
  ' */',
].join('\n');

/**
 * Recursively finds every `*.routes.ts` file under a domain directory.
 *
 * @param {string} domainDir - absolute path to routes/<domain>
 * @returns {string[]} paths relative to domainDir, POSIX-separated, ascending sorted
 */
function discoverRouteFiles(domainDir) {
  const results = [];

  function walk(currentDir, relPrefix) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(currentDir, entry.name), relPath);
      } else if (entry.isFile() && entry.name.endsWith('.routes.ts')) {
        results.push(relPath);
      }
    }
  }

  walk(domainDir, '');
  results.sort();
  return results;
}

/**
 * Converts a discovered route file's relative path into a camelCase import
 * alias, e.g. `miss-signatures.routes.ts` -> `missSignaturesRoute`.
 *
 * @param {string} relPath - path returned by discoverRouteFiles
 * @returns {string} alias identifier
 */
function toAlias(relPath) {
  const withoutSuffix = relPath.replace(/\.routes\.ts$/, '');
  const tokens = withoutSuffix.split(/[\\/\-_.]/).filter(Boolean);
  const camel = tokens
    .map((token, i) =>
      i === 0 ? token.toLowerCase() : token.charAt(0).toUpperCase() + token.slice(1).toLowerCase(),
    )
    .join('');
  return `${camel}Route`;
}

/**
 * Converts a domain key into its `<domain>DomainRoutes` constant name,
 * e.g. `self-improvement` -> `selfImprovementDomainRoutes`.
 *
 * @param {string} domain - domain key
 * @returns {string} constant identifier
 */
function toDomainConst(domain) {
  const camel = domain
    .split('-')
    .map((token, i) => (i === 0 ? token : token.charAt(0).toUpperCase() + token.slice(1)))
    .join('');
  return `${camel}DomainRoutes`;
}

/**
 * Reads and validates one domain's legacy manifest entries.
 *
 * @param {Record<string, unknown>} manifest - parsed manifest JSON
 * @param {string} domain - domain key
 * @throws {Error} when the domain key or a required entry field is missing
 * @returns {Array<{importPath: string, exportName?: string, reExportStar?: boolean, export?: boolean, use?: boolean}>}
 */
function loadLegacyManifest(manifest, domain) {
  if (!Object.prototype.hasOwnProperty.call(manifest, domain)) {
    throw new Error(`route-barrel-legacy-manifest.json is missing domain key: "${domain}"`);
  }
  const entries = manifest[domain];
  if (!Array.isArray(entries)) {
    throw new Error(`route-barrel-legacy-manifest.json entry for "${domain}" must be an array`);
  }
  for (const entry of entries) {
    if (!entry || typeof entry.importPath !== 'string' || entry.importPath.length === 0) {
      throw new Error(`route-barrel-legacy-manifest.json entry in "${domain}" missing required field: importPath`);
    }
    if (!entry.reExportStar && (typeof entry.exportName !== 'string' || entry.exportName.length === 0)) {
      throw new Error(
        `route-barrel-legacy-manifest.json entry in "${domain}" (importPath="${entry.importPath}") missing required field: exportName`,
      );
    }
  }
  return entries;
}

/**
 * Builds the generated `routes/<domain>/index.ts` source text.
 *
 * @param {string} domain - domain key
 * @param {Array} legacyEntries - validated manifest entries for this domain
 * @param {string[]} discoveredFiles - `*.routes.ts` paths found by discoverRouteFiles
 * @throws {Error} when two discovered files would generate the same alias
 * @returns {string} generated file contents (always ends with a trailing newline)
 */
function generateDomainBarrel(domain, legacyEntries, discoveredFiles) {
  const importLines = ["import { Elysia } from 'elysia';"];
  const exportLines = [];
  const useNames = [];
  const seenAliases = new Set();

  for (const entry of legacyEntries) {
    if (entry.reExportStar) {
      exportLines.push(`export * from '${entry.importPath}';`);
      continue;
    }
    importLines.push(`import { ${entry.exportName} } from '${entry.importPath}';`);
    if (entry.export !== false) {
      exportLines.push(`export { ${entry.exportName} } from '${entry.importPath}';`);
    }
    if (entry.use !== false) {
      useNames.push(entry.exportName);
    }
  }

  for (const relPath of discoveredFiles) {
    const alias = toAlias(relPath);
    if (seenAliases.has(alias)) {
      throw new Error(`Duplicate route alias "${alias}" generated in domain "${domain}" (file: ${relPath})`);
    }
    seenAliases.add(alias);
    const importPath = `./${relPath.replace(/\.ts$/, '')}`;
    importLines.push(`import ${alias} from '${importPath}';`);
    useNames.push(alias);
  }

  const domainConst = toDomainConst(domain);
  const useChain = useNames.map((name) => `  .use(${name})`).join('\n');
  const routesDecl =
    useNames.length > 0
      ? `export const ${domainConst} = new Elysia()\n${useChain};`
      : `export const ${domainConst} = new Elysia();`;

  return [HEADER, importLines.join('\n'), '', exportLines.join('\n'), '', routesDecl, ''].join('\n');
}

async function main() {
  const checkMode = process.argv.includes('--check');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

  const manifestKeys = Object.keys(manifest);
  const missingKeys = DOMAINS.filter((d) => !manifestKeys.includes(d));
  const unknownKeys = manifestKeys.filter((k) => !DOMAINS.includes(k));
  if (missingKeys.length > 0) {
    throw new Error(`route-barrel-legacy-manifest.json is missing domain keys: ${missingKeys.join(', ')}`);
  }
  if (unknownKeys.length > 0) {
    throw new Error(`route-barrel-legacy-manifest.json has unknown domain keys: ${unknownKeys.join(', ')}`);
  }

  const prettierConfig = (await prettier.resolveConfig(ROUTES_DIR)) || {};

  const drifted = [];
  for (const domain of DOMAINS) {
    const domainDir = path.join(ROUTES_DIR, domain);
    const legacyEntries = loadLegacyManifest(manifest, domain);
    const discoveredFiles = discoverRouteFiles(domainDir);
    const outPath = path.join(domainDir, 'index.ts');
    const raw = generateDomainBarrel(domain, legacyEntries, discoveredFiles);
    // Formatted through the project's own prettier config so the committed
    // generated file matches what `bunx prettier --check` expects — otherwise
    // --check would flag drift against its own freshly (unformatted) output.
    const generated = await prettier.format(raw, { ...prettierConfig, parser: 'typescript', filepath: outPath });

    if (checkMode) {
      const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
      if (current !== generated) {
        drifted.push(domain);
      }
    } else {
      fs.mkdirSync(domainDir, { recursive: true });
      fs.writeFileSync(outPath, generated);
    }
  }

  if (checkMode) {
    if (drifted.length > 0) {
      console.error(`Route barrel drift detected in domain(s): ${drifted.join(', ')}`);
      console.error('Run `bun run generate:route-barrels` in rapitas-backend/ and commit the result.');
      process.exit(1);
    }
    console.log(`Route barrels are up to date (${DOMAINS.length} domains checked).`);
  } else {
    console.log(`Generated route barrels for ${DOMAINS.length} domains.`);
  }
}

module.exports = { discoverRouteFiles, toAlias, toDomainConst, loadLegacyManifest, generateDomainBarrel };

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
