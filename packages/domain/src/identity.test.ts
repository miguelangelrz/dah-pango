import { describe, expect, it } from 'vitest';
import {
  canBeGuardian,
  currentLegalDocuments,
  needsGuardian,
  normalizeDocumentNumber,
  pendingLegalDocuments,
  type LegalDocumentVersion,
} from './index';

describe('document numbers', () => {
  it('keeps only digits for cédulas and tarjetas de identidad', () => {
    expect(normalizeDocumentNumber('CC', ' 1.020.345.678 ')).toBe('1020345678');
    expect(normalizeDocumentNumber('TI', '1-098-765')).toBe('1098765');
  });

  it('keeps letters for extranjería and passports, uppercased', () => {
    expect(normalizeDocumentNumber('PA', 'ab 123-456')).toBe('AB123456');
    expect(normalizeDocumentNumber('CE', 'e.12345')).toBe('E12345');
  });

  it('asks a guardian for minors and refuses a minor as guardian', () => {
    expect(needsGuardian('TI')).toBe(true);
    expect(needsGuardian('CC')).toBe(false);
    expect(canBeGuardian('TI')).toBe(false);
    expect(canBeGuardian('PA')).toBe(true);
  });
});

describe('legal documents', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const terms1: LegalDocumentVersion = { id: 't1', kind: 'terms', publishedAt: new Date('2026-07-01') };
  const terms2: LegalDocumentVersion = { id: 't2', kind: 'terms', publishedAt: new Date('2026-10-01') };
  const policy1: LegalDocumentVersion = { id: 'p1', kind: 'data_policy', publishedAt: new Date('2026-07-01') };
  const terms3Later: LegalDocumentVersion = { id: 't3', kind: 'terms', publishedAt: new Date('2026-12-01') };

  it('picks the newest published version of each kind', () => {
    expect(currentLegalDocuments([terms1, policy1, terms2, terms3Later], now)).toEqual([terms2, policy1]);
  });

  it('asks for both documents on first login', () => {
    expect(pendingLegalDocuments([terms1, policy1], [], now)).toEqual([terms1, policy1]);
  });

  it('asks nothing once the current versions are accepted', () => {
    expect(pendingLegalDocuments([terms1, policy1], ['t1', 'p1'], now)).toEqual([]);
  });

  it('asks again when a new version is published', () => {
    expect(pendingLegalDocuments([terms1, terms2, policy1], ['t1', 'p1'], now)).toEqual([terms2]);
  });
});
