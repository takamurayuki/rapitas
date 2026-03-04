import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * This script specifically fixes the ai-agent.ts route issues
 */

async function fixAiAgentRoutes() {
  const filePath = join(process.cwd(), 'routes', 'ai-agent.ts');
  let content = await readFile(filePath, 'utf-8');

  // Fix developer-mode.ts: add missing destructured params
  const developerPath = join(process.cwd(), 'routes', 'developer-mode.ts');
  let devContent = await readFile(developerPath, 'utf-8');

  // Find all routes that use body or set but don't destructure them
  // Pattern: async () => or async ({ someParams }) => where body/set are used in the handler

  // Fix developer-mode.ts line 20 issue - find the route handler around line 20
  const devLines = devContent.split('\n');
  for (let i = 0; i < devLines.length; i++) {
    const line = devLines[i];

    // Look for async handlers that might be missing parameters
    if (line.includes('async (') && line.includes('=>')) {
      // Check next few lines for usage of body, set, params, query
      let needsBody = false;
      let needsSet = false;
      let needsParams = false;

      // Scan forward to find usage
      for (let j = i; j < Math.min(i + 20, devLines.length); j++) {
        const checkLine = devLines[j];
        if (checkLine.match(/\bbody\b/) && !checkLine.includes('{ body')) needsBody = true;
        if (checkLine.match(/\bset\b/) && !checkLine.includes('{ set')) needsSet = true;
        if (checkLine.match(/\bparams\b/) && !checkLine.includes('{ params')) needsParams = true;
      }

      // If handler needs params but doesn't have them, fix it
      if ((needsBody || needsSet || needsParams) && line.includes('async ()')) {
        const params = [];
        if (needsBody) params.push('body');
        if (needsSet) params.push('set');
        if (needsParams) params.push('params');

        devLines[i] = line.replace('async ()', `async ({ ${params.join(', ')} })`);
      }
    }
  }

  devContent = devLines.join('\n');
  await writeFile(developerPath, devContent, 'utf-8');
  console.log('Fixed developer-mode.ts');

  // Fix other files with similar issues
  const filesToFix = [
    'directories.ts',
    'execution-logs.ts',
  ];

  for (const fileName of filesToFix) {
    const filePath = join(process.cwd(), 'routes', fileName);
    try {
      let fileContent = await readFile(filePath, 'utf-8');

      // Fix patterns like async () => where params, set, body are used
      fileContent = fileContent.replace(
        /async\s*\(\s*\)\s*=>\s*\{([^}]*(?:params|set|body)[^}]*)\}/g,
        (match, functionBody) => {
          const params = [];
          if (functionBody.includes('params') && !functionBody.includes('{ params')) params.push('params');
          if (functionBody.includes('set') && !functionBody.includes('{ set')) params.push('set');
          if (functionBody.includes('body') && !functionBody.includes('{ body')) params.push('body');

          if (params.length > 0) {
            return match.replace('async ()', `async ({ ${params.join(', ')} })`);
          }
          return match;
        }
      );

      await writeFile(filePath, fileContent, 'utf-8');
      console.log(`Fixed ${fileName}`);
    } catch (error) {
      console.log(`Skipping ${fileName} - ${error.message}`);
    }
  }
}

// Fix specific route handler issues one by one
async function fixSpecificRoutes() {
  // Fix comments.ts line 35 - missing query parameter
  const commentsPath = join(process.cwd(), 'routes', 'comments.ts');
  try {
    let content = await readFile(commentsPath, 'utf-8');
    // Find the route around line 35 and add query to destructured params
    content = content.replace(
      /async\s*\(\s*\{\s*params\s*\}\s*\)\s*=>\s*\{([^}]*query[^}]*)\}/g,
      'async ({ params, query }) => {$1}'
    );
    await writeFile(commentsPath, content, 'utf-8');
    console.log('Fixed comments.ts');
  } catch (error) {
    console.log('Could not fix comments.ts:', error.message);
  }
}

async function main() {
  console.log('Fixing route parameter issues...\n');

  await fixAiAgentRoutes();
  await fixSpecificRoutes();

  console.log('\nDone!');
}

main().catch(console.error);