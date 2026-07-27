import { useStudio } from '../../store/StudioContext';
import { ALL_ROLES } from '../../data/actors';
import { authEnabled } from '../../config/auth';
import { SignInStatus } from './SignInStatus';
import type { AppRole } from '@studio/domain';

export function TopBar() {
  const { activeRole, setActiveRole, currentUser } = useStudio();
  const heldRoles = currentUser.roles;
  const usingEntra = authEnabled();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="eyebrow">Azure Scientific Podcast Studio</span>
        <h1 className="topbar-title">Production workspace</h1>
      </div>

      <div className="topbar-right">
        <label className="topbar-role">
          <span className="sr-only">Active role</span>
          <span className="muted" aria-hidden="true">
            {usingEntra ? 'Viewing as' : 'Acting as'}
          </span>
          <select
            className="select topbar-select"
            value={activeRole}
            onChange={(e) => setActiveRole(e.target.value as AppRole)}
            aria-label="Active role"
          >
            {ALL_ROLES.map((r) => (
              <option key={r} value={r} disabled={!heldRoles.includes(r)}>
                {r}
                {heldRoles.includes(r) ? '' : ' (not assigned)'}
              </option>
            ))}
          </select>
        </label>

        {usingEntra ? (
          <SignInStatus />
        ) : (
          <div className="topbar-user">
            <span className="avatar" aria-hidden="true">
              {currentUser.displayName.charAt(0)}
            </span>
            <span className="topbar-user-name">{currentUser.displayName}</span>
          </div>
        )}
      </div>
    </header>
  );
}
