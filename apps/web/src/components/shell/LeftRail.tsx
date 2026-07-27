import { NavLink } from 'react-router-dom';
import { branding } from '../../config/branding';
import { useStudio } from '../../store/StudioContext';

const NAV = [
  { to: '/', label: 'Projects', icon: '◧', end: true },
  { to: '/templates', label: 'Templates', icon: '▤' },
  { to: '/pronunciation', label: 'Pronunciation library', icon: '🗣' },
  { to: '/recipients', label: 'Recipient lists', icon: '👤' },
  { to: '/audit', label: 'Audit trail', icon: '📜' },
  { to: '/admin', label: 'Admin', icon: '⚙' },
];

export function LeftRail() {
  const { backendStatus } = useStudio();
  const env =
    backendStatus === 'connected'
      ? { badge: 'badge-ok', label: 'Connected · Azure backend' }
      : backendStatus === 'checking'
        ? { badge: 'badge-info', label: 'Connecting to backend…' }
        : { badge: 'badge-warn', label: 'Demo · local (no backend)' };
  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-brand">
        <span className="rail-logo" aria-hidden="true">
          {branding.logoGlyph}
        </span>
        <span className="rail-brand-text">
          <strong>{branding.shortName}</strong>
          <small className="muted">{branding.vendor}</small>
        </span>
      </div>

      <ul className="rail-nav">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}
            >
              <span className="rail-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="rail-footer">
        <div className="eyebrow">Environment</div>
        <div className="row" style={{ marginTop: 6 }}>
          <span className={`badge ${env.badge}`}>
            <span className="dot" aria-hidden="true" /> {env.label}
          </span>
        </div>
      </div>
    </nav>
  );
}
