import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Link } from 'wouter';

type NavItem = { href: string; label: string; testId?: string };

export function ResponsiveNav({ items, label, current }: { items: NavItem[]; label: string; current?: { label: string; testId?: string } }) {
  const [open, setOpen] = useState(false);
  return <div className="relative">
    <button type="button" data-testid="button-mobile-menu" aria-label={open ? `Close ${label}` : `Open ${label}`} aria-expanded={open} aria-controls="responsive-navigation" onClick={() => setOpen(value => !value)} className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card sm:hidden">
      {open ? <X size={18} /> : <Menu size={18} />}
    </button>
    <nav id="responsive-navigation" aria-label={label} className={`${open ? 'flex' : 'hidden'} absolute right-0 top-[calc(100%+8px)] z-30 min-w-52 flex-col gap-1 rounded-2xl border border-border bg-card p-2 shadow-xl sm:static sm:flex sm:flex-row sm:items-center sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none`}>
      {items.map(item => <Link key={item.href} href={item.href} data-testid={item.testId} onClick={() => setOpen(false)} className="flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground sm:rounded-full sm:border sm:border-border sm:px-4 sm:text-xs">{item.label}</Link>)}
      {current && <span aria-current="page" data-testid={current.testId} className="flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-primary sm:rounded-full sm:border sm:border-primary/30 sm:bg-primary/5 sm:text-xs">{current.label}</span>}
    </nav>
  </div>;
}
