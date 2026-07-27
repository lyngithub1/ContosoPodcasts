import { useMemo, useState } from 'react';
import { useStudio } from '../../store/StudioContext';
import type { DeliveryChannel, Project } from '@studio/domain';
import { Badge } from '../../components/common/Badge';
import { branding } from '../../config/branding';

export function PublishView({ project }: { project: Project }) {
  const { audioVersions, sources, scripts, recipients, distributionLists, publications, deliveryReceipts, activeRole, publish } = useStudio();
  const audio = audioVersions.find((a) => a.projectId === project.id);
  const script = scripts.find((s) => s.projectId === project.id);
  const acceptedSources = sources.filter((s) => s.projectId === project.id && s.status === 'accepted');

  const [channel, setChannel] = useState<DeliveryChannel>('secure-email');
  const [listId, setListId] = useState<string>('');
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [expiryDays, setExpiryDays] = useState(30);
  const [confirming, setConfirming] = useState(false);

  const chosenRecipientIds = useMemo(() => {
    if (listId) {
      const list = distributionLists.find((l) => l.id === listId);
      return list?.recipientIds ?? [];
    }
    return selectedRecipients;
  }, [listId, selectedRecipients, distributionLists]);

  const chosen = recipients.filter((r) => chosenRecipientIds.includes(r.id));
  const hasExternal = chosen.some((r) => r.isExternal);
  const isPublisher = activeRole === 'Publisher' || activeRole === 'Administrator';
  const projectPubs = publications.filter((p) => p.projectId === project.id);

  const ready = project.state === 'READY_TO_PUBLISH' || project.state === 'PUBLISHED';
  const externalBlocked = hasExternal && !isPublisher;
  const canPublish = ready && audio && script && chosen.length > 0 && !externalBlocked && project.state !== 'PUBLISHED';

  if (!audio || !script) {
    return (
      <div className="panel panel-pad">
        <h3>Publication</h3>
        <p className="muted">Approved audio is required before publication.</p>
      </div>
    );
  }

  function doPublish() {
    publish({
      projectId: project.id,
      audioVersionId: audio!.id,
      scriptVersionId: script!.id,
      channel,
      recipientIds: chosenRecipientIds,
      disclosureStatement: branding.spokenDisclosure,
      acceptedSourceIds: acceptedSources.map((s) => s.id),
      expiresAt: channel === 'internal-link' ? null : new Date(Date.now() + expiryDays * 86400000).toISOString(),
    });
    setConfirming(false);
  }

  return (
    <div className="ws-layout">
      <div className="ws-main stack">
        <div className={`gate ${project.state === 'PUBLISHED' ? 'ready' : ready ? 'ready' : 'blocked'}`}>
          <span aria-hidden="true">{project.state === 'PUBLISHED' ? '📡' : ready ? '✓' : '⚠'}</span>
          <span>
            {project.state === 'PUBLISHED'
              ? 'Published. This version is immutable; corrections create a new version.'
              : ready
                ? 'Audio approved, disclosure ready. Review recipients and publish.'
                : 'Publication is disabled until audio approval and checks pass.'}
          </span>
        </div>

        <section className="panel panel-pad stack">
          <h3>Publication review</h3>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Episode">{script.title}</Field>
            <Field label="Version / hash">v{audio.version} · {audio.contentHash.slice(0, 16)}…</Field>
            <Field label="Publisher">{project.state === 'PUBLISHED' && projectPubs[0] ? projectPubs[0].publishedBy.displayName : 'You (on publish)'}</Field>
            <Field label="Duration / loudness">{Math.round(audio.durationSeconds / 60)} min · {audio.loudnessLufs} LUFS</Field>
          </div>

          <div className="waveform" aria-label="Approved episode waveform">
            {Array.from({ length: 70 }).map((_, i) => (
              <span key={i} className="wave-bar" style={{ height: `${18 + Math.abs(Math.cos(i * 0.4)) * 78}%` }} />
            ))}
          </div>
          <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }}>▶ Play approved episode</button>

          <div>
            <div className="eyebrow">Disclosure statement</div>
            <p className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>{branding.spokenDisclosure}</p>
          </div>

          <div>
            <div className="eyebrow">Accepted sources ({acceptedSources.length})</div>
            <ul className="warn-list" style={{ color: 'var(--text-secondary)' }}>
              {acceptedSources.map((s) => (
                <li key={s.id} style={{ color: 'var(--text-secondary)' }}>
                  {s.title} {s.doi ? `· DOI ${s.doi}` : ''}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {projectPubs.length > 0 && (
          <section className="panel panel-pad stack">
            <h3>Delivery receipts</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Idempotency key</th>
                </tr>
              </thead>
              <tbody>
                {deliveryReceipts
                  .filter((r) => projectPubs.some((p) => p.id === r.publicationId))
                  .map((r) => (
                    <tr key={r.id}>
                      <td>{recipients.find((x) => x.id === r.recipientId)?.displayName ?? r.recipientId}</td>
                      <td>{r.channel}</td>
                      <td>
                        <Badge tone={r.status === 'delivered' ? 'ok' : r.status === 'failed' ? 'error' : 'warn'}>{r.status}</Badge>
                      </td>
                      <td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{r.idempotencyKey.slice(0, 20)}…</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <aside className="inspector panel panel-pad stack">
        <h3 className="inspector-title">Recipients & delivery</h3>

        <div className="field">
          <label htmlFor="pub-list">Use a distribution list</label>
          <select id="pub-list" className="select" value={listId} onChange={(e) => { setListId(e.target.value); setSelectedRecipients([]); }}>
            <option value="">(choose recipients manually)</option>
            {distributionLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.recipientIds.length}){l.containsExternal ? ' · external' : ''}
              </option>
            ))}
          </select>
        </div>

        {!listId && (
          <div>
            <div className="eyebrow">Recipients</div>
            <div className="stack" style={{ gap: 4, marginTop: 6 }}>
              {recipients.map((r) => (
                <label key={r.id} className="row" style={{ gap: 8, fontSize: 'var(--fs-sm)' }}>
                  <input
                    type="checkbox"
                    checked={selectedRecipients.includes(r.id)}
                    onChange={(e) => setSelectedRecipients((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((x) => x !== r.id)))}
                  />
                  <span>{r.displayName}</span>
                  {r.isExternal && <Badge tone="warn">external</Badge>}
                </label>
              ))}
            </div>
          </div>
        )}

        {hasExternal && (
          <div className={`gate ${isPublisher ? 'ready' : 'blocked'}`} style={{ marginBottom: 0 }}>
            <span aria-hidden="true">{isPublisher ? '✓' : '⚠'}</span>
            <span style={{ fontSize: 'var(--fs-sm)' }}>
              External recipients require the Publisher role. {isPublisher ? 'Approved.' : 'Switch to Publisher in the top bar.'}
            </span>
          </div>
        )}

        <div className="field">
          <label htmlFor="pub-channel">Delivery channel</label>
          <select id="pub-channel" className="select" value={channel} onChange={(e) => setChannel(e.target.value as DeliveryChannel)}>
            <option value="secure-email">Secure email (time-limited authenticated link)</option>
            <option value="internal-link">Internal sharing link</option>
            <option value="webhook-api">Webhook / API adapter</option>
          </select>
        </div>

        {channel !== 'internal-link' && (
          <div className="field">
            <label htmlFor="pub-exp">Link expiry: {expiryDays} days</label>
            <input id="pub-exp" className="slider" type="range" min={1} max={90} value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value))} />
          </div>
        )}

        <hr className="hr" />
        {!confirming ? (
          <button className="btn btn-primary" disabled={!canPublish} onClick={() => setConfirming(true)}>
            Publish…
          </button>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <div className="gate ready" style={{ marginBottom: 0 }}>
              <span aria-hidden="true">📡</span>
              <span style={{ fontSize: 'var(--fs-sm)' }}>
                Publish “{script.title}” to {chosen.length} recipient(s) via {channel}? This action is explicit and idempotent.
              </span>
            </div>
            <button className="btn btn-primary" onClick={doPublish}>
              Confirm & publish
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        )}
        {project.state === 'PUBLISHED' && <Badge tone="ok">Published</Badge>}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="secondary" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
        {children}
      </div>
    </div>
  );
}
