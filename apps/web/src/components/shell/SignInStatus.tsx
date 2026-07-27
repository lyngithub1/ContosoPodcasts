import { useEffect, useState } from 'react';
import { authEnabled } from '../../config/auth';
import { initAuth, signIn, signOut, type SignedInActor } from '../../lib/auth';

/**
 * Sign-in control.
 *
 * Renders nothing unless Entra sign-in is configured, so the in-browser demo
 * (which uses the role selector as its identity) is unchanged.
 */
export function SignInStatus() {
  const [actor, setActor] = useState<SignedInActor | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!authEnabled()) {
      setReady(true);
      return;
    }
    let cancelled = false;
    initAuth()
      .then((a) => {
        if (!cancelled) setActor(a);
      })
      .catch(() => {
        /* surfaced on the next interactive sign-in attempt */
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!authEnabled() || !ready) return null;

  if (!actor) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => void signIn()}>
        Sign in
      </button>
    );
  }

  return (
    <div className="topbar-user">
      <span className="avatar" aria-hidden="true">
        {actor.displayName.charAt(0)}
      </span>
      <span className="topbar-user-name">{actor.displayName}</span>
      <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}
