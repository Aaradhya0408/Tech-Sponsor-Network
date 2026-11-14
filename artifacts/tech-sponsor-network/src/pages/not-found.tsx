import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <main className="grain flex min-h-[100dvh] items-center justify-center bg-background px-5 py-12">
      <section className="w-full max-w-xl rounded-[28px] border border-border/80 bg-card p-7 shadow-[0_24px_70px_-46px_rgba(36,52,43,.38)] sm:p-10">
        <Link href="/" data-testid="link-not-found-home" className="brand-mark text-foreground">
          <span className="brand-symbol"><span /><span /><span /></span>
          <span className="font-semibold tracking-[-.04em]">tech sponsor<span className="text-primary">.</span></span>
        </Link>
        <div className="mt-12 grid h-12 w-12 place-items-center rounded-2xl bg-[#e9e9df] text-primary"><Compass size={22} /></div>
        <p className="eyebrow mt-6 text-primary">A wrong turn</p>
        <h1 className="serif mt-3 text-4xl font-semibold tracking-[-.06em] sm:text-5xl">This page isn’t here.</h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground">The address may have changed. Head back to the network and find your way from there.</p>
        <Link href="/" className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-95"><ArrowLeft size={16} />Back to the network</Link>
      </section>
    </main>
  );
}
