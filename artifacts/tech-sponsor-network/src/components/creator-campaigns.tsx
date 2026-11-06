import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, CheckCircle2, Filter, Globe2, Search, ShieldCheck, SlidersHorizontal, UsersRound, XCircle, Send, CircleCheck } from 'lucide-react';
import { Link, useLocation, useParams } from 'wouter';
import {
  getGetCreatorProfileQueryKey,
  getGetCurrentUserQueryKey,
  getGetCreatorCampaignQueryKey,
  getListCreatorCampaignsQueryKey,
  getListCreatorApplicationsQueryKey,
  useListCreatorApplications,
  useCreateCreatorCampaignApplication,
  useGetCreatorProfile,
  useGetCurrentUser,
  useGetCreatorCampaign,
  useListCreatorCampaigns,
} from '@workspace/api-client-react';
import type { AdminCampaign, CreatorProfile, CampaignApplicationInput } from '@workspace/api-client-react';
import { COUNTRY_OPTIONS } from '@/lib/countries';
import { Form } from '@/components/ui/form';

function messageOf(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.';
}

function reward(amount: number, currency: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount); }
  catch { return `${currency} ${amount.toFixed(2)}`; }
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

function countryName(code: string) {
  return COUNTRY_OPTIONS.find(country => country.code === code)?.name ?? code;
}

function eligibility(campaign: AdminCampaign, profile: CreatorProfile) {
  const reasons: string[] = [];
  const anyCountry = campaign.allowedCountries.includes('Any');
  if (!anyCountry) {
    if (!profile.country.trim()) {
      reasons.push('Complete your country in your creator profile to check eligibility.');
    } else if (!campaign.allowedCountries.includes(profile.country)) {
      reasons.push('Your country is not in the allowed list.');
    }
  }
  if (!profile.niche.trim()) {
    reasons.push('Complete your niche in your creator profile to check eligibility.');
  } else if (!campaign.niches.includes(profile.niche as never)) {
    reasons.push(`Your ${profile.niche || 'unspecified'} niche is not included. This campaign is looking for ${campaign.niches.join(', ')} creators.`);
  }
  const linked = profile.platforms.filter(item => item.url.trim() && campaign.acceptedPlatforms.includes(item.platform));
  const qualified = linked.filter(item => item.followers >= campaign.minimumFollowers);
  if (qualified.length === 0) {
    if (!linked.length) {
      reasons.push(`Add a public ${campaign.acceptedPlatforms.join(' or ')} profile link to your creator profile.`);
    } else {
      const needed = new Intl.NumberFormat('en').format(campaign.minimumFollowers);
      reasons.push(`You need at least ${needed} followers on ${linked.map(item => item.platform).join(' or ')}.`);
    }
  }
  return { eligible: reasons.length === 0, reasons };
}

function LoadingBlock() {
  return <div className="mt-8 animate-pulse space-y-4" data-testid="loading-creator-campaigns"><div className="h-36 rounded-[22px] bg-muted" /><div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map(item => <div key={item} className="h-64 rounded-[22px] bg-muted" />)}</div></div>;
}

function CampaignHeader({ back = false }: { back?: boolean }) {
  return <header className="flex min-h-[76px] items-center justify-between border-b border-border/80 px-5 sm:px-9 lg:px-[7vw]">
    <Link href="/dashboard" data-testid="link-campaign-brand-dashboard" className="brand-mark text-foreground"><span className="brand-symbol"><span /><span /><span /></span><span className="font-semibold tracking-[-.04em]">tech sponsor<span className="text-primary">.</span></span></Link>
    <Link href={back ? '/campaigns' : '/dashboard'} data-testid={back ? 'link-back-campaigns' : 'link-campaign-dashboard'} className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground">
      <ArrowLeft size={14} /><span className="hidden sm:inline">{back ? 'All opportunities' : 'Creator dashboard'}</span><span className="sm:hidden">{back ? 'Back to list' : 'Dashboard'}</span>
    </Link>
  </header>;
}

function PaymentRule({ campaign, compact = false }: { campaign: AdminCampaign; compact?: boolean }) {
  return <div data-testid={`panel-payment-rule-${campaign.id}`} className={`flex gap-3 rounded-xl border border-[#d7d7c7] bg-[#f0efe7] ${compact ? 'p-3.5' : 'p-4 sm:p-5'}`}>
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#dce4d9] text-primary"><ShieldCheck size={17} /></div>
    <div className="min-w-0"><div className="eyebrow text-primary">Payment rule · fixed</div><p className="mt-1 text-xs leading-5 text-foreground sm:text-sm sm:leading-6">{campaign.paymentRule}</p></div>
  </div>;
}

function EligibilityPanel({ campaign, profile }: { campaign: AdminCampaign; profile?: CreatorProfile }) {
  if (!profile) return <div className="rounded-xl border border-border bg-muted/60 p-4 text-sm leading-6 text-muted-foreground" data-testid={`status-eligibility-unavailable-${campaign.id}`}>Your profile details could not be loaded, so eligibility cannot be calculated right now.</div>;
  if (profile.approvalStatus === 'PENDING_APPROVAL') return <div className="flex gap-3 rounded-xl border border-[#e2d2b8] bg-[#f4eddf] p-4" data-testid={`status-eligibility-pending-${campaign.id}`}>
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#eadcc4] text-[#805a36]"><BadgeCheck size={17} /></div><div><span className="inline-flex rounded-full bg-[#eadcc4] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#664b30]">Eligibility pending</span><p className="mt-2 text-xs leading-5 text-[#785f44]">You can browse this opportunity now. We’ll show your eligibility once your creator profile is approved.</p></div>
  </div>;
  if (profile.approvalStatus !== 'APPROVED') return <div className="rounded-xl border border-border bg-muted/60 p-4 text-sm leading-6 text-muted-foreground" data-testid={`status-eligibility-unavailable-${campaign.id}`}><span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em]">Approval required</span><p className="mt-2">Creator profile approval is needed before eligibility can be calculated.</p></div>;
  const result = eligibility(campaign, profile);
  return result.eligible
    ? <div className="flex gap-3 rounded-xl border border-[#bed1c1] bg-[#e7efe6] p-4" data-testid={`status-eligible-${campaign.id}`}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#d3dfd2] text-[#315848]"><CheckCircle2 size={18} /></div><div><p className="text-sm font-semibold text-[#315848]">You are eligible</p><p className="mt-1 text-xs leading-5 text-[#426451]">Your current profile meets the listed country, niche, and audience requirements.</p></div></div>
    : <div className="flex gap-3 rounded-xl border border-[#e3c2bb] bg-[#f7e9e6] p-4" data-testid={`status-not-eligible-${campaign.id}`}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#efd8d2] text-[#8f463d]"><XCircle size={18} /></div><div><p className="text-sm font-semibold text-[#8f463d]">Not eligible</p><ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-[#8f463d]">{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div></div>;
}

function StatusForProfile({ profile, campaign }: { profile?: CreatorProfile; campaign: AdminCampaign }) {
  if (!profile) return <p className="text-xs text-muted-foreground">Eligibility is not available until your creator profile loads.</p>;
  if (profile.approvalStatus === 'PENDING_APPROVAL') return <div className="space-y-1.5"><span className="inline-flex rounded-full bg-[#f4eddf] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#664b30]">Eligibility pending</span><p className="text-xs leading-5 text-[#785f44]">Eligibility will be shown after profile approval.</p></div>;
  if (profile.approvalStatus !== 'APPROVED') return <div className="space-y-1.5"><span className="inline-flex rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em]">Approval required</span><p className="text-xs text-muted-foreground">Creator profile approval is needed before eligibility can be calculated.</p></div>;
  const result = eligibility(campaign, profile);
  return result.eligible
    ? <div className="space-y-1.5"><p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#315848]"><CheckCircle2 size={14} /> You are eligible</p></div>
    : <div className="space-y-1.5"><p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8f463d]"><XCircle size={14} /> Not eligible</p><ul className="list-disc space-y-1 pl-4 text-[11px] leading-5 text-[#8f463d]">{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>;
}

function CampaignCard({ campaign, profile, applied }: { campaign: AdminCampaign; profile?: CreatorProfile; applied: boolean }) {
  return <article data-testid={`card-creator-campaign-${campaign.id}`} className="flex h-full flex-col overflow-hidden rounded-[22px] border border-border/80 bg-card transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_16px_40px_-32px_rgba(36,52,43,.42)]">
    <div className="p-5 sm:p-6">
       <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="eyebrow text-primary">{campaign.organizerName}</p><h2 data-testid={`text-creator-campaign-title-${campaign.id}`} className="serif mt-2 text-[1.4rem] font-semibold leading-tight tracking-[-.045em]">{campaign.title}</h2></div><div className="flex shrink-0 flex-col items-end gap-2"><span className="rounded-full bg-[#e5ebe1] px-3 py-1.5 text-sm font-semibold text-[#315848]" data-testid={`text-creator-campaign-reward-${campaign.id}`}>{reward(campaign.rewardAmount, campaign.currency)}</span>{applied && <span data-testid={`status-applied-card-${campaign.id}`} className="inline-flex items-center gap-1 rounded-full bg-[#e7efe6] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#315848]"><CircleCheck size={12} /> Applied</span>}</div></div>
      <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{campaign.shortDescription}</p>
      <div className="mt-5 flex flex-wrap gap-2">{campaign.niches.map(niche => <span key={niche} className="rounded-full bg-secondary px-3 py-1.5 text-[11px] font-semibold text-secondary-foreground">{niche}</span>)}</div>
      <div className="mt-5 grid gap-2 border-t border-border pt-4 text-xs text-muted-foreground sm:grid-cols-2">
        <span className="inline-flex items-center gap-2"><CalendarDays size={14} className="shrink-0 text-primary" />Due {dateLabel(campaign.deadline)}</span>
        <span className="inline-flex items-center gap-2"><UsersRound size={14} className="shrink-0 text-primary" />{new Intl.NumberFormat('en').format(campaign.minimumFollowers)}+ followers</span>
        <span className="inline-flex items-center gap-2"><Globe2 size={14} className="shrink-0 text-primary" />{campaign.allowedCountries.includes('Any') ? 'Any country' : campaign.allowedCountries.map(countryName).join(', ')}</span>
        <span className="inline-flex items-center gap-2"><SlidersHorizontal size={14} className="shrink-0 text-primary" />{campaign.acceptedPlatforms.join(', ')}</span>
      </div>
      <div className="mt-4 min-h-8"><StatusForProfile campaign={campaign} profile={profile} /></div>
    </div>
    <div className="mt-auto space-y-3 border-t border-border bg-background/45 p-4 sm:p-5">
      <PaymentRule campaign={campaign} compact />
      <Link href={`/campaigns/${encodeURIComponent(campaign.id)}`} data-testid={`link-campaign-detail-${campaign.id}`} className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-95">View campaign details <ArrowRight size={15} className="transition-transform group-hover:translate-x-1" /></Link>
    </div>
  </article>;
}

export function CampaignDiscovery() {
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const profileQuery = useGetCreatorProfile({ query: { queryKey: getGetCreatorProfileQueryKey(), enabled: !!current.data && current.data.role === 'CREATOR', retry: false } });
  const campaignsQuery = useListCreatorCampaigns({ query: { queryKey: getListCreatorCampaignsQueryKey(), enabled: !!current.data && current.data.role === 'CREATOR', retry: false } });
  const applicationsQuery = useListCreatorApplications({ query: { queryKey: getListCreatorApplicationsQueryKey(), enabled: !!current.data && current.data.role === 'CREATOR', retry: false } });
  const [niche, setNiche] = useState('All niches');
  const [platform, setPlatform] = useState('All platforms');
  const [country, setCountry] = useState('All countries');
  const [sort, setSort] = useState('deadline');
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const campaigns = campaignsQuery.data?.campaigns ?? [];
  const profile = profileQuery.data;
  const appliedCampaignIds = useMemo(() => new Set((applicationsQuery.data?.applications ?? []).map(application => application.campaignId)), [applicationsQuery.data?.applications]);
  useEffect(() => { if (current.isError) setLocation('/login'); }, [current.isError, setLocation]);
  const todayUtc = new Date().toISOString().slice(0, 10);
  const published = useMemo(() => campaigns.filter(campaign => campaign.status === 'PUBLISHED' && campaign.deadline >= todayUtc), [campaigns, todayUtc]);
  const nicheOptions = useMemo(() => ['All niches', ...new Set(published.flatMap(campaign => campaign.niches))], [published]);
  const platformOptions = useMemo(() => ['All platforms', ...new Set(published.flatMap(campaign => campaign.acceptedPlatforms))], [published]);
  useEffect(() => {
    if (profile && profile.approvalStatus !== 'APPROVED') setEligibleOnly(false);
  }, [profile?.approvalStatus]);
  const visible = useMemo(() => published.filter(campaign => {
    const matchesNiche = niche === 'All niches' || campaign.niches.includes(niche as never);
    const matchesPlatform = platform === 'All platforms' || campaign.acceptedPlatforms.includes(platform as never);
    const matchesCountry = country === 'All countries' || campaign.allowedCountries.includes('Any') || campaign.allowedCountries.includes(country);
    const matchesEligibility = !eligibleOnly || (!!profile && profile.approvalStatus === 'APPROVED' && eligibility(campaign, profile).eligible);
    return matchesNiche && matchesPlatform && matchesCountry && matchesEligibility;
  }).sort((a, b) => sort === 'newest' ? b.createdAt.localeCompare(a.createdAt) : a.deadline.localeCompare(b.deadline)), [published, niche, platform, country, eligibleOnly, profile, sort]);

  if (current.isError) return null;
  if (current.isLoading || !current.data) return <LoadingBlock />;
  if (current.data.role !== 'CREATOR') return <main className="min-h-[100dvh] bg-background"><CampaignHeader /><section className="mx-auto max-w-3xl px-5 py-16 text-center"><h1 className="serif text-3xl font-semibold">Creator opportunities are for members.</h1><p className="mt-3 text-sm text-muted-foreground">Sign in with a creator account to explore campaigns.</p><Link href="/dashboard" className="mt-6 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Return to dashboard</Link></section></main>;

  return <main className="min-h-[100dvh] bg-background">
    <CampaignHeader />
    <section className="mx-auto max-w-[1180px] px-5 py-8 sm:px-9 sm:py-12">
      <div className="page-enter">
        <div className="eyebrow flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Creator opportunity board</div>
        <div className="mt-3 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div><h1 className="serif text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Find work that fits.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">Clear briefs from technology partners, with the terms and fit visible before you take a closer look.</p></div>
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#dce4d9] text-primary"><ShieldCheck size={17} /></div><div><p className="eyebrow text-primary">Your profile</p><p className="mt-0.5 text-xs font-semibold" data-testid="text-profile-approval-status">{profile?.approvalStatus === 'APPROVED' ? 'Approved' : profile?.approvalStatus === 'PENDING_APPROVAL' ? 'Pending review' : profile?.approvalStatus === 'REJECTED' ? 'Rejected' : profileQuery.isLoading ? 'Loading details' : 'Review status unavailable'}</p></div></div>
        </div>
      </div>
      {profile?.approvalStatus === 'PENDING_APPROVAL' && <div className="mt-6 flex gap-3 rounded-2xl border border-[#e2d2b8] bg-[#f4eddf] p-4" data-testid="notice-profile-pending"><BadgeCheck size={18} className="mt-0.5 shrink-0 text-[#805a36]" /><p className="text-sm leading-6 text-[#664b30]"><strong>Profile under review.</strong> Browse all opportunities now; personalized eligibility will appear after approval.</p></div>}
      <div className="mt-7 rounded-[22px] border border-border/80 bg-card p-4 shadow-[0_15px_38px_-35px_rgba(36,52,43,.35)] sm:p-5" data-testid="panel-campaign-filters">
        <div className="mb-3 flex items-center gap-2"><Filter size={15} className="text-primary" /><p className="eyebrow text-muted-foreground">Refine the board</p></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <label><span className="sr-only">Filter by niche</span><select data-testid="select-campaign-niche" className="field !py-2.5" value={niche} onChange={event => setNiche(event.target.value)}>{nicheOptions.map(item => <option key={item}>{item}</option>)}</select></label>
          <label><span className="sr-only">Filter by platform</span><select data-testid="select-campaign-platform" className="field !py-2.5" value={platform} onChange={event => setPlatform(event.target.value)}>{platformOptions.map(item => <option key={item}>{item}</option>)}</select></label>
          <label><span className="sr-only">Filter by country</span><select data-testid="select-campaign-country" className="field !py-2.5" value={country} onChange={event => setCountry(event.target.value)}><option>All countries</option>{COUNTRY_OPTIONS.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
          <label><span className="sr-only">Sort campaigns</span><select data-testid="select-campaign-sort" className="field !py-2.5" value={sort} onChange={event => setSort(event.target.value)}><option value="deadline">Closing soon</option><option value="newest">Newest</option></select></label>
          <button type="button" aria-pressed={eligibleOnly} disabled={profile?.approvalStatus !== 'APPROVED'} title={profile?.approvalStatus !== 'APPROVED' ? 'Available after creator profile approval' : undefined} onClick={() => setEligibleOnly(value => !value)} data-testid="button-eligible-only" className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2 lg:col-span-1 ${eligibleOnly ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}>{eligibleOnly ? <CheckCircle2 size={15} /> : <Filter size={15} />} Eligible only</button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground"><span data-testid="text-campaign-results">{visible.length} {visible.length === 1 ? 'opportunity' : 'opportunities'}</span>{(niche !== 'All niches' || platform !== 'All platforms' || country !== 'All countries' || eligibleOnly) && <button type="button" onClick={() => { setNiche('All niches'); setPlatform('All platforms'); setCountry('All countries'); setEligibleOnly(false); }} data-testid="button-clear-campaign-filters" className="font-semibold text-primary underline underline-offset-2">Clear filters</button>}</div>
      </div>

      {campaignsQuery.isLoading ? <LoadingBlock /> : campaignsQuery.isError ? <div className="mt-8 rounded-[22px] border border-[#e3c2bb] bg-card p-6" data-testid="status-campaign-list-error"><p className="text-sm font-semibold text-[#8f463d]">Opportunities couldn’t be loaded.</p><p className="mt-1 text-xs text-muted-foreground">{messageOf(campaignsQuery.error)}</p><button type="button" onClick={() => campaignsQuery.refetch()} data-testid="button-retry-creator-campaigns" className="mt-4 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Try again</button></div>
        : campaigns.length === 0 || published.length === 0 ? <div className="mt-8 rounded-[22px] border border-dashed border-border bg-card/70 px-6 py-14 text-center" data-testid="empty-creator-campaigns"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e9e9df] text-primary"><Search size={20} /></div><div className="eyebrow mt-5 text-primary">The board is quiet</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">No live campaigns right now.</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">New opportunities will show here when they open.</p></div>
        : !visible.length ? <div className="mt-8 rounded-[22px] border border-dashed border-border bg-card/70 px-6 py-12 text-center" data-testid="empty-filtered-campaigns"><div className="eyebrow text-primary">No matches this time</div><h2 className="serif mt-2 text-xl font-semibold">Try a wider selection.</h2><p className="mt-1 text-sm text-muted-foreground">Adjust the filters to see more opportunities.</p></div>
         : <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="list-creator-campaigns">{visible.map(campaign => <CampaignCard key={campaign.id} campaign={campaign} profile={profile} applied={appliedCampaignIds.has(campaign.id)} />)}</div>}
    </section>
    <footer className="border-t border-border/80 px-5 py-6 text-center text-xs text-muted-foreground">Tech Sponsor Network <span className="px-2">·</span> Creator opportunity board</footer>
  </main>;
}

export function CreatorCampaignDetail() {
  const params = useParams<{ campaignId: string }>();
  const id = params.campaignId ?? '';
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const profileQuery = useGetCreatorProfile({ query: { queryKey: getGetCreatorProfileQueryKey(), enabled: !!current.data && current.data.role === 'CREATOR', retry: false } });
  const campaignQuery = useGetCreatorCampaign(id, { query: { queryKey: getGetCreatorCampaignQueryKey(id), enabled: !!id && !!current.data && current.data.role === 'CREATOR', retry: false } });
  const applicationsQuery = useListCreatorApplications({ query: { queryKey: getListCreatorApplicationsQueryKey(), enabled: !!current.data && current.data.role === 'CREATOR', retry: false } });
  useEffect(() => { if (current.isError) setLocation('/login'); }, [current.isError, setLocation]);
  if (current.isError) return null;
  if (current.isLoading || !current.data) return <LoadingBlock />;
  if (current.data.role !== 'CREATOR') return <main className="min-h-[100dvh] bg-background"><CampaignHeader back /><section className="mx-auto max-w-3xl px-5 py-16 text-center"><h1 className="serif text-3xl font-semibold">Creator opportunities are for members.</h1><Link href="/dashboard" className="mt-6 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Return to dashboard</Link></section></main>;
  if (campaignQuery.isLoading || profileQuery.isLoading) return <main className="min-h-[100dvh] bg-background"><CampaignHeader back /><div className="mx-auto max-w-[1040px] animate-pulse px-5 py-10 sm:px-9"><div className="h-3 w-36 rounded bg-muted" /><div className="mt-5 h-12 max-w-lg rounded bg-muted" /><div className="mt-4 h-28 rounded-[22px] bg-muted" /><div className="mt-5 grid gap-5 lg:grid-cols-[1fr_.72fr]"><div className="h-96 rounded-[22px] bg-muted" /><div className="h-64 rounded-[22px] bg-muted" /></div></div></main>;
  if (campaignQuery.isError || !campaignQuery.data) return <main className="min-h-[100dvh] bg-background"><CampaignHeader back /><div className="mx-auto max-w-2xl px-5 py-14"><div className="rounded-[22px] border border-[#e3c2bb] bg-card p-6"><div className="eyebrow text-[#8f463d]">Could not open campaign</div><p className="mt-2 text-sm leading-6 text-muted-foreground">{messageOf(campaignQuery.error)}</p><button type="button" onClick={() => campaignQuery.refetch()} data-testid="button-retry-campaign-detail" className="mt-4 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Try again</button></div></div></main>;
  const campaign = campaignQuery.data;
  const profile = profileQuery.data;
  const applied = (applicationsQuery.data?.applications ?? []).some(application => application.campaignId === campaign.id);
  const eligible = profile?.approvalStatus === 'APPROVED' && eligibility(campaign, profile).eligible;
  return <main className="min-h-[100dvh] bg-background">
    <CampaignHeader back />
    <section className="mx-auto max-w-[1040px] px-5 py-8 sm:px-9 sm:py-12">
      <div className="page-enter">
        <div className="eyebrow flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Published campaign brief</div>
        <div className="mt-3 flex flex-col gap-5 border-b border-border/80 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-primary">{campaign.organizerName}</p><span data-testid={`status-creator-campaign-${campaign.id}`} className="rounded-full bg-[#e7efe6] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#315848]">{campaign.status === 'PUBLISHED' ? 'Published' : campaign.status === 'CLOSED' ? 'Closed' : 'Draft'}</span></div><h1 data-testid={`text-campaign-detail-title-${campaign.id}`} className="serif mt-2 max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-.06em] sm:text-5xl">{campaign.title}</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">{campaign.shortDescription}</p></div>
          <div className="rounded-2xl bg-[#e5ebe1] px-5 py-4 sm:min-w-[190px]"><p className="eyebrow text-[#426451]">Reward</p><p className="serif mt-1 text-3xl font-semibold tracking-[-.05em] text-[#315848]" data-testid={`text-campaign-detail-reward-${campaign.id}`}>{reward(campaign.rewardAmount, campaign.currency)}</p></div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DetailMetric icon={<CalendarDays size={16} />} label="Deadline" value={dateLabel(campaign.deadline)} />
          <DetailMetric icon={<UsersRound size={16} />} label="Audience minimum" value={`${new Intl.NumberFormat('en').format(campaign.minimumFollowers)} followers`} />
          <DetailMetric icon={<Globe2 size={16} />} label="Eligible locations" value={campaign.allowedCountries.includes('Any') ? 'Any country' : campaign.allowedCountries.map(countryName).join(', ')} />
          <DetailMetric icon={<SlidersHorizontal size={16} />} label="Accepted platforms" value={campaign.acceptedPlatforms.join(', ')} />
        </div>
        <div className="mt-6 grid items-start gap-5 lg:grid-cols-[1.3fr_.8fr]">
          <div className="space-y-5">
            <section className="rounded-[22px] border border-border/80 bg-card p-5 sm:p-7" data-testid={`panel-campaign-objectives-${campaign.id}`}><div className="eyebrow text-primary">The intention</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">What this partnership is for</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground/85">{campaign.objectives}</p></section>
            <section className="rounded-[22px] border border-border/80 bg-card p-5 sm:p-7" data-testid={`panel-campaign-requirements-${campaign.id}`}><div className="eyebrow text-primary">The brief</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">Content requirements</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground/85">{campaign.contentRequirements}</p></section>
            <PaymentRule campaign={campaign} />
          </div>
          <aside className="space-y-4 lg:sticky lg:top-6">
             <section className="rounded-[22px] border border-border/80 bg-card p-5 sm:p-6" data-testid={`panel-campaign-eligibility-${campaign.id}`}><div className="eyebrow text-primary">Profile fit</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">Your eligibility</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Based on the creator profile currently on file.</p><div className="mt-5"><EligibilityPanel campaign={campaign} profile={profile} /></div></section>
             {applicationsQuery.isLoading ? <div data-testid={`loading-campaign-application-${campaign.id}`} className="h-24 animate-pulse rounded-[22px] bg-muted" /> : applied ? <div data-testid={`status-applied-detail-${campaign.id}`} className="flex items-start gap-3 rounded-[22px] border border-[#bed1c1] bg-[#e7efe6] p-5 text-[#315848]"><CircleCheck size={20} className="mt-0.5 shrink-0" /><div><p className="text-sm font-semibold">Applied</p><p className="mt-1 text-xs leading-5">Application submitted. Your application for {campaign.title} is now under review. We will email you when there is an update.</p></div></div> : applicationsQuery.isError ? <div role="alert" data-testid={`status-campaign-application-check-error-${campaign.id}`} className="rounded-[22px] border border-[#e3c2bb] bg-card p-4 text-xs leading-5 text-[#8f463d]"><p>We couldn’t confirm your application status.</p><button type="button" onClick={() => applicationsQuery.refetch()} data-testid={`button-retry-application-status-${campaign.id}`} className="mt-2 font-semibold underline underline-offset-2">Check again</button></div> : eligible && <ApplicationForm campaignId={campaign.id} campaignTitle={campaign.title} />}
            <section className="rounded-[22px] border border-border/80 bg-card p-5 sm:p-6"><div className="eyebrow text-muted-foreground">Niches</div><div className="mt-3 flex flex-wrap gap-2">{campaign.niches.map(item => <span key={item} className="rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground">{item}</span>)}</div><div className="mt-5 border-t border-border pt-4"><p className="eyebrow text-muted-foreground">Audience requirement</p><p className="mt-1 text-sm font-semibold">{new Intl.NumberFormat('en').format(campaign.minimumFollowers)} followers minimum</p><p className="mt-1 text-xs leading-5 text-muted-foreground">On at least one linked {campaign.acceptedPlatforms.join(' or ')} profile.</p></div></section>
          </aside>
        </div>
        <div className="mt-6 flex justify-start"><Link href="/campaigns" data-testid="link-back-campaign-discovery" className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"><ArrowLeft size={14} /> Back to opportunities</Link></div>
      </div>
    </section>
    <footer className="border-t border-border/80 px-5 py-6 text-center text-xs text-muted-foreground">Tech Sponsor Network <span className="px-2">·</span> Campaign details</footer>
  </main>;
}

const applicationSchema = z.object({
  personalMessage: z.string().trim().min(20, 'Please write at least 20 characters.').max(1000, 'Please keep your message to 1,000 characters or fewer.'),
  paymentRuleAcknowledged: z.boolean().refine(value => value, 'Please acknowledge the payment rule to continue.'),
});
type ApplicationFormValues = z.infer<typeof applicationSchema>;

function ApplicationForm({ campaignId, campaignTitle }: { campaignId: string; campaignTitle: string }) {
  const queryClient = useQueryClient();
  const apply = useCreateCreatorCampaignApplication();
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const form = useForm<ApplicationFormValues>({
    resolver: zodResolver(applicationSchema),
    defaultValues: { personalMessage: '', paymentRuleAcknowledged: false },
    mode: 'onSubmit',
  });
  const onSubmit = form.handleSubmit(values => {
    setError('');
    const data: CampaignApplicationInput = values;
    apply.mutate({ campaignId, data }, {
      onSuccess: () => {
        setSuccess(`Application submitted. Your application for ${campaignTitle} is now under review. We will email you when there is an update.`);
        void queryClient.invalidateQueries({ queryKey: getListCreatorApplicationsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListCreatorCampaignsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetCreatorCampaignQueryKey(campaignId) });
      },
      onError: mutationError => setError(messageOf(mutationError)),
    });
  });
  if (success) return <div role="status" data-testid="status-application-submitted" className="rounded-[22px] border border-[#bed1c1] bg-[#e7efe6] p-5 text-sm leading-6 text-[#315848]">{success}</div>;
  return <section className="rounded-[22px] border border-border/80 bg-card p-5 sm:p-6" data-testid="panel-apply-campaign">
    <div className="eyebrow text-primary">Take the next step</div>
    <h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">Apply to this campaign</h2>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">Tell the brand why this partnership fits your work.</p>
    <Form {...form}>
      <form noValidate onSubmit={onSubmit} className="mt-5 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold">Personal message</span>
          <textarea data-testid="input-application-message" className="field min-h-32 resize-y" maxLength={1000} placeholder="Introduce your perspective and how you would approach the brief." aria-invalid={!!form.formState.errors.personalMessage} {...form.register('personalMessage')} />
          <span className="mt-1 block text-right text-[11px] text-muted-foreground">{form.watch('personalMessage').length}/1000</span>
          {form.formState.errors.personalMessage && <span role="alert" className="mt-1 block text-xs text-destructive">{form.formState.errors.personalMessage.message}</span>}
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-3.5 text-xs leading-5">
          <input data-testid="checkbox-payment-rule-acknowledged" type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" {...form.register('paymentRuleAcknowledged')} />
          <span>I have read the payment rule: payment is made only if my submission is accepted.</span>
        </label>
        {form.formState.errors.paymentRuleAcknowledged && <p role="alert" className="-mt-2 text-xs text-destructive">{form.formState.errors.paymentRuleAcknowledged.message}</p>}
        {error && <div role="alert" data-testid="status-application-error" className="rounded-xl border border-[#e3c2bb] bg-[#f7e9e6] p-3 text-xs leading-5 text-[#8f463d]">{error}</div>}
        <button type="submit" disabled={apply.isPending} data-testid="button-submit-application" className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"><Send size={15} />{apply.isPending ? 'Submitting…' : 'Submit application'}</button>
      </form>
    </Form>
  </section>;
}

function DetailMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="min-w-0 rounded-2xl border border-border/80 bg-card px-4 py-3.5"><div className="flex items-center gap-2 text-primary">{icon}<span className="eyebrow !text-[9px] text-muted-foreground">{label}</span></div><p className="mt-2 break-words text-sm font-semibold leading-5">{value}</p></div>;
}
