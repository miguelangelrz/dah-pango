import type { Me } from '@dah-pango/contracts';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** GET on the API from the server, forwarding the session cookie. Null on 401, 403 and 404. */
export async function apiGet<T>(path: string): Promise<T | null> {
  const session = (await cookies()).get('dp_session');
  if (!session) return null;
  const res = await fetch(`${API_URL}${path}`, {
    headers: { cookie: `dp_session=${session.value}` },
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

/** The logged-in person, read on the server by forwarding the session cookie to the API. */
export function getMe(): Promise<Me | null> {
  return apiGet<Me>('/auth/me');
}
