'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/app/configuracion/semestres', label: 'Semestres y bloques' },
  { href: '/app/configuracion/clases', label: 'Horarios de clases' },
];

export function ConfigTabs() {
  const path = usePathname();
  return (
    <nav role="tablist" className="tabs tabs-box mt-6 bg-base-200">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          role="tab"
          className={`tab flex-1 ${path.startsWith(t.href) ? 'tab-active' : ''}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
