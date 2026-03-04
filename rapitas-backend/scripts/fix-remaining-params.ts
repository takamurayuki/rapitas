import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Fix remaining parameter issues in specific files
 */

async function fixFile(fileName: string, fixes: Array<{ line: number, issue: string, fix: string }>) {
  const filePath = join(process.cwd(), 'routes', fileName);
  let content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const { line, issue, fix } of fixes) {
    if (issue === 'missing-params') {
      // Find the async handler definition before this line
      for (let i = line - 1; i >= 0; i--) {
        if (lines[i].includes('async (') && lines[i].includes('=>')) {
          // Add the missing parameter
          if (!lines[i].includes(fix)) {
            lines[i] = lines[i].replace(/async\s*\(\s*\{([^}]*)\}\s*\)/, (match, params) => {
              const paramList = params.split(',').map(p => p.trim()).filter(Boolean);
              if (!paramList.includes(fix)) {
                paramList.push(fix);
              }
              return `async ({ ${paramList.join(', ')} }: any)`;
            });
            // If no destructuring yet, add it
            if (lines[i].includes('async ()')) {
              lines[i] = lines[i].replace('async ()', `async ({ ${fix} }: any)`);
            }
          }
          break;
        }
      }
    }
  }

  content = lines.join('\n');
  await writeFile(filePath, content, 'utf-8');
  console.log(`Fixed ${fileName}`);
}

async function main() {
  console.log('Fixing remaining parameter issues...\n');

  const fixes = [
    {
      file: 'comments.ts',
      fixes: [{ line: 35, issue: 'missing-params', fix: 'query' }]
    },
    {
      file: 'developer-mode.ts',
      fixes: [
        { line: 20, issue: 'missing-params', fix: 'body' },
        { line: 23, issue: 'missing-params', fix: 'set' },
      ]
    },
    {
      file: 'directories.ts',
      fixes: [{ line: 12, issue: 'missing-params', fix: 'params' }]
    },
    {
      file: 'execution-logs.ts',
      fixes: [
        { line: 17, issue: 'missing-params', fix: 'params' },
        { line: 19, issue: 'missing-params', fix: 'set' },
      ]
    },
    {
      file: 'github.ts',
      fixes: [{ line: 36, issue: 'missing-params', fix: 'params' }]
    },
    {
      file: 'habits.ts',
      fixes: [{ line: 25, issue: 'missing-params', fix: 'body' }]
    },
    {
      file: 'labels.ts',
      fixes: [{ line: 30, issue: 'missing-params', fix: 'body' }]
    },
    {
      file: 'milestones.ts',
      fixes: [{ line: 12, issue: 'missing-params', fix: 'params' }]
    },
    {
      file: 'notifications.ts',
      fixes: [{ line: 11, issue: 'missing-params', fix: 'params' }]
    },
    {
      file: 'schedules.ts',
      fixes: [{ line: 11, issue: 'missing-params', fix: 'params' }]
    },
    {
      file: 'screenshots.ts',
      fixes: [{ line: 24, issue: 'missing-params', fix: 'body' }]
    },
    {
      file: 'study-streaks.ts',
      fixes: [{ line: 9, issue: 'missing-params', fix: 'body' }]
    },
    {
      file: 'system-prompts.ts',
      fixes: [
        { line: 170, issue: 'missing-params', fix: 'params' },
        { line: 172, issue: 'missing-params', fix: 'set' },
      ]
    },
    {
      file: 'time-entries.ts',
      fixes: [{ line: 17, issue: 'missing-params', fix: 'body' }]
    },
  ];

  for (const { file, fixes: fileFixes } of fixes) {
    try {
      await fixFile(file, fileFixes);
    } catch (error) {
      console.log(`Error fixing ${file}:`, error.message);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);