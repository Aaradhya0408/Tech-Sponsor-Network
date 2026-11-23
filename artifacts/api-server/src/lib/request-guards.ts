import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { db, rateLimitBucketsTable } from "@workspace/db";
import type { NextFunction, Request, RequestHandler, Response } from "express";

interface RateLimitOptions {
  name: string;
  maxAttempts: number;
  windowMs: number;
  identity?: (req: Request, res: Response) => string | null | undefined;
}

let requestsSinceCleanup = 0;

function requestIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "unknown").slice(0, 100);
}

function normalizeIdentity(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized.slice(0, 254) : null;
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const now = new Date();
    const identity = normalizeIdentity(options.identity?.(req, res));
    const keys = [
      `${options.name}:ip:${requestIp(req)}`,
      ...(identity ? [`${options.name}:identity:${identity}`] : []),
    ];
    let retryAfterMs = 0;
    try {
      for (const key of keys) {
        const bucketKey = createHash("sha256").update(key).digest("hex");
        const nextExpiry = new Date(now.getTime() + options.windowMs);
        const [bucket] = await db
          .insert(rateLimitBucketsTable)
          .values({ bucketKey, attempts: 1, expiresAt: nextExpiry })
          .onConflictDoUpdate({
            target: rateLimitBucketsTable.bucketKey,
            set: {
              attempts: sql`CASE WHEN ${rateLimitBucketsTable.expiresAt} <= ${now} THEN 1 ELSE ${rateLimitBucketsTable.attempts} + 1 END`,
              expiresAt: sql`CASE WHEN ${rateLimitBucketsTable.expiresAt} <= ${now} THEN ${nextExpiry} ELSE ${rateLimitBucketsTable.expiresAt} END`,
            },
          })
          .returning({
            attempts: rateLimitBucketsTable.attempts,
            expiresAt: rateLimitBucketsTable.expiresAt,
          });
        if (bucket.attempts > options.maxAttempts) {
          retryAfterMs = Math.max(
            retryAfterMs,
            bucket.expiresAt.getTime() - now.getTime(),
          );
        }
      }

      requestsSinceCleanup += 1;
      if (requestsSinceCleanup >= 1000) {
        requestsSinceCleanup = 0;
        try {
          await db
            .delete(rateLimitBucketsTable)
            .where(lt(rateLimitBucketsTable.expiresAt, now));
        } catch {
          // Expired rows do not affect enforcement; cleanup is best effort.
        }
      }
    } catch {
      res.status(503).json({
        error: "The request could not be checked. Please try again shortly.",
      });
      return;
    }

    if (retryAfterMs > 0) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      res.status(429).json({ error: "Too many attempts. Please wait and try again." });
      return;
    }
    next();
  };
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (safeMethods.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const origin = req.get("origin");
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      const requestHost = req.get("host");
      const requestProtocol = `${req.protocol}:`;
      if (
        !requestHost ||
        parsedOrigin.host.toLowerCase() !== requestHost.toLowerCase() ||
        parsedOrigin.protocol !== requestProtocol
      ) {
        res.status(403).json({ error: "This request could not be verified." });
        return;
      }
    } catch {
      res.status(403).json({ error: "This request could not be verified." });
      return;
    }
  } else if (req.get("sec-fetch-site")?.toLowerCase() !== "same-origin") {
    res.status(403).json({ error: "This request could not be verified." });
    return;
  }

  next();
}
