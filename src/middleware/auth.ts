import type { Context, Next } from "hono";
import jwt from "jsonwebtoken";

export interface JwtPayload {
  driverId: number;
  phone: string;
}

export type AuthEnv = {
  Variables: {
    driver: JwtPayload;
  };
};

export async function authMiddleware(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = header.slice("Bearer ".length);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return c.json({ error: "Server misconfiguration: JWT_SECRET not set" }, 500);
  }

  try {
    const payload = jwt.verify(token, secret) as JwtPayload;
    c.set("driver", payload);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
}

export function signToken(payload: JwtPayload): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return jwt.sign(payload, secret, { expiresIn: "30d" });
}
