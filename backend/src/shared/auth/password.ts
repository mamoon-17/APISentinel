import crypto from "crypto";

const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_PREFIX = "scrypt";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto
    .scryptSync(password, salt, SCRYPT_KEY_LENGTH)
    .toString("hex");

  return `${SCRYPT_PREFIX}$${salt}$${derivedKey}`;
}

export function verifyPassword(password: string, storedValue: string): boolean {
  const parts = storedValue.split("$");
  if (parts.length === 3 && parts[0] === SCRYPT_PREFIX) {
    const [, salt, storedHash] = parts;
    if (!salt || !storedHash) {
      return false;
    }

    const derivedKey = crypto
      .scryptSync(password, salt, SCRYPT_KEY_LENGTH)
      .toString("hex");

    const first = Buffer.from(derivedKey, "hex");
    const second = Buffer.from(storedHash, "hex");

    if (first.length !== second.length) {
      return false;
    }

    return crypto.timingSafeEqual(first, second);
  }

  // Backward compatibility for any legacy plain-text seeded users.
  return password === storedValue;
}
