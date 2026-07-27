import { useStudio } from '../../store/StudioContext';

const ICON: Record<string, string> = { ok: '✓', warn: '⚠', error: '✕', info: 'ℹ' };
const TONE: Record<string, string> = { ok: 'badge-ok', warn: 'badge-warn', error: 'badge-error', info: 'badge-info' };

export function NotificationHost() {
  const { notifications, dismissNotification } = useStudio();
  if (notifications.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {notifications.map((n) => (
        <div key={n.id} className={`toast ${TONE[n.kind]}`}>
          <span className="toast-icon" aria-hidden="true">
            {ICON[n.kind]}
          </span>
          <span className="toast-msg">{n.message}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => dismissNotification(n.id)}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
