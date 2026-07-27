import { useState } from 'react';
import { useStudio } from '../store/StudioContext';
import type { Locale, PronunciationEntry } from '@studio/domain';
import { SUPPORTED_LOCALES } from '@studio/domain';
import { Badge, type BadgeTone } from '../components/common/Badge';

const STATUS_TONE: Record<PronunciationEntry['approvalStatus'], BadgeTone> = {
  draft: 'neutral',
  'in-review': 'warn',
  approved: 'ok',
  rejected: 'error',
};

export function PronunciationLibrary() {
  const { pronunciationEntries, addPronunciation, setPronunciationStatus } = useStudio();
  const [q, setQ] = useState('');
  const [showGolden, setShowGolden] = useState(false);
  const [form, setForm] = useState({ canonicalForm: '', spokenForm: '', ipa: '', locale: 'de-DE' as Locale, therapeuticArea: '', rationale: '' });

  const filtered = pronunciationEntries.filter(
    (e) =>
      (!showGolden || e.inGoldenSet) &&
      (q === '' || e.canonicalForm.toLowerCase().includes(q.toLowerCase()) || e.tags.some((t) => t.includes(q.toLowerCase()))),
  );

  function submit() {
    if (!form.canonicalForm.trim()) return;
    addPronunciation({
      canonicalForm: form.canonicalForm.trim(),
      locale: form.locale,
      spokenForm: form.spokenForm || null,
      ipa: form.ipa || null,
      phonemeAlphabet: form.ipa ? 'ipa' : null,
      audioReferencePath: null,
      therapeuticArea: form.therapeuticArea || null,
      tags: [],
      approvalStatus: 'draft',
      rationale: form.rationale || null,
      inGoldenSet: false,
    });
    setForm({ canonicalForm: '', spokenForm: '', ipa: '', locale: form.locale, therapeuticArea: '', rationale: '' });
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">Versioned organization glossary</span>
          <h2 className="page-title">Pronunciation library</h2>
          <p className="page-sub">
            Candidate terms are seeded for review — never as authoritative pronunciations. Each entry
            carries provenance and an approval state, and can join the golden regression set.
          </p>
        </div>
      </div>

      <div className="ws-layout">
        <div className="ws-main stack">
          <section className="panel panel-pad stack">
            <div className="spread">
              <input className="input" style={{ maxWidth: 320 }} placeholder="Search terms or tags…" value={q} onChange={(e) => setQ(e.target.value)} />
              <label className="row" style={{ gap: 6, fontSize: 'var(--fs-sm)' }}>
                <input type="checkbox" checked={showGolden} onChange={(e) => setShowGolden(e.target.checked)} /> Golden set only
              </label>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Term</th>
                  <th>Locale</th>
                  <th>Sounds like / IPA</th>
                  <th>Status</th>
                  <th>Golden</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.canonicalForm}</strong>
                      {e.therapeuticArea && <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{e.therapeuticArea}</div>}
                    </td>
                    <td className="mono">{e.locale}</td>
                    <td>
                      {e.spokenForm && <div>{e.spokenForm}</div>}
                      {e.ipa && <div className="mono muted" style={{ fontSize: 'var(--fs-xs)' }}>/{e.ipa}/</div>}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[e.approvalStatus]}>{e.approvalStatus}</Badge>
                    </td>
                    <td>{e.inGoldenSet ? '★' : '—'}</td>
                    <td>
                      {e.approvalStatus !== 'approved' && (
                        <button className="btn btn-sm" onClick={() => setPronunciationStatus(e.id, 'approved')}>
                          Approve
                        </button>
                      )}
                      {e.approvalStatus !== 'rejected' && (
                        <button className="btn btn-sm btn-ghost" onClick={() => setPronunciationStatus(e.id, 'rejected')}>
                          Reject
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <aside className="inspector panel panel-pad stack">
          <h3 className="inspector-title">Add candidate</h3>
          <div className="field">
            <label htmlFor="pl-term">Canonical written form</label>
            <input id="pl-term" className="input" value={form.canonicalForm} onChange={(e) => setForm({ ...form, canonicalForm: e.target.value })} placeholder="e.g. Nirmatrelvir" />
          </div>
          <div className="field">
            <label htmlFor="pl-locale">Locale</label>
            <select id="pl-locale" className="select" value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value as Locale })}>
              {SUPPORTED_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pl-spoken">Sounds like</label>
            <input id="pl-spoken" className="input" value={form.spokenForm} onChange={(e) => setForm({ ...form, spokenForm: e.target.value })} placeholder="Nir-MA-trel-vir" />
          </div>
          <div className="field">
            <label htmlFor="pl-ipa">IPA (expert, optional)</label>
            <input id="pl-ipa" className="input mono" value={form.ipa} onChange={(e) => setForm({ ...form, ipa: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pl-ta">Therapeutic area</label>
            <input id="pl-ta" className="input" value={form.therapeuticArea} onChange={(e) => setForm({ ...form, therapeuticArea: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pl-rat">Source / rationale (provenance)</label>
            <textarea id="pl-rat" className="textarea" value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} placeholder="Why this pronunciation? Cite a source or reviewer." />
          </div>
          <button className="btn btn-primary" onClick={submit} disabled={!form.canonicalForm.trim()}>
            Add as draft
          </button>
        </aside>
      </div>
    </div>
  );
}
