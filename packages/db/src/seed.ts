import { bogotaInstant, blockForDate, generateBlocks, occurrences } from '@dah-pango/domain';
import { createDb, schema } from './index';
import { PROGRAMS, TERM_2026_2 } from './seed-data';

// Loads the 2026-2 catalog and generates its sessions. Run on an empty database.
// Directors are placeholders until the academy gives real names and documents.

const PLACEHOLDER_PHONE = '0000000';

async function main() {
  const { db, client } = createDb();
  try {
    await db.transaction(async (tx) => {
      const [term] = await tx.insert(schema.term).values(TERM_2026_2).returning();
      if (!term) throw new Error('Term insert failed');

      const blockRows = await tx
        .insert(schema.block)
        .values(
          generateBlocks(term.startsOn, term.endsOn).map((b) => ({ termId: term.id, ...b })),
        )
        .returning();
      const blockRanges = blockRows.map((b) => ({
        number: b.number,
        startsOn: b.startsOn,
        endsOn: b.endsOn,
      }));

      for (const p of PROGRAMS) {
        const [program] = await tx
          .insert(schema.program)
          .values({
            slug: p.slug,
            name: p.name,
            description: p.description,
            accentColor: p.accentColor,
          })
          .returning();
        if (!program) throw new Error(`Program insert failed: ${p.slug}`);

        const [director] = await tx
          .insert(schema.person)
          .values({ fullName: `Dirección ${p.name} (por definir)`, phone: PLACEHOLDER_PHONE })
          .returning();
        if (!director) throw new Error('Director insert failed');
        await tx.insert(schema.roleGrant).values([
          { personId: director.id, role: 'teacher' },
          { personId: director.id, role: 'director', programId: program.id },
        ]);

        const trackIds = new Map<string, string>();
        for (const t of p.tracks) {
          const [row] = await tx
            .insert(schema.track)
            .values({ programId: program.id, ...t })
            .returning();
          if (row) trackIds.set(t.slug, row.id);
        }

        for (const c of p.courses) {
          const [course] = await tx
            .insert(schema.course)
            .values({
              programId: program.id,
              slug: c.slug,
              title: c.title,
              style: c.style,
              defaultTeacherId: director.id,
            })
            .returning();
          if (!course) throw new Error(`Course insert failed: ${c.slug}`);

          await tx
            .insert(schema.courseSlot)
            .values(c.slots.map((s) => ({ courseId: course.id, ...s })));
          await tx.insert(schema.trackCourse).values(
            c.tracks.map((slug) => {
              const trackId = trackIds.get(slug);
              if (!trackId) throw new Error(`Unknown track ${slug}`);
              return { trackId, courseId: course.id };
            }),
          );

          const sessions = c.slots.flatMap((s) =>
            occurrences(s.weekday, term.startsOn, term.endsOn).map((date) => ({
              courseId: course.id,
              termId: term.id,
              blockId: blockRows.find((b) => b.number === blockForDate(blockRanges, date)?.number)
                ?.id,
              startsAt: bogotaInstant(date, s.startsAt),
              endsAt: bogotaInstant(date, s.endsAt),
              teacherId: director.id,
              topic: c.topic,
            })),
          );
          await tx.insert(schema.session).values(sessions);
        }
      }

      await tx.insert(schema.legalDocument).values([
        {
          kind: 'terms',
          version: 'borrador-1',
          body: 'Borrador. El texto final de los Términos y condiciones lo entrega la academia.',
          publishedAt: new Date(),
        },
        {
          kind: 'data_policy',
          version: 'borrador-1',
          body: 'Borrador. La Política de tratamiento de datos (Ley 1581 de 2012) la entrega la academia.',
          publishedAt: new Date(),
        },
      ]);
    });
    console.log('Seed done: 2026-2 term, 2 programs, 8 líneas, 15 clases.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
