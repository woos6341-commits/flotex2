import {
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

function deriveKey(password: string, salt: Buffer, cost: number, blockSize: number, parallelism: number) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: cost,
        r: blockSize,
        p: parallelism,
        maxmem: MAX_MEMORY,
      },
      (error, key) => (error ? reject(error) : resolve(key as Buffer)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelism = Number(parts[3]);
  if (
    !Number.isInteger(cost) ||
    cost < 16_384 ||
    cost > 65_536 ||
    (cost & (cost - 1)) !== 0 ||
    !Number.isInteger(blockSize) ||
    blockSize < 1 ||
    blockSize > 16 ||
    !Number.isInteger(parallelism) ||
    parallelism < 1 ||
    parallelism > 4
  ) {
    return false;
  }
  try {
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await deriveKey(password, salt, cost, blockSize, parallelism);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashEmailOtp(
  secret: string,
  challengeId: string,
  email: string,
  purpose: string,
  code: string,
): string {
  return createHmac("sha256", secret)
    .update(`${challengeId}\u0000${email}\u0000${purpose}\u0000${code}`)
    .digest("hex");
}

export function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[\da-f]{64}$/i.test(left) || !/^[\da-f]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function createOpaqueGrant(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueGrant(grant: string): string {
  return createHmac("sha256", "manual-auth-grant-v1").update(grant).digest("hex");
}
