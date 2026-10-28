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
      className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-chalk"
    >
      Salir
    </button>
  );
}
