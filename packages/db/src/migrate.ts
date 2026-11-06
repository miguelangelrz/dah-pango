import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, migrationsFolder } from './index';

const { db, client } = createDb();
try {
  await migrate(db, { migrationsFolder });
  console.log('Migrations applied.');
} finally {
  await client.end();
}
