import type { Me } from '@dah-pango/contracts';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** The logged-in person, read on the server by forwarding the session cookie to the API. */
export async function getMe(): Promise<Me | null> {
  const session = (await cookies()).get('dp_session');
  if (!session) return null;
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { cookie: `dp_session=${session.value}` },
    cache: 'no-store',
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /auth/me failed with ${res.status}`);
  return (await res.json()) as Me;
}
