import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BadgeCheck, CheckCircle2, ExternalLink, FileText, Image, LoaderCircle, ReceiptText, ShieldCheck } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  getGetCurrentUserQueryKey,
  getListCreatorApplicationsQueryKey,
  getGetCreatorInvoiceTermsQueryKey,
  getListCreatorInvoicesQueryKey,
  getListAdminInvoicesQueryKey,
  getListAdminCampaignApplicationsQueryKey,
  useGetCurrentUser,
  useListCreatorApplications,
  useGetCreatorInvoiceTerms,
  useListCreatorInvoices,
  useRequestInvoiceUploadUrl,
  useCreateCreatorInvoice,
  useListAdminInvoices,
  useMarkAdminInvoicePaid,
} from '@workspace/api-client-react';
import type { AdminInvoice, CreatorCampaignApplication, CreatorInvoice, InvoiceInput } from '@workspace/api-client-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const invoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(1, 'Enter an invoice number.').max(80),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the invoice date.'),
  amount: z.number().positive('Enter an amount greater than zero.'),
  description: z.string().trim().min(1, 'Add a short description.').max(300, 'Keep the description under 300 characters.'),
  workUrl: z.string().trim().url('Enter a valid work URL.').max(2048),
  confirmed: z.boolean().refine(value => value, 'Please confirm that these details are accurate.'),
});

type InvoiceValues = z.infer<typeof invoiceSchema>;
const paidSchema = z.object({
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the paid date.'),
  note: z.string().max(300, 'Keep the note under 300 characters.').optional(),
});

function messageOf(error: unknown) {
  return error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.';
}

function shortDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function invoiceStatus(status: string) {
  return status === 'PAID' ? 'Paid' : 'Pending';
}

function invoiceFileUrl(role: 'creator' | 'admin', invoiceId: string, kind: 'invoice' | 'work-photo') {
  return `/api/${role}/invoices/${encodeURIComponent(invoiceId)}/files/${kind}`;
}

function InvoiceStatus({ status, testId }: { status: string; testId: string }) {
  const paid = status === 'PAID';
  return <span data-testid={testId} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.1em] ${paid ? 'bg-[#e7efe6] text-[#315848]' : 'bg-[#f4eddf] text-[#785f44]'}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" />{invoiceStatus(status)}
  </span>;
}

function FilePicker({ label, accept, required, file, onChange, testId }: {
  label: string;
  accept: string;
  required?: boolean;
  file: File | null;
  onChange: (file: File | null) => void;
  testId: string;
}) {
  return <label className="block">
    <span className="mb-1.5 block text-xs font-semibold">{label}{required ? ' · required' : ' · optional'}</span>
    <span className="flex min-h-[50px] items-center gap-3 rounded-xl border border-dashed border-border bg-background px-3 py-2.5 transition hover:border-primary/50">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e9e9df] text-primary">{accept.includes('pdf') ? <FileText size={16} /> : <Image size={16} />}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{file?.name ?? (accept.includes('pdf') ? 'Choose a PDF invoice' : 'Choose a work photo')}</span>
      <span className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[10px] font-semibold text-foreground">Browse</span>
    </span>
    <input data-testid={testId} type="file" accept={accept} onChange={event => onChange(event.target.files?.[0] ?? null)} className="sr-only" />
    <span className="mt-1 block text-[10px] text-muted-foreground">Maximum file size 5 MB{required ? ' · PDF only' : ' · JPG, PNG or WebP'}</span>
  </label>;
}

function CreatorInvoiceForm({ application, currency, rewardAmount, email, accountName, onCancel, onDone }: {
  application: CreatorCampaignApplication;
  currency: string;
  rewardAmount: number;
  email: string;
  accountName: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const requestUrl = useRequestInvoiceUploadUrl();
  const createInvoice = useCreateCreatorInvoice();
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [workPhoto, setWorkPhoto] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState('');
  const form = useForm<InvoiceValues>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: { invoiceNumber: '', invoiceDate: new Date().toISOString().slice(0, 10), amount: 0, description: '', workUrl: '', confirmed: false },
  });
  const amount = form.watch('amount');

  async function upload(file: File, kind: 'INVOICE' | 'WORK_PHOTO') {
    const contentType = file.type || (kind === 'INVOICE' ? 'application/pdf' : 'application/octet-stream');
    const requested = await requestUrl.mutateAsync({
      applicationId: application.id,
      data: { kind, name: file.name, size: file.size, contentType },
    });
    const response = await fetch(requested.uploadURL, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
    if (!response.ok) throw new Error(`The ${kind === 'INVOICE' ? 'invoice PDF' : 'work photo'} upload failed (${response.status}). Please try again.`);
    return requested.objectPath;
  }

  async function submit(values: InvoiceValues) {
    setSubmitError('');
    if (!invoiceFile) {
      setSubmitError('Add the required PDF invoice to continue.');
      return;
    }
    if (values.amount > rewardAmount) {
      setSubmitError(`The amount cannot be more than the campaign reward of ${new Intl.NumberFormat('en', { style: 'currency', currency }).format(rewardAmount)}.`);
      return;
    }
    if (invoiceFile.type !== 'application/pdf' || invoiceFile.size > 5 * 1024 * 1024) {
      setSubmitError('The invoice must be a PDF no larger than 5 MB.');
      return;
    }
    if (workPhoto && (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(workPhoto.type) || workPhoto.size > 5 * 1024 * 1024)) {
      setSubmitError('The work photo must be JPG, PNG, GIF or WebP and no larger than 5 MB.');
      return;
    }
    try {
      const invoiceObjectPath = await upload(invoiceFile, 'INVOICE');
      const workPhotoObjectPath = workPhoto ? await upload(workPhoto, 'WORK_PHOTO') : null;
      const payload: InvoiceInput = {
        invoiceNumber: values.invoiceNumber.trim(),
        invoiceDate: values.invoiceDate,
        amount: Number(values.amount),
        currency,
        description: values.description.trim(),
        workUrl: values.workUrl.trim(),
        invoiceObjectPath,
        workPhotoObjectPath,
        confirmed: true,
      };
      await createInvoice.mutateAsync({ applicationId: application.id, data: payload });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListCreatorInvoicesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListCreatorApplicationsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAdminInvoicesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAdminCampaignApplicationsQueryKey() }),
      ]);
      onDone();
    } catch (error) {
      setSubmitError(messageOf(error));
    }
  }

  const busy = requestUrl.isPending || createInvoice.isPending || form.formState.isSubmitting;
  return <div data-testid={`panel-invoice-form-${application.id}`} className="mt-5 rounded-2xl border border-[#d9dfd4] bg-[#f5f6f0] p-4 sm:p-5">
    <div className="mb-4 flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e1e9df] text-primary"><ReceiptText size={17} /></div><div><p className="text-sm font-semibold">Submit campaign invoice</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Files are uploaded privately. No payment account details are needed.</p></div></div>
    <div className="mb-4 grid gap-3 rounded-xl border border-border/70 bg-card px-3.5 py-3 sm:grid-cols-2">
      <div><span className="eyebrow text-muted-foreground">Account name</span><p data-testid={`text-invoice-account-name-${application.id}`} className="mt-1 text-sm font-semibold">{accountName}</p></div>
      <div><span className="eyebrow text-muted-foreground">Account email</span><p data-testid={`text-invoice-account-email-${application.id}`} className="mt-1 break-all text-sm font-semibold">{email}</p></div>
    </div>
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} data-testid={`form-creator-invoice-${application.id}`} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField control={form.control} name="invoiceNumber" render={({ field }) => <FormItem><FormLabel className="text-xs">Invoice number</FormLabel><FormControl><input {...field} data-testid={`input-invoice-number-${application.id}`} maxLength={80} className="field !py-2.5" placeholder="e.g. TSN-2025-014" /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="invoiceDate" render={({ field }) => <FormItem><FormLabel className="text-xs">Invoice date</FormLabel><FormControl><input {...field} data-testid={`input-invoice-date-${application.id}`} type="date" className="field !py-2.5" /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name="amount" render={({ field }) => <FormItem><FormLabel className="text-xs">Amount</FormLabel><FormControl><input name={field.name} ref={field.ref} onBlur={field.onBlur} onChange={event => field.onChange(event.target.value ? Number(event.target.value) : 0)} value={field.value || ''} data-testid={`input-invoice-amount-${application.id}`} type="number" min="0.01" max={rewardAmount} step="0.01" className="field !py-2.5" placeholder="0.00" /></FormControl><FormMessage /><p className="text-[10px] text-muted-foreground">Maximum {new Intl.NumberFormat('en', { style: 'currency', currency }).format(rewardAmount)}</p></FormItem>} />
          <div><label className="mb-1.5 block text-xs font-semibold">Campaign currency</label><input data-testid={`input-invoice-currency-${application.id}`} readOnly value={currency} className="field !py-2.5 font-mono font-semibold" /><p className="mt-1 text-[10px] text-muted-foreground">Set by the campaign and cannot be changed.</p></div>
        </div>
        <FormField control={form.control} name="description" render={({ field }) => <FormItem><div className="flex items-center justify-between"><FormLabel className="text-xs">Invoice details</FormLabel><span data-testid={`text-invoice-description-count-${application.id}`} className="text-[10px] text-muted-foreground">{field.value.length}/300</span></div><FormControl><textarea {...field} data-testid={`textarea-invoice-description-${application.id}`} maxLength={300} rows={3} className="field resize-y !py-2.5" placeholder="Briefly describe the work covered by this invoice." /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="workUrl" render={({ field }) => <FormItem><FormLabel className="text-xs">Published work URL</FormLabel><FormControl><input {...field} data-testid={`input-invoice-work-url-${application.id}`} type="url" maxLength={2048} className="field !py-2.5" placeholder="https://…" /></FormControl><FormMessage /></FormItem>} />
        <div className="grid gap-3 sm:grid-cols-2">
          <FilePicker label="Invoice PDF" accept="application/pdf,.pdf" required file={invoiceFile} onChange={setInvoiceFile} testId={`input-invoice-pdf-${application.id}`} />
          <FilePicker label="Work photo" accept="image/jpeg,image/png,image/webp,image/gif" file={workPhoto} onChange={setWorkPhoto} testId={`input-invoice-work-photo-${application.id}`} />
        </div>
        <FormField control={form.control} name="confirmed" render={({ field }) => <FormItem><label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3"><FormControl><input ref={field.ref} name={field.name} onBlur={field.onBlur} onChange={event => field.onChange(event.target.checked)} checked={field.value} data-testid={`checkbox-invoice-confirm-${application.id}`} type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" /></FormControl><span className="text-xs leading-5 text-foreground/80">I confirm these invoice details are accurate and relate to the work completed for this campaign.</span></label><FormMessage /></FormItem>} />
        {submitError && <p role="alert" data-testid={`status-invoice-submit-error-${application.id}`} className="rounded-xl border border-[#e3c2bb] bg-[#f7e9e6] px-3.5 py-3 text-xs leading-5 text-[#8f463d]">{submitError}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onCancel} data-testid={`button-cancel-invoice-${application.id}`} className="rounded-full border border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted">Cancel</button><button type="submit" disabled={busy || !currency} data-testid={`button-submit-invoice-${application.id}`} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:cursor-wait disabled:opacity-60">{busy ? <><LoaderCircle size={14} className="animate-spin" />Uploading and submitting…</> : 'Submit invoice'}{!busy && <CheckCircle2 size={14} />}</button></div>
      </form>
    </Form>
    {amount && <span className="sr-only">Entered amount {amount}</span>}
  </div>;
}

function CreatorInvoiceCard({ invoice }: { invoice: CreatorInvoice }) {
  return <article data-testid={`card-creator-invoice-${invoice.id}`} className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="eyebrow text-primary">Invoice {invoice.invoiceNumber}</p><h3 data-testid={`text-creator-invoice-campaign-${invoice.id}`} className="serif mt-1.5 text-lg font-semibold tracking-[-.04em]">{invoice.campaignTitle}</h3></div><InvoiceStatus status={invoice.status} testId={`status-creator-invoice-${invoice.id}`} /></div>
    <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-3"><div><p className="eyebrow text-muted-foreground">Amount</p><p data-testid={`text-creator-invoice-amount-${invoice.id}`} className="mt-1 text-sm font-semibold">{new Intl.NumberFormat('en', { style: 'currency', currency: invoice.currency }).format(invoice.amount)}</p></div><div><p className="eyebrow text-muted-foreground">Invoice date</p><p data-testid={`text-creator-invoice-date-${invoice.id}`} className="mt-1 text-sm font-semibold">{shortDate(invoice.invoiceDate)}</p></div><div><p className="eyebrow text-muted-foreground">Description</p><p data-testid={`text-creator-invoice-description-${invoice.id}`} className="mt-1 text-sm leading-5 text-muted-foreground">{invoice.description}</p></div></div>
    <div className="mt-4 flex flex-wrap gap-2"><a href={invoiceFileUrl('creator', invoice.id, 'invoice')} target="_blank" rel="noreferrer" data-testid={`link-creator-invoice-file-${invoice.id}`} className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-xs font-semibold transition hover:bg-muted"><FileText size={14} className="text-primary" />Invoice PDF <ExternalLink size={12} /></a><a href={invoice.workUrl} target="_blank" rel="noreferrer" data-testid={`link-creator-invoice-work-${invoice.id}`} className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-xs font-semibold transition hover:bg-muted">Published work <ExternalLink size={12} /></a>{invoice.hasWorkPhoto && <a href={invoiceFileUrl('creator', invoice.id, 'work-photo')} target="_blank" rel="noreferrer" data-testid={`link-creator-invoice-photo-${invoice.id}`} className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-xs font-semibold transition hover:bg-muted"><Image size={14} className="text-primary" />Work photo <ExternalLink size={12} /></a>}</div>
  </article>;
}

export function CreatorInvoiceSection({ applications, email, accountName }: { applications: CreatorCampaignApplication[]; email: string; accountName: string }) {
  const invoiceQuery = useListCreatorInvoices({ query: { queryKey: getListCreatorInvoicesQueryKey(), retry: false } });
  const invoices = invoiceQuery.data?.invoices ?? [];
  const invoiceByApplication = useMemo(() => new Map(invoices.map(invoice => [invoice.applicationId, invoice])), [invoices]);
  const eligible = applications.filter(application => application.status === 'ACCEPTED' || application.status === 'WINNER');
  return <section className="mt-12 border-t border-border/80 pt-9" data-testid="section-creator-invoices">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><div className="eyebrow flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Campaign paperwork</div><h2 className="serif mt-2 text-3xl font-semibold tracking-[-.05em]">Invoices.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Submit paperwork for accepted work and keep track of its payment status.</p></div><span data-testid="text-creator-invoice-count" className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold text-muted-foreground"><ReceiptText size={14} className="text-primary" />{invoiceQuery.isLoading ? 'Loading invoices' : `${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}`}</span></div>
    {invoiceQuery.isLoading ? <div data-testid="loading-creator-invoices" className="mt-5 space-y-3"><div className="h-28 animate-pulse rounded-2xl border border-border bg-card/70" /><div className="h-28 animate-pulse rounded-2xl border border-border bg-card/70" /></div>
      : invoiceQuery.isError ? <div role="alert" data-testid="status-creator-invoices-error" className="mt-5 rounded-2xl border border-[#e3c2bb] bg-card p-5"><p className="text-sm font-semibold text-[#8f463d]">Your invoices couldn’t be loaded.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{messageOf(invoiceQuery.error)}</p><button type="button" onClick={() => invoiceQuery.refetch()} data-testid="button-retry-creator-invoices" className="mt-3 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">Try again</button></div>
      : invoices.length ? <div className="mt-5 space-y-3" data-testid="list-creator-invoices">{invoices.map(invoice => <CreatorInvoiceCard key={invoice.id} invoice={invoice} />)}</div>
        : <div data-testid="empty-creator-invoices" className="mt-5 rounded-2xl border border-dashed border-border bg-card/60 px-5 py-7"><p className="text-sm font-semibold">No invoices submitted yet.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Once you send an invoice, its status and records will appear here.</p></div>}
    {!!eligible.length && <div className="mt-7 space-y-3" data-testid="list-invoice-eligible-applications">
      <h3 className="eyebrow text-muted-foreground">Ready for invoicing</h3>
      {eligible.map(application => <CreatorInvoiceEligibleCard key={application.id} application={application} invoice={invoiceByApplication.get(application.id)} email={email} accountName={accountName} canSubmit={!invoiceQuery.isLoading && !invoiceQuery.isError} />)}
    </div>}
    {!eligible.length && <div data-testid="empty-invoice-eligible-applications" className="mt-5 rounded-2xl border border-dashed border-border bg-card/60 px-5 py-6"><p className="text-sm font-semibold">No campaigns are ready for invoicing.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Invoices become available once an application is accepted or marked as a winner.</p></div>}
  </section>;
}

function CreatorInvoiceEligibleCard({ application, invoice, email, accountName, canSubmit }: {
  application: CreatorCampaignApplication;
  invoice?: CreatorInvoice;
  email: string;
  accountName: string;
  canSubmit: boolean;
}) {
  const termsQuery = useGetCreatorInvoiceTerms(application.id, { query: { queryKey: getGetCreatorInvoiceTermsQueryKey(application.id), retry: false } });
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const terms = termsQuery.data;
  return <article data-testid={`card-invoice-eligible-${application.id}`} className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="eyebrow text-primary">{application.status === 'WINNER' ? 'Winner' : 'Accepted'} campaign</p><h4 data-testid={`text-invoice-eligible-campaign-${application.id}`} className="serif mt-1.5 text-lg font-semibold tracking-[-.04em]">{application.campaignTitle}</h4><p className="mt-1 text-xs text-muted-foreground">{terms ? `Campaign currency · ${terms.currency}` : termsQuery.isLoading ? 'Loading campaign terms' : 'Campaign currency unavailable'}</p></div>{invoice ? <div className="flex flex-wrap items-center gap-2"><InvoiceStatus status={invoice.status} testId={`status-eligible-invoice-${application.id}`} /><span className="text-xs text-muted-foreground">Submitted · {invoice.invoiceNumber}</span></div> : <button type="button" onClick={() => setOpen(value => !value)} disabled={!canSubmit || termsQuery.isLoading || !terms} data-testid={`button-open-invoice-form-${application.id}`} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-50">{!canSubmit ? 'Invoices unavailable' : open ? 'Close invoice form' : 'Upload invoice'}<ReceiptText size={14} /></button>}</div>
    {termsQuery.isError && <div role="alert" data-testid={`status-invoice-currency-error-${application.id}`} className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[#e3c2bb] bg-[#f7e9e6] p-3 text-xs text-[#8f463d]"><span>Campaign terms couldn’t be loaded, so this invoice can’t be submitted yet.</span><button type="button" onClick={() => termsQuery.refetch()} data-testid={`button-retry-invoice-currency-${application.id}`} className="shrink-0 font-semibold underline">Try again</button></div>}
    {open && terms && <CreatorInvoiceForm application={application} currency={terms.currency} rewardAmount={terms.rewardAmount} email={email} accountName={accountName} onCancel={() => setOpen(false)} onDone={() => { setOpen(false); setSubmitted(true); }} />}
    {submitted && <div role="status" data-testid={`status-invoice-success-${application.id}`} className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#bed1c1] bg-[#e7efe6] p-3.5 text-xs leading-5 text-[#315848]"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>Your invoice was submitted. Its status is now Pending while the campaign team reviews it.</span></div>}
  </article>;
}

function MarkPaidForm({ invoice, onCancel }: { invoice: AdminInvoice; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const markPaid = useMarkAdminInvoicePaid();
  const [error, setError] = useState('');
  const form = useForm<z.infer<typeof paidSchema>>({
    resolver: zodResolver(paidSchema),
    defaultValues: { paidDate: new Date().toISOString().slice(0, 10), note: '' },
  });
  async function submit(values: z.infer<typeof paidSchema>) {
    setError('');
    try {
      await markPaid.mutateAsync({ invoiceId: invoice.id, data: { paidDate: values.paidDate, note: values.note?.trim() || undefined } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAdminInvoicesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListCreatorInvoicesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListCreatorApplicationsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAdminCampaignApplicationsQueryKey() }),
      ]);
      onCancel();
    } catch (problem) {
      setError(messageOf(problem));
    }
  }
  return <Form {...form}><form onSubmit={form.handleSubmit(submit)} data-testid={`form-mark-invoice-paid-${invoice.id}`} className="mt-4 grid gap-3 rounded-xl border border-[#d9dfd4] bg-[#f5f6f0] p-4 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
    <FormField control={form.control} name="paidDate" render={({ field }) => <FormItem><FormLabel className="text-xs">Paid date · required</FormLabel><FormControl><input {...field} data-testid={`input-invoice-paid-date-${invoice.id}`} type="date" className="field !py-2.5" /></FormControl><FormMessage /></FormItem>} />
    <FormField control={form.control} name="note" render={({ field }) => <FormItem><FormLabel className="text-xs">Reference note · optional</FormLabel><FormControl><input {...field} data-testid={`input-invoice-paid-note-${invoice.id}`} maxLength={300} className="field !py-2.5" placeholder="Transfer reference or internal note" /></FormControl><FormMessage /></FormItem>} />
    <div className="flex gap-2"><button type="button" onClick={onCancel} data-testid={`button-cancel-mark-paid-${invoice.id}`} className="rounded-full border border-border px-4 py-2.5 text-xs font-semibold">Cancel</button><button type="submit" disabled={markPaid.isPending || form.formState.isSubmitting} data-testid={`button-confirm-mark-paid-${invoice.id}`} className="rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{markPaid.isPending ? 'Saving…' : 'Confirm paid'}</button></div>
    {error && <p role="alert" data-testid={`status-mark-paid-error-${invoice.id}`} className="text-xs text-[#8f463d] sm:col-span-3">{error}</p>}
  </form></Form>;
}

function AdminInvoiceCard({ invoice }: { invoice: AdminInvoice }) {
  const [editing, setEditing] = useState(false);
  return <article data-testid={`row-admin-invoice-${invoice.id}`} className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start"><div className="min-w-0"><p data-testid={`text-admin-invoice-email-${invoice.id}`} className="break-all text-sm font-semibold">{invoice.creatorEmail}</p><p className="mt-1 text-xs text-muted-foreground">{invoice.creatorName}</p><h3 data-testid={`text-admin-invoice-campaign-${invoice.id}`} className="serif mt-3 text-xl font-semibold leading-tight tracking-[-.04em]">{invoice.campaignTitle}</h3></div><InvoiceStatus status={invoice.status} testId={`status-admin-invoice-${invoice.id}`} /></div>
    <div className="mt-4 grid gap-x-6 gap-y-3 border-y border-border py-4 sm:grid-cols-2 lg:grid-cols-4">
      <div><p className="eyebrow text-muted-foreground">Amount</p><p data-testid={`text-admin-invoice-amount-${invoice.id}`} className="mt-1 text-sm font-semibold">{new Intl.NumberFormat('en', { style: 'currency', currency: invoice.currency }).format(invoice.amount)}</p></div>
      <div><p className="eyebrow text-muted-foreground">Invoice number</p><p data-testid={`text-admin-invoice-number-${invoice.id}`} className="mt-1 text-sm font-semibold">{invoice.invoiceNumber}</p></div>
      <div><p className="eyebrow text-muted-foreground">Invoice date</p><p data-testid={`text-admin-invoice-date-${invoice.id}`} className="mt-1 text-sm font-semibold">{shortDate(invoice.invoiceDate)}</p></div>
      <div><p className="eyebrow text-muted-foreground">{invoice.paidDate ? 'Paid date' : 'Submitted'}</p><p data-testid={`text-admin-invoice-paid-date-${invoice.id}`} className="mt-1 text-sm font-semibold">{invoice.paidDate ? shortDate(invoice.paidDate) : shortDate(invoice.createdAt)}</p></div>
    </div>
    <p data-testid={`text-admin-invoice-description-${invoice.id}`} className="mt-4 whitespace-pre-wrap text-sm leading-6 text-foreground/80">{invoice.description}</p>
    {invoice.paidNote && <p data-testid={`text-admin-invoice-paid-note-${invoice.id}`} className="mt-2 text-xs text-muted-foreground">Reference: {invoice.paidNote}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <a href={invoiceFileUrl('admin', invoice.id, 'invoice')} target="_blank" rel="noreferrer" data-testid={`link-admin-invoice-file-${invoice.id}`} className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-xs font-semibold transition hover:bg-muted"><FileText size={14} className="text-primary" />Invoice PDF <ExternalLink size={12} /></a>
      <a href={invoice.workUrl} target="_blank" rel="noreferrer" data-testid={`link-admin-invoice-work-${invoice.id}`} className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-xs font-semibold transition hover:bg-muted">Published work <ExternalLink size={12} /></a>
      {invoice.hasWorkPhoto && <a href={invoiceFileUrl('admin', invoice.id, 'work-photo')} target="_blank" rel="noreferrer" data-testid={`link-admin-invoice-photo-${invoice.id}`} className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-xs font-semibold transition hover:bg-muted"><Image size={14} className="text-primary" />Work photo <ExternalLink size={12} /></a>}
      {invoice.status === 'PENDING' && <button type="button" onClick={() => setEditing(open => !open)} data-testid={`button-mark-invoice-paid-${invoice.id}`} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:brightness-95"><BadgeCheck size={14} />{editing ? 'Close payment form' : 'Mark paid'}</button>}
    </div>
    {editing && invoice.status === 'PENDING' && <MarkPaidForm invoice={invoice} onCancel={() => setEditing(false)} />}
    {invoice.paidByName && invoice.paidDate && <p data-testid={`text-admin-invoice-paid-by-${invoice.id}`} className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck size={13} className="text-primary" />Recorded by {invoice.paidByName}</p>}
  </article>;
}

export function AdminInvoicesPage() {
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const invoicesQuery = useListAdminInvoices({ query: { queryKey: getListAdminInvoicesQueryKey(), enabled: !!current.data && current.data.role === 'ADMIN', retry: false } });
  useEffect(() => {
    if (current.isError) setLocation('/login');
    else if (current.data && current.data.role !== 'ADMIN') setLocation('/dashboard');
  }, [current.isError, current.data, setLocation]);
  if (current.isLoading || (!current.data && !current.isError)) return <main className="min-h-[100dvh] bg-background"><AdminInvoiceHeader /><section className="mx-auto max-w-[1120px] px-5 py-10 sm:px-9"><InvoiceSkeleton /></section></main>;
  if (current.isError || current.data?.role !== 'ADMIN') return null;
  const invoices = invoicesQuery.data?.invoices ?? [];
  return <main className="min-h-[100dvh] bg-background">
    <AdminInvoiceHeader />
    <section className="mx-auto max-w-[1120px] px-5 py-8 sm:px-9 sm:py-12">
      <div className="page-enter"><div className="eyebrow flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Administrator workspace</div><div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="serif text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Invoice register.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Review creator paperwork and record completed payments.</p></div><span data-testid="text-admin-invoice-count" className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-xs font-semibold text-muted-foreground"><ReceiptText size={14} className="text-primary" />{invoicesQuery.isLoading ? 'Loading invoices' : `${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}`}</span></div></div>
      {invoicesQuery.isLoading ? <InvoiceSkeleton /> : invoicesQuery.isError ? <div role="alert" data-testid="status-admin-invoices-error" className="mt-7 rounded-2xl border border-[#e3c2bb] bg-card p-6"><p className="text-sm font-semibold text-[#8f463d]">The invoice register couldn’t be loaded.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{messageOf(invoicesQuery.error)}</p><button type="button" onClick={() => invoicesQuery.refetch()} data-testid="button-retry-admin-invoices" className="mt-4 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">Try again</button></div>
        : !invoices.length ? <div data-testid="empty-admin-invoices" className="mt-7 rounded-[24px] border border-dashed border-border bg-card/70 px-6 py-14 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e9e9df] text-primary"><ReceiptText size={20} /></div><div className="eyebrow mt-5 text-primary">No invoices received</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">The payment register is clear.</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Submitted creator invoices will be listed here for review.</p></div>
          : <div data-testid="list-admin-invoices" className="mt-7 space-y-3">{invoices.map(invoice => <AdminInvoiceCard key={invoice.id} invoice={invoice} />)}</div>}
    </section>
    <footer className="border-t border-border/80 px-5 py-6 text-center text-xs text-muted-foreground">Tech Sponsor Network <span className="px-2">·</span> Invoice register</footer>
  </main>;
}

function AdminInvoiceHeader() {
  return <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-3 border-b border-border/80 px-5 py-3 sm:px-9 lg:px-[7vw]">
    <Link href="/admin/dashboard" data-testid="link-admin-invoice-brand" className="brand-mark text-foreground"><span className="brand-symbol"><span /><span /><span /></span><span className="font-semibold tracking-[-.04em]">tech sponsor<span className="text-primary">.</span></span></Link>
    <nav aria-label="Administrator navigation" className="flex flex-wrap items-center gap-2"><Link href="/admin/campaigns" data-testid="link-invoices-admin-campaigns" className="rounded-full border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted sm:px-4 sm:text-xs">Campaigns</Link><Link href="/admin/applications" data-testid="link-invoices-admin-applications" className="rounded-full border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted sm:px-4 sm:text-xs">Applications</Link><span aria-current="page" data-testid="link-invoices-admin-current" className="rounded-full border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] font-semibold text-primary sm:px-4 sm:text-xs">Invoices</span></nav>
  </header>;
}

function InvoiceSkeleton() {
  return <div data-testid="loading-invoices" className="mt-7 space-y-3">{[0, 1, 2].map(index => <div key={index} className="h-32 animate-pulse rounded-2xl border border-border bg-card/70" />)}<span className="sr-only">Loading invoices</span></div>;
}
