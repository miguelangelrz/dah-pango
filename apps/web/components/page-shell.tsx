import Link from 'next/link';

/** The frame of an app screen: logo, a way back, the title and an optional intro line. */
export function PageShell({
  title,
  intro,
  back = '/app',
  children,
}: {
  title: string;
  intro?: React.ReactNode;
  back?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-8">
      <header className="flex items-center justify-between">
        <Link href="/app" className="font-display text-2xl tracking-wide">
          DAH PANGO
        </Link>
        <Link href={back} className="btn btn-ghost btn-sm rounded-full">
          Volver
        </Link>
      </header>
      <h1 className="mt-8 font-display text-5xl leading-none uppercase">{title}</h1>
      {intro && <p className="mt-2 text-sm text-mute">{intro}</p>}
      <div className="mt-6 flex-1">{children}</div>
    </main>
  );
}

/** A colored stripe for the programa of a clase (white for general clases). */
export function ProgramStripe({ color }: { color: string | null | undefined }) {
  return <span aria-hidden className="w-1 shrink-0 rounded-full" style={{ background: color ?? 'var(--color-chalk)' }} />;
}
