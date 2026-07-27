import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SUPPORTED_LOCALES, type Locale, type ResearchType, type ScriptForm } from '@studio/domain';
import { useStudio } from '../store/StudioContext';
import { apiEnabled } from '../config/api';
import { extractText } from '../lib/apiClient';
import { parseChunk, splitScriptVersions } from '../lib/scriptImport';

const RESEARCH_TYPES: { value: ResearchType; label: string }[] = [
  { value: 'peer-reviewed', label: 'Peer-reviewed journal articles' },
  { value: 'systematic-review', label: 'Systematic reviews / meta-analyses' },
  { value: 'clinical-trial-registry', label: 'Clinical-trial registries' },
  { value: 'regulatory', label: 'Regulatory / health-authority publications' },
  { value: 'conference-abstract', label: 'Conference abstracts' },
  { value: 'org-document', label: 'Approved organization documents' },
  { value: 'uploaded-document', label: 'Uploaded PDF/DOCX/PPTX/TXT/HTML' },
  { value: 'approved-website', label: 'Approved websites' },
  { value: 'identifier', label: 'DOI / PMID / URL / repository identifier' },
];

const SCRIPT_FORMS: { value: ScriptForm; label: string }[] = [
  { value: 'plain-narration', label: 'Plain single-narrator' },
  { value: 'structured-narration', label: 'Structured narrator with delivery cues' },
  { value: 'host-expert', label: 'Host / expert discussion' },
  { value: 'custom-template', label: 'Configurable custom template' },
];

/** File extensions we can read directly in the browser as text. */
const TEXT_EXT = /\.(txt|md|markdown|html?|rtf|vtt|srt|csv)$/i;

type Mode = 'research' | 'upload';

export function NewProject() {
  const navigate = useNavigate();
  const { createProject, createProjectFromScript, currentUser, activeRole, notify } = useStudio();

  const [mode, setMode] = useState<Mode>('research');

  // Shared fields (both modes)
  const [title, setTitle] = useState('');
  const [locale, setLocale] = useState<Locale>('de-DE');
  const [therapeuticArea, setTherapeuticArea] = useState('');

  // Research-mode fields
  const [topic, setTopic] = useState('');
  const [miniPrompt, setMiniPrompt] = useState('');
  const [scriptForm, setScriptForm] = useState<ScriptForm>('structured-narration');
  const [duration, setDuration] = useState(6);
  const [types, setTypes] = useState<ResearchType[]>(['peer-reviewed', 'clinical-trial-registry']);
  const [peerOnly, setPeerOnly] = useState(true);
  const [urls, setUrls] = useState('');

  // Upload-mode fields
  const [rawText, setRawText] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [formOverride, setFormOverride] = useState<ScriptForm | ''>('');
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSubmit = title.trim() && topic.trim() && miniPrompt.trim() && types.length > 0;

  const plan = useMemo(() => {
    const domains = urls
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return u;
        }
      });
    return {
      queries: [topic, miniPrompt].filter(Boolean),
      types,
      policy: peerOnly ? 'Peer-reviewed only; exclude non-allowlisted domains' : 'Include preprints (labeled)',
      domains,
    };
  }, [topic, miniPrompt, types, peerOnly, urls]);

  // Split the uploaded/pasted text into its labelled versions (the sample PDF
  // bundles three), then parse the selected one — honouring a form override.
  const chunks = useMemo(() => (rawText.trim() ? splitScriptVersions(rawText) : []), [rawText]);
  const activeChunk = chunks[Math.min(selectedIdx, Math.max(0, chunks.length - 1))];
  const parsed = useMemo(() => {
    if (!activeChunk) return null;
    return parseChunk(activeChunk.text, {
      label: activeChunk.label,
      ...(formOverride ? { forceForm: formOverride } : {}),
    });
  }, [activeChunk, formOverride]);

  // Prefill the project title from the script's own title, if the user hasn't typed one.
  useEffect(() => {
    if (parsed?.title && !title.trim()) setTitle(parsed.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  const canSubmitUpload = Boolean(title.trim()) && Boolean(parsed) && (parsed?.segments.length ?? 0) > 0;

  function toggleType(t: ResearchType) {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function submit() {
    if (!canSubmit) return;
    const project = createProject({
      title,
      topic,
      miniPrompt,
      outputLocale: locale,
      scriptForm,
      therapeuticArea: therapeuticArea || 'General',
      audience: 'clinician',
      targetDurationMinutes: duration,
      tags: [therapeuticArea || 'general', locale],
    });
    navigate(`/projects/${project.id}/research`);
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setSourceName(file.name);
    setSelectedIdx(0);
    setFormOverride('');
    // Text-like files read directly in the browser — no backend needed.
    if (file.type.startsWith('text/') || TEXT_EXT.test(file.name)) {
      setRawText(await file.text());
      return;
    }
    // PDF / DOCX / images need Document Intelligence on the connected backend.
    if (!apiEnabled()) {
      notify(
        'warn',
        'PDF/DOCX text extraction needs the connected backend. Copy the script text and paste it below instead.',
      );
      return;
    }
    setExtracting(true);
    try {
      const actor = { id: currentUser.id, name: currentUser.displayName, roles: [activeRole] };
      const res = await extractText(file, actor);
      if (res.ok && res.text) {
        setRawText(res.text);
        notify(
          'ok',
          `Extracted ${res.text.length.toLocaleString()} characters${res.pages ? ` from ${res.pages} page(s)` : ''} with Document Intelligence.`,
        );
      } else {
        notify(
          'error',
          res.error === 'offline'
            ? 'Extraction needs the connected backend. Paste the script text instead.'
            : `Could not extract text (${res.error ?? 'unknown error'}). Paste the script text instead.`,
        );
      }
    } finally {
      setExtracting(false);
    }
  }

  function submitUpload() {
    if (!canSubmitUpload || !parsed) return;
    const project = createProjectFromScript({
      title: title.trim(),
      outputLocale: locale,
      therapeuticArea: therapeuticArea || 'General',
      audience: 'clinician',
      sourceName: sourceName || 'Pasted text',
      script: parsed,
    });
    navigate(`/projects/${project.id}/script`);
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <span className="eyebrow">New production</span>
          <h2 className="page-title">Create a project</h2>
          <p className="page-sub">
            {mode === 'research'
              ? "Describe your topic and research question. You'll review an editable research plan before any acquisition begins — nothing runs until you approve it."
              : 'Already have a finished script? Upload or paste it. It becomes a Script draft you and your reviewers can shape, voice, and publish — the research and evidence steps are skipped.'}
          </p>
        </div>
      </div>

      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        <button
          role="tab"
          aria-selected={mode === 'research'}
          className={`tab${mode === 'research' ? ' active' : ''}`}
          onClick={() => setMode('research')}
        >
          Research a topic
        </button>
        <button
          role="tab"
          aria-selected={mode === 'upload'}
          className={`tab${mode === 'upload' ? ' active' : ''}`}
          onClick={() => setMode('upload')}
        >
          Upload a script
        </button>
      </div>

      {mode === 'research' ? (
        <div className="ws-layout">
          <div className="ws-main stack">
            <section className="panel panel-pad stack">
              <h3>Project &amp; research intent</h3>
              <div className="field">
                <label htmlFor="np-title">Project title</label>
                <input id="np-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. HIV-1 two-drug regimen briefing" />
              </div>
              <div className="field">
                <label htmlFor="np-topic">Short scientific topic</label>
                <input id="np-topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Doravirine/Islatravir vs. B/F/TAF" />
              </div>
              <div className="field">
                <label htmlFor="np-prompt">Mini-prompt (research question)</label>
                <textarea id="np-prompt" className="textarea" value={miniPrompt} onChange={(e) => setMiniPrompt(e.target.value)} placeholder="Describe the intended research question and what the episode should cover." />
              </div>
            </section>

            <section className="panel panel-pad stack">
              <h3>Research types</h3>
              <div className="pill-list">
                {RESEARCH_TYPES.map((t) => (
                  <button key={t.value} className={`chip${types.includes(t.value) ? ' active' : ''}`} onClick={() => toggleType(t.value)} aria-pressed={types.includes(t.value)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="np-urls">Add URLs / identifiers (DOI, PMID) — comma or space separated</label>
                <textarea id="np-urls" className="textarea" value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://clinicaltrials.gov/study/NCT04233879  10.1056/NEJMoa-DEMO" />
              </div>
              <label className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={peerOnly} onChange={(e) => setPeerOnly(e.target.checked)} />
                <span>Peer-reviewed only (exclude non-allowlisted domains)</span>
              </label>
            </section>

            <section className="panel panel-pad stack">
              <h3>Output &amp; format</h3>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="field">
                  <label htmlFor="np-locale">Output language &amp; locale</label>
                  <select id="np-locale" className="select" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                    {SUPPORTED_LOCALES.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="np-form">Script form</label>
                  <select id="np-form" className="select" value={scriptForm} onChange={(e) => setScriptForm(e.target.value as ScriptForm)}>
                    {SCRIPT_FORMS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="np-ta">Therapeutic area</label>
                  <input id="np-ta" className="input" value={therapeuticArea} onChange={(e) => setTherapeuticArea(e.target.value)} placeholder="e.g. Infectious disease / HIV" />
                </div>
                <div className="field">
                  <label htmlFor="np-dur">Target duration: {duration} min</label>
                  <input id="np-dur" className="slider" type="range" min={2} max={20} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                </div>
              </div>
            </section>
          </div>

          <aside className="inspector panel panel-pad stack">
            <h3 className="inspector-title">Research plan preview</h3>
            <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              Review before acquisition. You&apos;ll be able to edit queries, filters, and domains on the
              next screen.
            </p>
            <div>
              <div className="eyebrow">Queries</div>
              <ul className="warn-list" style={{ color: 'var(--text-secondary)' }}>
                {plan.queries.length ? plan.queries.map((q, i) => <li key={i} style={{ color: 'var(--text-secondary)' }}>{q}</li>) : <li className="muted">—</li>}
              </ul>
            </div>
            <div>
              <div className="eyebrow">Source categories</div>
              <div className="tag-row">
                {plan.types.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="eyebrow">Policy</div>
              <p className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>{plan.policy}</p>
            </div>
            <div>
              <div className="eyebrow">Domains</div>
              <div className="tag-row">
                {plan.domains.length ? plan.domains.map((d, i) => <span key={i} className="tag">{d}</span>) : <span className="muted">Allowlist only</span>}
              </div>
            </div>
            <hr className="hr" />
            <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
              Create project &amp; review plan
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/')}>
              Cancel
            </button>
          </aside>
        </div>
      ) : (
        <div className="ws-layout">
          <div className="ws-main stack">
            <section className="panel panel-pad stack">
              <h3>Upload or paste the script</h3>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                Supported shapes: plain single-narrator, structured narration with{' '}
                <span className="mono">[bracketed]</span> delivery cues, and Host/Expert dialogue
                (<span className="mono">H:</span> / <span className="mono">E:</span> turns). If the file
                bundles several versions, you&apos;ll pick one below.
              </p>
              <div className="field">
                <label htmlFor="up-file">Script file</label>
                <input
                  id="up-file"
                  ref={fileRef}
                  className="input"
                  type="file"
                  accept=".txt,.md,.markdown,.html,.htm,.rtf,.vtt,.srt,.csv,.pdf,.docx,.doc,.png,.jpg,.jpeg,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  disabled={extracting}
                  onChange={(e) => void onPickFile(e.target.files?.[0])}
                />
                <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 6 }}>
                  {extracting
                    ? 'Extracting text with Azure AI Document Intelligence…'
                    : apiEnabled()
                      ? 'Text files parse instantly in your browser. PDF/DOCX/images are extracted server-side with Document Intelligence.'
                      : 'Offline: text files (.txt/.md/.html) parse in your browser. PDF/DOCX need the connected backend — paste the text instead.'}
                </p>
              </div>
              <div className="field">
                <label htmlFor="up-paste">…or paste the script text</label>
                <textarea
                  id="up-paste"
                  className="textarea"
                  style={{ minHeight: 180 }}
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setSelectedIdx(0);
                    setFormOverride('');
                    if (!sourceName || sourceName === 'Pasted text') setSourceName('Pasted text');
                  }}
                  placeholder={'Titel: …\n\n[Intro – calm, deliberate]\nWelcome to this episode…\n\nH: Welcome…\nE: Today we discuss…'}
                />
              </div>
              {chunks.length > 1 ? (
                <div className="field">
                  <label htmlFor="up-version">This document bundles {chunks.length} versions — import which one?</label>
                  <select
                    id="up-version"
                    className="select"
                    value={selectedIdx}
                    onChange={(e) => {
                      setSelectedIdx(Number(e.target.value));
                      setFormOverride('');
                    }}
                  >
                    {chunks.map((c, i) => (
                      <option key={i} value={i}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </section>

            <section className="panel panel-pad stack">
              <h3>Output &amp; format</h3>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="field">
                  <label htmlFor="up-title">Project title</label>
                  <input id="up-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. HIV-1 two-drug regimen briefing" />
                </div>
                <div className="field">
                  <label htmlFor="up-locale">Output language &amp; locale</label>
                  <select id="up-locale" className="select" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                    {SUPPORTED_LOCALES.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="up-form">Script form {parsed ? '(auto-detected — override if needed)' : ''}</label>
                  <select
                    id="up-form"
                    className="select"
                    value={formOverride || parsed?.form || 'structured-narration'}
                    disabled={!parsed}
                    onChange={(e) => setFormOverride(e.target.value as ScriptForm)}
                  >
                    {SCRIPT_FORMS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="up-ta">Therapeutic area</label>
                  <input id="up-ta" className="input" value={therapeuticArea} onChange={(e) => setTherapeuticArea(e.target.value)} placeholder="e.g. Infectious disease / HIV" />
                </div>
              </div>
            </section>
          </div>

          <aside className="inspector panel panel-pad stack">
            <h3 className="inspector-title">Parsed script</h3>
            {parsed ? (
              <>
                <div className="tag-row">
                  <span className="tag">{parsed.form}</span>
                  <span className="tag">{parsed.segments.length} segment(s)</span>
                  {parsed.speakers.length ? <span className="tag">{parsed.speakers.length} speaker(s)</span> : null}
                  <span className="tag">~{Math.max(1, Math.round(parsed.estimatedDurationSeconds / 60))} min</span>
                </div>
                {parsed.speakers.length ? (
                  <div>
                    <div className="eyebrow">Speakers</div>
                    <div className="tag-row">
                      {parsed.speakers.map((s) => (
                        <span key={s.id} className="tag">
                          {s.label} · {s.role}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="eyebrow">Preview</div>
                  <ul className="warn-list" style={{ color: 'var(--text-secondary)' }}>
                    {parsed.segments.slice(0, 4).map((seg, i) => (
                      <li key={i} style={{ color: 'var(--text-secondary)' }}>
                        {seg.heading ? <strong>{seg.heading}: </strong> : null}
                        {seg.text.length > 140 ? `${seg.text.slice(0, 140)}…` : seg.text}
                      </li>
                    ))}
                    {parsed.segments.length > 4 ? (
                      <li className="muted">+{parsed.segments.length - 4} more segment(s)…</li>
                    ) : null}
                  </ul>
                </div>
                <div className="gate blocked" style={{ fontSize: 'var(--fs-xs)', marginBottom: 0 }}>
                  <span>
                    Parsed locally with a deterministic heuristic — no AI. It is imported as an{' '}
                    <strong>ungrounded Script draft</strong>: claims are not yet mapped to evidence, so
                    reviewers must validate accuracy before approval.
                  </span>
                </div>
              </>
            ) : (
              <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                Upload a file or paste text to see the parsed script here.
              </p>
            )}
            <hr className="hr" />
            <button className="btn btn-primary" disabled={!canSubmitUpload} onClick={submitUpload}>
              Create project from script
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/')}>
              Cancel
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
