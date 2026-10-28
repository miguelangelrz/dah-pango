import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('passwords', () => {
  it('verifies the right password and rejects others', async () => {
    const stored = await hashPassword('bailar-house');
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('bailar-house', stored)).toBe(true);
    expect(await verifyPassword('bailar-hous', stored)).toBe(false);
    expect(await verifyPassword('bailar-house', 'garbage')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('igual-igual')).not.toBe(await hashPassword('igual-igual'));
  });
});
