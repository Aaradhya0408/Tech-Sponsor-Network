import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { pinoHttp } from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { csrfProtection } from "./lib/request-guards";

const app: Express = express();

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set to sign authentication cookies.");
}

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, false);
        return;
      }
      try {
        const parsedOrigin = new URL(origin);
        callback(null, parsedOrigin.host.toLowerCase() === originHost());
      } catch {
        callback(null, false);
      }
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "64kb", inflate: false }));
app.use(
  express.urlencoded({
    extended: true,
    limit: "16kb",
    parameterLimit: 100,
    inflate: false,
  }),
);
app.use(cookieParser(process.env.SESSION_SECRET));
app.use(csrfProtection);
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use("/api", router);

app.use((_req, res) => {
  res.status(404).json({ error: "The requested resource was not found." });
});

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof err.status === "number" &&
    err.status >= 400 &&
    err.status < 500
      ? err.status
      : 500;
  const errorName =
    err instanceof Error && err.name.length <= 80 ? err.name : "RequestError";
  req.log.error({ errorName, status }, "Request failed");
  res.status(status).json({
    error:
      status === 413
        ? "The request is too large."
        : status < 500
          ? "The request could not be processed."
          : "Something went wrong. Please try again.",
  });
});

function originHost(): string {
  return (process.env.PUBLIC_APP_URL
    ? new URL(process.env.PUBLIC_APP_URL).host
    : process.env.REPLIT_DEV_DOMAIN
      ? process.env.REPLIT_DEV_DOMAIN
      : process.env.VERCEL_URL
        ? process.env.VERCEL_URL
        : "").toLowerCase();
}

export default app;
