'use client';

import { useRouter } from 'next/navigation';
import { postJson } from '@/lib/api';

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await postJson('/auth/logout').catch(() => undefined);
        router.replace('/ingresar');
        router.refresh();
      }}
      className="btn btn-outline btn-sm rounded-full"
    >
      Salir
    </button>
  );
}
