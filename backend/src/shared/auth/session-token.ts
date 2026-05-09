import crypto from "crypto";

export type AuthProvider = "github" | "google" | "local";

export interface AuthUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string;
  authProvider?: AuthProvider;
}

interface SessionPayload {
  user: AuthUser;
  exp: number;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(encodedPayload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

function safeCompare(a: string, b: string): boolean {
  const first = Buffer.from(a);
  const second = Buffer.from(b);

  if (first.length !== second.length) {
    return false;
  }

  return crypto.timingSafeEqual(first, second);
}

export function createSessionToken(
  user: AuthUser,
  secret: string,
  maxAgeMs: number,
): string {
  const payload: SessionPayload = {
    user,
    exp: Date.now() + maxAgeMs,
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);

  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
): AuthUser | null {
  const [encodedPayload, providedSignature] = token.split(".");

  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload, secret);
  if (!safeCompare(expectedSignature, providedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as SessionPayload;

    if (!payload.exp || payload.exp < Date.now()) {
      return null;
    }

    return payload.user;
  } catch {
    return null;
  }
}
