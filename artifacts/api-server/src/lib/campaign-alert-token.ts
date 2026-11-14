import { createHmac, timingSafeEqual } from "node:crypto";

function makeToken(userId: string, version: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return createHmac("sha256", secret)
    .update(`${userId}:${version}`)
    .digest("base64url");
}

export function campaignAlertUnsubscribeToken(
  userId: string,
  version: string,
): string {
  return makeToken(userId, version);
}

export function isValidCampaignAlertToken(
  userId: string,
  version: string,
  candidate: string,
): boolean {
  if (!/^[A-Za-z0-9_-]{40,48}$/.test(candidate)) return false;
  const expected = Buffer.from(makeToken(userId, version));
  const actual = Buffer.from(candidate);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
