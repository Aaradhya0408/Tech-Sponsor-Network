import { randomInt } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  GetCreatorProfileResponse,
  ListAdminCreatorProfilesResponse,
  UpdateCreatorApprovalBody,
  UpdateCreatorApprovalParams,
  UpdateCreatorApprovalResponse,
  UpdateCreatorPlatformVerificationBody,
  UpdateCreatorPlatformVerificationParams,
  UpdateCreatorPlatformVerificationResponse,
  UpdateCreatorProfileBody,
  UpdateCreatorProfileResponse,
} from "@workspace/api-zod";
import {
  CREATOR_PLATFORMS,
  creatorPlatformsTable,
  creatorProfilesTable,
  db,
  usersTable,
} from "@workspace/db";
import { Router, type IRouter, type Response } from "express";
import { requireRole } from "./auth";

const router: IRouter = Router();
type UserRecord = typeof usersTable.$inferSelect;
type ProfileRecord = typeof creatorProfilesTable.$inferSelect;
type PlatformRecord = typeof creatorPlatformsTable.$inferSelect;

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const nonCountryRegionCodes = new Set([
  "AC",
  "AN",
  "CP",
  "CQ",
  "CS",
  "DD",
  "DG",
  "EA",
  "EU",
  "EZ",
  "FX",
  "IC",
  "NT",
  "QO",
  "SU",
  "TA",
  "TP",
  "UK",
  "UN",
  "YU",
  "ZR",
  "ZZ",
]);

function isCountryCode(value: string): boolean {
  if (!/^[A-Z]{2}$/.test(value) || nonCountryRegionCodes.has(value)) {
    return false;
  }
  if (value.startsWith("X") && value !== "XK") return false;
  const name = regionNames.of(value);
  return Boolean(name && name !== value && name !== "Unknown Region");
}

function error(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function creatorCompleteness(
  profile: ProfileRecord,
  platforms: PlatformRecord[],
): number {
  const completedFields = [
    Boolean(profile.displayName.trim()),
    Boolean(profile.bio.trim()),
    isCountryCode(profile.country),
    Boolean(profile.niche),
    platforms.length > 0,
  ].filter(Boolean).length;

  return completedFields * 20;
}

function profileResponse(
  profile: ProfileRecord,
  platforms: PlatformRecord[],
) {
  const platformOrder = new Map(
    CREATOR_PLATFORMS.map((platform, index) => [platform, index]),
  );
  const sortedPlatforms = [...platforms].sort(
    (left, right) =>
      (platformOrder.get(left.platform) ?? 0) -
      (platformOrder.get(right.platform) ?? 0),
  );

  return {
    userId: profile.userId,
    displayName: profile.displayName,
    bio: profile.bio,
    country: profile.country,
    niche: profile.niche,
    proofCode: profile.proofCode,
    approvalStatus: profile.approvalStatus,
    rejectionReason: profile.rejectionReason,
    completeness: creatorCompleteness(profile, platforms),
    platforms: sortedPlatforms.map((platform) => ({
      platform: platform.platform,
      url: platform.url,
      followers: platform.followers,
      verified: platform.verified,
    })),
  };
}

function adminProfileResponse(
  user: UserRecord,
  profile: ProfileRecord,
  platforms: PlatformRecord[],
) {
  return {
    ...profileResponse(profile, platforms),
    userName: user.name,
    email: user.email,
  };
}

async function ensureCreatorProfile(user: UserRecord): Promise<ProfileRecord> {
  const [existing] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, user.id))
    .limit(1);
  if (existing) return existing;

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const proofCode = `TSN-${randomInt(1000, 10000)}`;
    await db
      .insert(creatorProfilesTable)
      .values({
        userId: user.id,
        displayName: user.name.trim() || "Creator",
        proofCode,
      })
      .onConflictDoNothing();

    const [profile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, user.id))
      .limit(1);
    if (profile) return profile;
  }

  throw new Error("Could not allocate a unique creator proof code.");
}

async function listPlatforms(userId: string): Promise<PlatformRecord[]> {
  return db
    .select()
    .from(creatorPlatformsTable)
    .where(eq(creatorPlatformsTable.userId, userId));
}

function authenticatedUser(res: Response): UserRecord {
  return res.locals.authUser as UserRecord;
}

router.get(
  "/creator/profile",
  requireRole("CREATOR"),
  async (_req, res): Promise<void> => {
    const user = authenticatedUser(res);
    const profile = await ensureCreatorProfile(user);
    const platforms = await listPlatforms(user.id);
    res.json(GetCreatorProfileResponse.parse(profileResponse(profile, platforms)));
  },
);

router.put(
  "/creator/profile",
  requireRole("CREATOR"),
  async (req, res): Promise<void> => {
    const parsed = UpdateCreatorProfileBody.safeParse(req.body);
    if (!parsed.success) {
      error(res, 400, "Check your profile fields and try again.");
      return;
    }

    const displayName = parsed.data.displayName.trim();
    const bio = parsed.data.bio.trim();
    if (!displayName) {
      error(res, 400, "Display name is required.");
      return;
    }
    if (!isCountryCode(parsed.data.country)) {
      error(res, 400, "Choose a valid country.");
      return;
    }

    const usedPlatforms = new Set<string>();
    for (const item of parsed.data.platforms) {
      if (usedPlatforms.has(item.platform)) {
        error(res, 400, "Choose each platform only once.");
        return;
      }
      usedPlatforms.add(item.platform);

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(item.url);
      } catch {
        error(res, 400, `Enter a valid ${item.platform} profile link.`);
        return;
      }
      if (
        !["http:", "https:"].includes(parsedUrl.protocol) ||
        !parsedUrl.hostname ||
        parsedUrl.username ||
        parsedUrl.password
      ) {
        error(res, 400, `Enter a valid ${item.platform} profile link.`);
        return;
      }
    }

    const user = authenticatedUser(res);
    const currentProfile = await ensureCreatorProfile(user);

    await db.transaction(async (tx) => {
      await tx
        .update(creatorProfilesTable)
        .set({
          displayName,
          bio,
          country: parsed.data.country,
          niche: parsed.data.niche,
          ...(currentProfile.approvalStatus === "REJECTED"
            ? {
                approvalStatus: "PENDING_APPROVAL" as const,
                rejectionReason: null,
              }
            : {}),
        })
        .where(eq(creatorProfilesTable.userId, user.id));

      for (const item of parsed.data.platforms) {
        await tx
          .insert(creatorPlatformsTable)
          .values({
            userId: user.id,
            platform: item.platform,
            url: item.url,
            followers: item.followers,
            verified: false,
          })
          .onConflictDoUpdate({
            target: [
              creatorPlatformsTable.userId,
              creatorPlatformsTable.platform,
            ],
            set: {
              url: item.url,
              followers: item.followers,
              verified: sql`${creatorPlatformsTable.url} = ${item.url} AND ${creatorPlatformsTable.verified}`,
              updatedAt: new Date(),
            },
          });
      }

      if (parsed.data.platforms.length === 0) {
        await tx
          .delete(creatorPlatformsTable)
          .where(eq(creatorPlatformsTable.userId, user.id));
      } else {
        await tx
          .delete(creatorPlatformsTable)
          .where(
            and(
              eq(creatorPlatformsTable.userId, user.id),
              notInArray(
                creatorPlatformsTable.platform,
                parsed.data.platforms.map((item) => item.platform),
              ),
            ),
          );
      }
    });

    const [profile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, user.id))
      .limit(1);
    const platforms = await listPlatforms(user.id);
    res.json(
      UpdateCreatorProfileResponse.parse(
        profileResponse(profile ?? currentProfile, platforms),
      ),
    );
  },
);

router.get(
  "/admin/creator-profiles",
  requireRole("ADMIN"),
  async (_req, res): Promise<void> => {
    const creators = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.role, "CREATOR"))
      .orderBy(asc(usersTable.createdAt));

    const profiles = await Promise.all(
      creators.map((creator) => ensureCreatorProfile(creator)),
    );
    const creatorIds = creators.map((creator) => creator.id);
    const platforms = creatorIds.length
      ? await db
          .select()
          .from(creatorPlatformsTable)
          .where(inArray(creatorPlatformsTable.userId, creatorIds))
      : [];
    const profilesByUserId = new Map(
      profiles.map((profile) => [profile.userId, profile]),
    );
    const platformsByUserId = new Map<string, PlatformRecord[]>();
    for (const platform of platforms) {
      const items = platformsByUserId.get(platform.userId) ?? [];
      items.push(platform);
      platformsByUserId.set(platform.userId, items);
    }

    const response = {
      creators: creators.map((creator) => {
        const profile = profilesByUserId.get(creator.id);
        if (!profile) {
          throw new Error("Creator profile could not be loaded.");
        }
        return adminProfileResponse(
          creator,
          profile,
          platformsByUserId.get(creator.id) ?? [],
        );
      }),
    };

    res.json(ListAdminCreatorProfilesResponse.parse(response));
  },
);

router.patch(
  "/admin/creator-profiles/:userId/approval",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const params = UpdateCreatorApprovalParams.safeParse(req.params);
    const body = UpdateCreatorApprovalBody.safeParse(req.body);
    if (!params.success || !body.success) {
      error(res, 400, "Choose a valid approval decision.");
      return;
    }

    const reason = body.data.reason?.trim() ?? "";
    if (body.data.status === "REJECTED" && !reason) {
      error(res, 400, "Add a short reason when rejecting a profile.");
      return;
    }

    const [creator] = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, params.data.userId),
          eq(usersTable.role, "CREATOR"),
        ),
      )
      .limit(1);
    if (!creator) {
      error(res, 404, "Creator not found.");
      return;
    }

    await ensureCreatorProfile(creator);
    await db
      .update(creatorProfilesTable)
      .set({
        approvalStatus: body.data.status,
        rejectionReason: body.data.status === "REJECTED" ? reason : null,
      })
      .where(eq(creatorProfilesTable.userId, creator.id));

    res.json(
      UpdateCreatorApprovalResponse.parse({
        message:
          body.data.status === "APPROVED"
            ? "Creator approved."
            : "Creator profile rejected.",
      }),
    );
  },
);

router.patch(
  "/admin/creator-profiles/:userId/platforms/:platform/verification",
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    const params = UpdateCreatorPlatformVerificationParams.safeParse(req.params);
    const body = UpdateCreatorPlatformVerificationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      error(res, 400, "Choose a valid platform verification update.");
      return;
    }

    const [creator] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, params.data.userId),
          eq(usersTable.role, "CREATOR"),
        ),
      )
      .limit(1);
    if (!creator) {
      error(res, 404, "Creator not found.");
      return;
    }

    const [platform] = await db
      .select({ id: creatorPlatformsTable.id })
      .from(creatorPlatformsTable)
      .where(
        and(
          eq(creatorPlatformsTable.userId, creator.id),
          eq(creatorPlatformsTable.platform, params.data.platform),
        ),
      )
      .limit(1);
    if (!platform) {
      error(res, 404, "Creator platform link not found.");
      return;
    }

    await db
      .update(creatorPlatformsTable)
      .set({ verified: body.data.verified })
      .where(eq(creatorPlatformsTable.id, platform.id));

    res.json(
      UpdateCreatorPlatformVerificationResponse.parse({
        message: body.data.verified
          ? `${params.data.platform} link marked verified.`
          : `${params.data.platform} verification removed.`,
      }),
    );
  },
);

export default router;
