import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './styles.css';

export const metadata: Metadata = {
  title: { default: 'MigrateProof', template: '%s | MigrateProof' },
  description: 'A disposable PostgreSQL migration safety lab.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>
    <header className="topbar"><div className="topbar-inner">
      <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>MigrateProof</Link>
      <nav aria-label="Primary"><Link href="/#inventory">Inventory</Link><Link href="/#history">Rehearsals</Link></nav>
      <span className="environment"><span aria-hidden="true" /> Disposable PostgreSQL lab</span>
    </div></header>
    <main className="container">{children}</main>
    <footer className="footer">MigrateProof <span>·</span> Synthetic fixtures only</footer>
  </body></html>;
}
