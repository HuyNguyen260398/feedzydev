'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import InstallButton from '@/components/InstallButton';
import NotifyButton from '@/components/NotifyButton';
import ThemeToggle from '@/components/ThemeToggle';

const LINKS = [
  { href: '/', label: 'Feed' },
  { href: '/sources/', label: 'Sources' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname === href.replace(/\/$/, '') || pathname.startsWith(href);
}

export default function Header() {
  const pathname = usePathname() ?? '/';
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-3 sm:px-4">
        <Link href="/" className="font-mono text-base font-semibold whitespace-nowrap sm:text-lg">
          {'> feedzy'}
          <span className="text-accent">dev</span>
          {'_'}
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <nav aria-label="Main" className="flex items-center gap-1">
            {LINKS.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-lg px-2.5 py-2 text-sm font-medium transition-colors sm:px-3 ${
                    active ? 'bg-surface text-accent' : 'text-muted hover:text-text'
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <InstallButton />
          <NotifyButton />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
