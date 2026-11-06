import {
  acceptLegalDocuments,
  login,
  signup,
  type Me,
  type PendingLegalDocument,
} from '@dah-pango/contracts';
import type { Db } from '@dah-pango/db';
import { schema } from '@dah-pango/db';
import {
  needsGuardian,
  normalizeDocumentNumber,
  pendingLegalDocuments,
  type DocumentType,
  type LegalDocumentKind,
} from '@dah-pango/domain';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password';
import { endSession, sessionPersonId, startSession } from './sessions';

const WRONG_LOGIN = 'Documento o contraseña incorrectos';

function parse<T extends z.ZodType>(contract: T, body: unknown, reply: FastifyReply): z.infer<T> | null {
  const result = contract.safeParse(body);
  if (result.success) return result.data;
  reply.code(400).send({ error: result.error.issues[0]?.message ?? 'Datos inválidos' });
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/** People are found by document; a merged duplicate points at the person who stays. */
async function findPersonByDocument(db: Db, type: DocumentType, number: string) {
  const [row] = await db
    .select({ person: schema.person, passwordHash: schema.account.passwordHash })
    .from(schema.person)
    .leftJoin(schema.account, eq(schema.account.personId, schema.person.id))
    .where(
      and(
        eq(schema.person.documentType, type),
        eq(schema.person.documentNumber, number),
        isNull(schema.person.mergedInto),
      ),
    );
  return row ?? null;
}

async function pendingFor(db: Db, personId: string): Promise<PendingLegalDocument[]> {
  const [docs, consents] = await Promise.all([
    db.select().from(schema.legalDocument),
    db
      .select({ id: schema.consent.legalDocumentId })
      .from(schema.consent)
      .where(eq(schema.consent.personId, personId)),
  ]);
  const typed = docs.map((d) => ({ ...d, kind: d.kind as LegalDocumentKind }));
  return pendingLegalDocuments(
    typed,
    consents.map((c) => c.id),
    new Date(),
  ).map(({ id, kind, version, body }) => ({ id, kind, version, body }));
}

export async function loadMe(db: Db, personId: string): Promise<Me | null> {
  const [person] = await db.select().from(schema.person).where(eq(schema.person.id, personId));
  if (!person?.documentType || !person.documentNumber) return null;
  const documentType = person.documentType as DocumentType;
  const roles = await db
    .select({ role: schema.roleGrant.role, programId: schema.roleGrant.programId })
    .from(schema.roleGrant)
    .where(eq(schema.roleGrant.personId, personId));
  return {
    id: person.id,
    fullName: person.fullName,
    documentType,
    documentNumber: person.documentNumber,
    roles: roles as Me['roles'],
    needsGuardian: needsGuardian(documentType),
    pendingLegalDocuments: await pendingFor(db, personId),
  };
}

/**
 * Guard for app routes: replies 401 without a session and 403 while the current terms
 * and data policy aren't accepted. Returns the person when the request may go on.
 */
export async function requireMember(db: Db, req: FastifyRequest, reply: FastifyReply) {
  const personId = await sessionPersonId(db, req);
  const me = personId ? await loadMe(db, personId) : null;
  if (!me) {
    reply.code(401).send({ error: 'Ingresa de nuevo' });
    return null;
  }
  if (me.pendingLegalDocuments.length > 0) {
    reply.code(403).send({ error: 'Acepta los términos para continuar', code: 'consent_required' });
    return null;
  }
  return me;
}

export function registerAuthRoutes(app: FastifyInstance, db: Db) {
  // Sign up. A walk-in already on file with the same document gets the account, keeping their history.
  app.post('/auth/signup', async (req, reply) => {
    const body = parse(signup, req.body, reply);
    if (!body) return;
    const documentNumber = normalizeDocumentNumber(body.documentType, body.documentNumber);
    if (documentNumber.length < 3) return reply.code(400).send({ error: 'Número de documento inválido' });

    const existing = await findPersonByDocument(db, body.documentType, documentNumber);
    if (existing?.passwordHash) {
      return reply.code(409).send({ error: 'Ya hay una cuenta con este documento. Ingresa con tu contraseña.' });
    }
    const passwordHash = await hashPassword(body.password);

    let personId: string;
    try {
      personId = await db.transaction(async (tx) => {
        let id = existing?.person.id;
        if (id) {
          await tx
            .update(schema.person)
            .set({ fullName: body.fullName, phone: body.phone })
            .where(eq(schema.person.id, id));
        } else {
          const [created] = await tx
            .insert(schema.person)
            .values({
              fullName: body.fullName,
              documentType: body.documentType,
              documentNumber,
              phone: body.phone,
            })
            .returning({ id: schema.person.id });
          if (!created) throw new Error('Person insert failed');
          id = created.id;
        }
        await tx.insert(schema.account).values({ personId: id, passwordHash });
        await tx.insert(schema.roleGrant).values({ personId: id, role: 'student' }).onConflictDoNothing();
        return id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: 'Ya hay una cuenta con este documento. Ingresa con tu contraseña.' });
      }
      throw err;
    }

    await startSession(db, req, reply, personId);
    return reply.code(201).send(await loadMe(db, personId));
  });

  app.post('/auth/login', async (req, reply) => {
    const body = parse(login, req.body, reply);
    if (!body) return;
    const documentNumber = normalizeDocumentNumber(body.documentType, body.documentNumber);
    const found = await findPersonByDocument(db, body.documentType, documentNumber);
    const ok = found?.passwordHash
      ? await verifyPassword(body.password, found.passwordHash)
      : await burnPasswordCheck(body.password);
    if (!found || !ok) return reply.code(401).send({ error: WRONG_LOGIN });

    await startSession(db, req, reply, found.person.id);
    return loadMe(db, found.person.id);
  });

  app.post('/auth/logout', async (req, reply) => {
    await endSession(db, req, reply);
    return { ok: true };
  });

  app.get('/auth/me', async (req, reply) => {
    const personId = await sessionPersonId(db, req);
    const me = personId ? await loadMe(db, personId) : null;
    if (!me) return reply.code(401).send({ error: 'No has ingresado' });
    return me;
  });

  // Acceptance of the current terms and data policy, with the device it came from.
  app.post('/auth/consents', async (req, reply) => {
    const personId = await sessionPersonId(db, req);
    const me = personId ? await loadMe(db, personId) : null;
    if (!me) return reply.code(401).send({ error: 'No has ingresado' });
    const body = parse(acceptLegalDocuments, req.body, reply);
    if (!body) return;

    const pending = new Set(me.pendingLegalDocuments.map((d) => d.id));
    const sent = new Set(body.legalDocumentIds);
    if (pending.size !== sent.size || [...pending].some((id) => !sent.has(id))) {
      return reply
        .code(409)
        .send({ error: 'Los documentos cambiaron mientras los leías. Revísalos de nuevo.' });
    }
    if (me.needsGuardian && !body.guardian) {
      return reply.code(400).send({ error: 'Un acudiente debe aceptar por ser menor de edad' });
    }
    const g = me.needsGuardian ? body.guardian : undefined;

    await db
      .insert(schema.consent)
      .values(
        [...pending].map((legalDocumentId) => ({
          personId: me.id,
          legalDocumentId,
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
          guardianName: g?.fullName ?? null,
          guardianDocumentType: g?.documentType ?? null,
          guardianDocument: g ? normalizeDocumentNumber(g.documentType, g.documentNumber) : null,
          guardianPhone: g?.phone ?? null,
        })),
      )
      .onConflictDoNothing();

    return loadMe(db, me.id);
  });
}
