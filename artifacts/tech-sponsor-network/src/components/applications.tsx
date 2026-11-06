import { useEffect, useMemo } from 'react';
import { ArrowLeft, BriefcaseBusiness, CalendarDays, CircleCheck, Clock3, ShieldCheck } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getGetCurrentUserQueryKey,
  getListCreatorApplicationsQueryKey,
  getListAdminCampaignApplicationsQueryKey,
  useGetCurrentUser,
  useListCreatorApplications,
  useListAdminCampaignApplications,
} from '@workspace/api-client-react';
import type { AdminCampaignApplication, CampaignApplicationStatus } from '@workspace/api-client-react';

function errorMessage(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.';
}

function appliedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function statusLabel(status: CampaignApplicationStatus) {
  return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
}

function StatusBadge({ status }: { status: CampaignApplicationStatus }) {
  const underReview = status === 'UNDER_REVIEW';
  const positive = status === 'ACCEPTED' || status === 'WINNER' || status === 'PAID';
  return <span data-testid={`status-application-${status.toLowerCase()}`} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.08em] ${underReview ? 'bg-[#f4eddf] text-[#785f44]' : positive ? 'bg-[#e7efe6] text-[#315848]' : 'bg-[#f1e5dc] text-[#8b573d]'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusLabel(status)}</span>;
}

function ApplicationsHeader({ admin = false }: { admin?: boolean }) {
  return <header className="flex min-h-[76px] items-center justify-between border-b border-border/80 px-5 sm:px-9 lg:px-[7vw]">
    <Link href={admin ? '/admin/dashboard' : '/dashboard'} data-testid="link-applications-brand" className="brand-mark text-foreground"><span className="brand-symbol"><span /><span /><span /></span><span className="font-semibold tracking-[-.04em]">tech sponsor<span className="text-primary">.</span></span></Link>
    <Link href={admin ? '/admin/campaigns' : '/campaigns'} data-testid="link-applications-back" className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"><ArrowLeft size={14} /><span>{admin ? 'Campaigns' : 'Discover campaigns'}</span></Link>
  </header>;
}

function ApplicationsSkeleton({ admin = false }: { admin?: boolean }) {
  return <div className="mt-8 space-y-3" data-testid="loading-applications">
    {[0, 1, 2].map(row => <div key={row} className="h-28 animate-pulse rounded-[20px] border border-border bg-card/70" />)}
    <span className="sr-only">{admin ? 'Loading campaign applications' : 'Loading your applications'}</span>
  </div>;
}

export function CreatorApplicationsPage() {
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const applicationsQuery = useListCreatorApplications({ query: { queryKey: getListCreatorApplicationsQueryKey(), enabled: !!current.data && current.data.role === 'CREATOR', retry: false } });
  useEffect(() => {
    if (current.isError) setLocation('/login');
    else if (current.data && current.data.role !== 'CREATOR') setLocation('/dashboard');
  }, [current.isError, current.data, setLocation]);
  if (current.isLoading || (!current.data && !current.isError)) return <main className="min-h-[100dvh] bg-background"><ApplicationsHeader /><section className="mx-auto max-w-[1000px] px-5 py-10 sm:px-9"><ApplicationsSkeleton /></section></main>;
  if (current.isError || current.data?.role !== 'CREATOR') return null;
  const applications = applicationsQuery.data?.applications ?? [];
  return <main className="min-h-[100dvh] bg-background">
    <ApplicationsHeader />
    <section className="mx-auto max-w-[1000px] px-5 py-8 sm:px-9 sm:py-12">
      <div className="page-enter">
        <div className="eyebrow flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Creator workspace</div>
        <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div><h1 className="serif text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Your applications.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">A clear record of the campaigns you have put yourself forward for.</p></div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground"><BriefcaseBusiness size={14} className="text-primary" />{applicationsQuery.isLoading ? 'Loading applications' : `${applications.length} ${applications.length === 1 ? 'application' : 'applications'}`}</div>
        </div>
      </div>
      {applicationsQuery.isLoading ? <ApplicationsSkeleton /> : applicationsQuery.isError ? <div role="alert" data-testid="status-creator-applications-error" className="mt-8 rounded-[22px] border border-[#e3c2bb] bg-card p-6"><p className="text-sm font-semibold text-[#8f463d]">Your applications couldn’t be loaded.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{errorMessage(applicationsQuery.error)}</p><button type="button" onClick={() => applicationsQuery.refetch()} data-testid="button-retry-creator-applications" className="mt-4 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Try again</button></div>
        : applications.length === 0 ? <div data-testid="empty-creator-applications" className="mt-8 rounded-[24px] border border-dashed border-border bg-card/70 px-6 py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e9e9df] text-primary"><BriefcaseBusiness size={20} /></div><div className="eyebrow mt-5 text-primary">Nothing submitted yet</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">Your next opportunity starts here.</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">When you apply to a campaign, you’ll find its status and submission details here.</p><Link href="/campaigns" data-testid="link-discover-from-applications" className="mt-5 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Explore campaigns</Link></div>
          : <div className="mt-7 space-y-3" data-testid="list-creator-applications">{applications.map(application => <article key={application.id} data-testid={`card-creator-application-${application.id}`} className="rounded-[20px] border border-border/80 bg-card p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="eyebrow text-primary">Campaign application</div><h2 className="serif mt-2 text-xl font-semibold leading-tight tracking-[-.04em]" data-testid={`text-application-campaign-${application.id}`}>{application.campaignTitle}</h2><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><CalendarDays size={13} className="text-primary" />Applied {appliedDate(application.appliedAt)}</span><span className="inline-flex items-center gap-1.5"><Clock3 size={13} className="text-primary" />Payment rule acknowledged</span></div></div><StatusBadge status={application.status} /></div><p className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-sm leading-6 text-foreground/80">{application.personalMessage}</p></article>)}</div>}
    </section>
    <footer className="border-t border-border/80 px-5 py-6 text-center text-xs text-muted-foreground">Tech Sponsor Network <span className="px-2">·</span> Your applications</footer>
  </main>;
}

export function AdminApplicationsPage() {
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const applicationsQuery = useListAdminCampaignApplications({ query: { queryKey: getListAdminCampaignApplicationsQueryKey(), enabled: !!current.data && current.data.role === 'ADMIN', retry: false } });
  useEffect(() => {
    if (current.isError) setLocation('/login');
    else if (current.data && current.data.role !== 'ADMIN') setLocation('/dashboard');
  }, [current.isError, current.data, setLocation]);
  const groupedApplications = useMemo(() => {
    const groups = new Map<string, AdminCampaignApplication[]>();
    for (const application of applicationsQuery.data?.applications ?? []) {
      const existing = groups.get(application.campaignId) ?? [];
      existing.push(application);
      groups.set(application.campaignId, existing);
    }
    return [...groups.entries()].map(([campaignId, applications]) => ({ campaignId, title: applications[0]?.campaignTitle ?? 'Campaign', applications }));
  }, [applicationsQuery.data?.applications]);
  if (current.isLoading || (!current.data && !current.isError)) return <main className="min-h-[100dvh] bg-background"><ApplicationsHeader admin /><section className="mx-auto max-w-[1120px] px-5 py-10 sm:px-9"><ApplicationsSkeleton admin /></section></main>;
  if (current.isError || current.data?.role !== 'ADMIN') return null;
  const applications = applicationsQuery.data?.applications ?? [];
  return <main className="min-h-[100dvh] bg-background">
    <ApplicationsHeader admin />
    <section className="mx-auto max-w-[1120px] px-5 py-8 sm:px-9 sm:py-12">
      <div className="page-enter">
        <div className="eyebrow flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Administrator workspace</div>
        <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="serif text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Campaign applications.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">A read-only view of creator submissions, organized by campaign.</p></div><div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground"><ShieldCheck size={14} className="text-primary" />{applicationsQuery.isLoading ? 'Loading submissions' : `${applications.length} ${applications.length === 1 ? 'submission' : 'submissions'}`}</div></div>
      </div>
      {applicationsQuery.isLoading ? <ApplicationsSkeleton admin /> : applicationsQuery.isError ? <div role="alert" data-testid="status-admin-applications-error" className="mt-8 rounded-[22px] border border-[#e3c2bb] bg-card p-6"><p className="text-sm font-semibold text-[#8f463d]">Applications couldn’t be loaded.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{errorMessage(applicationsQuery.error)}</p><button type="button" onClick={() => applicationsQuery.refetch()} data-testid="button-retry-admin-applications" className="mt-4 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Try again</button></div>
        : !applications.length ? <div data-testid="empty-admin-applications" className="mt-8 rounded-[24px] border border-dashed border-border bg-card/70 px-6 py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e9e9df] text-primary"><CircleCheck size={20} /></div><div className="eyebrow mt-5 text-primary">No submissions yet</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">The campaign inbox is clear.</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Creator applications will appear here, grouped under their campaign.</p></div>
          : <div className="mt-8 space-y-7" data-testid="list-admin-applications">{groupedApplications.map(group => <section key={group.campaignId} data-testid={`group-admin-applications-${group.campaignId}`} className="overflow-hidden rounded-[22px] border border-border/80 bg-card"><header className="flex flex-col gap-2 border-b border-border bg-[#f0efe7] px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6"><div><div className="eyebrow text-primary">Campaign</div><h2 className="serif mt-1 text-xl font-semibold tracking-[-.04em]" data-testid={`text-admin-application-campaign-${group.campaignId}`}>{group.title}</h2></div><span className="text-xs font-medium text-muted-foreground">{group.applications.length} {group.applications.length === 1 ? 'creator' : 'creators'}</span></header><div className="divide-y divide-border">{group.applications.map(application => <article key={application.id} data-testid={`row-admin-application-${application.id}`} className="p-5 sm:px-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold" data-testid={`text-application-creator-${application.id}`}>{application.creatorName}</p><p className="mt-1 text-xs text-muted-foreground">Submitted {appliedDate(application.appliedAt)}</p></div><StatusBadge status={application.status} /></div><p className="mt-4 whitespace-pre-wrap rounded-xl border border-border/70 bg-background/70 p-4 text-sm leading-6 text-foreground/85">{application.personalMessage}</p><p className="mt-3 text-[11px] font-medium text-muted-foreground">Payment rule acknowledged</p></article>)}</div></section>)}</div>}
    </section>
    <footer className="border-t border-border/80 px-5 py-6 text-center text-xs text-muted-foreground">Tech Sponsor Network <span className="px-2">·</span> Application register</footer>
  </main>;
}
