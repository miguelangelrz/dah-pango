'use client';

import type { AdminTerm } from '@dah-pango/contracts';
import { addDays, BLOCK_WEEKS, blocksProblem, daysBetween, generateBlocks } from '@dah-pango/domain';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/form';
import { putJson } from '@/lib/api';

interface Row {
  startsOn: string;
  endsOn: string;
}

export function BlocksEditor({ term }: { term: AdminTerm }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(term.blocks.map(({ startsOn, endsOn }) => ({ startsOn, endsOn })));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const numbered = rows.map((r, i) => ({ number: i + 1, ...r }));
  const complete = rows.every((r) => r.startsOn && r.endsOn);
  const problem = complete ? blocksProblem(term, numbered) : 'Completa todas las fechas';

  function change(i: number, field: keyof Row, value: string) {
    setDone(false);
    setRows(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  }

  function addBlock() {
    setDone(false);
    const last = rows.at(-1);
    const startsOn = last?.endsOn ? addDays(last.endsOn, 1) : term.startsOn;
    const fullEnd = addDays(startsOn, BLOCK_WEEKS * 7 - 1);
    setRows([...rows, { startsOn, endsOn: fullEnd > term.endsOn ? term.endsOn : fullEnd }]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await putJson(`/admin/terms/${term.id}/blocks`, { blocks: rows });
      setDone(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-mute">
        Por defecto son de 4 semanas desde el inicio del semestre. Puedes mover las fechas, por
        ejemplo para dejar por fuera una semana de vacaciones. El pago va antes del 10 de cada mes.
      </p>
      <ol className="space-y-3">
        {rows.map((r, i) => {
          const weeks =
            r.startsOn && r.endsOn ? Math.round(((daysBetween(r.startsOn, r.endsOn) + 1) / 7) * 10) / 10 : null;
          return (
            <li key={i} className="rounded-box border border-base-300 bg-base-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-xl tracking-wide uppercase">Bloque {i + 1}</span>
                <span className="text-xs text-mute">{weeks !== null && weeks > 0 ? `${weeks} semanas` : ''}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-mute">Desde</span>
                  <input
                    type="date"
                    className="input mt-1 w-full bg-base-100"
                    value={r.startsOn}
                    min={term.startsOn}
                    max={term.endsOn}
                    onChange={(e) => change(i, 'startsOn', e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-mute">Hasta</span>
                  <input
                    type="date"
                    className="input mt-1 w-full bg-base-100"
                    value={r.endsOn}
                    min={term.startsOn}
                    max={term.endsOn}
                    onChange={(e) => change(i, 'endsOn', e.target.value)}
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={addBlock} className="btn btn-outline btn-sm rounded-full">
          Agregar bloque
        </button>
        <button
          type="button"
          onClick={() => {
            setDone(false);
            setRows(rows.slice(0, -1));
          }}
          disabled={rows.length <= 1}
          className="btn btn-outline btn-sm rounded-full"
        >
          Quitar el último
        </button>
        <button
          type="button"
          onClick={() => {
            setDone(false);
            setRows(generateBlocks(term.startsOn, term.endsOn).map(({ startsOn, endsOn }) => ({ startsOn, endsOn })));
          }}
          className="btn btn-ghost btn-sm rounded-full"
        >
          Recalcular cada 4 semanas
        </button>
      </div>
      <FormError message={error ?? problem} />
      {done && (
        <p role="status" className="alert alert-success alert-soft text-sm">
          Bloques guardados.
        </p>
      )}
      <button
        type="button"
        onClick={save}
        disabled={busy || problem !== null}
        className="btn btn-primary btn-lg btn-block rounded-full font-display text-xl tracking-wide uppercase"
      >
        {busy ? <span className="loading loading-spinner" aria-label="Un momento" /> : 'Guardar bloques'}
      </button>
    </div>
  );
}
