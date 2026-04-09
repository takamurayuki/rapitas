import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  // NOTE: After ADR-0006 the schema lives in prisma/schema/ as a
  // prismaSchemaFolder layout (one .prisma file per sub-domain). Prisma
  // CLI accepts a directory here and merges every .prisma file inside.
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations',
  },
  engine: 'classic',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
