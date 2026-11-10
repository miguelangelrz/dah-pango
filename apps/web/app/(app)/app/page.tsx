import { ROLE_LABELS } from '@dah-pango/domain';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';
import { LogoutButton } from './logout-button';

export default async function AppHome() {
  const me = await getMe();
  if (!me) redirect('/ingresar');
  const roles = [...new Set(me.roles.map((r) => ROLE_LABELS[r.role]))];
  const isStudent = me.roles.some((r) => r.role === 'student') && me.permissions.includes('send_requests');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-8">
      <header className="flex items-center justify-between">
        <span className="font-display text-2xl tracking-wide">DAH PANGO</span>
        <LogoutButton />
      </header>
      <h1 className="mt-10 font-display text-5xl leading-none uppercase">
        Hola, {me.fullName.split(' ')[0]}
      </h1>
      {roles.length > 0 && <p className="mt-2 text-sm text-mute">{roles.join(' · ')}</p>}
      <div className="mt-8 space-y-3">
        {isStudent && (
          <HomeCard href="/app/clases" title="Mis clases" text="Tus próximas clases, avisos de falta e historial." />
        )}
        {isStudent && (
          <HomeCard href="/app/programas" title="Mis programas" text="Tus clases por programa: agrega, cambia o cancela." />
        )}
        {me.permissions.includes('take_attendance') && (
          <HomeCard href="/app/asistencia" title="Asistencia" text="Las sesiones de hoy, reposiciones, visitantes y reemplazos." />
        )}
        {me.permissions.includes('configure_academy') && (
          <HomeCard href="/app/configuracion" title="Configuración" text="Semestres, bloques y horarios de las clases." />
        )}
      </div>
    </main>
  );
}

function HomeCard({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Link href={href} className="card card-border border-base-300 bg-base-200 transition hover:border-primary">
      <div className="card-body gap-1 p-4">
        <h2 className="font-display text-2xl tracking-wide uppercase">{title}</h2>
        <p className="text-sm text-mute">{text}</p>
      </div>
    </Link>
  );
}
