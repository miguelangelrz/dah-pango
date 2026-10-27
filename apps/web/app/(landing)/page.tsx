import { PROGRAMS } from '@dah-pango/db/seed-data';
import Link from 'next/link';

const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function formatTime(t: string) {
  const [h = 0, m = 0] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export default function Landing() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between py-6">
        <span className="font-display text-2xl tracking-wide">DAH PANGO</span>
        <Link
          href="/app"
          className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-chalk"
        >
          Ingresar
        </Link>
      </header>

      <section className="py-12 sm:py-20">
        <h1 className="font-display text-6xl leading-none uppercase sm:text-8xl">
          Hip hop, house
          <br />
          <span className="text-house">y dancehall</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-mute">
          Procesos formativos en Teusaquillo, Bogotá. Dos programas, un mismo piso.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {PROGRAMS.map((p) => (
          <article
            key={p.slug}
            className="rounded-2xl border border-line bg-concrete p-5"
            style={{ borderLeft: `4px solid ${p.accentColor}` }}
          >
            <h2 className="font-display text-4xl uppercase" style={{ color: p.accentColor }}>
              {p.name}
            </h2>
            <p className="mt-1 text-mute">{p.description}</p>
            <ul className="mt-4 space-y-3">
              {p.tracks.map((t) => (
                <li key={t.slug}>
                  <p className="font-semibold">{t.name}</p>
                  <p className="text-sm text-mute">
                    {p.courses
                      .filter((c) => c.tracks.includes(t.slug))
                      .flatMap((c) =>
                        c.slots.map(
                          (s) =>
                            `${WEEKDAYS[s.weekday - 1]} ${formatTime(s.startsAt)}–${formatTime(s.endsAt)} ${c.title}`,
                        ),
                      )
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <footer className="mt-16 border-t border-line pt-6 text-sm text-mute">
        Centro Artístico y Cultural Dah Pango · Calle 50 #15-60, Teusaquillo, Bogotá
      </footer>
    </main>
  );
}
