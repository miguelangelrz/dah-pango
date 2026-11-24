import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';

// A student's requests to the director and their answers.
export default async function StudentRequestsLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/ingresar');
  if (!me.permissions.includes('send_requests')) redirect('/app');
  return children;
}
