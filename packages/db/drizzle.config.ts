import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Read the repo-root .env, like the migrate and seed scripts do.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://dahpango:dahpango@localhost:5432/dahpango',
  },
});
