import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * This script fixes parameter access issues in Elysia route handlers
 * by adding inline schema definitions where they're missing.
 */

interface RouteInfo {
  method: string;
  path: string;
  handlerStart: number;
  handlerEnd: number;
  hasSchema: boolean;
  parameters: Set<string>;
  bodyProperties?: string[];
}

function extractParameters(handlerCode: string): Set<string> {
  const params = new Set<string>();

  // Match destructured parameters like { body, params, query, set }
  const destructureMatch = handlerCode.match(/async\s*\(\s*\{([^}]+)\}\s*\)/);
  if (destructureMatch) {
    destructureMatch[1].split(',').forEach(param => {
      const cleanParam = param.trim().split(':')[0].trim();
      if (cleanParam) params.add(cleanParam);
    });
  }

  return params;
}

function extractBodyProperties(handlerCode: string): string[] | undefined {
  const properties: string[] = [];

  // Match destructuring from body like: const { name, description } = body;
  const destructureMatch = handlerCode.match(/const\s*\{([^}]+)\}\s*=\s*body/);
  if (destructureMatch) {
    destructureMatch[1].split(',').forEach(prop => {
      const cleanProp = prop.trim();
      if (cleanProp) properties.push(cleanProp);
    });
    return properties;
  }

  // Also check for direct property access like body.name, body.description
  const propertyMatches = handlerCode.matchAll(/body\.(\w+)/g);
  const foundProps = new Set<string>();
  for (const match of propertyMatches) {
    foundProps.add(match[1]);
  }

  return foundProps.size > 0 ? Array.from(foundProps) : undefined;
}

function findRoutes(content: string): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const methods = ['get', 'post', 'put', 'patch', 'delete'];

  for (const method of methods) {
    // Match route definitions like .post("/path", async ({ body }) => { ... }, { schema })
    const routeRegex = new RegExp(`\\.${method}\\s*\\(\\s*["'/]([^"']+)["']\\s*,\\s*(async\\s*\\([^)]+\\)\\s*=>\\s*\\{)`, 'g');
    let match;

    while ((match = routeRegex.exec(content)) !== null) {
      const path = match[1];
      const handlerStart = match.index! + match[0].indexOf('async');

      // Find the end of the handler function
      let braceCount = 0;
      let inHandler = false;
      let handlerEnd = handlerStart;

      for (let i = handlerStart; i < content.length; i++) {
        if (content[i] === '{') {
          if (!inHandler) inHandler = true;
          braceCount++;
        } else if (content[i] === '}') {
          braceCount--;
          if (braceCount === 0 && inHandler) {
            handlerEnd = i + 1;
            break;
          }
        }
      }

      // Check if there's already a schema after the handler
      const afterHandler = content.substring(handlerEnd, Math.min(handlerEnd + 200, content.length));
      const hasSchema = /^\s*,\s*\{/.test(afterHandler);

      // Extract handler code and analyze it
      const handlerCode = content.substring(handlerStart, handlerEnd);
      const parameters = extractParameters(handlerCode);
      const bodyProperties = parameters.has('body') ? extractBodyProperties(handlerCode) : undefined;

      routes.push({
        method,
        path,
        handlerStart,
        handlerEnd,
        hasSchema,
        parameters,
        bodyProperties
      });
    }
  }

  return routes.sort((a, b) => b.handlerEnd - a.handlerEnd); // Sort in reverse order for safe replacement
}

function generateSchema(params: Set<string>, bodyProperties?: string[]): string {
  const schemaParts: string[] = [];

  if (params.has('body') && bodyProperties && bodyProperties.length > 0) {
    const bodySchema = bodyProperties.map(prop =>
      `        ${prop}: t.String({ minLength: 1 })`
    ).join(',\n');

    schemaParts.push(`      body: t.Object({\n${bodySchema}\n      })`);
  }

  if (params.has('params')) {
    // For now, we'll assume params.id is common
    schemaParts.push(`      params: t.Object({\n        id: t.String()\n      })`);
  }

  if (schemaParts.length === 0) {
    return '';
  }

  return `,\n    {\n${schemaParts.join(',\n')}\n    }`;
}

async function fixFile(filePath: string): Promise<boolean> {
  const content = await readFile(filePath, 'utf-8');
  let modifiedContent = content;
  let hasChanges = false;

  // Check if file imports 't' from elysia
  const hasElysiaTImport = /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["']elysia["']/.test(content);

  const routes = findRoutes(content);

  for (const route of routes) {
    // Skip if route already has schema
    if (route.hasSchema) continue;

    // Skip if no parameters need schemas
    if (!route.parameters.has('body') && !route.parameters.has('params')) continue;

    // Generate schema based on usage
    const schema = generateSchema(route.parameters, route.bodyProperties);
    if (!schema) continue;

    // If we need to add schema and 't' is not imported, skip this file
    // (we'll handle imports in a separate pass to avoid complexity)
    if (!hasElysiaTImport) {
      console.log(`Skipping ${filePath} - needs 't' import`);
      continue;
    }

    // Insert schema after the handler
    modifiedContent =
      modifiedContent.slice(0, route.handlerEnd) +
      schema +
      modifiedContent.slice(route.handlerEnd);

    hasChanges = true;
  }

  if (hasChanges) {
    await writeFile(filePath, modifiedContent, 'utf-8');
    return true;
  }

  return false;
}

async function addTImports(filePath: string): Promise<boolean> {
  let content = await readFile(filePath, 'utf-8');

  // Check if file needs 't' import
  const needsTImport = content.includes('t.Object') || content.includes('t.String') || content.includes('t.Number');
  const hasElysiaTImport = /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["']elysia["']/.test(content);

  if (needsTImport && !hasElysiaTImport) {
    // Find existing Elysia import
    const elysiaImportMatch = content.match(/import\s*\{([^}]+)\}\s*from\s*["']elysia["']/);

    if (elysiaImportMatch) {
      // Add 't' to existing import
      const imports = elysiaImportMatch[1];
      const newImports = `${imports.trim()}, t`;
      content = content.replace(elysiaImportMatch[0], `import { ${newImports} } from "elysia"`);
    } else {
      // Add new import line after other imports
      const lastImportMatch = content.match(/(?:^|\n)(import[^;]+;)/g);
      if (lastImportMatch) {
        const lastImport = lastImportMatch[lastImportMatch.length - 1];
        const insertPos = content.lastIndexOf(lastImport) + lastImport.length;
        content = content.slice(0, insertPos) + '\nimport { t } from "elysia";' + content.slice(insertPos);
      }
    }

    await writeFile(filePath, content, 'utf-8');
    return true;
  }

  return false;
}

async function main() {
  console.log('Fixing parameter access issues in route handlers...\n');

  const routesDir = join(process.cwd(), 'routes');
  const files = await readdir(routesDir);

  let filesNeedingTImport: string[] = [];
  let fixedFiles = 0;

  // First pass: identify files needing schemas and t import
  for (const file of files) {
    if (!file.endsWith('.ts')) continue;

    const filePath = join(routesDir, file);
    const content = await readFile(filePath, 'utf-8');
    const routes = findRoutes(content);

    const needsSchema = routes.some(r =>
      !r.hasSchema && (r.parameters.has('body') || r.parameters.has('params'))
    );

    if (needsSchema) {
      const hasElysiaTImport = /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*["']elysia["']/.test(content);
      if (!hasElysiaTImport) {
        filesNeedingTImport.push(filePath);
      }
    }
  }

  // Add t imports where needed
  console.log('Adding t imports to files that need them...');
  for (const filePath of filesNeedingTImport) {
    if (await addTImports(filePath)) {
      console.log(`Added t import to ${filePath}`);
    }
  }

  // Second pass: fix parameter access issues
  console.log('\nFixing parameter access issues...');
  for (const file of files) {
    if (!file.endsWith('.ts')) continue;

    const filePath = join(routesDir, file);
    if (await fixFile(filePath)) {
      console.log(`Fixed ${file}`);
      fixedFiles++;
    }
  }

  console.log(`\nTotal files fixed: ${fixedFiles}`);
}

main().catch(console.error);