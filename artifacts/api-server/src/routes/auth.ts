import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  and,
  eq,
  gt,
} from "drizzle-orm";
import {
  GetAdminDashboardResponse,
  GetCreatorDashboardResponse,
  GetCurrentUserResponse,
  LogInBody,
  LogInResponse,
  LogOutResponse,
  SignUpBody,
  SignUpResponse,
  VerifyEmailBody,
  VerifyEmailResponse,
} from "@workspace/api-zod";
import {
  db,
  sessionsTable,
  usersTable,
  verificationTokensTable,
} from "@workspace/db";
import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";

const router: IRouter = Router();
const SESSION_COOKIE = "tsn_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const scryptAsync = promisify(scrypt);

if (typeof process.env.ADMIN_EMAILS !== "string") {
  throw new Error("ADMIN_EMAILS must be set to a comma-separated email list.");
}

const adminEmails = new Set(
  process.env.ADMIN_EMAILS.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

type UserRecord = typeof usersTable.$inferSelect;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [algorithm, salt, savedHash] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !savedHash) return false;

  const expected = Buffer.from(savedHash, "hex");
  if (expected.length !== 64) return false;
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(expected, actual);
}

function userResponse(user: UserRecord) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
  };
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    signed: true,
    path: "/api",
    maxAge: SESSION_TTL_MS,
  };
}

async function getSessionUser(req: Request): Promise<UserRecord | null> {
  const sessionToken = req.signedCookies?.[SESSION_COOKIE];
  if (typeof sessionToken !== "string") return null;

  const [session] = await db
    .select({ user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(
      and(
        eq(sessionsTable.tokenHash, hashToken(sessionToken)),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return session?.user ?? null;
}

function requireRole(role: "CREATOR" | "ADMIN") {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Please log in to continue." });
      return;
    }
    if (user.role !== role) {
      res.status(403).json({ error: `${role} access is required.` });
      return;
    }
    res.locals.authUser = user;
    next();
  };
}

router.post("/auth/signup", async (req, res): Promise<void> => {
  const parsed = SignUpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a name, valid email, and password of at least 10 characters." });
    return;
  }

  const name = parsed.data.name.trim();
  const email = parsed.data.email.trim().toLowerCase();
  if (!name) {
    res.status(400).json({ error: "Name is required." });
    return;
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const verificationToken = randomBytes(32).toString("base64url");
  const role = adminEmails.has(email) ? "ADMIN" : "CREATOR";
  const verificationExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

  const createdUser = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(usersTable)
      .values({ name, email, passwordHash, role })
      .onConflictDoNothing({ target: usersTable.email })
      .returning();
    if (!user) return null;

    await tx.insert(verificationTokensTable).values({
      tokenHash: hashToken(verificationToken),
      userId: user.id,
      expiresAt: verificationExpiresAt,
    });
    return user;
  });

  if (!createdUser) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }

  const origin =
    req.get("origin") ?? `${req.protocol}://${req.get("host") ?? "localhost"}`;
  const verificationUrl = new URL("/", origin);
  verificationUrl.searchParams.set("verify", verificationToken);
  req.log.info(
    { email, verificationUrl: verificationUrl.toString() },
    "Email verification link (temporary development delivery)",
  );

  res
    .status(201)
    .json(
      SignUpResponse.parse({
        message: "Account created. Use the verification link printed by the server, then log in.",
      }),
    );
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LogInBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  if (!user.emailVerified) {
    res.status(403).json({ error: "Verify your email before logging in. Use the link printed by the server." });
    return;
  }

  const sessionToken = randomBytes(32).toString("base64url");
  await db.insert(sessionsTable).values({
    tokenHash: hashToken(sessionToken),
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  res.cookie(SESSION_COOKIE, sessionToken, cookieOptions());
  res.json(LogInResponse.parse(userResponse(user)));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const sessionToken = req.signedCookies?.[SESSION_COOKIE];
  if (typeof sessionToken === "string") {
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.tokenHash, hashToken(sessionToken)));
  }
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    signed: true,
    path: "/api",
  });
  res.json(LogOutResponse.parse({ message: "You are logged out." }));
});

router.post("/auth/verify", async (req, res): Promise<void> => {
  const parsed = VerifyEmailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "This verification link is invalid or expired." });
    return;
  }

  const tokenHash = hashToken(parsed.data.token);
  const verified = await db.transaction(async (tx) => {
    const [verification] = await tx
      .select()
      .from(verificationTokensTable)
      .where(
        and(
          eq(verificationTokensTable.tokenHash, tokenHash),
          gt(verificationTokensTable.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!verification) return false;
    await tx
      .update(usersTable)
      .set({ emailVerified: true })
      .where(eq(usersTable.id, verification.userId));
    await tx
      .delete(verificationTokensTable)
      .where(eq(verificationTokensTable.tokenHash, tokenHash));
    return true;
  });

  if (!verified) {
    res.status(400).json({ error: "This verification link is invalid or expired." });
    return;
  }
  res.json(
    VerifyEmailResponse.parse({
      message: "Your email is verified. You can now log in.",
    }),
  );
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Please log in to continue." });
    return;
  }
  res.json(GetCurrentUserResponse.parse(userResponse(user)));
});

router.get(
  "/auth/creator/dashboard",
  requireRole("CREATOR"),
  (_req, res): void => {
    res.json(
      GetCreatorDashboardResponse.parse(
        userResponse(res.locals.authUser as UserRecord),
      ),
    );
  },
);

router.get(
  "/auth/admin/dashboard",
  requireRole("ADMIN"),
  (_req, res): void => {
    res.json(
      GetAdminDashboardResponse.parse(
        userResponse(res.locals.authUser as UserRecord),
      ),
    );
  },
);

export default router;
