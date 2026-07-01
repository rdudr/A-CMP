import { SignJWT, jwtVerify } from "jose";

export type SessionRole = "ADMIN" | "OPERATOR" | "VIEWER";

const COOKIE = "fx_session";
export const SESSION_COOKIE_NAME = COOKIE;
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

function getSecretKey() {
  const secret =
    process.env.SESSION_SECRET ||
    "fox-kisem-fallback-session-secret-min-32-chars!!";
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set (min 16 characters)");
  }
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  sub: string;
  email: string;
  role: SessionRole;
};

export async function signSessionToken(payload: SessionPayload) {
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SEC}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"] });
    const sub = payload.sub;
    const email = typeof payload.email === "string" ? payload.email : null;
    const role = payload.role as SessionRole | undefined;
    if (!sub || !email || !role) return null;
    return { sub, email, role };
  } catch {
    return null;
  }
}
