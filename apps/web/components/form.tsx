import type { DocumentType } from '@dah-pango/domain';
import { DOCUMENT_LABELS } from '@dah-pango/domain';
import Link from 'next/link';

// Form pieces shared by the login, sign-up and terms screens, built on daisyUI classes.

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input className="input input-lg mt-1 w-full bg-base-200" {...input} />
      {hint && <span className="mt-1 block text-xs text-mute">{hint}</span>}
    </label>
  );
}

export function DocumentTypeSelect({
  label = 'Tipo de documento',
  types = ['CC', 'TI', 'CE', 'PA'],
  ...select
}: {
  label?: string;
  types?: DocumentType[];
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <select className="select select-lg mt-1 w-full bg-base-200" {...select}>
        {types.map((t) => (
          <option key={t} value={t}>
            {DOCUMENT_LABELS[t]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Checkbox({ children, ...input }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" className="checkbox checkbox-primary mt-0.5" {...input} />
      <span className="text-sm">{children}</span>
    </label>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="btn btn-primary btn-lg btn-block rounded-full font-display text-xl tracking-wide uppercase"
    >
      {busy ? <span className="loading loading-spinner" aria-label="Un momento" /> : children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="alert alert-error alert-soft text-sm">
      {message}
    </p>
  );
}

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-8">
      <Link href="/" className="font-display text-2xl tracking-wide">
        DAH PANGO
      </Link>
      <h1 className="mt-10 font-display text-5xl leading-none uppercase">{title}</h1>
      <div className="mt-8 flex-1">{children}</div>
    </main>
  );
}
