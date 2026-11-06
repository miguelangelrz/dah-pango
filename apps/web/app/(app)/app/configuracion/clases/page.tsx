import type { AdminCourse } from '@dah-pango/contracts';
import { weekdayLabel } from '@dah-pango/domain';
import Link from 'next/link';
import { formatDuration } from '@/lib/format';
import { apiGet } from '@/lib/session';

export default async function CoursesPage() {
  const courses = (await apiGet<AdminCourse[]>('/admin/courses')) ?? [];
  const groups = new Map<string, { name: string; color: string | null; courses: AdminCourse[] }>();
  for (const c of courses) {
    const key = c.program?.id ?? 'general';
    const group = groups.get(key) ?? {
      name: c.program?.name ?? 'Clases generales',
      color: c.program?.accentColor ?? null,
      courses: [],
    };
    group.courses.push(c);
    groups.set(key, group);
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-mute">
        Toca una clase para cambiar sus días, horas o duración. Las sesiones que todavía no han
        pasado se ajustan solas.
      </p>
      {[...groups.entries()].map(([key, g]) => (
        <section key={key} className="space-y-3">
          <h2 className="font-display text-3xl uppercase" style={g.color ? { color: g.color } : undefined}>
            {g.name}
          </h2>
          <ul className="space-y-2">
            {g.courses.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/configuracion/clases/${c.id}`}
                  className="flex items-center justify-between gap-3 rounded-box border border-base-300 bg-base-200 p-4 transition hover:border-primary"
                >
                  <div>
                    <p className="font-semibold">{c.title}</p>
                    {c.kind === 'special' ? (
                      <p className="text-sm text-mute">Clase especial (fechas sueltas)</p>
                    ) : c.slots.length === 0 ? (
                      <p className="text-sm text-mute">Sin horario</p>
                    ) : (
                      c.slots.map((s, i) => (
                        <p key={i} className="text-sm text-mute">
                          {weekdayLabel(s.weekday)} {s.startsAt}–{s.endsAt} · {formatDuration(s.durationMinutes)}
                        </p>
                      ))
                    )}
                  </div>
                  <span aria-hidden className="text-mute">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {courses.length === 0 && <p className="text-mute">Todavía no hay clases.</p>}
    </div>
  );
}
