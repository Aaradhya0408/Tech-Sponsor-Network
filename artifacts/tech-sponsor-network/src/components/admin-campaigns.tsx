import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Check, CircleDollarSign, Plus, Radio, Save, ShieldCheck, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  getGetCurrentUserQueryKey,
  getListAdminCampaignsQueryKey,
  useCreateAdminCampaign,
  useGetCurrentUser,
  useListAdminCampaigns,
  useUpdateAdminCampaign,
  useUpdateAdminCampaignStatus,
} from '@workspace/api-client-react';
import type { AdminCampaign, CampaignInput, CampaignStatus, CreatorNiche, CreatorPlatform } from '@workspace/api-client-react';
import { COUNTRY_OPTIONS } from '@/lib/countries';
import { Form } from '@/components/ui/form';

const PAYMENT_RULE = 'Payment is made only if your submission is accepted. If your work is not accepted, no payment will be made.';
const PLATFORMS: CreatorPlatform[] = ['Instagram', 'YouTube', 'LinkedIn', 'X', 'TikTok', 'GitHub'];
const NICHES: CreatorNiche[] = ['Technology', 'AI', 'Developer tools', 'Gaming', 'Education', 'Business', 'Other'];
const EMPTY_FORM = (): CampaignInput => ({
  title: '', organizerName: '', shortDescription: '', objectives: '', contentRequirements: '',
  rewardAmount: 0, currency: 'USD', deadline: '', acceptedPlatforms: [], allowedCountries: [],
  minimumFollowers: 0, niches: [],
});
const campaignInputSchema = z.object({
  title: z.string().trim().min(1, 'Campaign title is required.').max(160, 'Use 160 characters or fewer.'),
  organizerName: z.string().trim().min(1, 'Organizer name is required.').max(120, 'Use 120 characters or fewer.'),
  shortDescription: z.string().trim().min(1, 'A short description is required.').max(500, 'Use 500 characters or fewer.'),
  objectives: z.string().trim().min(1, 'Objectives are required.').max(3000, 'Use 3,000 characters or fewer.'),
  contentRequirements: z.string().trim().min(1, 'Content requirements are required.').max(5000, 'Use 5,000 characters or fewer.'),
  rewardAmount: z.number().finite().min(0.01, 'Reward must be greater than zero.').max(9999999999.99, 'Reward exceeds the maximum of 9,999,999,999.99.')
    .refine(value => Number(value.toFixed(2)) === value, 'Use no more than two decimal places.'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, such as USD.'),
  deadline: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'Choose a valid deadline.')
    .refine(value => utcDateString(new Date(`${value}T00:00:00.000Z`)) === value, 'Choose a valid deadline.')
    .refine(value => value > new Date().toISOString().slice(0, 10), 'Deadline must be a future date.'),
  acceptedPlatforms: z.array(z.enum(['Instagram', 'YouTube', 'LinkedIn', 'X', 'TikTok', 'GitHub'])).min(1, 'Choose at least one platform.').max(6),
  allowedCountries: z.array(z.string()).min(1, 'Choose at least one eligible country, or Any.').max(250)
    .superRefine((countries, context) => {
      if (countries.includes('Any') && countries.length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Any cannot be combined with individual countries.' });
      if (countries.some(country => country !== 'Any' && !/^[A-Z]{2}$/.test(country))) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Choose valid two-letter country codes.' });
    }),
  minimumFollowers: z.number().int('Enter a whole number.').min(0, 'Minimum followers cannot be negative.').max(2147483647, 'Follower count exceeds the supported maximum.'),
  niches: z.array(z.enum(['Technology', 'AI', 'Developer tools', 'Gaming', 'Education', 'Business', 'Other'])).min(1, 'Choose at least one niche.').max(7),
});
type CampaignFormValues = z.infer<typeof campaignInputSchema>;

function inputClass(extra = '') {
  return `field ${extra}`;
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Something went wrong. Please try again.';
}

function formatReward(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function dateLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function utcDateString(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function CampaignSkeleton() {
  return <div className="mt-8 animate-pulse space-y-3" data-testid="loading-campaigns">
    {[0, 1, 2].map(row => <div key={row} className="h-[88px] rounded-2xl border border-border bg-card/70" />)}
  </div>;
}

function ToggleGroup<T extends string>({ label, values, selected, onChange, testId }: {
  label: string; values: readonly T[]; selected: T[]; onChange: (next: T[]) => void; testId: string;
}) {
  return <fieldset>
    <legend className="mb-2 text-xs font-semibold text-foreground">{label} <span className="font-normal text-muted-foreground">({selected.length} selected)</span></legend>
    <div className="flex flex-wrap gap-2">
      {values.map(value => {
        const active = selected.includes(value);
        return <button type="button" key={value} data-testid={`${testId}-${String(value).toLowerCase().replaceAll(' ', '-')}`} aria-pressed={active}
          onClick={() => onChange(active ? selected.filter(item => item !== value) : [...selected, value])}
          className={`rounded-full border px-3 py-2 text-xs font-semibold transition ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}>
          {active && <Check size={12} className="mr-1 inline" />}{value}
        </button>;
      })}
    </div>
  </fieldset>;
}

function FieldError({ message }: { message?: string }) {
  return message ? <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">{message}</p> : null;
}

function CampaignForm({ campaign, busy, onCancel, onSave, error, success }: {
  campaign: AdminCampaign | null; busy: boolean; onCancel: () => void; onSave: (input: CampaignInput) => void; error: string; success: string;
}) {
  const [countryQuery, setCountryQuery] = useState('');
  const initialValues: CampaignFormValues = campaign ? {
      title: campaign.title, organizerName: campaign.organizerName, shortDescription: campaign.shortDescription,
      objectives: campaign.objectives, contentRequirements: campaign.contentRequirements,
      rewardAmount: campaign.rewardAmount, currency: campaign.currency || 'USD', deadline: campaign.deadline,
      acceptedPlatforms: [...campaign.acceptedPlatforms], allowedCountries: [...campaign.allowedCountries],
      minimumFollowers: campaign.minimumFollowers, niches: [...campaign.niches],
    } : { ...EMPTY_FORM(), currency: 'USD' };
  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignInputSchema),
    defaultValues: initialValues,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const values = form.watch();
  const fieldErrors = form.formState.errors;
  const set = <K extends keyof CampaignFormValues>(key: K, value: CampaignFormValues[K]) => {
    form.setValue(key, value as never, { shouldValidate: true, shouldDirty: true });
  };
  const toggleCountry = (code: string) => {
    if (code === 'Any') {
      set('allowedCountries', values.allowedCountries.includes('Any') ? [] : ['Any']);
    } else {
      set('allowedCountries', values.allowedCountries.filter(country => country !== 'Any').includes(code)
        ? values.allowedCountries.filter(country => country !== code)
        : [...values.allowedCountries.filter(country => country !== 'Any'), code]);
    }
  };
  const filteredCountries = COUNTRY_OPTIONS.filter(country => country.name.toLowerCase().includes(countryQuery.toLowerCase()) || country.code.toLowerCase().includes(countryQuery.toLowerCase())).slice(0, 45);
  const utcTomorrow = new Date();
  utcTomorrow.setUTCDate(utcTomorrow.getUTCDate() + 1);
  const minDeadline = utcDateString(utcTomorrow);
  const onSubmit = form.handleSubmit(data => {
    const input: CampaignInput = {
      title: data.title,
      organizerName: data.organizerName,
      shortDescription: data.shortDescription,
      objectives: data.objectives,
      contentRequirements: data.contentRequirements,
      rewardAmount: data.rewardAmount,
      currency: data.currency || 'USD',
      deadline: data.deadline,
      acceptedPlatforms: data.acceptedPlatforms,
      allowedCountries: data.allowedCountries,
      minimumFollowers: data.minimumFollowers,
      niches: data.niches,
    };
    onSave(input);
  });

  return <section id="campaign-editor" className="mt-8 scroll-mt-6 rounded-[22px] border border-border/80 bg-card p-5 shadow-[0_16px_40px_-32px_rgba(36,52,43,.35)] sm:p-7" data-testid="panel-campaign-editor">
    <div className="mb-6 flex items-start justify-between gap-4">
      <div><div className="eyebrow text-primary">{campaign ? 'Update details' : 'New opportunity'}</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.05em]">{campaign ? 'Edit campaign.' : 'Set the brief.'}</h2><p className="mt-1 text-sm text-muted-foreground">Be specific. Clear terms make better partnerships.</p></div>
      <button type="button" onClick={onCancel} data-testid="button-cancel-campaign" aria-label="Close campaign editor" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground hover:bg-muted"><X size={16} /></button>
    </div>
    <Form {...form}>
    <form noValidate onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-1.5 block text-xs font-semibold">Campaign title</span><input className={inputClass()} data-testid="input-campaign-title" maxLength={160} placeholder="e.g. Build with Atlas" aria-invalid={!!fieldErrors.title} {...form.register('title')} /><FieldError message={fieldErrors.title?.message} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold">Organizer name</span><input className={inputClass()} data-testid="input-organizer-name" maxLength={120} placeholder="Company or team" aria-invalid={!!fieldErrors.organizerName} {...form.register('organizerName')} /><FieldError message={fieldErrors.organizerName?.message} /></label>
      </div>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold">Short description <span className="font-normal text-muted-foreground">· max 500</span></span><textarea className={`${inputClass()} min-h-24 resize-y`} data-testid="input-short-description" maxLength={500} placeholder="A concise overview creators can scan." aria-invalid={!!fieldErrors.shortDescription} {...form.register('shortDescription')} /><span className="mt-1 block text-right text-[11px] text-muted-foreground">{values.shortDescription.length}/500</span><FieldError message={fieldErrors.shortDescription?.message} /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold">Objectives <span className="font-normal text-muted-foreground">· max 3,000</span></span><textarea className={`${inputClass()} min-h-28 resize-y`} data-testid="input-objectives" maxLength={3000} placeholder="What should a successful partnership achieve?" aria-invalid={!!fieldErrors.objectives} {...form.register('objectives')} /><span className="mt-1 block text-right text-[11px] text-muted-foreground">{values.objectives.length}/3000</span><FieldError message={fieldErrors.objectives?.message} /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold">Content requirements <span className="font-normal text-muted-foreground">· max 5,000</span></span><textarea className={`${inputClass()} min-h-32 resize-y`} data-testid="input-content-requirements" maxLength={5000} placeholder="Deliverables, key points, guardrails, and any review expectations." aria-invalid={!!fieldErrors.contentRequirements} {...form.register('contentRequirements')} /><span className="mt-1 block text-right text-[11px] text-muted-foreground">{values.contentRequirements.length}/5000</span><FieldError message={fieldErrors.contentRequirements?.message} /></label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block"><span className="mb-1.5 block text-xs font-semibold">Reward amount</span><span className="relative block"><CircleDollarSign size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className={`${inputClass()} pl-10`} data-testid="input-reward-amount" type="number" min="0.01" max="9999999999.99" step="0.01" placeholder="0.00" aria-invalid={!!fieldErrors.rewardAmount} {...form.register('rewardAmount', { valueAsNumber: true })} /></span><FieldError message={fieldErrors.rewardAmount?.message} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold">Currency</span><input className={inputClass()} data-testid="input-currency" maxLength={3} aria-invalid={!!fieldErrors.currency} {...form.register('currency', { onChange: event => { const currency = event.target.value.toUpperCase(); event.target.value = currency; set('currency', currency); } })} /><FieldError message={fieldErrors.currency?.message} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold">Application deadline</span><span className="relative block"><CalendarDays size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className={`${inputClass()} pl-10`} data-testid="input-deadline" type="date" min={minDeadline} aria-invalid={!!fieldErrors.deadline} {...form.register('deadline')} /></span><FieldError message={fieldErrors.deadline?.message} /></label>
      </div>
      <label className="block max-w-sm"><span className="mb-1.5 block text-xs font-semibold">Minimum followers</span><input className={inputClass()} data-testid="input-minimum-followers" type="number" min="0" max="2147483647" step="1" aria-invalid={!!fieldErrors.minimumFollowers} {...form.register('minimumFollowers', { valueAsNumber: true })} /><FieldError message={fieldErrors.minimumFollowers?.message} /></label>
      <div><ToggleGroup label="Accepted platforms" values={PLATFORMS} selected={values.acceptedPlatforms} onChange={value => set('acceptedPlatforms', value)} testId="toggle-platform" /><FieldError message={fieldErrors.acceptedPlatforms?.message} /></div>
      <div><ToggleGroup label="Creator niches" values={NICHES} selected={values.niches} onChange={value => set('niches', value)} testId="toggle-niche" /><FieldError message={fieldErrors.niches?.message} /></div>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold">Eligible countries <span className="font-normal text-muted-foreground">({values.allowedCountries.includes('Any') ? 'Anywhere' : `${values.allowedCountries.length} selected`})</span></legend>
        <div className="rounded-xl border border-border bg-background p-3">
          <button type="button" data-testid="toggle-country-any" aria-pressed={values.allowedCountries.includes('Any')} onClick={() => toggleCountry('Any')} className={`mb-3 rounded-full border px-3 py-2 text-xs font-semibold ${values.allowedCountries.includes('Any') ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground'}`}>{values.allowedCountries.includes('Any') && <Check size={12} className="mr-1 inline" />}Any country</button>
          {!values.allowedCountries.includes('Any') && <>
            <input className={`${inputClass()} mb-3`} data-testid="input-country-search" value={countryQuery} onChange={event => setCountryQuery(event.target.value)} placeholder="Search countries by name or code" />
            <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto pr-1 sm:grid-cols-3" data-testid="list-country-options">
              {filteredCountries.map(country => {
                const checked = values.allowedCountries.includes(country.code);
                return <label key={country.code} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-muted"><input type="checkbox" data-testid={`checkbox-country-${country.code.toLowerCase()}`} checked={checked} onChange={() => toggleCountry(country.code)} className="accent-[hsl(var(--primary))]" /><span>{country.name}</span><span className="ml-auto text-[10px] text-muted-foreground">{country.code}</span></label>;
              })}
            </div>
          </>}
        </div>
        <FieldError message={fieldErrors.allowedCountries?.message} />
      </fieldset>
      {error && <div role="alert" data-testid="status-campaign-error" className="rounded-xl border border-[#e3c2bb] bg-[#f7e9e6] p-3 text-sm text-[#8f463d]">{error}</div>}
      {success && <div role="status" data-testid="status-campaign-success" className="rounded-xl border border-[#bed1c1] bg-[#e7efe6] p-3 text-sm text-[#315848]">{success}</div>}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} data-testid="button-dismiss-editor" className="rounded-full border border-border px-5 py-3 text-sm font-semibold text-muted-foreground hover:bg-muted">Cancel</button>
        <button type="submit" disabled={busy} data-testid="button-save-campaign" className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60"><Save size={15} />{busy ? 'Saving…' : campaign ? 'Save changes' : 'Save as draft'}</button>
      </div>
    </form>
    </Form>
  </section>;
}

function StatusPill({ status }: { status: CampaignStatus }) {
  const styles: Record<CampaignStatus, string> = {
    DRAFT: 'bg-[#e9e9df] text-[#626657]',
    PUBLISHED: 'bg-[#e1eee1] text-[#315848]',
    CLOSED: 'bg-[#f1e5dc] text-[#8b573d]',
  };
  return <span data-testid={`status-campaign-${status.toLowerCase()}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.08em] ${styles[status]}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status}</span>;
}

export default function AdminCampaigns() {
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const admin = current.data?.role === 'ADMIN';
  const campaignsQuery = useListAdminCampaigns({ query: { enabled: admin, queryKey: getListAdminCampaignsQueryKey(), retry: false } });
  const create = useCreateAdminCampaign();
  const update = useUpdateAdminCampaign();
  const changeStatus = useUpdateAdminCampaignStatus();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [editing, setEditing] = useState<AdminCampaign | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  useEffect(() => {
    if (current.isError) setLocation('/login');
    else if (current.data && current.data.role !== 'ADMIN') setLocation('/dashboard');
  }, [current.isError, current.data, setLocation]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListAdminCampaignsQueryKey() });
  function save(input: CampaignInput) {
    setNotice('');
    setActionError('');
    const callbacks = {
      onSuccess: () => {
        void refresh();
        setNotice(editing ? 'Campaign details saved.' : 'Campaign saved as a draft.');
        setFormOpen(false);
        setEditing(null);
      },
      onError: (error: unknown) => setActionError(errorMessage(error)),
    };
    if (editing) update.mutate({ campaignId: editing.id, data: input }, callbacks);
    else create.mutate({ data: input }, callbacks);
  }
  function setStatus(campaign: AdminCampaign, status: CampaignStatus) {
    setPendingId(campaign.id);
    setActionError('');
    setNotice('');
    changeStatus.mutate({ campaignId: campaign.id, data: { status } }, {
      onSuccess: () => {
        void refresh();
        setNotice(status === 'PUBLISHED' ? `${campaign.title} is published.` : status === 'DRAFT' ? `${campaign.title} is now a draft.` : `${campaign.title} is closed.`);
        setPendingId(null);
      },
      onError: error => { setActionError(errorMessage(error)); setPendingId(null); },
    });
  }
  function startEdit(campaign: AdminCampaign) {
    setEditing(campaign);
    setNotice('');
    setActionError('');
    setFormOpen(true);
    window.setTimeout(() => document.getElementById('campaign-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  }
  function startCreate() {
    setEditing(null);
    setNotice('');
    setActionError('');
    setFormOpen(true);
    window.setTimeout(() => document.getElementById('campaign-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  }

  if (current.isLoading || (!current.data && !current.isError)) return <main className="min-h-[100dvh] bg-background"><div className="mx-auto max-w-[1120px] animate-pulse px-5 py-12 sm:px-9"><div className="h-3 w-32 rounded bg-muted" /><div className="mt-6 h-10 w-72 rounded bg-muted" /><div className="mt-8 h-28 rounded-2xl bg-muted" /></div></main>;
  if (current.isError || !admin) return <main className="grid min-h-[100dvh] place-items-center bg-background"><div className="text-center"><ShieldCheck className="mx-auto text-primary" size={28} /><p className="mt-4 text-sm text-muted-foreground" data-testid="status-campaign-access">Checking administrator access…</p></div></main>;

  const campaigns = campaignsQuery.data?.campaigns ?? [];
  const mutationError = actionError || (campaignsQuery.isError ? errorMessage(campaignsQuery.error) : '');
  const pending = (campaign: AdminCampaign) => pendingId === campaign.id && changeStatus.isPending;
  return <main className="min-h-[100dvh] bg-background">
    <header className="flex min-h-[76px] items-center justify-between border-b border-border/80 px-5 sm:px-9 lg:px-[7vw]">
      <Link href="/admin/dashboard" data-testid="link-admin-dashboard" className="brand-mark text-foreground"><span className="brand-symbol"><span /><span /><span /></span><span className="font-semibold tracking-[-.04em]">tech sponsor<span className="text-primary">.</span></span></Link>
      <Link href="/admin/dashboard" data-testid="link-back-admin" className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"><ArrowLeft size={14} /><span className="hidden sm:inline">Admin dashboard</span><span className="sm:hidden">Back</span></Link>
    </header>
    <section className="mx-auto max-w-[1120px] px-5 py-8 sm:px-9 sm:py-12">
      <div className="page-enter">
        <div className="eyebrow flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Administrator workspace</div>
        <div className="mt-3 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><h1 className="serif text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Campaigns, clearly.</h1><p className="mt-3 max-w-xl leading-7 text-muted-foreground">Set transparent briefs and keep each opportunity's terms in one place.</p></div>
          {!formOpen && <button type="button" onClick={startCreate} data-testid="button-create-campaign" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-95"><Plus size={16} />New campaign</button>}
        </div>
      </div>
      <div className="mt-7 flex gap-3 rounded-2xl border border-[#d7d7c7] bg-[#f0efe7] p-4 sm:p-5" data-testid="panel-payment-rule">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#dce4d9] text-primary"><ShieldCheck size={18} /></div>
        <div><div className="eyebrow text-primary">Fixed payment rule · applies to every campaign</div><p className="mt-1 text-sm leading-6 text-foreground">{PAYMENT_RULE}</p></div>
      </div>
      {notice && <div role="status" data-testid="status-campaign-success" className="mt-5 rounded-xl border border-[#bed1c1] bg-[#e7efe6] p-3 text-sm text-[#315848]">{notice}</div>}
      {mutationError && <div role="alert" data-testid="status-campaign-error" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e3c2bb] bg-[#f7e9e6] p-3 text-sm text-[#8f463d]"><span>{mutationError}</span>{campaignsQuery.isError && <button onClick={() => campaignsQuery.refetch()} data-testid="button-retry-campaigns" className="font-semibold underline underline-offset-2">Retry</button>}</div>}

      {formOpen && <CampaignForm key={editing?.id ?? 'new'} campaign={editing} busy={busy} onCancel={() => { setFormOpen(false); setEditing(null); }} onSave={save} error={actionError} success="" />}
      <div className="mt-9">
        <div className="mb-4 flex items-end justify-between gap-4"><div><div className="eyebrow text-muted-foreground">Campaign register</div><h2 className="serif mt-1 text-2xl font-semibold tracking-[-.04em]">All campaigns</h2></div><span className="text-xs text-muted-foreground" data-testid="text-campaign-count">{campaignsQuery.isLoading ? 'Loading…' : `${campaigns.length} ${campaigns.length === 1 ? 'campaign' : 'campaigns'}`}</span></div>
        {campaignsQuery.isLoading ? <CampaignSkeleton /> : campaignsQuery.isError ? <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground" data-testid="status-campaign-list-error">Campaigns could not be loaded. Use retry above to try again.</div> : campaigns.length === 0 ? <div className="rounded-[22px] border border-dashed border-border bg-card/60 px-6 py-12 text-center" data-testid="empty-campaigns"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e9e9df] text-primary"><Radio size={21} /></div><div className="eyebrow mt-5 text-primary">A considered first step</div><h3 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">No campaigns yet.</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Create a clear brief to give the right creators a reason to lean in.</p><button onClick={startCreate} data-testid="button-create-first-campaign" className="mt-5 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"><Plus size={15} className="mr-2 inline" />Create first campaign</button></div> : <div className="space-y-3" data-testid="list-admin-campaigns">
          {campaigns.map(campaign => <article key={campaign.id} data-testid={`row-campaign-${campaign.id}`} className="rounded-2xl border border-border/80 bg-card p-4 transition hover:border-primary/30 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5"><h3 className="text-base font-semibold tracking-[-.02em]" data-testid={`text-campaign-title-${campaign.id}`}>{campaign.title}</h3><StatusPill status={campaign.status} /></div>
                <p className="mt-1 text-xs text-muted-foreground">{campaign.organizerName}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1.5"><CalendarDays size={13} />Deadline <strong className="font-semibold text-foreground">{dateLabel(campaign.deadline)}</strong></span><span className="inline-flex items-center gap-1.5"><CircleDollarSign size={14} /><strong className="font-semibold text-foreground">{formatReward(campaign.rewardAmount, campaign.currency)}</strong></span></div>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-border pt-3 lg:border-0 lg:pt-0">
                <button onClick={() => startEdit(campaign)} data-testid={`button-edit-campaign-${campaign.id}`} className="rounded-full border border-border px-3.5 py-2 text-xs font-semibold hover:bg-muted">Edit</button>
                {campaign.status !== 'CLOSED' && <>
                  {campaign.status === 'DRAFT' ? <button disabled={pending(campaign)} onClick={() => setStatus(campaign, 'PUBLISHED')} data-testid={`button-publish-campaign-${campaign.id}`} className="rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">{pending(campaign) ? 'Updating…' : 'Publish'}</button> : <button disabled={pending(campaign)} onClick={() => setStatus(campaign, 'DRAFT')} data-testid={`button-unpublish-campaign-${campaign.id}`} className="rounded-full border border-primary/40 px-3.5 py-2 text-xs font-semibold text-primary hover:bg-primary/5 disabled:opacity-60">{pending(campaign) ? 'Updating…' : 'Unpublish'}</button>}
                  <button disabled={pending(campaign)} onClick={() => { if (window.confirm(`Close “${campaign.title}”? Closed campaigns cannot be reopened.`)) setStatus(campaign, 'CLOSED'); }} data-testid={`button-close-campaign-${campaign.id}`} className="rounded-full border border-[#e4cfc0] px-3.5 py-2 text-xs font-semibold text-[#8b573d] hover:bg-[#f7eee7] disabled:opacity-60">Close</button>
                </>}
                {campaign.status === 'CLOSED' && <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-2 text-xs font-medium text-muted-foreground"><ShieldCheck size={13} />Closed · final</span>}
              </div>
            </div>
          </article>)}
        </div>}
      </div>
    </section>
    <footer className="border-t border-border/80 px-5 py-6 text-center text-xs text-muted-foreground">Tech Sponsor Network <span className="px-2">·</span> Admin workspace</footer>
  </main>;
}
