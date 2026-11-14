import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Mail, RefreshCw, Send } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  getGetCurrentUserQueryKey,
  getListAdminEmailLogQueryKey,
  useGetCurrentUser,
  useListAdminEmailLog,
  useSendAdminTestEmail,
} from "@workspace/api-client-react";
import type { AdminEmailLogEntry } from "@workspace/api-client-react";

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

function statusStyle(status: AdminEmailLogEntry["status"]): string {
  if (status === "sent") return "bg-[#e7efe6] text-[#315848]";
  if (status === "skipped") return "bg-[#f4eddf] text-[#785f44]";
  return "bg-[#f7e9e6] text-[#8f463d]";
}

export function AdminEmailLogPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const current = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false },
  });
  const logQuery = useListAdminEmailLog({
    query: {
      queryKey: getListAdminEmailLogQueryKey(),
      enabled: !!current.data && current.data.role === "ADMIN",
      retry: false,
      refetchInterval: 15_000,
    },
  });
  const sendTest = useSendAdminTestEmail();
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);

  useEffect(() => {
    if (current.isError) setLocation("/login");
    else if (current.data && current.data.role !== "ADMIN") {
      setLocation("/dashboard");
    }
  }, [current.data, current.isError, setLocation]);

  if (current.isLoading || (!current.data && !current.isError)) {
    return (
      <main className="min-h-[100dvh] bg-background">
        <EmailLogHeader />
        <section className="mx-auto max-w-[1120px] px-5 py-10 sm:px-9">
          <div className="h-40 animate-pulse rounded-[22px] border border-border bg-card/70" />
        </section>
      </main>
    );
  }
  if (current.isError || current.data?.role !== "ADMIN") return null;

  const emails = logQuery.data?.emails ?? [];
  async function handleTestEmail() {
    setFeedback("");
    setFeedbackError(false);
    try {
      const result = await sendTest.mutateAsync();
      setFeedback(result.message);
      setFeedbackError(result.status !== "sent");
      await queryClient.invalidateQueries({
        queryKey: getListAdminEmailLogQueryKey(),
      });
    } catch {
      setFeedback("The test email could not be attempted. Check the email log.");
      setFeedbackError(true);
    }
  }

  return (
    <main className="min-h-[100dvh] bg-background">
      <EmailLogHeader />
      <section className="mx-auto max-w-[1120px] px-5 py-8 sm:px-9 sm:py-12">
        <div className="page-enter">
          <div className="eyebrow flex items-center gap-2 text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Administrator workspace
          </div>
          <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h1 className="serif text-4xl font-semibold tracking-[-.06em] sm:text-5xl">
                Email log.
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                Review the latest transactional email attempts and test delivery
                to your verified admin address.
              </p>
            </div>
            <button
              type="button"
              onClick={handleTestEmail}
              disabled={sendTest.isPending}
              data-testid="button-send-test-email"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-55"
            >
              {sendTest.isPending ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              Send test email
            </button>
          </div>
          {feedback && (
            <p
              role={feedbackError ? "alert" : "status"}
              data-testid="status-test-email"
              className={`mt-4 rounded-xl border p-3 text-sm ${
                feedbackError
                  ? "border-[#e3c2bb] bg-[#f7e9e6] text-[#8f463d]"
                  : "border-[#bed1c1] bg-[#e7efe6] text-[#315848]"
              }`}
            >
              {feedback}
            </p>
          )}
        </div>

        <div className="mt-7 overflow-hidden rounded-[22px] border border-border bg-card">
          {logQuery.isLoading ? (
            <div
              data-testid="loading-email-log"
              className="space-y-3 p-5 sm:p-7"
            >
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-14 animate-pulse rounded-xl bg-muted/70"
                />
              ))}
            </div>
          ) : logQuery.isError ? (
            <div
              role="alert"
              data-testid="status-email-log-error"
              className="p-6"
            >
              <p className="text-sm font-semibold text-[#8f463d]">
                The email log could not be loaded.
              </p>
              <button
                type="button"
                onClick={() => logQuery.refetch()}
                data-testid="button-retry-email-log"
                className="mt-3 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
              >
                Try again
              </button>
            </div>
          ) : emails.length === 0 ? (
            <div
              data-testid="empty-email-log"
              className="px-6 py-14 text-center"
            >
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#e9e9df] text-primary">
                <Mail size={20} />
              </div>
              <div className="eyebrow mt-5 text-primary">No messages yet</div>
              <h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">
                Email attempts will appear here.
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                Send a test email or wait for an application, decision, payment,
                or matching campaign alert.
              </p>
            </div>
          ) : (
            <div data-testid="list-admin-email-log">
              <div className="hidden grid-cols-[1.2fr_1fr_1.4fr_auto] gap-4 border-b border-border bg-muted/40 px-5 py-3 text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground md:grid">
                <span>Time and recipient</span>
                <span>Type</span>
                <span>Subject and result</span>
                <span>Status</span>
              </div>
              <ul className="divide-y divide-border">
                {emails.map((email) => (
                  <li
                    key={email.id}
                    data-testid={`row-email-log-${email.id}`}
                    className="grid gap-2 px-4 py-4 sm:px-5 md:grid-cols-[1.2fr_1fr_1.4fr_auto] md:items-start md:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">
                        {dateTime(email.createdAt)}
                      </p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {email.toEmail}
                      </p>
                    </div>
                    <p className="text-xs font-medium text-muted-foreground">
                      {email.type.replaceAll("_", " ").toLowerCase()}
                    </p>
                    <div className="min-w-0">
                      <p className="break-words text-xs font-semibold">
                        {email.subject}
                      </p>
                      {email.errorMessage && (
                        <p
                          data-testid={`text-email-error-${email.id}`}
                          className="mt-1 break-words text-xs leading-5 text-[#8f463d]"
                        >
                          {email.errorMessage}
                        </p>
                      )}
                    </div>
                    <span
                      data-testid={`status-email-${email.id}`}
                      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.08em] ${statusStyle(email.status)}`}
                    >
                      {email.status === "sent" && <CheckCircle2 size={12} />}
                      {email.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Showing up to 100 most recent attempts. The list refreshes automatically.
        </p>
      </section>
      <footer className="border-t border-border/80 px-5 py-6 text-center text-xs text-muted-foreground">
        Tech Sponsor Network <span className="px-2">·</span> Email log
      </footer>
    </main>
  );
}

function EmailLogHeader() {
  return (
    <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-3 border-b border-border/80 px-5 py-3 sm:px-9 lg:px-[7vw]">
      <Link
        href="/admin/dashboard"
        data-testid="link-email-log-brand"
        className="brand-mark text-foreground"
      >
        <span className="brand-symbol">
          <span />
          <span />
          <span />
        </span>
        <span className="font-semibold tracking-[-.04em]">
          tech sponsor<span className="text-primary">.</span>
        </span>
      </Link>
      <nav
        aria-label="Administrator navigation"
        className="flex flex-wrap items-center gap-2"
      >
        <Link
          href="/admin/campaigns"
          className="rounded-full border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted sm:px-4 sm:text-xs"
        >
          Campaigns
        </Link>
        <Link
          href="/admin/applications"
          className="rounded-full border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted sm:px-4 sm:text-xs"
        >
          Applications
        </Link>
        <Link
          href="/admin/invoices"
          className="rounded-full border border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted sm:px-4 sm:text-xs"
        >
          Invoices
        </Link>
        <Link
          href="/admin/dashboard"
          data-testid="link-email-log-back"
          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] font-semibold text-primary"
        >
          <ArrowLeft size={13} />
          Dashboard
        </Link>
      </nav>
    </header>
  );
}
