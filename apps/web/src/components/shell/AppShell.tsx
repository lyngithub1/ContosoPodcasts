import type { ReactNode } from 'react';
import { LeftRail } from './LeftRail';
import { TopBar } from './TopBar';
import { NotificationHost } from './NotificationHost';
import { branding } from '../../config/branding';

/**
 * Application shell (Spec §8): left rail, top bar, main workspace. The right
 * inspector and bottom transport are rendered contextually by workspace pages.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <LeftRail />
      <div className="shell-main">
        <TopBar />
        <main id="main" className="workspace" tabIndex={-1}>
          {children}
        </main>
        <footer className="shell-footer">
          <span className="muted">{branding.legal.copyright}</span>
          <span className="muted">{branding.legal.disclaimer}</span>
        </footer>
      </div>
      <NotificationHost />
    </div>
  );
}
