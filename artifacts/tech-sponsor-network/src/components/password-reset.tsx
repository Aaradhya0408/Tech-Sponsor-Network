import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, KeyRound, Mail } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import {
  useRequestPasswordReset,
  useResetPassword,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

function AuthPageFrame({
  children,
  kicker,
  title,
  description,
}: {
  children: React.ReactNode;
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <main className="grain flex min-h-[100dvh] flex-col bg-background">
      <header className="flex h-[76px] items-center justify-between border-b border-border/70 px-5 sm:px-9 lg:px-[7vw]">
        <Link
          href="/"
          data-testid="link-home"
          className="font-semibold tracking-[-.04em] text-foreground"
        >
          tech sponsor<span className="text-primary">.</span>
        </Link>
        <Link
          href="/login"
          data-testid="link-back-login"
          className="text-sm text-muted-foreground transition hover:text-foreground"
        >
          Back to sign in
        </Link>
      </header>
      <div className="mx-auto grid w-full max-w-[1120px] flex-1 items-center gap-12 px-5 py-10 sm:px-9 lg:grid-cols-[1fr_.85fr] lg:gap-24 lg:px-14">
        <section className="order-2 max-w-[470px] lg:order-1">
          <div className="eyebrow flex items-center gap-2 text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {kicker}
          </div>
          <h1 className="serif mt-5 text-4xl font-semibold leading-[1.08] tracking-[-.06em] sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-md leading-7 text-muted-foreground">
            {description}
          </p>
        </section>
        <section className="order-1 mx-auto w-full max-w-[440px] rounded-[24px] border border-border/80 bg-card px-6 py-7 shadow-[0_20px_60px_-42px_rgba(36,52,43,.32)] sm:px-9 sm:py-9 lg:order-2">
          {children}
        </section>
      </div>
      <footer className="px-5 py-5 text-center text-xs text-muted-foreground">
        Tech Sponsor Network · A more considered way to connect.
      </footer>
    </main>
  );
}

function FormNotice({
  kind,
  children,
}: {
  kind: "success" | "error" | "info";
  children: React.ReactNode;
}) {
  const styles = {
    success: "border-[#bed1c1] bg-[#e7efe6] text-[#315848]",
    error: "border-[#e3c2bb] bg-[#f7e9e6] text-[#8f463d]",
    info: "border-border bg-muted/60 text-muted-foreground",
  };
  return (
    <div
      role="status"
      data-testid={`status-password-reset-${kind}`}
      className={`rounded-xl border p-3 text-xs leading-5 ${styles[kind]}`}
    >
      {children}
    </div>
  );
}

const requestSchema = z.object({
  email: z.string().email("Enter a valid email address.").max(320),
});

type RequestValues = z.infer<typeof requestSchema>;

export function ForgotPasswordPage() {
  const requestReset = useRequestPasswordReset();
  const [submitted, setSubmitted] = useState(false);
  const [resetUrl, setResetUrl] = useState("");
  const form = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { email: "" },
  });

  function submit(values: RequestValues) {
    setSubmitted(false);
    setResetUrl("");
    requestReset.mutate(
      { data: { email: values.email.trim() } },
      {
        onSuccess: (response) => {
          setSubmitted(true);
          setResetUrl(response.resetUrl ?? "");
        },
      },
    );
  }

  return (
    <AuthPageFrame
      kicker="Account recovery"
      title="Let’s get you back in."
      description="Enter the email address on your account. We’ll provide reset instructions if an account matches."
    >
      <div className="mb-7">
        <div className="eyebrow text-muted-foreground">Password reset</div>
        <h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">
          Forgot your password?
        </h2>
      </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email address</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    data-testid="input-reset-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@studio.com"
                    required
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {submitted && (
            <>
              <FormNotice kind="success">
                If an account exists for that email, reset instructions will be
                available shortly.
              </FormNotice>
              <FormNotice kind="info">
                Development reset links appear below when an account matches.
                Production responses never include the reset link.
              </FormNotice>
              {resetUrl && (
                <div
                  className="rounded-xl border border-[#bed1c1] bg-[#e7efe6] p-4"
                  data-testid="panel-dev-password-reset-link"
                >
                  <p className="text-xs font-semibold text-[#315848]">
                    Development password reset link
                  </p>
                  <a
                    href={resetUrl}
                    data-testid="link-dev-password-reset"
                    className="mt-2 inline-flex items-center gap-2 break-all text-sm font-semibold text-primary underline underline-offset-4"
                  >
                    Reset your password <ArrowRight size={15} className="shrink-0" />
                  </a>
                </div>
              )}
            </>
          )}
          {requestReset.isError && (
            <FormNotice kind="error">
              {requestReset.error.message ||
                "Could not request a password reset. Please try again."}
            </FormNotice>
          )}
          <Button
            type="submit"
            data-testid="button-request-password-reset"
            disabled={requestReset.isPending}
            className="min-h-11 w-full rounded-xl"
          >
            {requestReset.isPending ? "Requesting link…" : "Request reset link"}
            {!requestReset.isPending && <Mail aria-hidden="true" />}
          </Button>
          <p className="pt-2 text-center text-sm text-muted-foreground">
            Remembered it?{" "}
            <Link
              href="/login"
              data-testid="link-reset-sign-in"
              className="font-semibold text-primary hover:underline"
            >
              Sign in
            </Link>
          </p>
        </form>
      </Form>
    </AuthPageFrame>
  );
}

const resetSchema = z
  .object({
    newPassword: z
      .string()
      .min(10, "Use at least 10 characters.")
      .max(128, "Use no more than 128 characters."),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

type ResetValues = z.infer<typeof resetSchema>;

export function ResetPasswordPage() {
  const resetPassword = useResetPassword();
  const [location, setLocation] = useLocation();
  const token = new URLSearchParams(location.split("?")[1] ?? "").get("token") ?? "";
  const [success, setSuccess] = useState(false);
  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  function submit(values: ResetValues) {
    resetPassword.mutate(
      { data: { token, newPassword: values.newPassword } },
      {
        onSuccess: () => setSuccess(true),
      },
    );
  }

  return (
    <AuthPageFrame
      kicker="Account recovery"
      title="Choose a new password."
      description="Set a new password to regain access to your Tech Sponsor Network account."
    >
      <div className="mb-7">
        <div className="eyebrow text-muted-foreground">Secure your account</div>
        <h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">
          Reset password
        </h2>
      </div>
      {success ? (
        <div className="space-y-4">
          <FormNotice kind="success">
            Your password has been updated. You can now sign in with the new
            password.
          </FormNotice>
          <Button
            type="button"
            data-testid="button-reset-password-sign-in"
            onClick={() => setLocation("/login")}
            className="min-h-11 w-full rounded-xl"
          >
            Go to sign in <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      ) : !token ? (
        <div className="space-y-4">
          <FormNotice kind="error">
            This password reset link is missing or invalid. Request a new one to
            continue.
          </FormNotice>
          <Link
            href="/forgot-password"
            data-testid="link-request-another-reset"
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-95"
          >
            Request another link <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      data-testid="input-new-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={10}
                      maxLength={128}
                      placeholder="At least 10 characters"
                      required
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm new password</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      data-testid="input-confirm-new-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Enter it again"
                      required
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {resetPassword.isError && (
              <FormNotice kind="error">
                {resetPassword.error.message ||
                  "This password reset link is invalid or expired."}
              </FormNotice>
            )}
            <Button
              type="submit"
              data-testid="button-reset-password"
              disabled={resetPassword.isPending}
              className="min-h-11 w-full rounded-xl"
            >
              {resetPassword.isPending ? "Updating password…" : "Set new password"}
              {!resetPassword.isPending && <KeyRound aria-hidden="true" />}
            </Button>
          </form>
        </Form>
      )}
    </AuthPageFrame>
  );
}
