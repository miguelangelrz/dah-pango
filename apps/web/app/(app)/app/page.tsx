import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';
import { LogoutButton } from './logout-button';

const ROLE_LABELS = { student: 'Estudiante', teacher: 'Profe', director: 'Dirección' } as const;

export default async function AppHome() {
  const me = await getMe();
  if (!me) redirect('/ingresar');
  const roles = [...new Set(me.roles.map((r) => ROLE_LABELS[r.role]))];

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
      <p className="mt-6 text-mute">
        Aquí vas a ver tus clases, tu asistencia y tus reposiciones. Esas pantallas llegan en el
        siguiente paso.
      </p>
    </main>
  );
}
