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
    // NOTE: `prisma generate` does NOT open a database connection — it only reads
    // the schema files and emits TypeScript/JS client code. DATABASE_URL is
    // consumed only by `prisma db push`, `prisma migrate`, and runtime queries.
    //
    // `env()` throws PrismaConfigEnvError when DATABASE_URL is unset; there is
    // NO silent fallback. A dummy URL (e.g. postgresql://dummy:dummy@localhost/…)
    // must NOT be placed here: it would mislead future contributors into thinking
    // a connection-less generate phase still requires a reachable URL, and would
    // mask the real error (missing .env) at generate time while failing at runtime.
    //
    // → Set DATABASE_URL in rapitas-backend/.env (copy from .env.example).
    url: env('DATABASE_URL'),
  },
});
