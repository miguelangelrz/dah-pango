import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './index';

const { db, client } = createDb();
try {
  await migrate(db, { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
  console.log('Migrations applied.');
} finally {
  await client.end();
}
