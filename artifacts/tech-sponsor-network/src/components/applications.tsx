import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, BriefcaseBusiness, CalendarDays, CircleCheck, Clock3, ExternalLink, ShieldCheck, BadgeCheck, History, UserRound } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getGetCurrentUserQueryKey,
  getListCreatorApplicationsQueryKey,
  getListAdminCampaignApplicationsQueryKey,
  useGetCurrentUser,
  useListCreatorApplications,
  useListAdminCampaignApplications,
  useUpdateAdminCampaignApplicationDecision,
} from '@workspace/api-client-react';
import type { AdminCampaignApplication, CampaignApplicationDecisionInput, CampaignApplicationStatus } from '@workspace/api-client-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { CreatorInvoiceSection } from '@/components/invoices';

const REJECTION_REASONS = [
  { value: 'FOLLOWERS_BELOW_REQUIREMENT', label: 'Followers below the requirement' },
  { value: 'NICHE_NOT_A_FIT', label: 'Niche is not a fit' },
  { value: 'PROFILE_INCOMPLETE', label: 'Profile is incomplete' },
  { value: 'APPLICATION_MESSAGE_TOO_WEAK', label: 'Application message is too weak' },
  { value: 'TOO_MANY_APPLICANTS', label: 'Too many applicants for this campaign' },
  { value: 'OTHER', label: 'Other' },
] as const;

const decisionSchema = z.object({
  status: z.enum(['ACCEPTED', 'NOT_SELECTED', 'WINNER']),
  rejectionReason: z.enum(['FOLLOWERS_BELOW_REQUIREMENT', 'NICHE_NOT_A_FIT', 'PROFILE_INCOMPLETE', 'APPLICATION_MESSAGE_TOO_WEAK', 'TOO_MANY_APPLICANTS', 'OTHER']).optional(),
  note: z.string().max(500, 'Keep the note under 500 characters.').optional(),
  changeReason: z.string().max(500, 'Keep the reason under 500 characters.').optional(),
}).superRefine((value, context) => {
  if (value.status === 'NOT_SELECTED' && !value.rejectionReason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['rejectionReason'], message: 'Choose a reason for not selecting this application.' });
  }
  if (value.status === 'NOT_SELECTED' && value.rejectionReason === 'OTHER' && !value.note?.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'Add a short note when the reason is Other.' });
  }
});

type DecisionValues = z.infer<typeof decisionSchema>;
type FormMode = 'accept' | 'reject' | 'change' | 'winner';

function errorMessage(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.';
}

function appliedDate(value: string, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', withTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function statusLabel(status: CampaignApplicationStatus) {
  return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
}

function reasonLabel(reason?: string | null) {
  return REJECTION_REASONS.find(item => item.value === reason)?.label ?? reason ?? '';
}

function StatusBadge({ status, testId }: { status: CampaignApplicationStatus; testId?: string }) {
  const underReview = status === 'UNDER_REVIEW';
  const positive = status === 'ACCEPTED' || status === 'WINNER' || status === 'PAID';
  return <span data-testid={testId ?? `status-application-${status.toLowerCase()}`} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.08em] ${underReview ? 'bg-[#f4eddf] text-[#785f44]' : positive ? 'bg-[#e7efe6] text-[#315848]' : 'bg-[#f1e5dc] text-[#8b573d]'}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusLabel(status)}</span>;
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
          <div data-testid="text-creator-application-count" className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground"><BriefcaseBusiness size={14} className="text-primary" />{applicationsQuery.isLoading ? 'Loading applications' : `${applications.length} ${applications.length === 1 ? 'application' : 'applications'}`}</div>
        </div>
      </div>
      {applicationsQuery.isLoading ? <ApplicationsSkeleton /> : applicationsQuery.isError ? <div role="alert" data-testid="status-creator-applications-error" className="mt-8 rounded-[22px] border border-[#e3c2bb] bg-card p-6"><p className="text-sm font-semibold text-[#8f463d]">Your applications couldn’t be loaded.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{errorMessage(applicationsQuery.error)}</p><button type="button" onClick={() => applicationsQuery.refetch()} data-testid="button-retry-creator-applications" className="mt-4 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Try again</button></div>
        : applications.length === 0 ? <div data-testid="empty-creator-applications" className="mt-8 rounded-[24px] border border-dashed border-border bg-card/70 px-6 py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e9e9df] text-primary"><BriefcaseBusiness size={20} /></div><div className="eyebrow mt-5 text-primary">Nothing submitted yet</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">Your next opportunity starts here.</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">When you apply to a campaign, you’ll find its status and submission details here.</p><Link href="/campaigns" data-testid="link-discover-from-applications" className="mt-5 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Explore campaigns</Link></div>
          : <div className="mt-7 space-y-3" data-testid="list-creator-applications">{applications.map(application => <article key={application.id} data-testid={`card-creator-application-${application.id}`} className="rounded-[20px] border border-border/80 bg-card p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="eyebrow text-primary">Campaign application</div><h2 className="serif mt-2 text-xl font-semibold leading-tight tracking-[-.04em]" data-testid={`text-application-campaign-${application.id}`}>{application.campaignTitle}</h2><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span data-testid={`text-application-applied-date-${application.id}`} className="inline-flex items-center gap-1.5"><CalendarDays size={13} className="text-primary" />Applied {appliedDate(application.appliedAt)}</span><span className="inline-flex items-center gap-1.5"><Clock3 size={13} className="text-primary" />Payment rule acknowledged</span></div></div><StatusBadge status={application.status} testId={`status-creator-application-${application.id}`} /></div><p data-testid={`text-application-message-${application.id}`} className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-sm leading-6 text-foreground/80">{application.personalMessage}</p>{application.status === 'NOT_SELECTED' && <div data-testid={`panel-application-decision-${application.id}`} className="mt-4 rounded-xl border border-[#e5cfc4] bg-[#f7eee8] p-4"><p className="eyebrow text-[#8b573d]">Decision details</p><p data-testid={`text-application-rejection-reason-${application.id}`} className="mt-2 text-sm font-semibold text-[#704832]">{reasonLabel(application.rejectionReason) || 'Reason not provided'}</p>{application.decisionNote && <p data-testid={`text-application-decision-note-${application.id}`} className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#704832]">{application.decisionNote}</p>}</div>}</article>)}</div>}
      <CreatorInvoiceSection applications={applications} email={current.data.email} accountName={current.data.name} />
      </section>
    <footer className="border-t border-border/80 px-5 py-6 text-center text-xs text-muted-foreground">Tech Sponsor Network <span className="px-2">·</span> Your applications</footer>
  </main>;
}

function DecisionForm({ application, mode, pending, onCancel, onSubmit }: {
  application: AdminCampaignApplication;
  mode: FormMode;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (data: CampaignApplicationDecisionInput) => void;
}) {
  const defaultStatus = mode === 'accept'
    ? 'ACCEPTED'
    : mode === 'reject'
      ? 'NOT_SELECTED'
      : mode === 'winner'
        ? 'WINNER'
        : application.status === 'NOT_SELECTED' ? 'ACCEPTED' : 'NOT_SELECTED';
  const form = useForm<DecisionValues>({
    resolver: zodResolver(mode === 'change' || mode === 'winner'
      ? decisionSchema.superRefine((value, context) => {
        if (!value.changeReason?.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ['changeReason'], message: 'Explain why this decision is changing.' });
      })
      : decisionSchema),
    defaultValues: { status: defaultStatus, rejectionReason: undefined, note: '', changeReason: '' },
  });
  const status = form.watch('status');
  const chosenReason = form.watch('rejectionReason');
  const submit = (values: DecisionValues) => {
    onSubmit({
      status: values.status,
      ...(values.status === 'NOT_SELECTED' ? { rejectionReason: values.rejectionReason, note: values.note?.trim() || undefined } : { note: values.note?.trim() || undefined }),
      ...(mode === 'change' || mode === 'winner' ? { changeReason: values.changeReason?.trim() } : {}),
    });
  };
  return <Form {...form}>
    <form onSubmit={form.handleSubmit(submit)} data-testid={`form-decision-${application.id}`} className="mt-4 space-y-3 rounded-xl border border-border bg-background/80 p-4">
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-foreground">{mode === 'change' ? 'Change this decision' : mode === 'winner' ? 'Mark application as Winner' : mode === 'accept' ? 'Accept application' : 'Record a decision'}</p><button type="button" onClick={onCancel} data-testid={`button-cancel-decision-${application.id}`} className="text-xs font-semibold text-muted-foreground underline underline-offset-2">Cancel</button></div>
      {mode === 'change' && <FormField control={form.control} name="status" render={({ field }) => <FormItem><FormLabel className="text-xs">New decision</FormLabel><FormControl><select {...field} data-testid={`select-change-status-${application.id}`} className="field !py-2.5">{application.status !== 'ACCEPTED' && <option value="ACCEPTED">Accepted</option>}{application.status !== 'NOT_SELECTED' && <option value="NOT_SELECTED">Not selected</option>}</select></FormControl><FormMessage /></FormItem>} />}
      {status === 'NOT_SELECTED' && <FormField control={form.control} name="rejectionReason" render={({ field }) => <FormItem><FormLabel className="text-xs">Reason for not selecting</FormLabel><FormControl><select {...field} value={field.value ?? ''} onChange={event => field.onChange(event.target.value || undefined)} data-testid={`select-rejection-reason-${application.id}`} className="field !py-2.5"><option value="">Choose a reason</option>{REJECTION_REASONS.map(reason => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></FormControl><FormMessage /></FormItem>} />}
      <FormField control={form.control} name="note" render={({ field }) => <FormItem><FormLabel className="text-xs">Note {status === 'NOT_SELECTED' && chosenReason === 'OTHER' ? '(required)' : '(optional)'}</FormLabel><FormControl><textarea {...field} data-testid={`textarea-decision-note-${application.id}`} maxLength={500} rows={3} placeholder={status === 'NOT_SELECTED' ? 'A brief, helpful explanation for the creator' : 'Optional context for the creator'} className="field resize-y !py-2.5" /></FormControl><FormMessage /></FormItem>} />
      {(mode === 'change' || mode === 'winner') && <FormField control={form.control} name="changeReason" rules={{ required: 'Explain why this decision is changing.' }} render={({ field }) => <FormItem><FormLabel className="text-xs">Reason for changing decision</FormLabel><FormControl><textarea {...field} data-testid={`textarea-change-reason-${application.id}`} required maxLength={500} rows={2} placeholder="Record why the earlier decision is being changed" className="field resize-y !py-2.5" /></FormControl><FormMessage /></FormItem>} />}
      <button type="submit" disabled={pending} data-testid={`button-submit-decision-${application.id}`} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60">{pending ? 'Saving decision…' : mode === 'change' ? 'Save changed decision' : mode === 'winner' ? 'Confirm Winner status' : status === 'NOT_SELECTED' ? 'Confirm not selected' : 'Confirm acceptance'}</button>
    </form>
  </Form>;
}

function ApplicationReviewCard({ application }: { application: AdminCampaignApplication }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<FormMode | null>(null);
  const [mutationError, setMutationError] = useState('');
  const decision = useUpdateAdminCampaignApplicationDecision({
    mutation: {
      onSuccess: async () => {
        setMode(null);
        setMutationError('');
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getListAdminCampaignApplicationsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getListCreatorApplicationsQueryKey() }),
        ]);
      },
      onError: error => setMutationError(errorMessage(error)),
    },
  });
  const decide = (data: CampaignApplicationDecisionInput) => {
    setMutationError('');
    decision.mutate({ applicationId: application.id, data });
  };
  const alreadyDecided = application.status !== 'UNDER_REVIEW';
  return <article key={application.id} data-testid={`row-admin-application-${application.id}`} className="p-5 sm:px-6 sm:py-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#e9e9df] text-primary"><UserRound size={19} /></div><div className="min-w-0"><p className="text-sm font-semibold" data-testid={`text-application-creator-${application.id}`}>{application.creatorName}</p><p data-testid={`text-application-profile-${application.id}`} className="mt-1 text-xs text-muted-foreground">{application.creatorNiche} <span className="px-1.5">·</span>{application.creatorCountry || 'Country not listed'}</p><p data-testid={`text-application-applied-date-${application.id}`} className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays size={13} className="text-primary" />Applied {appliedDate(application.appliedAt)}</p></div></div>
      <StatusBadge status={application.status} testId={`status-admin-application-${application.id}`} />
    </div>
    <div data-testid={`list-application-platforms-${application.id}`} className="mt-4 flex flex-wrap gap-2">{application.platforms.map((platform, index) => <div key={`${platform.platform}-${index}`} data-testid={`item-application-platform-${application.id}-${index}`} className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs"><span className="font-semibold">{platform.platform}</span><span className="text-muted-foreground">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(platform.followers)} followers</span>{platform.verified && <span data-testid={`status-platform-verified-${application.id}-${index}`} className="inline-flex items-center gap-1 text-[#315848]" title="Verified profile"><BadgeCheck size={14} /><span className="sr-only">Verified</span></span>}<a href={platform.url} target="_blank" rel="noreferrer" data-testid={`link-application-platform-${application.id}-${index}`} aria-label={`Open ${platform.platform} profile for ${application.creatorName}`} className="text-primary hover:underline"><ExternalLink size={13} /></a></div>)}</div>
    <div data-testid={`text-application-message-${application.id}`} className="mt-4 whitespace-pre-wrap rounded-xl border border-border/70 bg-background/70 p-4 text-sm leading-6 text-foreground/85">{application.personalMessage}</div>
    <p data-testid={`status-payment-rule-acknowledged-${application.id}`} className="mt-3 text-[11px] font-medium text-muted-foreground">{application.paymentRuleAcknowledged ? 'Payment rule acknowledged' : 'Payment rule not acknowledged'}</p>
    {alreadyDecided && <div data-testid={`panel-current-decision-${application.id}`} className="mt-4 rounded-xl border border-[#d8dfd4] bg-[#f1f3ed] p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-[#315848]"><ShieldCheck size={15} /> Decision record</div>
      {application.status === 'NOT_SELECTED' && <p data-testid={`text-admin-rejection-reason-${application.id}`} className="mt-2 text-sm font-semibold text-[#704832]">{reasonLabel(application.rejectionReason)}</p>}
      {application.decisionNote && <p data-testid={`text-admin-decision-note-${application.id}`} className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground/80">{application.decisionNote}</p>}
      {application.decidedByName && application.decidedAt && <p data-testid={`text-admin-decision-author-${application.id}`} className="mt-2 text-xs text-muted-foreground">Recorded by {application.decidedByName} · {appliedDate(application.decidedAt, true)}</p>}
    </div>}
    {!!application.decisionHistory.length && <details data-testid={`details-decision-history-${application.id}`} className="mt-4 rounded-xl border border-border bg-background/55">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs font-semibold text-foreground"><History size={14} className="text-primary" />Decision history <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{application.decisionHistory.length}</span></summary>
      <ol data-testid={`list-decision-history-${application.id}`} className="space-y-0 border-t border-border px-4">
        {application.decisionHistory.map(entry => <li key={entry.id} data-testid={`item-decision-history-${entry.id}`} className="relative border-l border-border py-4 pl-4 last:pb-4">
          <span className="absolute -left-[5px] top-[19px] h-2 w-2 rounded-full bg-primary ring-4 ring-background" />
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs font-semibold">{statusLabel(entry.previousStatus)} <span className="px-1 text-muted-foreground">→</span> {statusLabel(entry.status)}</p><p data-testid={`text-decision-history-date-${entry.id}`} className="text-[11px] text-muted-foreground">{entry.decidedByName} · {appliedDate(entry.decidedAt, true)}</p></div>
          {entry.rejectionReason && <p data-testid={`text-decision-history-reason-${entry.id}`} className="mt-2 text-xs font-medium text-[#704832]">{reasonLabel(entry.rejectionReason)}</p>}
          {entry.note && <p data-testid={`text-decision-history-note-${entry.id}`} className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">Note: {entry.note}</p>}
          {entry.changeReason && <p data-testid={`text-decision-history-change-reason-${entry.id}`} className="mt-1 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">Change reason: {entry.changeReason}</p>}
        </li>)}
      </ol>
    </details>}
    {mutationError && <p role="alert" data-testid={`status-decision-error-${application.id}`} className="mt-3 rounded-lg border border-[#e3c2bb] bg-[#f7e9e6] px-3 py-2.5 text-xs leading-5 text-[#8f463d]">{mutationError}</p>}
    {application.status === 'UNDER_REVIEW' ? <div className="mt-4 flex flex-col gap-2 sm:flex-row">
      <button type="button" disabled={decision.isPending} onClick={() => setMode('accept')} data-testid={`button-accept-application-${application.id}`} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-50"><CircleCheck size={14} />Accept</button>
      <button type="button" disabled={decision.isPending} onClick={() => setMode('reject')} data-testid={`button-reject-application-${application.id}`} className="inline-flex items-center justify-center gap-2 rounded-full border border-[#c99783] px-4 py-2.5 text-xs font-semibold text-[#8b573d] transition hover:bg-[#f7eee8] disabled:opacity-50">Reject</button>
    </div> : <div className="mt-4 flex flex-wrap gap-2">
      {application.status === 'ACCEPTED' && <button type="button" disabled={decision.isPending} onClick={() => setMode('winner')} data-testid={`button-mark-winner-${application.id}`} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#e7efe6] px-4 py-2.5 text-xs font-semibold text-[#315848] transition hover:bg-[#dce8dc] disabled:opacity-50"><CircleCheck size={14} />Mark winner</button>}
      <button type="button" disabled={decision.isPending} onClick={() => setMode('change')} data-testid={`button-change-decision-${application.id}`} className="inline-flex items-center justify-center gap-2 rounded-full border border-border px-4 py-2.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50">Change decision</button>
    </div>}
    {mode && <DecisionForm application={application} mode={mode} pending={decision.isPending} onCancel={() => setMode(null)} onSubmit={decide} />}
  </article>;
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
        <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="serif text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Campaign applications.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">A considered, traceable review of every creator submission, organized by campaign.</p></div><div data-testid="text-admin-application-count" className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground"><ShieldCheck size={14} className="text-primary" />{applicationsQuery.isLoading ? 'Loading submissions' : `${applications.length} ${applications.length === 1 ? 'submission' : 'submissions'}`}</div></div>
      </div>
      {applicationsQuery.isLoading ? <ApplicationsSkeleton admin /> : applicationsQuery.isError ? <div role="alert" data-testid="status-admin-applications-error" className="mt-8 rounded-[22px] border border-[#e3c2bb] bg-card p-6"><p className="text-sm font-semibold text-[#8f463d]">Applications couldn’t be loaded.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{errorMessage(applicationsQuery.error)}</p><button type="button" onClick={() => applicationsQuery.refetch()} data-testid="button-retry-admin-applications" className="mt-4 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Try again</button></div>
        : !applications.length ? <div data-testid="empty-admin-applications" className="mt-8 rounded-[24px] border border-dashed border-border bg-card/70 px-6 py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e9e9df] text-primary"><CircleCheck size={20} /></div><div className="eyebrow mt-5 text-primary">No submissions yet</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">The campaign inbox is clear.</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Creator applications will appear here, grouped under their campaign.</p></div>
          : <div className="mt-8 space-y-7" data-testid="list-admin-applications">{groupedApplications.map(group => <section key={group.campaignId} data-testid={`group-admin-applications-${group.campaignId}`} className="overflow-hidden rounded-[22px] border border-border/80 bg-card"><header className="flex flex-col gap-2 border-b border-border bg-[#f0efe7] px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6"><div><div className="eyebrow text-primary">Campaign</div><h2 className="serif mt-1 text-xl font-semibold tracking-[-.04em]" data-testid={`text-admin-application-campaign-${group.campaignId}`}>{group.title}</h2></div><span data-testid={`text-admin-campaign-count-${group.campaignId}`} className="text-xs font-medium text-muted-foreground">{group.applications.length} {group.applications.length === 1 ? 'creator' : 'creators'}</span></header><div className="divide-y divide-border">{group.applications.map(application => <ApplicationReviewCard key={application.id} application={application} />)}</div></section>)}</div>}
    </section>
    <footer className="border-t border-border/80 px-5 py-6 text-center text-xs text-muted-foreground">Tech Sponsor Network <span className="px-2">·</span> Application register</footer>
  </main>;
}
