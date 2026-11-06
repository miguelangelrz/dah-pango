import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';
import { ConfigTabs } from './tabs';

// Directors and super admins configure the academy here.
export default async function ConfigLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/ingresar');
  if (!me.permissions.includes('configure_academy')) redirect('/app');

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-8">
      <header className="flex items-center justify-between">
        <Link href="/app" className="font-display text-2xl tracking-wide">
          DAH PANGO
        </Link>
        <Link href="/app" className="btn btn-ghost btn-sm rounded-full">
          Volver
        </Link>
      </header>
      <h1 className="mt-8 font-display text-5xl leading-none uppercase">Configuración</h1>
      <ConfigTabs />
      <div className="mt-6 flex-1">{children}</div>
    </main>
  );
}
