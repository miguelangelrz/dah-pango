import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';

// Directors and super admins review student requests here.
export default async function ReviewLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/ingresar');
  if (!me.permissions.includes('review_requests')) redirect('/app');
  return children;
}
