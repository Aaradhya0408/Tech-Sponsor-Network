import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, ExternalLink, Image, ShieldCheck, UserRound, CircleCheck } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getGetCurrentUserQueryKey,
  getListAdminCampaignApplicationsQueryKey,
  getListAdminCampaignSubmissionsQueryKey,
  getListCreatorApplicationsQueryKey,
  getListAdminCampaignsQueryKey,
  useGetCurrentUser,
  useListAdminCampaignSubmissions,
  useListAdminCampaigns,
  useStartCreatorCampaignProject,
  useRequestCreatorSubmissionUploadUrl,
  useCreateCreatorCampaignSubmission,
  useUpdateAdminCampaignSubmissionDecision,
} from '@workspace/api-client-react';
import type { CreatorCampaignApplication, AdminCampaignSubmission, CampaignSubmissionStatus, ProjectSubmissionInput } from '@workspace/api-client-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ResponsiveNav } from '@/components/responsive-nav';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const submissionSchema = z.object({
  title: z.string().trim().min(1, 'Add a title for your project.').max(160),
  projectUrl: z.string().trim().url('Enter a valid URL.').max(2048).refine(value => {
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }, 'Use a secure https:// link.'),
  description: z.string().trim().min(1, 'Describe the work you completed.').max(500),
});

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message);
    if (message.length < 220 && !/(\bat\s.+:\d+:\d+|stack|exception|fetch failed|failed to fetch|network error|http \d{3})/i.test(message)) return message;
  }
  return 'Something went wrong. Please try again.';
}

function dateText(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function statusName(status: string) {
  const labels: Record<string, string> = {
    UNDER_REVIEW: 'Applied', ACCEPTED: 'Accepted', NOT_SELECTED: 'Rejected',
    IN_PROGRESS: 'In progress', SUBMITTED: 'Submitted', SUBMISSION_ACCEPTED: 'Submission accepted',
    SUBMISSION_REJECTED: 'Submission rejected', WINNER: 'Winner', PAID: 'Paid',
  };
  return labels[status] ?? status.replaceAll('_', ' ');
}

function statusTone(status: string) {
  if (status === 'UNDER_REVIEW' || status === 'IN_PROGRESS' || status === 'SUBMITTED') return 'bg-[#f4eddf] text-[#785f44]';
  if (status === 'ACCEPTED' || status === 'SUBMISSION_ACCEPTED' || status === 'WINNER' || status === 'PAID') return 'bg-[#e7efe6] text-[#315848]';
  if (status === 'NOT_SELECTED' || status === 'SUBMISSION_REJECTED') return 'bg-[#f7e9e6] text-[#8f463d]';
  return 'bg-muted text-muted-foreground';
}

function Pill({ status, testId }: { status: string; testId: string }) {
  return <span data-testid={testId} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.08em] ${statusTone(status)}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusName(status)}</span>;
}

function SubmissionForm({ application }: { application: CreatorCampaignApplication }) {
  const queryClient = useQueryClient();
  const requestUpload = useRequestCreatorSubmissionUploadUrl();
  const createSubmission = useCreateCreatorCampaignSubmission();
  const [cover, setCover] = useState<File | null>(null);
  const [error, setError] = useState('');
  const existing = application.submission;
  const form = useForm<z.infer<typeof submissionSchema>>({
    resolver: zodResolver(submissionSchema),
    defaultValues: { title: existing?.title ?? '', projectUrl: existing?.projectUrl ?? '', description: existing?.description ?? '' },
  });
  const description = form.watch('description') ?? '';
  const deadlineOpen = application.campaignDeadline >= new Date().toISOString().slice(0, 10);
  async function submit(values: z.infer<typeof submissionSchema>) {
    setError('');
    if (cover && (!['image/jpeg', 'image/png'].includes(cover.type) || cover.size > MAX_FILE_SIZE)) {
      setError('Choose a JPG or PNG image no larger than 5 MB.');
      return;
    }
    try {
      let coverObjectPath: string | undefined;
      if (cover) {
        const uploaded = await requestUpload.mutateAsync({
          applicationId: application.id,
          data: { name: cover.name, size: cover.size, contentType: cover.type as 'image/jpeg' | 'image/png' },
        });
        const response = await fetch(uploaded.uploadURL, { method: 'PUT', headers: { 'Content-Type': cover.type }, body: cover });
        if (!response.ok) throw new Error('The cover image upload failed. Please try again.');
        coverObjectPath = uploaded.objectPath;
      }
      const data: ProjectSubmissionInput = {
        title: values.title.trim(), projectUrl: values.projectUrl.trim(), description: values.description.trim(),
        ...(coverObjectPath ? { coverObjectPath } : {}),
      };
      await createSubmission.mutateAsync({ applicationId: application.id, data });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListCreatorApplicationsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAdminCampaignApplicationsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAdminCampaignSubmissionsQueryKey() }),
      ]);
    } catch (problem) { setError(errorText(problem)); }
  }
  const busy = requestUpload.isPending || createSubmission.isPending || form.formState.isSubmitting;
  return <Form {...form}><form onSubmit={form.handleSubmit(submit)} data-testid={`form-project-submission-${application.id}`} className="mt-4 space-y-4 rounded-2xl border border-border bg-background/70 p-4 sm:p-5">
    <div><p className="text-sm font-semibold">{existing ? 'Revise your project submission' : 'Submit your completed project'}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Share the published work and a short note for the campaign team.</p></div>
    <FormField control={form.control} name="title" render={({ field }) => <FormItem><FormLabel className="text-xs">Project title</FormLabel><FormControl><input {...field} maxLength={160} data-testid={`input-project-title-${application.id}`} className="field !py-2.5" placeholder="Name your project" /></FormControl><FormMessage /></FormItem>} />
    <FormField control={form.control} name="projectUrl" render={({ field }) => <FormItem><FormLabel className="text-xs">Project URL</FormLabel><FormControl><input {...field} type="url" maxLength={2048} data-testid={`input-project-url-${application.id}`} className="field !py-2.5" placeholder="https://…" /></FormControl><FormMessage /></FormItem>} />
    <div>
      <label className="mb-1.5 block text-xs font-semibold">Cover image · optional</label>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border bg-card px-3 py-2.5 hover:border-primary/50">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e9e9df] text-primary"><Image size={16} /></span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{cover?.name ?? (existing?.coverUrl ? 'Replace current cover image' : 'Choose JPG or PNG cover')}</span><span className="text-[10px] font-semibold">Browse</span>
        <input data-testid={`input-project-cover-${application.id}`} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={event => setCover(event.target.files?.[0] ?? null)} />
      </label><p className="mt-1 text-[10px] text-muted-foreground">JPG or PNG · maximum 5 MB</p>
    </div>
    <FormField control={form.control} name="description" render={({ field }) => <FormItem><div className="flex items-center justify-between"><FormLabel className="text-xs">Description</FormLabel><span data-testid={`text-project-description-count-${application.id}`} className="text-[10px] text-muted-foreground">{description.length}/500</span></div><FormControl><textarea {...field} rows={4} maxLength={500} data-testid={`textarea-project-description-${application.id}`} className="field resize-y !py-2.5" placeholder="What did you create, and how does it meet the brief?" /></FormControl><FormMessage /></FormItem>} />
    {error && <p role="alert" data-testid={`status-project-submission-error-${application.id}`} className="rounded-xl border border-[#e3c2bb] bg-[#f7e9e6] p-3 text-xs leading-5 text-[#8f463d]">{error}</p>}
    <p className="rounded-xl border border-[#d7d7c7] bg-[#f0efe7] px-3.5 py-3 text-xs font-semibold leading-5">Payment is made only if your submission is accepted.</p>
     {!deadlineOpen && <p role="status" data-testid={`text-project-deadline-closed-${application.id}`} className="rounded-xl border border-[#e3c2bb] bg-[#f7e9e6] p-3 text-xs leading-5 text-[#8f463d]">The campaign deadline has passed. Project submissions are closed.</p>}
     <button type="submit" disabled={busy || !deadlineOpen} data-testid={`button-submit-project-${application.id}`} className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-xs font-semibold text-primary-foreground disabled:opacity-60">{busy ? 'Uploading and submitting…' : existing ? 'Resubmit project' : 'Submit project'}<ArrowRight size={14} /></button>
  </form></Form>;
}

export function CreatorProjectLifecycle({ application }: { application: CreatorCampaignApplication }) {
  const queryClient = useQueryClient();
  const startProject = useStartCreatorCampaignProject();
  const [error, setError] = useState('');
  const submission = application.submission;
  const start = async () => {
    setError('');
    try {
      await startProject.mutateAsync({ applicationId: application.id });
      await queryClient.invalidateQueries({ queryKey: getListCreatorApplicationsQueryKey() });
    } catch (problem) { setError(errorText(problem)); }
  };
  const currentStatus = application.status;
  const editable = application.status === 'IN_PROGRESS' || (submission?.status === 'SUBMISSION_REJECTED' && submission.canResubmit);
  return <section data-testid={`panel-project-lifecycle-${application.id}`} className="mt-5 rounded-2xl border border-border/80 bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow text-primary">Project lifecycle</p><p className="mt-1 text-xs text-muted-foreground">Deadline · {dateText(application.campaignDeadline)}</p></div><Pill status={currentStatus} testId={`status-project-lifecycle-${application.id}`} /></div>
    {submission ? <div className="mt-4 rounded-xl border border-border bg-background/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p data-testid={`text-project-title-${application.id}`} className="text-sm font-semibold">{submission.title}</p><p className="mt-1 text-[11px] text-muted-foreground">Attempt {submission.attempt} · Submitted {dateText(submission.submittedAt)}</p></div><Pill status={submission.status} testId={`status-project-submission-${application.id}`} /></div>
      <a href={submission.projectUrl} target="_blank" rel="noreferrer" data-testid={`link-project-url-${application.id}`} className="mt-3 inline-flex items-center gap-1.5 break-all text-xs font-semibold text-primary underline underline-offset-2">{submission.projectUrl}<ExternalLink size={12} /></a>
      <p data-testid={`text-project-description-${application.id}`} className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/80">{submission.description}</p>
      {submission.coverUrl && <img data-testid={`img-project-cover-${application.id}`} src={submission.coverUrl} alt={`${submission.title} cover`} className="mt-4 max-h-64 w-full rounded-xl border border-border object-cover" />}
      {submission.status === 'SUBMISSION_REJECTED' && <div data-testid={`panel-submission-rejection-${application.id}`} className="mt-4 rounded-xl border border-[#e3c2bb] bg-[#f7e9e6] p-3.5"><p className="text-xs font-semibold text-[#8f463d]">Review note</p><p data-testid={`text-submission-rejection-reason-${application.id}`} className="mt-1 whitespace-pre-wrap text-sm leading-5 text-[#8f463d]">{submission.rejectionReason || 'No additional reason was provided.'}</p>{!submission.canResubmit && <p data-testid={`text-resubmission-unavailable-${application.id}`} className="mt-2 text-xs leading-5 text-[#8f463d]">A resubmission is no longer available because the deadline passed or the attempt limit was reached.</p>}</div>}
      {submission.status === 'SUBMISSION_ACCEPTED' && <p className="mt-3 rounded-xl border border-[#bed1c1] bg-[#e7efe6] p-3 text-xs font-semibold text-[#315848]">Your submission was accepted. Invoice actions are now available in My applications.</p>}
    </div> : application.status === 'ACCEPTED' ? <div className="mt-4">
      <p className="text-xs leading-5 text-muted-foreground">Your application is accepted. Start the project when you are ready to work from the campaign brief.</p>
      {error && <p role="alert" data-testid={`status-project-start-error-${application.id}`} className="mt-3 rounded-xl bg-[#f7e9e6] p-3 text-xs text-[#8f463d]">{error}</p>}
      <button type="button" disabled={startProject.isPending} onClick={start} data-testid={`button-start-project-${application.id}`} className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-60">{startProject.isPending ? 'Starting project…' : 'Start project'}<ArrowRight size={14} /></button>
    </div> : application.status === 'IN_PROGRESS' ? <p data-testid={`text-project-started-${application.id}`} className="mt-4 text-sm leading-6 text-muted-foreground">Project started {dateText(application.startedAt)}. Use the campaign brief and submit when the work is ready.</p> : <p className="mt-4 text-xs leading-5 text-muted-foreground">The project submission area will open if this application is accepted.</p>}
    {editable && <SubmissionForm key={`${application.id}-${submission?.attempt ?? 0}`} application={application} />}
    <p data-testid={`text-project-payment-rule-${application.id}`} className="mt-4 border-t border-border pt-3 text-xs font-semibold text-foreground">Payment is made only if your submission is accepted.</p>
  </section>;
}

function AdminSubmissionCard({ submission }: { submission: AdminCampaignSubmission }) {
  const queryClient = useQueryClient();
  const decision = useUpdateAdminCampaignSubmissionDecision();
  const [mode, setMode] = useState<'accept' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const canReview = submission.isCurrent && submission.status === 'SUBMITTED';
  async function decide(status: 'SUBMISSION_ACCEPTED' | 'SUBMISSION_REJECTED') {
    setError(''); setSaved('');
    if (status === 'SUBMISSION_REJECTED' && !reason.trim()) { setError('Add a short rejection reason.'); return; }
    try {
      await decision.mutateAsync({ submissionId: submission.id, data: { status, ...(status === 'SUBMISSION_REJECTED' ? { rejectionReason: reason.trim() } : {}) } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAdminCampaignSubmissionsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAdminCampaignApplicationsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListCreatorApplicationsQueryKey() }),
      ]);
      setMode(null); setReason(''); setSaved(status === 'SUBMISSION_ACCEPTED' ? 'Submission accepted.' : 'Submission rejected.');
    } catch (problem) { setError(errorText(problem)); }
  }
  return <article data-testid={`row-admin-submission-${submission.id}`} className="rounded-[22px] border border-border/80 bg-card p-4 sm:p-6">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="flex gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e9e9df] text-primary"><UserRound size={18} /></div><div><p data-testid={`text-admin-submission-creator-${submission.id}`} className="text-sm font-semibold">{submission.creatorName}</p><p className="mt-1 text-xs text-muted-foreground">{submission.creatorNiche} · {submission.creatorCountry || 'Country not listed'} · {submission.campaignTitle}</p></div></div><div className="flex flex-wrap items-center gap-2"><Pill status={submission.status} testId={`status-admin-submission-${submission.id}`} />{!submission.isCurrent && <span data-testid={`status-old-submission-${submission.id}`} className="rounded-full bg-muted px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-muted-foreground">Previous attempt · read only</span>}</div></div>
    <div data-testid={`list-submission-platforms-${submission.id}`} className="mt-4 flex flex-wrap gap-2">{submission.platforms.map((platform, index) => <a key={`${platform.platform}-${index}`} href={platform.url} target="_blank" rel="noreferrer" data-testid={`link-submission-platform-${submission.id}-${index}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-xs font-semibold">{platform.platform}<span className="font-normal text-muted-foreground">{new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(platform.followers)}</span><ExternalLink size={12} className="text-primary" /></a>)}</div>
    <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-[1fr_.8fr]">
      <div><p data-testid={`text-submission-title-${submission.id}`} className="text-base font-semibold">{submission.title}</p><p className="mt-1 text-[11px] text-muted-foreground">Attempt {submission.attempt} · Submitted {dateText(submission.submittedAt)}</p><a href={submission.projectUrl} target="_blank" rel="noreferrer" data-testid={`link-admin-submission-project-${submission.id}`} className="mt-3 inline-flex items-center gap-1.5 break-all text-xs font-semibold text-primary underline underline-offset-2">{submission.projectUrl}<ExternalLink size={12} /></a><p data-testid={`text-admin-submission-description-${submission.id}`} className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/80">{submission.description}</p>{submission.rejectionReason && <p data-testid={`text-admin-submission-rejection-${submission.id}`} className="mt-3 rounded-xl bg-[#f7e9e6] p-3 text-xs leading-5 text-[#8f463d]">Reason: {submission.rejectionReason}</p>}</div>
      {submission.coverUrl ? <a href={submission.coverUrl} target="_blank" rel="noreferrer" data-testid={`link-admin-submission-cover-${submission.id}`} className="block"><img src={submission.coverUrl} alt={`${submission.title} cover`} className="max-h-64 w-full rounded-xl border border-border object-cover" /><span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary">Protected cover image <ExternalLink size={11} /></span></a> : <div data-testid={`empty-admin-submission-cover-${submission.id}`} className="grid min-h-28 place-items-center rounded-xl border border-dashed border-border bg-background text-xs text-muted-foreground"><Image size={18} className="mb-1 text-primary" />No cover image</div>}
    </div>
    {submission.reviewedByName && <p className="mt-3 text-[11px] text-muted-foreground">Reviewed by {submission.reviewedByName} · {dateText(submission.reviewedAt)}</p>}
    {saved && <p role="status" data-testid={`status-admin-submission-success-${submission.id}`} className="mt-3 rounded-xl border border-[#bed1c1] bg-[#e7efe6] p-3 text-xs text-[#315848]">{saved}</p>}
    {error && <p role="alert" data-testid={`status-admin-submission-error-${submission.id}`} className="mt-3 rounded-xl border border-[#e3c2bb] bg-[#f7e9e6] p-3 text-xs text-[#8f463d]">{error}</p>}
    {canReview && <div className="mt-4 flex flex-col gap-2 sm:flex-row"><button type="button" disabled={decision.isPending} onClick={() => void decide('SUBMISSION_ACCEPTED')} data-testid={`button-accept-submission-${submission.id}`} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"><CircleCheck size={14} />Accept submission</button><button type="button" disabled={decision.isPending} onClick={() => { setError(''); setMode(mode === 'reject' ? null : 'reject'); }} data-testid={`button-reject-submission-${submission.id}`} className="inline-flex items-center justify-center rounded-full border border-[#c99783] px-4 py-2.5 text-xs font-semibold text-[#8b573d] disabled:opacity-50">Reject submission</button></div>}
    {mode === 'reject' && <div className="mt-3 space-y-3 rounded-xl border border-border bg-background p-4"><label className="block text-xs font-semibold">Short rejection reason<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3} data-testid={`textarea-submission-rejection-${submission.id}`} className="field mt-1.5 resize-y !py-2.5" placeholder="What should be corrected for a resubmission?" /></label><div className="flex gap-2"><button type="button" disabled={decision.isPending} onClick={() => void decide('SUBMISSION_REJECTED')} data-testid={`button-confirm-reject-submission-${submission.id}`} className="rounded-full bg-[#8f463d] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{decision.isPending ? 'Saving…' : 'Confirm rejection'}</button><button type="button" onClick={() => setMode(null)} data-testid={`button-cancel-reject-submission-${submission.id}`} className="rounded-full border border-border px-4 py-2.5 text-xs font-semibold">Cancel</button></div></div>}
  </article>;
}

export function AdminSubmissionsPage() {
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const [campaignId, setCampaignId] = useState('');
  const [status, setStatus] = useState('');
  const params = { ...(campaignId ? { campaignId } : {}), ...(status ? { status: status as CampaignSubmissionStatus } : {}) };
  const queryKey = getListAdminCampaignSubmissionsQueryKey(params);
  const submissionsQuery = useListAdminCampaignSubmissions(params, { query: { enabled: !!current.data && current.data.role === 'ADMIN', queryKey, retry: false } });
  const campaignsQuery = useListAdminCampaigns({ query: { enabled: !!current.data && current.data.role === 'ADMIN', queryKey: getListAdminCampaignsQueryKey(), retry: false } });
  useEffect(() => {
    if (current.isError) setLocation('/login');
    else if (current.data && current.data.role !== 'ADMIN') setLocation('/dashboard');
  }, [current.isError, current.data, setLocation]);
  if (current.isLoading || (!current.data && !current.isError)) return <main className="min-h-[100dvh] bg-background"><SubmissionsHeader /><section className="mx-auto max-w-[1120px] px-5 py-10"><div className="h-52 animate-pulse rounded-2xl bg-muted" /></section></main>;
  if (current.isError || current.data?.role !== 'ADMIN') return null;
  const submissions = submissionsQuery.data?.submissions ?? [];
  return <main className="min-h-[100dvh] bg-background"><SubmissionsHeader /><section className="mx-auto max-w-[1120px] px-5 py-8 sm:px-9 sm:py-12">
    <div className="page-enter"><div className="eyebrow flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Administrator workspace</div><div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="serif text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Project submissions.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Review the delivered work. Only the current submitted attempt can receive a decision.</p></div><span data-testid="text-admin-submission-count" className="rounded-full border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground">{submissions.length} {submissions.length === 1 ? 'submission' : 'submissions'}</span></div></div>
    <div data-testid="panel-submission-filters" className="mt-6 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2"><label className="text-xs font-semibold">Campaign<select value={campaignId} onChange={event => setCampaignId(event.target.value)} data-testid="select-submission-campaign" className="field mt-1.5 !py-2.5"><option value="">All campaigns</option>{(campaignsQuery.data?.campaigns ?? []).map(campaign => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}</select></label><label className="text-xs font-semibold">Status<select value={status} onChange={event => setStatus(event.target.value)} data-testid="select-submission-status" className="field mt-1.5 !py-2.5"><option value="">All statuses</option><option value="SUBMITTED">Submitted</option><option value="SUBMISSION_ACCEPTED">Submission accepted</option><option value="SUBMISSION_REJECTED">Submission rejected</option></select></label></div>
    {submissionsQuery.isLoading ? <div data-testid="loading-admin-submissions" className="mt-6 space-y-3">{[0, 1, 2].map(item => <div key={item} className="h-52 animate-pulse rounded-[22px] bg-muted" />)}</div>
      : submissionsQuery.isError ? <div role="alert" data-testid="status-admin-submissions-error" className="mt-6 rounded-2xl border border-[#e3c2bb] bg-card p-6"><p className="text-sm font-semibold text-[#8f463d]">Submissions couldn’t be loaded.</p><p className="mt-1 text-xs text-muted-foreground">{errorText(submissionsQuery.error)}</p><button type="button" onClick={() => submissionsQuery.refetch()} data-testid="button-retry-admin-submissions" className="mt-4 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Try again</button></div>
      : !submissions.length ? <div data-testid="empty-admin-submissions" className="mt-6 rounded-[24px] border border-dashed border-border bg-card/70 px-6 py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e9e9df] text-primary"><ShieldCheck size={20} /></div><div className="eyebrow mt-5 text-primary">Nothing to review</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">The submission queue is clear.</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Submitted creator projects will appear here.</p></div>
      : <div data-testid="list-admin-submissions" className="mt-6 space-y-3">{submissions.map(submission => <AdminSubmissionCard key={submission.id} submission={submission} />)}</div>}
  </section><footer className="border-t border-border/80 px-5 py-6 text-center text-xs text-muted-foreground">Tech Sponsor Network · Project submissions</footer></main>;
}

function SubmissionsHeader() {
  return <header className="flex min-h-[76px] items-center justify-between border-b border-border/80 px-5 sm:px-9 lg:px-[7vw]">
    <Link href="/admin/dashboard" data-testid="link-submissions-brand" className="brand-mark text-foreground"><span className="brand-symbol"><span /><span /><span /></span><span className="font-semibold tracking-[-.04em]">tech sponsor<span className="text-primary">.</span></span></Link>
    <ResponsiveNav label="Administrator navigation" items={[
      { href: '/admin/campaigns', label: 'Campaigns' }, { href: '/admin/applications', label: 'Applications' },
      { href: '/admin/invoices', label: 'Invoices' }, { href: '/admin/email-log', label: 'Email log' },
      { href: '/admin/dashboard', label: 'Dashboard' },
    ]} current={{ label: 'Submissions', testId: 'link-admin-submissions-current' }} />
  </header>;
}
