import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '@dah-pango/db/password';

// Hashing lives in @dah-pango/db so the seed can create demo accounts with the same format.
export { hashPassword, verifyPassword };

// Checked when the document number has no account, so a wrong document takes as long as a wrong password.
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));
export async function burnPasswordCheck(password: string): Promise<false> {
  await verifyPassword(password, DUMMY_HASH);
  return false;
}
