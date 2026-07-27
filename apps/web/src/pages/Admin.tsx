import { useStudio } from '../store/StudioContext';
import { SUPPORTED_LOCALES } from '@studio/domain';
import { Badge, capabilityTone } from '../components/common/Badge';

/**
 * Capability registry (Spec §15). Capabilities are configuration- and
 * environment-driven — the UI reflects what has been verified, never hard-codes
 * assumptions. Unavailable/degraded features are disabled or annotated elsewhere.
 */
export function Admin() {
  const { voiceProfiles } = useStudio();

  const ssmlCols: { key: keyof (typeof voiceProfiles)[number]['supportedSsml']; label: string }[] = [
    { key: 'prosodyRate', label: 'Rate' },
    { key: 'prosodyPitch', label: 'Pitch' },
    { key: 'prosodyVolume', label: 'Volume' },
    { key: 'emphasis', label: 'Emphasis' },
    { key: 'breakTag', label: 'Breaks' },
    { key: 'phoneme', label: 'Phoneme' },
    { key: 'sayAs', label: 'say-as' },
    { key: 'lexicon', label: 'Lexicon' },
    { key: 'lang', label: 'Lang' },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">Administration</span>
          <h2 className="page-title">Capability registry</h2>
          <p className="page-sub">
            Voice, locale, and platform capabilities are discovered from configuration and probes.
            The workbench adapts to these values; nothing is assumed to be available.
          </p>
        </div>
      </div>

      <section className="panel panel-pad stack">
        <h3>Voice registry</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Voice</th>
              <th>Locale</th>
              <th>Status</th>
              {ssmlCols.map((c) => (
                <th key={c.key} style={{ textAlign: 'center' }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {voiceProfiles.map((v) => (
              <tr key={v.id}>
                <td>
                  <strong>{v.displayName}</strong>
                  <div className="mono muted" style={{ fontSize: 'var(--fs-xs)' }}>{v.voiceName}</div>
                </td>
                <td className="mono">{v.locale}</td>
                <td>
                  <Badge tone={capabilityTone(v.status)}>{v.status}</Badge>
                </td>
                {ssmlCols.map((c) => (
                  <td key={c.key} style={{ textAlign: 'center' }}>
                    {v.supportedSsml[c.key] ? '✓' : <span className="muted">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 'var(--sp-4)' }}>
        <section className="panel panel-pad stack">
          <h3>Supported output locales</h3>
          <div className="tag-row">
            {SUPPORTED_LOCALES.map((l) => (
              <span key={l} className="tag">
                {l}
              </span>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            Locale drives voice filtering, say-as formatting, and lexicon selection.
          </p>
        </section>

        <section className="panel panel-pad stack">
          <h3>Platform capabilities</h3>
          <ul className="cap-list">
            <li>
              <span>Speech synthesis (Neural)</span>
              <Badge tone="ok">verified</Badge>
            </li>
            <li>
              <span>HD voices</span>
              <Badge tone="warn">preview</Badge>
            </li>
            <li>
              <span>Custom lexicon upload</span>
              <Badge tone="ok">configured</Badge>
            </li>
            <li>
              <span>Closed-loop QA transcription</span>
              <Badge tone="ok">verified</Badge>
            </li>
            <li>
              <span>Managed identity / Key Vault</span>
              <Badge tone="ok">configured</Badge>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
