import type { NextFunction, Request, RequestHandler, Response } from "express";

interface RateLimitOptions {
  name: string;
  maxAttempts: number;
  windowMs: number;
  identity?: (req: Request, res: Response) => string | null | undefined;
}

interface RateLimitBucket {
  count: number;
  expiresAt: number;
}

const buckets = new Map<string, RateLimitBucket>();
let requestsSinceCleanup = 0;

function requestIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || "unknown").slice(0, 100);
}

function normalizeIdentity(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized.slice(0, 254) : null;
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const identity = normalizeIdentity(options.identity?.(req, res));
    const keys = [
      `${options.name}:ip:${requestIp(req)}`,
      ...(identity ? [`${options.name}:identity:${identity}`] : []),
    ];

    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= 500 || buckets.size > 10_000) {
      requestsSinceCleanup = 0;
      for (const [key, bucket] of buckets) {
        if (bucket.expiresAt <= now) buckets.delete(key);
      }
    }

    let limited = false;
    let retryAfterMs = 0;
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (!bucket || bucket.expiresAt <= now) {
        buckets.set(key, { count: 1, expiresAt: now + options.windowMs });
        continue;
      }
      bucket.count += 1;
      if (bucket.count > options.maxAttempts) {
        limited = true;
        retryAfterMs = Math.max(retryAfterMs, bucket.expiresAt - now);
      }
    }

    if (limited) {
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
  } else if (req.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    res.status(403).json({ error: "This request could not be verified." });
    return;
  }

  next();
}
