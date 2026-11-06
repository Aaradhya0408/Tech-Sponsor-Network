import type {
  CampaignRecord,
  CreatorPlatformRecord,
  CreatorProfileRecord,
} from "@workspace/db";

type EligibilityCampaign = Pick<
  CampaignRecord,
  | "acceptedPlatforms"
  | "allowedCountries"
  | "minimumFollowers"
  | "niches"
>;

type EligibilityProfile = Pick<
  CreatorProfileRecord,
  "country" | "niche"
>;

type EligibilityPlatform = Pick<
  CreatorPlatformRecord,
  "platform" | "url" | "followers"
>;

export function campaignEligibilityReasons(
  campaign: EligibilityCampaign,
  profile: EligibilityProfile,
  platforms: EligibilityPlatform[],
): string[] {
  const reasons: string[] = [];
  const allowsAnyCountry = campaign.allowedCountries.includes("Any");

  if (!allowsAnyCountry) {
    if (!profile.country.trim()) {
      reasons.push("Add a country to your creator profile before applying.");
    } else if (!campaign.allowedCountries.includes(profile.country)) {
      reasons.push("Your country is not in the allowed list.");
    }
  }

  if (!profile.niche.trim()) {
    reasons.push("Choose a niche in your creator profile before applying.");
  } else if (!campaign.niches.includes(profile.niche as never)) {
    reasons.push(
      `Your niche does not match this campaign. It is looking for ${campaign.niches.join(", ")} creators.`,
    );
  }

  const acceptedLinks = platforms.filter(
    (platform) =>
      platform.url.trim() &&
      campaign.acceptedPlatforms.includes(platform.platform),
  );
  const qualifyingLinks = acceptedLinks.filter(
    (platform) => platform.followers >= campaign.minimumFollowers,
  );

  if (qualifyingLinks.length === 0) {
    if (acceptedLinks.length === 0) {
      reasons.push(
        `Add a link for at least one accepted platform: ${campaign.acceptedPlatforms.join(" or ")}.`,
      );
    } else {
      reasons.push(
        `You need at least ${new Intl.NumberFormat("en").format(campaign.minimumFollowers)} followers on ${acceptedLinks.map((platform) => platform.platform).join(" or ")}.`,
      );
    }
  }

  return reasons;
}
