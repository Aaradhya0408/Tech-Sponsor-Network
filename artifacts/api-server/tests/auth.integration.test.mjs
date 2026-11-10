import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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

test("signup, verification, profiles, campaigns, roles, and logout stay isolated", async () => {
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
    const responseText = await response.text();
    let parsedBody;
    try {
      parsedBody = JSON.parse(responseText);
    } catch {
      throw new Error(
        `Expected JSON for ${method} ${path}, received HTTP ${response.status}: ${responseText.slice(0, 160)}\nServer output:\n${output.slice(-2400)}`,
      );
    }
    return {
      response,
      body: parsedBody,
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

    await db.query(
      "UPDATE tech_sponsor_users SET email_verified = true WHERE email = $1",
      [expiredEmail],
    );
    const otherCreatorLogin = await request("/auth/login", {
      method: "POST",
      body: {
        email: expiredEmail,
        password: "safe-test-password-123",
      },
    });
    assert.equal(otherCreatorLogin.response.status, 200);

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

    const initialProfile = await request("/creator/profile", {
      cookie: creatorLogin.cookie,
    });
    assert.equal(initialProfile.response.status, 200);
    assert.match(initialProfile.body.proofCode, /^TSN-[0-9]{4}$/);
    assert.equal(initialProfile.body.approvalStatus, "PENDING_APPROVAL");

    const otherInitialProfile = await request("/creator/profile", {
      cookie: otherCreatorLogin.cookie,
    });
    assert.equal(otherInitialProfile.response.status, 200);
    assert.notEqual(
      otherInitialProfile.body.userId,
      initialProfile.body.userId,
      "each creator receives a profile tied to their own account",
    );

    const creatorToProfiles = await request("/admin/creator-profiles", {
      cookie: creatorLogin.cookie,
    });
    assert.equal(creatorToProfiles.response.status, 403);

    const invalidCountry = await request("/creator/profile", {
      method: "PUT",
      cookie: creatorLogin.cookie,
      body: {
        displayName: "Auth Test Creator",
        bio: "Technology creator.",
        country: "AA",
        niche: "AI",
        platforms: [],
      },
    });
    assert.equal(invalidCountry.response.status, 400);

    const profileInput = {
      displayName: "Auth Test Creator",
      bio: "Technology creator.",
      country: "IN",
      niche: "AI",
      platforms: [
        {
          platform: "YouTube",
          url: "https://youtube.com/@auth-test-creator",
          followers: 4200,
        },
      ],
    };
    const savedProfile = await request("/creator/profile", {
      method: "PUT",
      cookie: creatorLogin.cookie,
      body: profileInput,
    });
    assert.equal(savedProfile.response.status, 200);
    assert.equal(savedProfile.body.completeness, 100);
    assert.equal(savedProfile.body.proofCode, initialProfile.body.proofCode);
    assert.equal(savedProfile.body.approvalStatus, "PENDING_APPROVAL");
    assert.equal(savedProfile.body.platforms[0].verified, false);

    const otherCreatorStillOwnsProfile = await request("/creator/profile", {
      cookie: otherCreatorLogin.cookie,
    });
    assert.equal(
      otherCreatorStillOwnsProfile.body.userId,
      otherInitialProfile.body.userId,
    );
    assert.deepEqual(otherCreatorStillOwnsProfile.body.platforms, []);

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

    const campaignIdForDeniedWrites = randomUUID();
    const validCampaignInput = {
      title: "Creator tools launch",
      organizerName: "Northstar Labs",
      shortDescription: "A launch campaign for developer tools.",
      objectives: "Introduce the product to developers.",
      contentRequirements: "Publish one honest walkthrough.",
      rewardAmount: 120.5,
      deadline: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      acceptedPlatforms: ["YouTube", "Instagram"],
      allowedCountries: ["Any"],
      minimumFollowers: 1000,
      niches: ["Technology", "Developer tools"],
    };
    const creatorCampaignList = await request("/admin/campaigns", {
      cookie: creatorLogin.cookie,
    });
    assert.equal(creatorCampaignList.response.status, 403);
    const creatorCampaignCreate = await request("/admin/campaigns", {
      method: "POST",
      cookie: creatorLogin.cookie,
      body: validCampaignInput,
    });
    assert.equal(creatorCampaignCreate.response.status, 403);
    const creatorCampaignEdit = await request(
      `/admin/campaigns/${campaignIdForDeniedWrites}`,
      {
        method: "PATCH",
        cookie: creatorLogin.cookie,
        body: validCampaignInput,
      },
    );
    assert.equal(creatorCampaignEdit.response.status, 403);
    const creatorCampaignStatus = await request(
      `/admin/campaigns/${campaignIdForDeniedWrites}/status`,
      {
        method: "PATCH",
        cookie: creatorLogin.cookie,
        body: { status: "PUBLISHED" },
      },
    );
    assert.equal(creatorCampaignStatus.response.status, 403);
    const adminCreatorCampaignList = await request("/creator/campaigns", {
      cookie: adminLogin.cookie,
    });
    assert.equal(adminCreatorCampaignList.response.status, 403);

    const invalidPastDeadline = await request("/admin/campaigns", {
      method: "POST",
      cookie: adminLogin.cookie,
      body: {
        ...validCampaignInput,
        deadline: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
      },
    });
    assert.equal(invalidPastDeadline.response.status, 400);
    const invalidReward = await request("/admin/campaigns", {
      method: "POST",
      cookie: adminLogin.cookie,
      body: { ...validCampaignInput, rewardAmount: 0 },
    });
    assert.equal(invalidReward.response.status, 400);
    const invalidCountries = await request("/admin/campaigns", {
      method: "POST",
      cookie: adminLogin.cookie,
      body: { ...validCampaignInput, allowedCountries: ["Any", "IN"] },
    });
    assert.equal(invalidCountries.response.status, 400);

    const campaignCreate = await request("/admin/campaigns", {
      method: "POST",
      cookie: adminLogin.cookie,
      body: validCampaignInput,
    });
    assert.equal(campaignCreate.response.status, 201);
    const campaignId = campaignCreate.body.id;
    assert.equal(campaignCreate.body.status, "DRAFT");
    assert.equal(campaignCreate.body.currency, "USD");
    assert.equal(
      campaignCreate.body.paymentRule,
      "Payment is made only if your submission is accepted. If your work is not accepted, no payment will be made.",
    );

    const expiredCampaignId = randomUUID();
    const expiredDeadline = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const adminUser = await db.query(
      "SELECT id FROM tech_sponsor_users WHERE email = $1",
      [adminEmail],
    );
    await db.query(
      `INSERT INTO tech_sponsor_campaigns
         (id, title, organizer_name, short_description, objectives,
          content_requirements, reward_amount, currency, deadline,
          accepted_platforms, allowed_countries, minimum_followers, niches,
          status, created_by)
       VALUES
         ($1, 'Expired test campaign', 'Northstar Labs', 'Expired test',
          'Test campaign visibility', 'No creator action required',
          10, 'USD', $2, ARRAY['YouTube']::text[], ARRAY['Any']::text[],
          0, ARRAY['Technology']::text[], 'PUBLISHED', $3)`,
      [expiredCampaignId, expiredDeadline, adminUser.rows[0].id],
    );

    const creatorCampaignsWhileDraft = await request("/creator/campaigns", {
      cookie: creatorLogin.cookie,
    });
    assert.equal(creatorCampaignsWhileDraft.response.status, 200);
    assert.ok(
      !creatorCampaignsWhileDraft.body.campaigns.some(
        (item) => item.id === campaignId,
      ),
      "draft campaigns must not appear to creators",
    );
    assert.ok(
      !creatorCampaignsWhileDraft.body.campaigns.some(
        (item) => item.id === expiredCampaignId,
      ),
      "expired campaigns must not appear to creators",
    );
    const creatorDraftDetail = await request(
      `/creator/campaigns/${campaignId}`,
      { cookie: creatorLogin.cookie },
    );
    assert.equal(creatorDraftDetail.response.status, 404);
    const creatorExpiredDetail = await request(
      `/creator/campaigns/${expiredCampaignId}`,
      { cookie: creatorLogin.cookie },
    );
    assert.equal(creatorExpiredDetail.response.status, 404);

    const campaignList = await request("/admin/campaigns", {
      cookie: adminLogin.cookie,
    });
    assert.equal(campaignList.response.status, 200);
    assert.ok(
      campaignList.body.campaigns.some((item) => item.id === campaignId),
    );

    const campaignEdit = await request(`/admin/campaigns/${campaignId}`, {
      method: "PATCH",
      cookie: adminLogin.cookie,
      body: {
        ...validCampaignInput,
        title: "Creator tools launch — updated",
        rewardAmount: 250.75,
        currency: "INR",
        allowedCountries: ["IN", "US"],
      },
    });
    assert.equal(campaignEdit.response.status, 200);
    assert.equal(campaignEdit.body.title, "Creator tools launch — updated");
    assert.equal(campaignEdit.body.rewardAmount, 250.75);
    assert.equal(campaignEdit.body.currency, "INR");
    const attemptPaymentRuleEdit = await request(
      `/admin/campaigns/${campaignId}`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: {
          ...validCampaignInput,
          paymentRule: "Pay everyone.",
        },
      },
    );
    assert.equal(attemptPaymentRuleEdit.response.status, 400);

    const publishCampaign = await request(
      `/admin/campaigns/${campaignId}/status`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "PUBLISHED" },
      },
    );
    assert.equal(publishCampaign.response.status, 200);
    assert.equal(publishCampaign.body.status, "PUBLISHED");
    const publishedCreatorCampaigns = await request("/creator/campaigns", {
      cookie: creatorLogin.cookie,
    });
    assert.equal(publishedCreatorCampaigns.response.status, 200);
    const visibleCampaign = publishedCreatorCampaigns.body.campaigns.find(
      (item) => item.id === campaignId,
    );
    assert.equal(visibleCampaign?.status, "PUBLISHED");
    assert.equal(
      visibleCampaign?.paymentRule,
      "Payment is made only if your submission is accepted. If your work is not accepted, no payment will be made.",
    );
    const creatorCampaignDetail = await request(
      `/creator/campaigns/${campaignId}`,
      { cookie: creatorLogin.cookie },
    );
    assert.equal(creatorCampaignDetail.response.status, 200);
    assert.equal(creatorCampaignDetail.body.id, campaignId);
    const unpublishCampaign = await request(
      `/admin/campaigns/${campaignId}/status`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "DRAFT" },
      },
    );
    assert.equal(unpublishCampaign.response.status, 200);
    assert.equal(unpublishCampaign.body.status, "DRAFT");
    const creatorCampaignsAfterUnpublish = await request(
      "/creator/campaigns",
      { cookie: creatorLogin.cookie },
    );
    assert.ok(
      !creatorCampaignsAfterUnpublish.body.campaigns.some(
        (item) => item.id === campaignId,
      ),
      "unpublished campaigns must not appear to creators",
    );
    const unpublishedDetail = await request(
      `/creator/campaigns/${campaignId}`,
      { cookie: creatorLogin.cookie },
    );
    assert.equal(unpublishedDetail.response.status, 404);
    const republishCampaign = await request(
      `/admin/campaigns/${campaignId}/status`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "PUBLISHED" },
      },
    );
    assert.equal(republishCampaign.response.status, 200);
    const creatorCampaignsAfterRepublish = await request("/creator/campaigns", {
      cookie: creatorLogin.cookie,
    });
    assert.ok(
      creatorCampaignsAfterRepublish.body.campaigns.some(
        (item) => item.id === campaignId,
      ),
    );
    const closeCampaign = await request(
      `/admin/campaigns/${campaignId}/status`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "CLOSED" },
      },
    );
    assert.equal(closeCampaign.response.status, 200);
    assert.equal(closeCampaign.body.status, "CLOSED");
    const creatorCampaignsAfterClose = await request("/creator/campaigns", {
      cookie: creatorLogin.cookie,
    });
    assert.ok(
      !creatorCampaignsAfterClose.body.campaigns.some(
        (item) => item.id === campaignId,
      ),
      "closed campaigns must not appear to creators",
    );
    const closedDetail = await request(`/creator/campaigns/${campaignId}`, {
      cookie: creatorLogin.cookie,
    });
    assert.equal(closedDetail.response.status, 404);
    const reopenClosedCampaign = await request(
      `/admin/campaigns/${campaignId}/status`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "PUBLISHED" },
      },
    );
    assert.equal(reopenClosedCampaign.response.status, 400);

    const adminToCreatorProfile = await request("/creator/profile", {
      cookie: adminLogin.cookie,
    });
    assert.equal(adminToCreatorProfile.response.status, 403);

    const creatorList = await request("/admin/creator-profiles", {
      cookie: adminLogin.cookie,
    });
    assert.equal(creatorList.response.status, 200);
    const creatorRecord = creatorList.body.creators.find(
      (item) => item.email === creatorEmail,
    );
    assert.ok(creatorRecord, "admin can view the creator's profile");
    assert.equal(creatorRecord.approvalStatus, "PENDING_APPROVAL");

    const verifyPlatform = await request(
      `/admin/creator-profiles/${creatorRecord.userId}/platforms/YouTube/verification`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { verified: true },
      },
    );
    assert.equal(verifyPlatform.response.status, 200);

    const savedSamePlatform = await request("/creator/profile", {
      method: "PUT",
      cookie: creatorLogin.cookie,
      body: {
        ...profileInput,
        platforms: [
          {
            ...profileInput.platforms[0],
            followers: 5000,
          },
        ],
      },
    });
    assert.equal(savedSamePlatform.response.status, 200);
    assert.equal(
      savedSamePlatform.body.platforms[0].verified,
      true,
      "follower-count edits preserve verification for the same link",
    );

    const changedPlatformLink = await request("/creator/profile", {
      method: "PUT",
      cookie: creatorLogin.cookie,
      body: {
        ...profileInput,
        platforms: [
          {
            ...profileInput.platforms[0],
            url: "https://youtube.com/@auth-test-creator-updated",
          },
        ],
      },
    });
    assert.equal(changedPlatformLink.response.status, 200);
    assert.equal(
      changedPlatformLink.body.platforms[0].verified,
      false,
      "changing a profile URL clears its previous verification",
    );

    const rejectWithoutReason = await request(
      `/admin/creator-profiles/${creatorRecord.userId}/approval`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "REJECTED" },
      },
    );
    assert.equal(rejectWithoutReason.response.status, 400);

    const rejected = await request(
      `/admin/creator-profiles/${creatorRecord.userId}/approval`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: {
          status: "REJECTED",
          reason: "Please add your proof code to your bio.",
        },
      },
    );
    assert.equal(rejected.response.status, 200);

    const creatorSeesRejection = await request("/creator/profile", {
      cookie: creatorLogin.cookie,
    });
    assert.equal(creatorSeesRejection.body.approvalStatus, "REJECTED");
    assert.equal(
      creatorSeesRejection.body.rejectionReason,
      "Please add your proof code to your bio.",
    );

    const resubmitted = await request("/creator/profile", {
      method: "PUT",
      cookie: creatorLogin.cookie,
      body: {
        ...profileInput,
        bio: "Updated creator bio.",
        platforms: [
          {
            ...profileInput.platforms[0],
            followers: 5000,
            url: "https://youtube.com/@auth-test-creator-updated",
          },
        ],
      },
    });
    assert.equal(resubmitted.response.status, 200);
    assert.equal(resubmitted.body.approvalStatus, "PENDING_APPROVAL");
    assert.equal(resubmitted.body.rejectionReason, null);

    const validApplicationMessage =
      "My AI tutorials help developers evaluate new tools with practical examples.";
    const applicationCampaignInput = {
      ...validCampaignInput,
      title: `Application test campaign ${suffix}`,
      acceptedPlatforms: ["YouTube"],
      allowedCountries: ["IN"],
      minimumFollowers: 5000,
      niches: ["AI"],
    };
    const applicationCampaign = await request("/admin/campaigns", {
      method: "POST",
      cookie: adminLogin.cookie,
      body: applicationCampaignInput,
    });
    assert.equal(applicationCampaign.response.status, 201);
    const applicationCampaignId = applicationCampaign.body.id;

    const applicationDraftAttempt = await request(
      `/creator/campaigns/${applicationCampaignId}/applications`,
      {
        method: "POST",
        cookie: creatorLogin.cookie,
        body: {
          personalMessage: validApplicationMessage,
          paymentRuleAcknowledged: true,
        },
      },
    );
    assert.equal(applicationDraftAttempt.response.status, 404);

    const publishApplicationCampaign = await request(
      `/admin/campaigns/${applicationCampaignId}/status`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "PUBLISHED" },
      },
    );
    assert.equal(publishApplicationCampaign.response.status, 200);

    const pendingCreatorApply = await request(
      `/creator/campaigns/${applicationCampaignId}/applications`,
      {
        method: "POST",
        cookie: creatorLogin.cookie,
        body: {
          personalMessage: validApplicationMessage,
          paymentRuleAcknowledged: true,
        },
      },
    );
    assert.equal(pendingCreatorApply.response.status, 403);

    const ineligibleCampaign = await request("/admin/campaigns", {
      method: "POST",
      cookie: adminLogin.cookie,
      body: {
        ...applicationCampaignInput,
        title: `Ineligible application test ${suffix}`,
        allowedCountries: ["US"],
        minimumFollowers: 6000,
        niches: ["Business"],
      },
    });
    assert.equal(ineligibleCampaign.response.status, 201);
    const ineligibleCampaignId = ineligibleCampaign.body.id;
    const publishIneligibleCampaign = await request(
      `/admin/campaigns/${ineligibleCampaignId}/status`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "PUBLISHED" },
      },
    );
    assert.equal(publishIneligibleCampaign.response.status, 200);

    const approved = await request(
      `/admin/creator-profiles/${creatorRecord.userId}/approval`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "APPROVED" },
      },
    );
    assert.equal(approved.response.status, 200);

    const invalidShortApplication = await request(
      `/creator/campaigns/${applicationCampaignId}/applications`,
      {
        method: "POST",
        cookie: creatorLogin.cookie,
        body: {
          personalMessage: "Too short",
          paymentRuleAcknowledged: true,
        },
      },
    );
    assert.equal(invalidShortApplication.response.status, 400);
    const missingPaymentAcknowledgement = await request(
      `/creator/campaigns/${applicationCampaignId}/applications`,
      {
        method: "POST",
        cookie: creatorLogin.cookie,
        body: {
          personalMessage: validApplicationMessage,
          paymentRuleAcknowledged: false,
        },
      },
    );
    assert.equal(missingPaymentAcknowledgement.response.status, 400);

    const ineligibleCreatorApply = await request(
      `/creator/campaigns/${ineligibleCampaignId}/applications`,
      {
        method: "POST",
        cookie: creatorLogin.cookie,
        body: {
          personalMessage: validApplicationMessage,
          paymentRuleAcknowledged: true,
        },
      },
    );
    assert.equal(ineligibleCreatorApply.response.status, 403);
    assert.match(
      ineligibleCreatorApply.body.error,
      /country is not in the allowed list/i,
    );
    assert.match(ineligibleCreatorApply.body.error, /niche does not match/i);
    assert.match(ineligibleCreatorApply.body.error, /6,?000 followers/i);

    const createApplication = await request(
      `/creator/campaigns/${applicationCampaignId}/applications`,
      {
        method: "POST",
        cookie: creatorLogin.cookie,
        body: {
          personalMessage: validApplicationMessage,
          paymentRuleAcknowledged: true,
        },
      },
    );
    assert.equal(
      createApplication.response.status,
      201,
      createApplication.body.error,
    );
    assert.equal(createApplication.body.status, "UNDER_REVIEW");
    assert.equal(
      createApplication.body.campaignTitle,
      applicationCampaignInput.title,
    );
    const applicationId = createApplication.body.id;

    const duplicateApplication = await request(
      `/creator/campaigns/${applicationCampaignId}/applications`,
      {
        method: "POST",
        cookie: creatorLogin.cookie,
        body: {
          personalMessage: validApplicationMessage,
          paymentRuleAcknowledged: true,
        },
      },
    );
    assert.equal(duplicateApplication.response.status, 409);

    const creatorApplications = await request("/creator/applications", {
      cookie: creatorLogin.cookie,
    });
    assert.equal(creatorApplications.response.status, 200);
    assert.ok(
      creatorApplications.body.applications.some(
        (item) =>
          item.id === applicationId &&
          item.campaignTitle === applicationCampaignInput.title &&
          item.status === "UNDER_REVIEW",
      ),
    );
    const otherCreatorApplications = await request("/creator/applications", {
      cookie: otherCreatorLogin.cookie,
    });
    assert.equal(otherCreatorApplications.response.status, 200);
    assert.ok(
      !otherCreatorApplications.body.applications.some(
        (item) => item.id === applicationId,
      ),
      "creators can only list their own applications",
    );
    const adminCannotListCreatorApplications = await request(
      "/creator/applications",
      { cookie: adminLogin.cookie },
    );
    assert.equal(adminCannotListCreatorApplications.response.status, 403);

    const verifyApplicationPlatform = await request(
      `/admin/creator-profiles/${creatorRecord.userId}/platforms/YouTube/verification`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { verified: true },
      },
    );
    assert.equal(verifyApplicationPlatform.response.status, 200);

    const adminApplications = await request("/admin/applications", {
      cookie: adminLogin.cookie,
    });
    assert.equal(adminApplications.response.status, 200);
    const adminApplication = adminApplications.body.applications.find(
      (item) => item.id === applicationId,
    );
    assert.equal(adminApplication?.campaignTitle, applicationCampaignInput.title);
    assert.equal(adminApplication?.creatorName, "Auth Test Creator");
    assert.equal(adminApplication?.personalMessage, validApplicationMessage);
    assert.equal(adminApplication?.paymentRuleAcknowledged, true);
    assert.equal(adminApplication?.status, "UNDER_REVIEW");
    assert.equal(adminApplication?.creatorCountry, "IN");
    assert.equal(adminApplication?.creatorNiche, "AI");
    assert.deepEqual(adminApplication?.platforms, [
      {
        platform: "YouTube",
        url: "https://youtube.com/@auth-test-creator-updated",
        followers: 5000,
        verified: true,
      },
    ]);
    assert.deepEqual(adminApplication?.decisionHistory, []);
    const creatorCannotListAdminApplications = await request(
      "/admin/applications",
      { cookie: creatorLogin.cookie },
    );
    assert.equal(creatorCannotListAdminApplications.response.status, 403);
    const creatorCannotDecideApplications = await request(
      `/admin/applications/${applicationId}/decision`,
      {
        method: "PATCH",
        cookie: creatorLogin.cookie,
        body: { status: "ACCEPTED" },
      },
    );
    assert.equal(creatorCannotDecideApplications.response.status, 403);

    const rejectionWithoutReason = await request(
      `/admin/applications/${applicationId}/decision`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "NOT_SELECTED" },
      },
    );
    assert.equal(rejectionWithoutReason.response.status, 400);
    const otherRejectionWithoutNote = await request(
      `/admin/applications/${applicationId}/decision`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: {
          status: "NOT_SELECTED",
          rejectionReason: "OTHER",
        },
      },
    );
    assert.equal(otherRejectionWithoutNote.response.status, 400);

    const rejection = await request(
      `/admin/applications/${applicationId}/decision`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: {
          status: "NOT_SELECTED",
          rejectionReason: "APPLICATION_MESSAGE_TOO_WEAK",
          note: "Please give a more specific example of your planned content.",
        },
      },
    );
    assert.equal(rejection.response.status, 200);
    assert.equal(rejection.body.status, "NOT_SELECTED");
    assert.equal(rejection.body.rejectionReason, "APPLICATION_MESSAGE_TOO_WEAK");

    const creatorSeesRejectedApplication = await request("/creator/applications", {
      cookie: creatorLogin.cookie,
    });
    const rejectedApplication = creatorSeesRejectedApplication.body.applications.find(
      (item) => item.id === applicationId,
    );
    assert.equal(rejectedApplication?.status, "NOT_SELECTED");
    assert.equal(
      rejectedApplication?.rejectionReason,
      "APPLICATION_MESSAGE_TOO_WEAK",
    );
    assert.equal(
      rejectedApplication?.decisionNote,
      "Please give a more specific example of your planned content.",
    );

    const winnerFromRejected = await request(
      `/admin/applications/${applicationId}/decision`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: {
          status: "WINNER",
          changeReason: "This should not be permitted.",
        },
      },
    );
    assert.equal(winnerFromRejected.response.status, 409);
    const changeWithoutReason = await request(
      `/admin/applications/${applicationId}/decision`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "ACCEPTED" },
      },
    );
    assert.equal(changeWithoutReason.response.status, 400);

    const correctedDecision = await request(
      `/admin/applications/${applicationId}/decision`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: {
          status: "ACCEPTED",
          note: "The creator has now clarified their proposed content.",
          changeReason: "Reviewed new information from the creator.",
        },
      },
    );
    assert.equal(correctedDecision.response.status, 200);
    assert.equal(correctedDecision.body.status, "ACCEPTED");

    const winnerWithoutReason = await request(
      `/admin/applications/${applicationId}/decision`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: { status: "WINNER" },
      },
    );
    assert.equal(winnerWithoutReason.response.status, 400);
    const winner = await request(
      `/admin/applications/${applicationId}/decision`,
      {
        method: "PATCH",
        cookie: adminLogin.cookie,
        body: {
          status: "WINNER",
          changeReason: "Selected as the campaign winner after review.",
        },
      },
    );
    assert.equal(winner.response.status, 200);
    assert.equal(winner.body.status, "WINNER");

    const updatedAdminApplications = await request("/admin/applications", {
      cookie: adminLogin.cookie,
    });
    const updatedAdminApplication =
      updatedAdminApplications.body.applications.find(
        (item) => item.id === applicationId,
      );
    assert.equal(updatedAdminApplication?.status, "WINNER");
    assert.equal(updatedAdminApplication?.decisionHistory.length, 3);
    assert.equal(
      updatedAdminApplication?.decisionHistory[0].decidedByName,
      "Auth Test",
    );
    assert.equal(
      updatedAdminApplication?.decisionHistory[1].changeReason,
      "Reviewed new information from the creator.",
    );
    assert.ok(updatedAdminApplication?.decisionHistory[2].decidedAt);

    const creatorSeesWinner = await request("/creator/applications", {
      cookie: creatorLogin.cookie,
    });
    assert.equal(
      creatorSeesWinner.body.applications.find((item) => item.id === applicationId)
        ?.status,
      "WINNER",
    );
    const expiredCampaignApply = await request(
      `/creator/campaigns/${expiredCampaignId}/applications`,
      {
        method: "POST",
        cookie: creatorLogin.cookie,
        body: {
          personalMessage: validApplicationMessage,
          paymentRuleAcknowledged: true,
        },
      },
    );
    assert.equal(expiredCampaignApply.response.status, 404);
    const closedCampaignApply = await request(
      `/creator/campaigns/${campaignId}/applications`,
      {
        method: "POST",
        cookie: creatorLogin.cookie,
        body: {
          personalMessage: validApplicationMessage,
          paymentRuleAcknowledged: true,
        },
      },
    );
    assert.equal(closedCampaignApply.response.status, 404);

    const finalCreatorList = await request("/admin/creator-profiles", {
      cookie: adminLogin.cookie,
    });
    assert.equal(
      finalCreatorList.body.creators.find(
        (item) => item.email === creatorEmail,
      )?.approvalStatus,
      "APPROVED",
    );

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

    const resetRequest = await request("/auth/password-reset/request", {
      method: "POST",
      body: { email: adminEmail },
    });
    assert.equal(resetRequest.response.status, 200);
    assert.equal(typeof resetRequest.body.message, "string");
    assert.equal(resetRequest.body.resetUrl, undefined);
    const unknownResetRequest = await request("/auth/password-reset/request", {
      method: "POST",
      body: { email: `missing-${suffix}@example.test` },
    });
    assert.deepEqual(
      unknownResetRequest.body,
      resetRequest.body,
      "password-reset requests must not reveal whether an email exists",
    );

    const resetToken = randomBytes(32).toString("base64url");
    const adminRecord = await db.query(
      "SELECT id FROM tech_sponsor_users WHERE email = $1",
      [adminEmail],
    );
    await db.query(
      `INSERT INTO tech_sponsor_password_reset_tokens (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
      [hashToken(resetToken), adminRecord.rows[0].id],
    );
    const resetPassword = await request("/auth/password-reset/confirm", {
      method: "POST",
      body: {
        token: resetToken,
        newPassword: "safe-reset-password-456",
      },
    });
    assert.equal(resetPassword.response.status, 200);
    const reusedResetToken = await request("/auth/password-reset/confirm", {
      method: "POST",
      body: {
        token: resetToken,
        newPassword: "safe-reset-password-789",
      },
    });
    assert.equal(reusedResetToken.response.status, 400);
    const oldAdminSession = await request("/auth/me", {
      cookie: adminLogin.cookie,
    });
    assert.equal(oldAdminSession.response.status, 401);
    const oldAdminPassword = await request("/auth/login", {
      method: "POST",
      body: { email: adminEmail, password: "safe-test-password-123" },
    });
    assert.equal(oldAdminPassword.response.status, 401);
    const newAdminPassword = await request("/auth/login", {
      method: "POST",
      body: { email: adminEmail, password: "safe-reset-password-456" },
    });
    assert.equal(newAdminPassword.response.status, 200);
    assert.equal(newAdminPassword.body.role, "ADMIN");

    const expiredResetToken = randomBytes(32).toString("base64url");
    await db.query(
      `INSERT INTO tech_sponsor_password_reset_tokens (token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() - INTERVAL '1 second')`,
      [hashToken(expiredResetToken), adminRecord.rows[0].id],
    );
    const expiredReset = await request("/auth/password-reset/confirm", {
      method: "POST",
      body: {
        token: expiredResetToken,
        newPassword: "safe-reset-password-999",
      },
    });
    assert.equal(expiredReset.response.status, 400);

    const devPort = await findAvailablePort();
    const devServer = spawn(
      process.execPath,
      [fileURLToPath(new URL("../dist/index.mjs", import.meta.url))],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: {
          ...process.env,
          ADMIN_EMAILS: adminEmail,
          NODE_ENV: "development",
          PORT: String(devPort),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let devOutput = "";
    const appendDevOutput = (chunk) => {
      devOutput += chunk.toString();
    };
    devServer.stdout.on("data", appendDevOutput);
    devServer.stderr.on("data", appendDevOutput);

    try {
      const devBaseUrl = `http://127.0.0.1:${devPort}/api`;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (devServer.exitCode !== null) {
          throw new Error("Development reset test server exited before becoming ready.");
        }
        try {
          const response = await fetch(`${devBaseUrl}/healthz`);
          if (response.ok) break;
        } catch {
          // The development server may still be starting.
        }
        await delay(100);
      }

      async function requestDevelopmentReset() {
        const outputOffset = devOutput.length;
        const response = await fetch(`${devBaseUrl}/auth/password-reset/request`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: adminEmail }),
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.resetUrl, undefined);

        let resetUrl = null;
        for (let attempt = 0; attempt < 40 && !resetUrl; attempt += 1) {
          const recentOutput = devOutput
            .slice(outputOffset)
            .replace(/\u001b\[[0-9;]*m/g, "");
          const match = recentOutput.match(/resetUrl:\s*["']?([^\s"']+)/);
          if (match) resetUrl = match[1];
          else await delay(25);
        }
        const safeOutput = devOutput
          .slice(outputOffset)
          .replace(/\u001b\[[0-9;]*m/g, "")
          .replace(/(resetUrl:\s*["']?)[^\s"']+/g, "$1[redacted]");
        assert.ok(
          resetUrl,
          `Development reset link should be available in server logs. Output: ${safeOutput.slice(-1200)}`,
        );
        return new URL(resetUrl).searchParams.get("token");
      }

      const firstDevToken = await requestDevelopmentReset();
      const secondDevToken = await requestDevelopmentReset();
      assert.ok(firstDevToken);
      assert.ok(secondDevToken);
      assert.notEqual(firstDevToken, secondDevToken);

      const rotatedTokenResult = await fetch(
        `${devBaseUrl}/auth/password-reset/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: firstDevToken,
            newPassword: "safe-reset-password-111",
          }),
        },
      );
      assert.equal(rotatedTokenResult.status, 400);

      const currentDevTokenResult = await fetch(
        `${devBaseUrl}/auth/password-reset/confirm`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: secondDevToken,
            newPassword: "safe-reset-password-222",
          }),
        },
      );
      assert.equal(currentDevTokenResult.status, 200);
    } finally {
      devServer.kill("SIGTERM");
      if (devServer.exitCode === null) await once(devServer, "exit").catch(() => {});
    }
  } finally {
    server.kill("SIGTERM");
    if (server.exitCode === null) await once(server, "exit").catch(() => {});
    await db.query(
      `DELETE FROM tech_sponsor_campaigns
       WHERE created_by IN (
         SELECT id FROM tech_sponsor_users WHERE email = ANY($1::text[])
       )`,
      [testEmails],
    );
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
