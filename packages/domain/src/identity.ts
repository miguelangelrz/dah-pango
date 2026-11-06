export const DOCUMENT_TYPES = ['CC', 'TI', 'CE', 'PA'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Spanish labels shown in the app. */
export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  CC: 'Cédula de ciudadanía',
  TI: 'Tarjeta de identidad',
  CE: 'Cédula de extranjería',
  PA: 'Pasaporte',
};

/**
 * One canonical form per document, so "1.020.345.678" typed at login matches
 * "1020345678" typed by a teacher for a walk-in. CC and TI are digits only;
 * CE and passports keep letters, uppercased, without spaces, dots or dashes.
 */
export function normalizeDocumentNumber(type: DocumentType, raw: string): string {
  if (type === 'CC' || type === 'TI') return raw.replace(/\D/g, '');
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Holders of a tarjeta de identidad are minors: a guardian accepts the legal documents for them. */
export function needsGuardian(type: DocumentType): boolean {
  return type === 'TI';
}

/** A guardian is an adult, so they can't identify with a tarjeta de identidad. */
export function canBeGuardian(type: DocumentType): boolean {
  return type !== 'TI';
}

export const LEGAL_DOCUMENT_KINDS = ['terms', 'data_policy'] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

export const LEGAL_DOCUMENT_LABELS: Record<LegalDocumentKind, string> = {
  terms: 'Términos y condiciones',
  data_policy: 'Política de tratamiento de datos',
};

export interface LegalDocumentVersion {
  id: string;
  kind: LegalDocumentKind;
  publishedAt: Date;
}

/** The newest published version of each kind; a version dated in the future isn't out yet. */
export function currentLegalDocuments<T extends LegalDocumentVersion>(docs: T[], now: Date): T[] {
  const latest = new Map<LegalDocumentKind, T>();
  for (const doc of docs) {
    if (doc.publishedAt.getTime() > now.getTime()) continue;
    const seen = latest.get(doc.kind);
    if (!seen || doc.publishedAt.getTime() > seen.publishedAt.getTime()) latest.set(doc.kind, doc);
  }
  return LEGAL_DOCUMENT_KINDS.flatMap((kind) => latest.get(kind) ?? []);
}

/**
 * What a person still has to accept before using the app: every current version they
 * haven't accepted. Accepting an older version doesn't count once a new one is published.
 */
export function pendingLegalDocuments<T extends LegalDocumentVersion>(
  docs: T[],
  acceptedIds: Iterable<string>,
  now: Date,
): T[] {
  const accepted = new Set(acceptedIds);
  return currentLegalDocuments(docs, now).filter((doc) => !accepted.has(doc.id));
}
