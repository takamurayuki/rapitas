import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Final fix for specific files with parameter issues
 */

const fileFixes = {
  'comments.ts': {
    // Line 35: using query without destructuring it
    search: /async\s*\(\s*\{\s*params\s*\}\s*:\s*any\s*\)/g,
    replace: 'async ({ params, query }: any)'
  },
  'directories.ts': {
    // Line 12: using params without destructuring it
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ params }: any) =>'
  },
  'execution-logs.ts': {
    // Multiple issues with params and set
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ params, set }: any) =>'
  },
  'github.ts': {
    // Line 36: using params
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ params }: any) =>'
  },
  'habits.ts': {
    // Line 25: using body
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ body }: any) =>'
  },
  'labels.ts': {
    // Line 30: using body
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ body }: any) =>'
  },
  'milestones.ts': {
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ params }: any) =>'
  },
  'notifications.ts': {
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ params }: any) =>'
  },
  'schedules.ts': {
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ params }: any) =>'
  },
  'screenshots.ts': {
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ body }: any) =>'
  },
  'study-streaks.ts': {
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ body }: any) =>'
  },
  'system-prompts.ts': {
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ params, set }: any) =>'
  },
  'time-entries.ts': {
    search: /async\s*\(\s*\)\s*=>/g,
    replace: 'async ({ body }: any) =>'
  }
};

async function fixFile(fileName: string, fix: { search: RegExp; replace: string }) {
  const filePath = join(process.cwd(), 'routes', fileName);
  try {
    let content = await readFile(filePath, 'utf-8');
    const modified = content.replace(fix.search, fix.replace);

    if (modified !== content) {
      await writeFile(filePath, modified, 'utf-8');
      console.log(`✓ Fixed ${fileName}`);
      return true;
    } else {
      console.log(`⚠ No changes needed for ${fileName}`);
      return false;
    }
  } catch (error) {
    console.log(`✗ Error fixing ${fileName}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('Applying final parameter fixes...\n');

  let fixedCount = 0;
  for (const [fileName, fix] of Object.entries(fileFixes)) {
    if (await fixFile(fileName, fix)) {
      fixedCount++;
    }
  }

  console.log(`\nTotal files fixed: ${fixedCount}`);
}

main().catch(console.error);