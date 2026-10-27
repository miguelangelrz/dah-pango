import cors from '@fastify/cors';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import { blockForDate, bogotaDate } from '@dah-pango/domain';
import { asc, desc, eq } from 'drizzle-orm';
import Fastify from 'fastify';

export interface AppOptions {
  db?: Db;
  webOrigin?: string;
}

export function buildApp({ db, webOrigin }: AppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  app.register(cors, { origin: webOrigin ?? true, credentials: true });

  app.get('/health', async () => ({ ok: true }));

  // Public catalog for the landing: programs, líneas and clases.
  app.get('/catalog', async (_req, reply) => {
    if (!db) return reply.code(503).send({ error: 'Base de datos no configurada' });
    const [programs, tracks, courses, slots] = await Promise.all([
      db.select().from(schema.program).orderBy(asc(schema.program.name)),
      db.select().from(schema.track).orderBy(asc(schema.track.name)),
      db.select().from(schema.course).orderBy(asc(schema.course.title)),
      db.select().from(schema.courseSlot),
    ]);
    return { programs, tracks, courses, slots };
  });

  // The latest term and the block that contains today (Bogotá date).
  app.get('/terms/current', async (_req, reply) => {
    if (!db) return reply.code(503).send({ error: 'Base de datos no configurada' });
    const [term] = await db
      .select()
      .from(schema.term)
      .orderBy(desc(schema.term.startsOn))
      .limit(1);
    if (!term) return reply.code(404).send({ error: 'No hay semestre configurado' });
    const blocks = await db
      .select()
      .from(schema.block)
      .where(eq(schema.block.termId, term.id))
      .orderBy(asc(schema.block.number));
    const today = bogotaDate(new Date());
    return { term, blocks, currentBlock: blockForDate(blocks, today) ?? null };
  });

  return app;
}
