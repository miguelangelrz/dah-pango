import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'dp_session';
const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export async function startSession(db: Db, req: FastifyRequest, reply: FastifyReply, personId: string) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  // Each login is a good moment to drop this person's expired sessions.
  await db
    .delete(schema.authSession)
    .where(and(eq(schema.authSession.personId, personId), lt(schema.authSession.expiresAt, now)));
  await db.insert(schema.authSession).values({
    tokenHash: hashToken(token),
    personId,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY_MS),
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
  });
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** The person behind the request's cookie, or null when there is no live session. */
export async function sessionPersonId(db: Db, req: FastifyRequest): Promise<string | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const [row] = await db
    .select({ personId: schema.authSession.personId })
    .from(schema.authSession)
    .where(
      and(eq(schema.authSession.tokenHash, hashToken(token)), gt(schema.authSession.expiresAt, new Date())),
    );
  return row?.personId ?? null;
}

export async function endSession(db: Db, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) {
    await db.delete(schema.authSession).where(eq(schema.authSession.tokenHash, hashToken(token)));
  }
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
