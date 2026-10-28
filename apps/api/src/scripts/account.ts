import { parseArgs } from 'node:util';
import { createDb, schema } from '@dah-pango/db';
import { DOCUMENT_TYPES, normalizeDocumentNumber, type DocumentType } from '@dah-pango/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { hashPassword } from '../auth/password';

// Creates an account from the command line, or sets a new password on an existing one.
// The first directors are created here, since the seed only has placeholders for them:
//   pnpm account --document CC:1020345678 --name "Nombre" --phone 3001234567 --password ... --director en-rouge

const { values } = parseArgs({
  options: {
    document: { type: 'string' },
    name: { type: 'string' },
    phone: { type: 'string' },
    password: { type: 'string' },
    director: { type: 'string' },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const [rawType, rawNumber] = (values.document ?? '').split(':');
if (!DOCUMENT_TYPES.includes(rawType as DocumentType) || !rawNumber) {
  fail('Use --document TYPE:NUMBER, with TYPE one of CC, TI, CE, PA.');
}
const documentType = rawType as DocumentType;
const documentNumber = normalizeDocumentNumber(documentType, rawNumber);
if (!values.password || values.password.length < 8) fail('--password needs at least 8 characters.');

const { db, client } = createDb();
try {
  await db.transaction(async (tx) => {
    const program = values.director
      ? (await tx.select().from(schema.program).where(eq(schema.program.slug, values.director)))[0]
      : undefined;
    if (values.director && !program) fail(`No program with slug "${values.director}".`);

    let [person] = await tx
      .select()
      .from(schema.person)
      .where(
        and(
          eq(schema.person.documentType, documentType),
          eq(schema.person.documentNumber, documentNumber),
          isNull(schema.person.mergedInto),
        ),
      );

    // A new director takes over the seed's placeholder, keeping the clases and sessions assigned to it.
    if (!person && program) {
      const [placeholder] = await tx
        .select({ person: schema.person })
        .from(schema.roleGrant)
        .innerJoin(schema.person, eq(schema.person.id, schema.roleGrant.personId))
        .where(
          and(
            eq(schema.roleGrant.role, 'director'),
            eq(schema.roleGrant.programId, program.id),
            isNull(schema.person.documentNumber),
          ),
        );
      if (placeholder) {
        if (!values.name || !values.phone) fail('--name and --phone are needed for a new person.');
        [person] = await tx
          .update(schema.person)
          .set({ fullName: values.name, phone: values.phone, documentType, documentNumber })
          .where(eq(schema.person.id, placeholder.person.id))
          .returning();
        console.log(`Took over the placeholder director of ${program.name}.`);
      }
    }

    if (!person) {
      if (!values.name || !values.phone) fail('--name and --phone are needed for a new person.');
      [person] = await tx
        .insert(schema.person)
        .values({ fullName: values.name, phone: values.phone, documentType, documentNumber })
        .returning();
    }
    if (!person) throw new Error('Person insert failed');

    const passwordHash = await hashPassword(values.password!);
    const [had] = await tx.select().from(schema.account).where(eq(schema.account.personId, person.id));
    if (had) {
      await tx.update(schema.account).set({ passwordHash }).where(eq(schema.account.personId, person.id));
    } else {
      await tx.insert(schema.account).values({ personId: person.id, passwordHash });
    }

    if (program) {
      await tx
        .insert(schema.roleGrant)
        .values([
          { personId: person.id, role: 'teacher' },
          { personId: person.id, role: 'director', programId: program.id },
        ])
        .onConflictDoNothing();
    }
    console.log(`${had ? 'New password for' : 'Account created for'} ${person.fullName} (${documentType} ${documentNumber}).`);
  });
} finally {
  await client.end();
}
