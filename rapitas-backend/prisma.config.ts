import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  // NOTE: After ADR-0006 the schema lives in prisma/schema/ as a
  // prismaSchemaFolder layout (one .prisma file per sub-domain). Prisma
  // CLI accepts a directory here and merges every .prisma file inside.
  schema: process.env.RAPITAS_DB_PROVIDER === 'sqlite' ? 'prisma/schema.desktop' : 'prisma/schema',
  migrations: {
    path:
      process.env.RAPITAS_DB_PROVIDER === 'sqlite'
        ? 'prisma/migrations.desktop'
        : 'prisma/migrations',
  },
  engine: 'classic',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
