import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt from Node's standard library: no native add-on to build on the server.
// Stored as scrypt$N$r$p$salt$hash (base64), so the cost can grow later.

const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const params = { ...opts, maxmem: 64 * 1024 * 1024 };
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, params, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(password, Buffer.from(salt, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Checked when the document number has no account, so a wrong document takes as long as a wrong password.
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));
export async function burnPasswordCheck(password: string): Promise<false> {
  await verifyPassword(password, DUMMY_HASH);
  return false;
}
