import assert from "node:assert/strict";
import { createHmac, createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const requireFromDb = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
);
const { Pool } = requireFromDb("pg");

const testDatabaseUrl = process.env.TSN_TEST_DATABASE_URL;
assert.ok(
  testDatabaseUrl,
  "TSN_TEST_DATABASE_URL must point to a disposable test database.",
);
const databaseName = decodeURIComponent(
  new URL(testDatabaseUrl).pathname.replace(/^\/+/, ""),
);
assert.match(
  databaseName,
  /(^|[-_])(test|testing|ci)([-_]|$)/i,
  "Refusing to load-test unless the database name clearly identifies a test database.",
);
assert.notEqual(
  testDatabaseUrl,
  process.env.DATABASE_URL,
  "The load test must not use the app's configured database.",
);
assert.ok(process.env.SESSION_SECRET, "SESSION_SECRET is required.");

const RUN_ID = randomUUID();
const ADMIN_EMAIL = `load-admin-${RUN_ID}@example.test`;
const COOKIE_NAME = "tsn_session";
const db = new Pool({ connectionString: testDatabaseUrl });
const creatorIds = [];
const campaignIds = [];
let adminId;
let creatorCookie;
let adminCookie;
let server;
let serverOutput = "";
const port = await findAvailablePort();
const baseUrl = `http://127.0.0.1:${port}/api`;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function signedCookie(token) {
  const signature = createHmac("sha256", process.env.SESSION_SECRET)
    .update(token)
    .digest("base64")
    .replace(/=+$/, "");
  return `${COOKIE_NAME}=s%3A${encodeURIComponent(`${token}.${signature}`)}`;
}

async function findAvailablePort() {
  const net = await import("node:net");
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function seed() {
  const adminToken = randomUUID();
  const [admin] = (
    await db.query(
      `INSERT INTO tech_sponsor_users
        (name, email, password_hash, role, email_verified)
       VALUES ('Load test administrator', $1, 'scrypt$unused$unused', 'ADMIN', true)
       RETURNING id`,
      [ADMIN_EMAIL],
    )
  ).rows;
  adminId = admin.id;

  const creators = await db.query(
    `INSERT INTO tech_sponsor_users
      (name, email, password_hash, role, email_verified)
     SELECT 'Loadtest Creator ' || n,
       'loadtest-${RUN_ID}-' || n || '@example.test',
       'scrypt$unused$unused',
       'CREATOR',
       true
     FROM generate_series(1, 500) AS n
     RETURNING id, name, email`,
  );
  creatorIds.push(...creators.rows.map((row) => row.id));
  assert.equal(creatorIds.length, 500);

  const profileValues = [];
  const platformValues = [];
  for (let index = 0; index < creators.rows.length; index += 1) {
    const creator = creators.rows[index];
    profileValues.push(
      creator.id,
      creator.name,
      `Test bio for creator ${index + 1}.`,
      "IN",
      "Technology",
      `TSN-L${RUN_ID.slice(0, 8)}-${index + 1}`,
    );
    platformValues.push(
      randomUUID(),
      creator.id,
      "YouTube",
      `https://youtube.com/@loadtest-${index + 1}`,
      1000 + index,
    );
  }
  await db.query(
    `INSERT INTO tech_sponsor_creator_profiles
      (user_id, display_name, bio, country, niche, proof_code)
     SELECT * FROM UNNEST(
       $1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]
     )`,
    transpose(profileValues, 6),
  );
  await db.query(
    `INSERT INTO tech_sponsor_creator_platforms
      (id, user_id, platform, url, followers)
     SELECT * FROM UNNEST(
       $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::integer[]
     )`,
    transpose(platformValues, 5),
  );

  const campaigns = await db.query(
    `INSERT INTO tech_sponsor_campaigns
      (title, organizer_name, short_description, objectives, content_requirements,
       reward_amount, currency, deadline, accepted_platforms, allowed_countries,
       minimum_followers, niches, status, created_by)
     SELECT 'Load test campaign ' || n,
       'Load test organizer',
       'Campaign fixture for performance verification.',
       'Measure paginated list response time.',
       'Use generated data only.',
       100.00,
       'USD',
       CURRENT_DATE + 30,
       ARRAY['YouTube']::text[],
       ARRAY['Any']::text[],
       100,
       ARRAY['Technology']::text[],
       'PUBLISHED',
       $1
     FROM generate_series(1, 4) AS n
     RETURNING id`,
    [adminId],
  );
  campaignIds.push(...campaigns.rows.map((row) => row.id));

  const applications = [];
  const submissionIds = [];
  const invoiceIds = [];
  const appStatuses = [];
  const appDecidedBy = [];
  const appDecidedAt = [];
  const appStartedAt = [];
  for (let index = 0; index < 2000; index += 1) {
    const appId = randomUUID();
    const creatorId = creatorIds[Math.floor(index / 4)];
    const campaignId = campaignIds[index % 4];
    const state = index < 200 ? "SUBMISSION_ACCEPTED" : index < 600 ? "SUBMITTED" : "UNDER_REVIEW";
    applications.push(appId, campaignId, creatorId, `Generated test application ${index + 1} includes enough text for validation.`, true);
    appStatuses.push(state);
    appDecidedBy.push(state === "UNDER_REVIEW" ? null : adminId);
    appDecidedAt.push(state === "UNDER_REVIEW" ? null : new Date());
    appStartedAt.push(state === "UNDER_REVIEW" ? null : new Date());
    if (index < 600) submissionIds.push(randomUUID());
    if (index < 200) invoiceIds.push(randomUUID());
  }
  assert.equal(applications.length / 5, 2000);
  const applicationColumns = transpose(applications, 5);
  const applicationIds = applicationColumns[0];
  const applicationCampaignIds = applicationColumns[1];
  const applicationCreatorIds = applicationColumns[2];
  const applicationMessages = applicationColumns[3];
  const acknowledged = applicationColumns[4];
  await db.query(
    `INSERT INTO tech_sponsor_campaign_applications
      (id, campaign_id, creator_id, personal_message, payment_rule_acknowledged,
       status, decided_by, decided_at, started_at)
     SELECT * FROM UNNEST(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::boolean[],
       $6::text[], $7::uuid[], $8::timestamptz[], $9::timestamptz[]
     )`,
    [
      applicationIds,
      applicationCampaignIds,
      applicationCreatorIds,
      applicationMessages,
      acknowledged,
      appStatuses,
      appDecidedBy,
      appDecidedAt,
      appStartedAt,
    ],
  );

  const submissions = [];
  for (let index = 0; index < 600; index += 1) {
    const accepted = index < 200;
    submissions.push(
      submissionIds[index],
      applicationIds[index],
      applicationCreatorIds[index],
      1,
      `Load test submission ${index + 1}`,
      `https://example.test/loadtest/${index + 1}`,
      `Performance test submission description for item ${index + 1}.`,
      accepted ? "SUBMISSION_ACCEPTED" : "SUBMITTED",
      accepted ? adminId : null,
      accepted ? new Date() : null,
    );
  }
  await db.query(
    `INSERT INTO tech_sponsor_campaign_submissions
      (id, application_id, creator_id, attempt, title, project_url, description,
       status, reviewed_by, reviewed_at)
     SELECT * FROM UNNEST(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::integer[], $5::text[],
       $6::text[], $7::text[], $8::text[], $9::uuid[], $10::timestamptz[]
     )`,
    transpose(submissions, 10),
  );

  const invoices = [];
  for (let index = 0; index < 200; index += 1) {
    invoices.push(
      invoiceIds[index],
      applicationIds[index],
      applicationCreatorIds[index],
      `LOAD-${RUN_ID.slice(0, 8)}-${index + 1}`,
      100,
      `Load test invoice ${index + 1}`,
      `https://example.test/loadtest/work/${index + 1}`,
      `private/load-test/${RUN_ID}/${index}.pdf`,
    );
  }
  await db.query(
    `INSERT INTO tech_sponsor_invoices
      (id, application_id, creator_id, invoice_number, invoice_date, amount,
       currency, description, work_url, invoice_object_path, invoice_content_type, confirmed)
     SELECT id, application_id, creator_id, invoice_number, CURRENT_DATE, amount,
       'USD', description, work_url, object_path, 'application/pdf', true
     FROM UNNEST(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::numeric[],
       $6::text[], $7::text[], $8::text[]
     ) AS items(id, application_id, creator_id, invoice_number, amount, description, work_url, object_path)`,
    transpose(invoices, 8),
  );

  await db.query(
    `INSERT INTO email_log (to_email, type, subject, status)
     SELECT 'loadtest-${RUN_ID}-' || n || '@example.test',
       'CAMPAIGN_ALERT',
       'Load test email ' || n,
       'sent'
     FROM generate_series(1, 500) AS n`,
  );

  const creatorToken = randomUUID();
  const [creatorSession] = (
    await db.query(
      `INSERT INTO tech_sponsor_sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')
       RETURNING token_hash`,
      [hashToken(creatorToken), creatorIds[0]],
    )
  ).rows;
  assert.ok(creatorSession);
  await db.query(
    `INSERT INTO tech_sponsor_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
    [hashToken(adminToken), adminId],
  );
  creatorCookie = signedCookie(creatorToken);
  adminCookie = signedCookie(adminToken);
}

function transpose(flat, columns) {
  const result = Array.from({ length: columns }, () => []);
  for (let index = 0; index < flat.length; index += columns) {
    for (let column = 0; column < columns; column += 1) {
      result[column].push(flat[index + column]);
    }
  }
  return result;
}

async function startServer() {
  server = spawn(
    process.execPath,
    [fileURLToPath(new URL("../dist/index.mjs", import.meta.url))],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        ADMIN_EMAILS: ADMIN_EMAIL,
        NODE_ENV: "test",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => (serverOutput += chunk.toString()));
  server.stderr.on("data", (chunk) => (serverOutput += chunk.toString()));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error("Load test server exited before becoming ready.");
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // Wait for the local test server to bind.
    }
    await delay(100);
  }
  throw new Error("Load test server did not become ready.");
}

async function measure(path, cookie) {
  const start = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { cookie },
  });
  const elapsedMs = Math.round(performance.now() - start);
  const payload = await response.json();
  assert.equal(
    response.status,
    200,
    `GET ${path} failed: ${JSON.stringify(payload)}\n${serverOutput.slice(-2000)}`,
  );
  const list = Object.values(payload).find((value) => Array.isArray(value));
  assert.ok(list, `${path} response must contain a paged list.`);
  assert.ok(list.length <= 20, `${path} returned more than 20 rows.`);
  return {
    path,
    elapsedMs,
    returned: list.length,
    total: payload.pagination?.total,
  };
}

async function cleanup() {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit").catch(() => {});
  }
  if (adminId) {
    await db.query("DELETE FROM email_log WHERE to_email LIKE $1", [
      `loadtest-${RUN_ID}-%`,
    ]);
    await db.query("DELETE FROM tech_sponsor_campaigns WHERE created_by = $1", [
      adminId,
    ]);
    await db.query("DELETE FROM tech_sponsor_users WHERE email LIKE $1", [
      `loadtest-${RUN_ID}-%`,
    ]);
    await db.query("DELETE FROM tech_sponsor_users WHERE id = $1", [adminId]);
  }
  await db.end();
}

try {
  const requiredTables = [
    "tech_sponsor_users",
    "tech_sponsor_creator_profiles",
    "tech_sponsor_creator_platforms",
    "tech_sponsor_campaigns",
    "tech_sponsor_campaign_applications",
    "tech_sponsor_campaign_submissions",
    "tech_sponsor_invoices",
    "tech_sponsor_sessions",
    "tech_sponsor_rate_limit_buckets",
    "email_log",
  ];
  const tables = await db.query(
    "SELECT to_regclass(table_name) AS name FROM unnest($1::text[]) AS table_name",
    [requiredTables],
  );
  assert.equal(
    tables.rows.filter((row) => row.name).length,
    requiredTables.length,
    "The test database must already have the current application schema.",
  );
  await seed();
  await startServer();

  const timings = await Promise.all([
    measure("/admin/creator-profiles?page=1&search=loadtest", adminCookie),
    measure("/admin/campaigns?page=1&search=Load", adminCookie),
    measure("/admin/applications?page=1&search=Load", adminCookie),
    measure("/admin/submissions?page=1&search=Load", adminCookie),
    measure("/admin/invoices?page=1&search=Load", adminCookie),
    measure("/admin/email-log?page=1&search=loadtest", adminCookie),
    measure("/creator/applications?page=1&search=Load", creatorCookie),
    measure("/creator/campaigns?page=1&search=Load", creatorCookie),
  ]);
  timings.sort((left, right) => right.elapsedMs - left.elapsedMs);
  console.log(JSON.stringify({
    seeded: { creators: 500, applications: 2000, campaigns: 4, submissions: 600, invoices: 200, emailLogRows: 500 },
    slowestPages: timings,
  }, null, 2));
} finally {
  await cleanup();
}
