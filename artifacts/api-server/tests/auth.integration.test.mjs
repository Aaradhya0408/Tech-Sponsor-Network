import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const requireFromDb = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
);
const { Pool } = requireFromDb("pg");

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function findAvailablePort() {
  const net = await import("node:net");
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

test("signup, verification, role access, and logout stay isolated", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for auth tests");
  assert.ok(process.env.SESSION_SECRET, "SESSION_SECRET is required for auth tests");

  const suffix = randomUUID();
  const creatorEmail = `auth-creator-${suffix}@example.test`;
  const adminEmail = `auth-admin-${suffix}@example.test`;
  const expiredEmail = `auth-expired-${suffix}@example.test`;
  const testEmails = [creatorEmail, adminEmail, expiredEmail];
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const port = await findAvailablePort();
  const server = spawn(
    process.execPath,
    [fileURLToPath(new URL("../dist/index.mjs", import.meta.url))],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        ADMIN_EMAILS: adminEmail,
        NODE_ENV: "production",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  const appendOutput = (chunk) => {
    output += chunk.toString();
  };
  server.stdout.on("data", appendOutput);
  server.stderr.on("data", appendOutput);

  const baseUrl = `http://127.0.0.1:${port}/api`;
  const verificationTokenFor = (email) => {
    for (const line of output.split("\n")) {
      try {
        const event = JSON.parse(line);
        if (
          event.msg === "Email verification link (temporary development delivery)" &&
          event.email === email
        ) {
          return new URL(event.verificationUrl).searchParams.get("verify");
        }
      } catch {
        // Ignore startup and non-JSON output.
      }
    }
    return null;
  };

  async function waitForServer() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (server.exitCode !== null) {
        throw new Error("Auth test server exited before becoming ready.");
      }
      try {
        const response = await fetch(`${baseUrl}/healthz`);
        if (response.ok) return;
      } catch {
        // The listener may not be ready yet.
      }
      await delay(100);
    }
    throw new Error("Auth test server did not become ready.");
  }

  async function request(path, { method = "GET", body, cookie } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      response,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? null,
    };
  }

  async function signup(email) {
    const result = await request("/auth/signup", {
      method: "POST",
      body: { name: "Auth Test", email, password: "safe-test-password-123" },
    });
    assert.equal(result.response.status, 201);

    for (let attempt = 0; attempt < 40; attempt += 1) {
      const token = verificationTokenFor(email);
      if (token) return token;
      await delay(25);
    }
    throw new Error("Signup did not emit a verification link.");
  }

  try {
    await waitForServer();

    const creatorToken = await signup(creatorEmail);
    const adminToken = await signup(adminEmail);
    const expiredToken = await signup(expiredEmail);

    const storedUsers = await db.query(
      `SELECT email, password_hash, role
       FROM tech_sponsor_users
       WHERE email = ANY($1::text[])`,
      [[creatorEmail, adminEmail]],
    );
    assert.equal(storedUsers.rows.length, 2, "signup creates both accounts");
    for (const user of storedUsers.rows) {
      assert.notEqual(user.password_hash, "safe-test-password-123");
      assert.match(user.password_hash, /^scrypt\$[^$]+\$[a-f0-9]+$/);
    }
    assert.equal(
      storedUsers.rows.find((user) => user.email === creatorEmail)?.role,
      "CREATOR",
    );
    assert.equal(
      storedUsers.rows.find((user) => user.email === adminEmail)?.role,
      "ADMIN",
    );

    const blockedLogin = await request("/auth/login", {
      method: "POST",
      body: { email: creatorEmail, password: "safe-test-password-123" },
    });
    assert.equal(blockedLogin.response.status, 403);
    assert.equal(blockedLogin.cookie, null, "unverified login must not issue a session");

    const creatorVerification = await request("/auth/verify", {
      method: "POST",
      body: { token: creatorToken },
    });
    assert.equal(creatorVerification.response.status, 200);

    const reusedVerification = await request("/auth/verify", {
      method: "POST",
      body: { token: creatorToken },
    });
    assert.equal(reusedVerification.response.status, 400);

    const expiredTokenHash = hashToken(expiredToken);
    await db.query(
      `UPDATE tech_sponsor_verification_tokens
       SET expires_at = NOW() - INTERVAL '1 second'
       WHERE token_hash = $1`,
      [expiredTokenHash],
    );
    const expiredVerification = await request("/auth/verify", {
      method: "POST",
      body: { token: expiredToken },
    });
    assert.equal(expiredVerification.response.status, 400);

    const creatorLogin = await request("/auth/login", {
      method: "POST",
      body: { email: creatorEmail, password: "safe-test-password-123" },
    });
    assert.equal(creatorLogin.response.status, 200);
    assert.equal(creatorLogin.body.role, "CREATOR");
    assert.ok(creatorLogin.cookie, "successful login issues a session cookie");

    const creatorDashboard = await request("/auth/creator/dashboard", {
      cookie: creatorLogin.cookie,
    });
    assert.equal(creatorDashboard.response.status, 200);
    const creatorToAdmin = await request("/auth/admin/dashboard", {
      cookie: creatorLogin.cookie,
    });
    assert.equal(creatorToAdmin.response.status, 403);

    const adminVerification = await request("/auth/verify", {
      method: "POST",
      body: { token: adminToken },
    });
    assert.equal(adminVerification.response.status, 200);
    const adminLogin = await request("/auth/login", {
      method: "POST",
      body: { email: adminEmail, password: "safe-test-password-123" },
    });
    assert.equal(adminLogin.response.status, 200);
    assert.equal(adminLogin.body.role, "ADMIN");
    const adminDashboard = await request("/auth/admin/dashboard", {
      cookie: adminLogin.cookie,
    });
    assert.equal(adminDashboard.response.status, 200);
    const adminToCreator = await request("/auth/creator/dashboard", {
      cookie: adminLogin.cookie,
    });
    assert.equal(adminToCreator.response.status, 403);

    const logout = await request("/auth/logout", {
      method: "POST",
      cookie: creatorLogin.cookie,
    });
    assert.equal(logout.response.status, 200);
    const afterLogout = await request("/auth/me", { cookie: creatorLogin.cookie });
    assert.equal(afterLogout.response.status, 401);
    const dashboardAfterLogout = await request("/auth/creator/dashboard", {
      cookie: creatorLogin.cookie,
    });
    assert.equal(dashboardAfterLogout.response.status, 401);
  } finally {
    server.kill("SIGTERM");
    if (server.exitCode === null) await once(server, "exit").catch(() => {});
    await db.query(
      `DELETE FROM tech_sponsor_sessions
       WHERE user_id IN (
         SELECT id FROM tech_sponsor_users WHERE email = ANY($1::text[])
       )`,
      [testEmails],
    );
    await db.query(
      `DELETE FROM tech_sponsor_verification_tokens
       WHERE user_id IN (
         SELECT id FROM tech_sponsor_users WHERE email = ANY($1::text[])
       )`,
      [testEmails],
    );
    await db.query(
      "DELETE FROM tech_sponsor_users WHERE email = ANY($1::text[])",
      [testEmails],
    );
    await db.end();
  }
});
