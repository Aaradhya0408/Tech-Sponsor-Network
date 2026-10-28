import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, ArrowRight, Check, CheckCircle2, CircleUserRound, Compass, Fingerprint, LockKeyhole, LogOut, Mail, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  getGetCurrentUserQueryKey,
  useGetCurrentUser,
  useGetCreatorDashboard,
  useGetAdminDashboard,
  useLogIn,
  useLogOut,
  useSignUp,
  useVerifyEmail,
} from '@workspace/api-client-react';
import type { AuthUser } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function errorText(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Something went wrong. Please try again.';
}

function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" data-testid="link-home" className={`brand-mark ${light ? 'text-[#f6f2e8]' : 'text-foreground'}`}>
    <span className="brand-symbol"><span /><span /><span /></span>
    <span className="font-semibold tracking-[-.04em]">tech sponsor<span className="text-primary">.</span></span>
  </Link>;
}

function Header() {
  const [location] = useLocation();
  return <header className="relative z-10 flex h-[76px] items-center justify-between border-b border-border/70 px-5 sm:px-9 lg:px-[7vw]">
    <Brand />
    <nav className="flex items-center gap-2 sm:gap-5">
      <a href="/#network" className="hidden text-sm text-muted-foreground transition hover:text-foreground sm:block">The network</a>
      <Link href="/login" data-testid="link-login" className={`rounded-full px-4 py-2 text-sm font-semibold transition hover:bg-muted ${location === '/login' ? 'text-primary' : ''}`}>Log in</Link>
      <Link href="/signup" data-testid="link-join" className="rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 sm:px-5">Join the network</Link>
    </nav>
  </header>;
}

function Landing() {
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (current.data) setLocation(current.data.role === 'ADMIN' ? '/admin/dashboard' : '/dashboard');
  }, [current.data, setLocation]);
  return <main className="grain min-h-[100dvh] overflow-hidden bg-background">
    <Header />
    <section className="relative mx-auto grid max-w-[1440px] items-center gap-10 px-5 pb-20 pt-14 sm:px-9 sm:pt-20 lg:min-h-[690px] lg:grid-cols-[1.05fr_.95fr] lg:px-[7vw] lg:pb-24 lg:pt-10">
      <div className="page-enter relative z-[1] max-w-[650px]">
        <div className="eyebrow mb-7 flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> A considered community for creators</div>
        <h1 className="serif max-w-[660px] text-[clamp(3.2rem,7.7vw,6.7rem)] font-semibold leading-[.99] tracking-[-.065em] text-foreground">Good work<br />deserves <span className="italic text-primary">good</span><br />partnerships.</h1>
        <p className="mt-7 max-w-[470px] text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">A focused network connecting thoughtful creators with technology brands that belong in their work.</p>
        <div className="mt-9 flex flex-wrap items-center gap-4">
          <Link href="/signup" data-testid="link-hero-signup" className="group inline-flex items-center gap-3 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition hover:-translate-y-0.5">
            Apply to join <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </Link>
          <Link href="/login" data-testid="link-hero-login" className="rounded-full px-5 py-3.5 text-sm font-semibold text-foreground transition hover:bg-muted">Member sign in</Link>
        </div>
        <div className="mt-12 flex items-center gap-4 border-t border-border/80 pt-5">
          <div className="flex -space-x-2">
            {['M','J','A','R'].map((letter, i) => <span key={letter} className={`grid h-9 w-9 place-items-center rounded-full border-2 border-background text-xs font-bold ${['bg-[#d6e4d6] text-[#315848]','bg-[#ead9c2] text-[#794f2f]','bg-[#d4dde8] text-[#3f5673]','bg-[#e6d5d0] text-[#82554b]'][i]}`}>{letter}</span>)}
          </div>
          <p className="text-xs leading-5 text-muted-foreground"><strong className="font-semibold text-foreground">Creator-first, always.</strong><br />Built around the people who make.</p>
        </div>
      </div>
      <div className="relative mx-auto flex min-h-[360px] w-full max-w-[560px] items-center justify-center sm:min-h-[450px] lg:min-h-[570px]">
        <div className="absolute inset-[8%] rounded-[48%] bg-[#e8e5d9] lg:inset-[4%]"></div>
        <div className="absolute inset-[14%] rounded-[48%] border border-[#c9cdbd] lg:inset-[10%]"></div>
        <div className="absolute left-[12%] top-[13%] h-2.5 w-2.5 rounded-full bg-[#bd7c59]"></div>
        <div className="absolute right-[12%] top-[32%] h-2 w-2 rounded-full bg-primary"></div>
        <div className="absolute bottom-[17%] left-[20%] h-1.5 w-1.5 rounded-full bg-[#bd7c59]"></div>
        <div className="relative z-[1] flex aspect-[.83] w-[64%] max-w-[350px] flex-col justify-between overflow-hidden rounded-[180px_180px_28px_28px] bg-[#c4d2c2] px-7 pb-7 pt-12 shadow-[0_26px_55px_-28px_rgba(44,70,58,.38)] sm:pt-16">
          <div className="absolute -right-12 top-20 h-40 w-40 rounded-full border border-[#75927b]/40"></div>
          <div className="absolute -left-9 top-28 h-36 w-36 rounded-full border border-[#75927b]/30"></div>
          <div className="relative">
            <div className="eyebrow text-[#426451]">Independent by nature</div>
            <div className="serif mt-3 text-3xl font-semibold leading-[1.05] tracking-[-.06em] text-[#263f34] sm:text-4xl">Make room<br />for better.</div>
          </div>
          <div className="relative flex items-end justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#426451]">01 — 04</span>
            <span className="grid h-10 w-10 place-items-center rounded-full border border-[#426451]/40 text-[#315848]"><ArrowDownRight size={17} /></span>
          </div>
          <div className="absolute bottom-[28%] right-[19%] h-[22%] w-[26%] rounded-t-full bg-[#8fa88e] opacity-80"></div>
          <div className="absolute bottom-[27%] right-[25%] h-[21%] w-[2px] rotate-[8deg] bg-[#54765e]"></div>
          <div className="absolute bottom-[35%] right-[17%] h-[8%] w-[16%] -rotate-12 rounded-[100%_0_100%_0] bg-[#6e8c72]"></div>
        </div>
        <div className="absolute bottom-[12%] right-[2%] z-[2] max-w-[185px] rounded-2xl border border-border/70 bg-card/95 p-4 shadow-[0_12px_30px_-18px_rgba(34,48,42,.35)] sm:right-0">
          <div className="flex items-center gap-2 text-primary"><ShieldCheck size={16} /><span className="eyebrow !tracking-[.12em]">Vetted, not crowded</span></div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">A focused community for people building thoughtful partnerships.</p>
        </div>
        <div className="absolute left-[1%] top-[26%] z-[2] hidden rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground shadow-sm sm:block">People before placements</div>
      </div>
    </section>
    <section id="network" className="border-y border-border/80 bg-[#eae9df] px-5 py-12 sm:px-9 lg:px-[7vw]">
      <div className="mx-auto grid max-w-[1240px] gap-8 md:grid-cols-[.8fr_1.2fr] md:items-center">
        <div><div className="eyebrow text-primary">A better kind of network</div><h2 className="serif mt-3 max-w-sm text-3xl font-semibold leading-tight tracking-[-.05em] text-foreground sm:text-4xl">Built for the long game.</h2></div>
        <div className="grid gap-6 sm:grid-cols-3">
          <ValueItem icon={<Fingerprint size={19} />} number="01" title="Selective by design" text="We keep the room small enough for real trust." />
          <ValueItem icon={<UsersRound size={19} />} number="02" title="Creator-led" text="Your voice and your standards stay yours." />
          <ValueItem icon={<Compass size={19} />} number="03" title="Better-fit work" text="Partnerships begin with relevance, not reach." />
        </div>
      </div>
    </section>
    <section className="mx-auto flex max-w-[1240px] flex-col items-start justify-between gap-6 px-5 py-16 sm:px-9 md:flex-row md:items-end lg:px-[7vw] lg:py-24">
      <div><div className="eyebrow text-primary">Your next chapter starts here</div><h2 className="serif mt-4 max-w-xl text-4xl font-semibold leading-[1.08] tracking-[-.06em] sm:text-5xl">A network that takes your work seriously.</h2></div>
      <Link href="/signup" data-testid="link-footer-signup" className="group inline-flex shrink-0 items-center gap-3 rounded-full border border-primary/35 px-6 py-3.5 text-sm font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground">Request access <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" /></Link>
    </section>
    <footer className="flex flex-col gap-4 border-t border-border/80 px-5 py-7 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-9 lg:px-[7vw]">
      <Brand /><p>Thoughtful technology partnerships, by design.</p><Link href="/admin/dashboard" data-testid="link-admin-entry" className="font-medium transition hover:text-foreground">Administrator sign in</Link>
    </footer>
  </main>;
}

function ValueItem({ icon, number, title, text }: { icon: ReactNode; number: string; title: string; text: string }) {
  return <div className="flex gap-3">
    <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#dce4d9] text-primary">{icon}</div>
    <div><div className="eyebrow text-muted-foreground">{number} / {title}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div>
  </div>;
}

function AuthFrame({ children, title, kicker, description, mode }: { children: ReactNode; title: string; kicker: string; description: string; mode: 'login' | 'signup' }) {
  return <main className="grain flex min-h-[100dvh] flex-col bg-background">
    <header className="flex h-[76px] items-center justify-between border-b border-border/70 px-5 sm:px-9 lg:px-[7vw]"><Brand /><Link href="/" className="text-sm text-muted-foreground transition hover:text-foreground" data-testid="link-back-home">Back to home</Link></header>
    <div className="mx-auto grid w-full max-w-[1120px] flex-1 items-center gap-12 px-5 py-10 sm:px-9 lg:grid-cols-[1fr_.85fr] lg:gap-24 lg:px-14">
      <section className="page-enter order-2 max-w-[470px] lg:order-1">
        <div className="eyebrow flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> {kicker}</div>
        <h1 className="serif mt-5 text-4xl font-semibold leading-[1.08] tracking-[-.06em] sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-md leading-7 text-muted-foreground">{description}</p>
        <div className="mt-9 rounded-2xl bg-[#e9e9df] p-5 sm:p-6">
          <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-[#d3dfd2] text-primary"><Sparkles size={18} /></div><div><p className="text-sm font-semibold">The work comes first.</p><p className="mt-0.5 text-xs text-muted-foreground">A little signal. A lot less noise.</p></div></div>
          <div className="mt-5 flex gap-2">{['Creator-led','Thoughtful fit','Private by default'].map(item => <span key={item} className="rounded-full border border-border/70 bg-card/60 px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground">{item}</span>)}</div>
        </div>
      </section>
      <section className="page-enter order-1 mx-auto w-full max-w-[440px] rounded-[24px] border border-border/80 bg-card px-6 py-7 shadow-[0_20px_60px_-42px_rgba(36,52,43,.32)] sm:px-9 sm:py-9 lg:order-2">
        <div className="mb-7"><div className="eyebrow text-muted-foreground">{mode === 'login' ? 'Member access' : 'Join the network'}</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">{mode === 'login' ? 'Welcome back.' : 'Create your account.'}</h2></div>
        {children}
      </section>
    </div>
    <footer className="px-5 py-5 text-center text-xs text-muted-foreground">Tech Sponsor Network · A more considered way to connect.</footer>
  </main>;
}

function Login() {
  const login = useLogIn();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    login.mutate({ data: { email: String(form.get('email')).trim(), password: String(form.get('password')) } }, {
      onSuccess: user => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), user);
        setLocation(user.role === 'ADMIN' ? '/admin/dashboard' : '/dashboard');
      },
      onError: err => setError(errorText(err)),
    });
  }
  return <AuthFrame mode="login" kicker="For verified members" title="Your community is waiting." description="Sign in to your account to continue. Accounts must be verified before access is granted.">
    <form onSubmit={submit} className="space-y-4">
      <FormField label="Email address" name="email" type="email" placeholder="you@studio.com" autoComplete="email" icon={<Mail size={16} />} />
      <FormField label="Password" name="password" type="password" placeholder="Your password" autoComplete="current-password" icon={<LockKeyhole size={16} />} />
      {error && <Notice kind="error" text={error} />}
      <button data-testid="button-login" disabled={login.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:cursor-wait disabled:opacity-65">
        {login.isPending ? 'Signing in…' : 'Sign in'} {!login.isPending && <ArrowRight size={16} />}
      </button>
      <p className="pt-2 text-center text-sm text-muted-foreground">New to the network? <Link href="/signup" data-testid="link-create-account" className="font-semibold text-primary hover:underline">Create an account</Link></p>
    </form>
  </AuthFrame>;
}

function Signup() {
  const signup = useSignUp();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(''); setError('');
    const form = new FormData(event.currentTarget);
    signup.mutate({ data: { name: String(form.get('name')).trim(), email: String(form.get('email')).trim(), password: String(form.get('password')) } }, {
      onSuccess: response => setMessage(response.message),
      onError: err => setError(errorText(err)),
    });
  }
  return <AuthFrame mode="signup" kicker="Join the network" title="Make your next move a good one." description="Create your account and verify your email to access the creator network.">
    <form onSubmit={submit} className="space-y-4">
      <FormField label="Your name" name="name" type="text" placeholder="Name you work under" autoComplete="name" icon={<CircleUserRound size={16} />} />
      <FormField label="Email address" name="email" type="email" placeholder="you@studio.com" autoComplete="email" icon={<Mail size={16} />} />
      <FormField label="Password" name="password" type="password" placeholder="At least 10 characters" autoComplete="new-password" icon={<LockKeyhole size={16} />} minLength={10} />
      <div className="flex gap-2.5 rounded-xl border border-[#d7d7c7] bg-[#f0efe7] p-3.5 text-xs leading-5 text-muted-foreground"><Mail size={16} className="mt-0.5 shrink-0 text-primary" /><p><strong className="font-semibold text-foreground">Email verification required.</strong> After signup, follow the verification link printed by the server before signing in.</p></div>
      {message && <Notice kind="success" text={message} />}
      {error && <Notice kind="error" text={error} />}
      <button data-testid="button-signup" disabled={signup.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:cursor-wait disabled:opacity-65">
        {signup.isPending ? 'Creating account…' : 'Create account'} {!signup.isPending && <ArrowRight size={16} />}
      </button>
      <p className="pt-1 text-center text-sm text-muted-foreground">Already a member? <Link href="/login" data-testid="link-existing-account" className="font-semibold text-primary hover:underline">Sign in</Link></p>
    </form>
  </AuthFrame>;
}

function FormField({ label, name, type, placeholder, autoComplete, icon, minLength }: { label: string; name: string; type: string; placeholder: string; autoComplete: string; icon: ReactNode; minLength?: number }) {
  return <label className="block">
    <span className="mb-1.5 block text-xs font-semibold text-foreground">{label}</span>
    <span className="relative block"><span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</span><input className="field pl-10" data-testid={`input-${name}`} required name={name} type={type} placeholder={placeholder} autoComplete={autoComplete} minLength={minLength} /></span>
  </label>;
}

function Notice({ kind, text }: { kind: 'success' | 'error'; text: string }) {
  const success = kind === 'success';
  return <div role="status" data-testid={`status-${kind}`} className={`flex gap-2.5 rounded-xl border p-3 text-xs leading-5 ${success ? 'border-[#bed1c1] bg-[#e7efe6] text-[#315848]' : 'border-[#e3c2bb] bg-[#f7e9e6] text-[#8f463d]'}`}>
    {success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <ShieldCheck size={16} className="mt-0.5 shrink-0" />}<span>{text}</span>
  </div>;
}

function DashboardShell({ user, admin = false, onLogout, children }: { user: AuthUser; admin?: boolean; onLogout: () => void; children: ReactNode }) {
  return <main className="min-h-[100dvh] bg-background">
    <header className="flex min-h-[76px] items-center justify-between border-b border-border/80 px-5 sm:px-9 lg:px-[7vw]">
      <Brand /><div className="flex items-center gap-3 sm:gap-5"><span className="hidden text-xs text-muted-foreground sm:block">{admin ? 'Network administration' : 'Creator member'}</span><button onClick={onLogout} data-testid="button-logout" className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-xs font-semibold transition hover:bg-muted"><LogOut size={14} /> Sign out</button></div>
    </header>
    <section className="mx-auto max-w-[1120px] px-5 py-10 sm:px-9 sm:py-14">
      <div className="page-enter">
        <div className="eyebrow flex items-center gap-2 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> {admin ? 'Administrator area' : 'Member space'}</div>
        <h1 className="serif mt-3 text-4xl font-semibold tracking-[-.06em] sm:text-5xl">{admin ? 'Good to have you here.' : `Welcome, ${user.name.split(' ')[0]}.`}</h1>
        <p className="mt-3 max-w-xl leading-7 text-muted-foreground">{admin ? 'Your administrator access is verified. This is the secure entry point for the network team.' : 'Your account is ready. This is your home base in the Tech Sponsor Network.'}</p>
      </div>
      {children}
    </section>
    <footer className="border-t border-border/80 px-5 py-6 text-center text-xs text-muted-foreground">Tech Sponsor Network <span className="px-2">·</span> Member access</footer>
  </main>;
}

function Dashboard({ admin = false }: { admin?: boolean }) {
  const me = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const creator = useGetCreatorDashboard({ query: { enabled: !!me.data && !admin, retry: false, queryKey: ['/api/auth/creator/dashboard'] } });
  const adminData = useGetAdminDashboard({ query: { enabled: !!me.data && admin, retry: false, queryKey: ['/api/auth/admin/dashboard'] } });
  const logout = useLogOut();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [logoutError, setLogoutError] = useState('');

  useEffect(() => {
    if (me.isError) setLocation('/login');
  }, [me.isError, setLocation]);
  if (me.isLoading || (!me.data && !me.isError)) return <LoadingPage />;
  if (me.isError || !me.data) return <LoadingPage />;

  const accountQuery = admin ? adminData : creator;
  if (accountQuery.isLoading) return <LoadingPage />;
  if (admin && accountQuery.isError) return <AccessDenied message={errorText(accountQuery.error)} onLogout={() => {
    logout.mutate(undefined, { onSuccess: () => { queryClient.clear(); setLocation('/login'); } });
  }} />;
  if (!accountQuery.data) return <ErrorPage onRetry={() => accountQuery.refetch()} />;

  const user = accountQuery.data;
  const handleLogout = () => {
    setLogoutError('');
    logout.mutate(undefined, { onSuccess: () => { queryClient.clear(); setLocation('/login'); }, onError: err => setLogoutError(errorText(err)) });
  };
  return <DashboardShell user={user} admin={admin} onLogout={handleLogout}>
    <div className="mt-10 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <article className="rounded-[22px] border border-border bg-card p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4"><div><div className="eyebrow text-muted-foreground">Account summary</div><h2 className="serif mt-2 text-2xl font-semibold tracking-[-.04em]">Your network profile</h2></div><div className="grid h-11 w-11 place-items-center rounded-2xl bg-secondary text-primary"><CircleUserRound size={21} /></div></div>
        <div className="mt-7 divide-y divide-border">
          <SummaryRow label="Full name" value={user.name} />
          <SummaryRow label="Email address" value={user.email} />
          <SummaryRow label="Membership" value={admin ? 'Administrator' : 'Creator'} />
          <SummaryRow label="Email status" value={user.emailVerified ? 'Verified' : 'Awaiting verification'} status={user.emailVerified} />
          <SummaryRow label="Member since" value={new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} />
        </div>
        {logoutError && <div className="mt-4"><Notice kind="error" text={logoutError} /></div>}
      </article>
      <aside className="relative overflow-hidden rounded-[22px] bg-[#213a32] p-6 text-[#f4f0e5] sm:p-8">
        <div className="absolute -right-12 -top-10 h-48 w-48 rounded-full border border-white/10"></div><div className="absolute -right-5 -top-3 h-32 w-32 rounded-full border border-white/10"></div>
        <div className="relative"><div className="eyebrow text-[#a9c9b4]">{admin ? 'Secure access' : 'Made for your work'}</div><h2 className="serif mt-4 max-w-sm text-3xl font-semibold leading-tight tracking-[-.05em]">{admin ? 'A trusted space for the people behind the network.' : 'Good partnerships begin with the right people.'}</h2><p className="mt-4 max-w-sm text-sm leading-6 text-[#d3ddd4]">{admin ? 'Your role and access are confirmed by the network server.' : 'Your account is verified and your place in the community is ready.'}</p><div className="mt-8 flex items-center gap-2 text-xs font-semibold text-[#b8d4bd]"><Check size={15} /> {user.emailVerified ? 'Verified account' : 'Account active'}</div></div>
      </aside>
    </div>
  </DashboardShell>;
}

function SummaryRow({ label, value, status }: { label: string; value: string; status?: boolean }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 py-4"><span className="text-sm text-muted-foreground">{label}</span><span className={`flex items-center gap-2 text-right text-sm font-semibold ${status ? 'text-primary' : 'text-foreground'}`}>{status && <CheckCircle2 size={15} />}{value}</span></div>;
}

function LoadingPage() {
  return <main className="min-h-[100dvh] bg-background"><div className="flex h-[76px] items-center border-b border-border/80 px-5 sm:px-9"><Brand /></div><div className="mx-auto max-w-[1120px] animate-pulse px-5 py-14 sm:px-9"><div className="h-3 w-32 rounded bg-muted" /><div className="mt-5 h-10 w-72 max-w-full rounded-lg bg-muted" /><div className="mt-4 h-4 w-96 max-w-full rounded bg-muted" /><div className="mt-10 grid gap-5 lg:grid-cols-2"><div className="h-80 rounded-[22px] bg-muted" /><div className="h-80 rounded-[22px] bg-muted" /></div></div></main>;
}

function AccessDenied({ message, onLogout }: { message: string; onLogout: () => void }) {
  const [, setLocation] = useLocation();
  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5"><div className="page-enter max-w-md rounded-[24px] border border-border bg-card p-8 text-center shadow-sm sm:p-10"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#f4e5df] text-[#9c5041]"><ShieldCheck size={24} /></div><div className="eyebrow mt-6 text-[#9c5041]">Restricted area</div><h1 className="serif mt-2 text-3xl font-semibold tracking-[-.05em]">Access not available.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">The server could not authorize administrator access for this account. Your account remains secure.</p><p className="mt-3 text-xs text-muted-foreground" data-testid="text-access-denied">{message}</p><div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center"><button onClick={() => setLocation('/dashboard')} data-testid="button-return-dashboard" className="rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Return to my dashboard</button><button onClick={onLogout} data-testid="button-denied-logout" className="rounded-full border border-border px-5 py-3 text-sm font-semibold">Sign out</button></div></div></main>;
}

function ErrorPage({ onRetry }: { onRetry: () => void }) {
  return <main className="grid min-h-[100dvh] place-items-center bg-background px-5"><div className="max-w-md rounded-[24px] border border-border bg-card p-8 text-center"><div className="eyebrow text-destructive">A momentary interruption</div><h1 className="serif mt-3 text-3xl font-semibold">We couldn't load your account.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Please try again. If the issue continues, sign out and sign in once more.</p><button onClick={onRetry} data-testid="button-retry-dashboard" className="mt-6 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Try again</button></div></main>;
}

function AuthNotice() {
  const verify = useVerifyEmail();
  const [location, setLocation] = useLocation();
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const tokenStarted = useRef('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('verify');
    if (token && tokenStarted.current !== token) {
      tokenStarted.current = token;
      setVerifying(true);
      verify.mutate({ data: { token } }, {
        onSuccess: response => {
          setVerifying(false);
          setNotice({ type: 'success', text: response.message });
          setLocation('/login?verified=1');
        },
        onError: err => {
          setVerifying(false);
          setNotice({ type: 'error', text: errorText(err) });
          setLocation(location.split('?')[0]);
        },
      });
      return;
    }
    if (params.get('verified') === '1') setNotice({ type: 'success', text: 'Your email is verified. You can now sign in.' });
  }, [location]);
  if ((!notice && !verifying) || location.startsWith('/dashboard') || location.startsWith('/admin')) return null;
  if (verifying) return <div role="status" data-testid="status-verification-pending" className="fixed bottom-5 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-lg"><span className="h-4 w-4 animate-pulse rounded-full bg-primary/30" /> Verifying your email…</div>;
  if (!notice) return null;
  return <div className="fixed bottom-5 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2"><Notice kind={notice.type} text={notice.text} /></div>;
}

function Router() {
  const [location] = useLocation();
  return <>
    <AuthNotice />
    <ErrorBoundary resetKey={location}>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/signup" component={Signup} />
        <Route path="/login" component={Login} />
        <Route path="/dashboard"><Dashboard /></Route>
        <Route path="/admin/dashboard"><Dashboard admin /></Route>
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  </>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
