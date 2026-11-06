import { createDb } from '@dah-pango/db';
import { sql } from 'drizzle-orm';
import { buildApp } from './app';
import { lockDueSessions } from './attendance/service';

const { db } = createDb();
const app = buildApp({ db, webOrigin: process.env.WEB_ORIGIN });

// Say right away when Postgres is unreachable, instead of failing on the first login.
await db.execute(sql`select 1`).then(
  () => app.log.info('Database reachable'),
  (err: Error) => app.log.error({ cause: (err.cause as Error | undefined)?.message ?? err.message }, 'Database unreachable: check DATABASE_URL and that Postgres is running (pnpm db:up)'),
);

const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
// Every route the API answers, so a 404 can be checked against this list.
if (process.env.NODE_ENV !== 'production') app.log.info(`Routes:\n${app.printRoutes({ commonPrefix: false })}`);

// Attendance locks 24 h after each sesión: every 10 minutes, unmarked students become Falta.
const LOCK_EVERY_MS = 10 * 60 * 1000;
async function runLockJob() {
  try {
    const locked = await lockDueSessions(db, new Date());
    if (locked > 0) app.log.info({ locked }, 'Closed attendance of finished sesiones');
  } catch (err) {
    app.log.error({ err }, 'Attendance lock job failed');
  }
}
void runLockJob();
setInterval(runLockJob, LOCK_EVERY_MS).unref();
