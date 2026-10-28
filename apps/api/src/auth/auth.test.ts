import type { Me } from '@dah-pango/contracts';
import { schema } from '@dah-pango/db';
import { createTestDb } from '@dah-pango/db/testing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';

type TestDb = Awaited<ReturnType<typeof createTestDb>>['db'];

let db: TestDb;
let app: ReturnType<typeof buildApp>;
let terms: { id: string };
let policy: { id: string };

async function publish(kind: 'terms' | 'data_policy', version: string, publishedAt: string) {
  const [doc] = await db
    .insert(schema.legalDocument)
    .values({ kind, version, body: `${kind} ${version}`, publishedAt: new Date(publishedAt) })
    .returning();
  if (!doc) throw new Error('Legal document insert failed');
  return doc;
}

beforeEach(async () => {
  ({ db } = await createTestDb());
  app = buildApp({ db });
  terms = await publish('terms', '1', '2026-07-01');
  policy = await publish('data_policy', '1', '2026-07-01');
});

const ana = {
  fullName: 'Ana Gómez',
  documentType: 'CC',
  documentNumber: '1.020.345.678',
  phone: '300 123 4567',
  password: 'dancehall-26',
};

function cookieOf(res: { cookies: { name: string; value: string }[] }) {
  const c = res.cookies.find((c) => c.name === 'dp_session');
  return c ? `dp_session=${c.value}` : '';
}

async function signup(body: Record<string, string> = ana) {
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: body });
  return { res, cookie: cookieOf(res), me: res.json() as Me };
}

describe('signup and login', () => {
  it('creates a student account and logs them in', async () => {
    const { res, cookie, me } = await signup();
    expect(res.statusCode).toBe(201);
    expect(cookie).not.toBe('');
    expect(me.documentNumber).toBe('1020345678');
    expect(me.roles).toEqual([{ role: 'student', programId: null }]);
    expect(me.pendingLegalDocuments.map((d) => d.kind)).toEqual(['terms', 'data_policy']);

    const again = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(again.statusCode).toBe(200);
  });

  it('refuses a second account for the same document', async () => {
    await signup();
    const { res } = await signup({ ...ana, documentNumber: '1020345678' });
    expect(res.statusCode).toBe(409);
  });

  it('logs in with the document typed differently, and rejects a wrong password', async () => {
    await signup();
    const ok = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { documentType: 'CC', documentNumber: '1020345678', password: ana.password },
    });
    expect(ok.statusCode).toBe(200);
    expect(cookieOf(ok)).not.toBe('');

    const wrong = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { documentType: 'CC', documentNumber: '1020345678', password: 'otra-clave' },
    });
    expect(wrong.statusCode).toBe(401);

    const unknown = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { documentType: 'TI', documentNumber: '1020345678', password: ana.password },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
  });

  it('gives a walk-in on file their account, keeping the same person', async () => {
    const [walkIn] = await db
      .insert(schema.person)
      .values({ fullName: 'Ana', documentType: 'CC', documentNumber: '1020345678', phone: '3001234567' })
      .returning();
    const { res, me } = await signup();
    expect(res.statusCode).toBe(201);
    expect(me.id).toBe(walkIn?.id);
    expect(me.fullName).toBe('Ana Gómez');
  });

  it('ends the session on logout', async () => {
    const { cookie } = await signup();
    await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('explains what is wrong with the form', async () => {
    const { res } = await signup({ ...ana, password: 'corta' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/al menos 8/);
  });
});

describe('terms and data policy', () => {
  it('records the acceptance with the device', async () => {
    const { cookie } = await signup();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/consents',
      headers: { cookie, 'user-agent': 'Safari iPhone', 'x-forwarded-for': '190.25.1.2' },
      payload: { legalDocumentIds: [terms.id, policy.id] },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Me).pendingLegalDocuments).toEqual([]);

    const rows = await db.select().from(schema.consent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ userAgent: 'Safari iPhone', ip: '190.25.1.2', guardianName: null });
  });

  it('asks again when a new version is published', async () => {
    const { cookie } = await signup();
    await app.inject({
      method: 'POST',
      url: '/auth/consents',
      headers: { cookie },
      payload: { legalDocumentIds: [terms.id, policy.id] },
    });
    const terms2 = await publish('terms', '2', '2026-10-01');
    const me = (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).json() as Me;
    expect(me.pendingLegalDocuments.map((d) => d.id)).toEqual([terms2.id]);
  });

  it('refuses a partial acceptance', async () => {
    const { cookie } = await signup();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/consents',
      headers: { cookie },
      payload: { legalDocumentIds: [terms.id] },
    });
    expect(res.statusCode).toBe(409);
  });

  it('needs a guardian for a minor and stores their details', async () => {
    const { cookie, me } = await signup({ ...ana, documentType: 'TI', documentNumber: '1098765432' });
    expect(me.needsGuardian).toBe(true);
    const ids = [terms.id, policy.id];

    const without = await app.inject({
      method: 'POST',
      url: '/auth/consents',
      headers: { cookie },
      payload: { legalDocumentIds: ids },
    });
    expect(without.statusCode).toBe(400);

    const minorAsGuardian = await app.inject({
      method: 'POST',
      url: '/auth/consents',
      headers: { cookie },
      payload: {
        legalDocumentIds: ids,
        guardian: { fullName: 'Luis Gómez', documentType: 'TI', documentNumber: '123456', phone: '3109876543' },
      },
    });
    expect(minorAsGuardian.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/auth/consents',
      headers: { cookie },
      payload: {
        legalDocumentIds: ids,
        guardian: { fullName: 'Marta Gómez', documentType: 'CC', documentNumber: '52.123.456', phone: '3109876543' },
      },
    });
    expect(ok.statusCode).toBe(200);
    const rows = await db.select().from(schema.consent).where(eq(schema.consent.personId, me.id));
    expect(rows[0]).toMatchObject({
      guardianName: 'Marta Gómez',
      guardianDocumentType: 'CC',
      guardianDocument: '52123456',
      guardianPhone: '3109876543',
    });
  });
});
