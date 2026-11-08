import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';

// Teachers, directors and super admins take attendance here.
export default async function AttendanceLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/ingresar');
  if (!me.permissions.includes('take_attendance')) redirect('/app');
  return <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-8">{children}</main>;
}
