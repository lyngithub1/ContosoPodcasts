import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  authorizeTransition,
  type AppRole,
  type AuditEvent,
  type Locale,
  type Project,
  type PronunciationEntry,
  type Recipient,
  type ReviewDecision,
  type ScriptSegment,
  type ScriptVersion,
  type Speaker,
  type SpeechAnnotation,
  type WorkflowState,
} from '@studio/domain';
import { buildSeed, type SeedData } from '../data/seed';
import type { ParsedScript } from '../lib/scriptImport';
import { currentUser, demoHash } from '../data/actors';
import { apiEnabled } from '../config/api';
import { bootstrap, persist as apiPersist, deleteItem as apiDeleteItem, transition as apiTransition, publishProject as apiPublish, generateScript as apiGenerateScript, synthesizeEpisode as apiSynthesizeEpisode, synthesizeEpisodeAsync as apiSynthesizeEpisodeAsync, runPronunciationQa as apiRunPronunciationQa } from '../lib/apiClient';

export interface Notification {
  id: string;
  kind: 'ok' | 'warn' | 'error' | 'info';
  message: string;
}

interface StudioState extends SeedData {
  activeRole: AppRole;
  notifications: Notification[];
  /** Real connection state, surfaced in the environment indicator. */
  backendStatus: 'checking' | 'connected' | 'local';
}

interface StudioContextValue extends StudioState {
  currentUser: typeof currentUser;
  setActiveRole: (role: AppRole) => void;
  notify: (kind: Notification['kind'], message: string) => void;
  dismissNotification: (id: string) => void;

  getProject: (id: string) => Project | undefined;
  createProject: (input: {
    title: string;
    topic: string;
    miniPrompt: string;
    outputLocale: Locale;
    scriptForm: Project['scriptForm'];
    therapeuticArea: string;
    audience: Project['audience'];
    targetDurationMinutes: number;
    tags: string[];
  }) => Project;
  /**
   * Create a project directly from a finished, uploaded/pasted script. The
   * project starts in `SCRIPT_DRAFT` (research + evidence are skipped) and the
   * parsed script is attached, unapproved and ungrounded, for reviewer control.
   */
  createProjectFromScript: (input: {
    title: string;
    outputLocale: Locale;
    therapeuticArea: string;
    audience: Project['audience'];
    sourceName: string;
    script: ParsedScript;
  }) => Project;
  transitionProject: (projectId: string, to: WorkflowState, reason?: string) => Promise<boolean>;
  setProjectLocale: (projectId: string, locale: Locale) => void;
  /** Permanently remove a project and all of its project-scoped production data. */
  deleteProject: (projectId: string) => void;

  acceptSource: (sourceId: string) => void;
  rejectSource: (sourceId: string, reason: string) => void;

  toggleClaimPinned: (claimId: string) => void;
  toggleClaimExcluded: (claimId: string) => void;

  upsertAnnotation: (scriptId: string, segmentId: string, annotation: SpeechAnnotation) => void;
  removeAnnotation: (scriptId: string, segmentId: string, annotationId: string) => void;
  /** Assign a voice profile to every speaker on a script so the choice carries into render + audio review. */
  setScriptVoice: (scriptId: string, voiceProfileId: string) => void;

  addPronunciation: (entry: Omit<PronunciationEntry, 'id' | 'version' | 'parentVersionId' | 'createdBy' | 'createdAt' | 'modifiedBy' | 'modifiedAt' | 'contentHash' | 'reviewHistory'>) => void;
  setPronunciationStatus: (entryId: string, status: PronunciationEntry['approvalStatus']) => void;

  overrideQaTerm: (reportId: string, term: string, reason: string) => void;

  addReview: (review: Omit<ReviewDecision, 'id' | 'by' | 'at'>) => void;

  addRecipient: (r: Omit<Recipient, 'id'>) => Recipient;
  createDistributionList: (name: string, purpose: string, recipientIds: string[]) => void;

  publish: (input: {
    projectId: string;
    audioVersionId: string;
    scriptVersionId: string;
    channel: 'secure-email' | 'internal-link' | 'webhook-api' | 'onedrive';
    recipientIds: string[];
    disclosureStatement: string;
    acceptedSourceIds: string[];
    expiresAt: string | null;
  }) => void;

  /**
   * Generate a grounded script by running the deployed Foundry
   * podcast-script-generator agent against the project's accepted evidence and
   * claims. Connected-mode only (requires the backend Foundry wiring). Resolves
   * to true when a script was generated and merged.
   */
  generateScript: (projectId: string) => Promise<boolean>;

  /**
   * Render the approved script to a multi-voice preview via Azure AI Speech and
   * store the MP3 in Blob Storage (creates a SynthesisJob + AudioVersion).
   * Connected-mode + Creator only. Resolves true when audio was rendered.
   */
  synthesizeEpisode: (projectId: string) => Promise<boolean>;

  /**
   * Run closed-loop pronunciation QA: re-transcribe the stored preview with
   * Azure AI Speech and compare medical terms to their expected spoken forms.
   * Connected-mode + Creator/AudioReviewer only. Resolves true when a report
   * was produced and merged.
   */
  runPronunciationQa: (projectId: string) => Promise<boolean>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

let notifSeq = 0;
let idSeq = 0;
const gen = (p: string) => `${p}-${Date.now().toString(36)}-${(++idSeq).toString(36)}`;

/** Seed template id that backs each script form (imported scripts reuse them). */
const TEMPLATE_BY_FORM: Record<Project['scriptForm'], string> = {
  'plain-narration': 'tmpl-plain',
  'structured-narration': 'tmpl-structured',
  'host-expert': 'tmpl-host-expert',
  'custom-template': 'tmpl-structured',
};

/** Collections that are persisted to / hydrated from the backend, by state key. */
const MERGE_KEYS = [
  'projects',
  'scripts',
  'passages',
  'reviews',
  'recipients',
  'auditEvents',
  'pronunciationEntries',
  'researchPlans',
  'sources',
  'claims',
  'structuredEvidence',
  'synthesisJobs',
  'audioVersions',
  'qualityReports',
  'distributionLists',
  'publications',
  'deliveryReceipts',
  'voiceProfiles',
  'scriptTemplates',
] as const;

/** Collections that hold project-scoped items (partitioned by projectId), removed
 * when a project is deleted. Global libraries (voiceProfiles, scriptTemplates,
 * pronunciationEntries, recipients) are intentionally excluded. */
const PROJECT_SCOPED_COLLECTIONS = [
  'scripts',
  'passages',
  'reviews',
  'auditEvents',
  'researchPlans',
  'sources',
  'claims',
  'structuredEvidence',
  'synthesisJobs',
  'audioVersions',
  'qualityReports',
  'publications',
  'deliveryReceipts',
] as const;

function mergeById<T extends { id: string }>(seed: ReadonlyArray<T>, incoming: unknown[]): T[] {
  const map = new Map<string, T>();
  for (const item of seed) map.set(item.id, item);
  for (const item of incoming) {
    if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') {
      map.set((item as T).id, item as T);
    }
  }
  return [...map.values()];
}

/** Merge server-persisted collections over the local seed (server wins by id). */
function mergeCollections(state: StudioState, collections: Record<string, unknown[]>): StudioState {
  const next: StudioState = { ...state };
  for (const key of MERGE_KEYS) {
    const incoming = collections[key];
    if (Array.isArray(incoming) && incoming.length > 0) {
      (next as unknown as Record<string, unknown>)[key] = mergeById(
        state[key] as ReadonlyArray<{ id: string }>,
        incoming,
      );
    }
  }
  return next;
}

/**
 * Deleted-project tombstones (localStorage). The seed is re-applied on every
 * load and hydration merges server data *over* it by id — so without a durable
 * record of what was removed, deleting a seed project would resurrect it on the
 * next refresh. We keep the ids here and prune them on load + after hydration.
 */
const DELETED_PROJECTS_KEY = 'podstudio.deletedProjectIds';
function loadDeletedProjectIds(): Set<string> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(DELETED_PROJECTS_KEY) : null;
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}
function saveDeletedProjectIds(ids: Set<string>): void {
  try {
    localStorage.setItem(DELETED_PROJECTS_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore quota / unavailable storage */
  }
}
/** Drop tombstoned projects and their scoped items so deletions survive reloads. */
function pruneDeletedProjects(state: StudioState, deleted: Set<string>): StudioState {
  if (deleted.size === 0) return state;
  const next: StudioState = { ...state, projects: state.projects.filter((p) => !deleted.has(p.id)) };
  for (const key of PROJECT_SCOPED_COLLECTIONS) {
    const arr = state[key] as ReadonlyArray<{ projectId?: string }> | undefined;
    if (Array.isArray(arr)) {
      (next as unknown as Record<string, unknown>)[key] = arr.filter(
        (it) => !it.projectId || !deleted.has(it.projectId),
      );
    }
  }
  return next;
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState>(() =>
    pruneDeletedProjects(
      {
        ...buildSeed(),
        // Default to Administrator so the demo walkthrough runs end-to-end
        // without role switching; switch to a specific role to demo gating.
        activeRole: 'Administrator',
        notifications: [],
        backendStatus: apiEnabled() ? 'checking' : 'local',
      },
      loadDeletedProjectIds(),
    ),
  );

  const notify = useCallback((kind: Notification['kind'], message: string) => {
    const id = `n-${++notifSeq}`;
    setState((s) => ({ ...s, notifications: [...s.notifications, { id, kind, message }] }));
    // Auto-dismiss non-error notifications.
    if (kind !== 'error') {
      setTimeout(() => {
        setState((s) => ({ ...s, notifications: s.notifications.filter((n) => n.id !== id) }));
      }, 4200);
    }
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setState((s) => ({ ...s, notifications: s.notifications.filter((n) => n.id !== id) }));
  }, []);

  // Best-effort persistence: fire-and-forget upsert; warn once if the server is unreachable.
  const persistWarnedRef = useRef(false);
  const persistItem = useCallback(
    (collection: string, item: { id: string }) => {
      if (!apiEnabled()) return;
      void apiPersist(collection, item).then((ok) => {
        if (!ok && !persistWarnedRef.current) {
          persistWarnedRef.current = true;
          notify('warn', 'Working offline — changes are kept locally but not saved to the server.');
        }
      });
    },
    [notify],
  );

  // Hydrate persisted collections from the backend once on mount, merged over
  // the seed. Also (a) seed the global reference libraries into the backend the
  // first time so the render pipeline can resolve voices/templates, and (b)
  // reflect the real connection state for the environment indicator.
  useEffect(() => {
    let cancelled = false;
    void bootstrap().then((boot) => {
      if (cancelled) return;
      if (!boot || !boot.persistence) {
        setState((s) => ({ ...s, backendStatus: 'local' }));
        return;
      }
      // Seed global libraries when the backend has none — the audio render
      // resolves voiceProfileId -> Azure voice name from Cosmos, so without
      // these every render falls back to a single default voice.
      const seed = buildSeed();
      for (const key of ['voiceProfiles', 'scriptTemplates'] as const) {
        const serverItems = boot.collections[key];
        if (!Array.isArray(serverItems) || serverItems.length === 0) {
          for (const item of seed[key]) void apiPersist(key, item);
        }
      }
      const count = Object.values(boot.collections).reduce(
        (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
        0,
      );
      setState((s) => {
        const merged = count === 0 ? s : mergeCollections(s, boot.collections);
        return {
          ...pruneDeletedProjects(merged, loadDeletedProjectIds()),
          backendStatus: 'connected',
        };
      });
      if (count > 0) notify('info', 'Loaded your saved work from the server.');
    });
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const appendAudit = useCallback(
    (e: Omit<AuditEvent, 'id' | 'at' | 'actor'>) => {
      const event: AuditEvent = {
        ...e,
        id: gen('ae'),
        at: new Date().toISOString(),
        actor: currentUser,
      };
      setState((s) => ({ ...s, auditEvents: [event, ...s.auditEvents] }));
      persistItem('auditEvents', event);
    },
    [persistItem],
  );

  const setActiveRole = useCallback((role: AppRole) => {
    setState((s) => ({ ...s, activeRole: role }));
  }, []);

  const getProject = useCallback((id: string) => state.projects.find((p) => p.id === id), [state.projects]);

  const createProject = useCallback<StudioContextValue['createProject']>(
    (input) => {
      const now = new Date().toISOString();
      const project: Project = {
        id: gen('proj'),
        version: 1,
        parentVersionId: null,
        createdBy: currentUser,
        createdAt: now,
        modifiedBy: currentUser,
        modifiedAt: now,
        contentHash: demoHash(input.title + input.topic),
        title: input.title,
        topic: input.topic,
        miniPrompt: input.miniPrompt,
        state: 'DRAFT',
        outputLocale: input.outputLocale,
        scriptForm: input.scriptForm,
        therapeuticArea: input.therapeuticArea,
        audience: input.audience,
        targetDurationMinutes: input.targetDurationMinutes,
        ownerId: currentUser.id,
        tags: input.tags,
      };
      setState((s) => ({ ...s, projects: [project, ...s.projects] }));
      persistItem('projects', project);
      appendAudit({
        projectId: project.id,
        eventType: 'project.created',
        summary: 'Project created from topic/mini-prompt',
        detail: { title: project.title },
        contentHash: project.contentHash,
      });
      notify('ok', 'Project created (DRAFT)');
      return project;
    },
    [appendAudit, notify, persistItem],
  );

  const createProjectFromScript = useCallback<StudioContextValue['createProjectFromScript']>(
    (input) => {
      const now = new Date().toISOString();
      const projectId = gen('proj');
      const scriptId = gen('script');
      const parsed = input.script;
      const topic = parsed.title ?? input.title;
      const project: Project = {
        id: projectId,
        version: 1,
        parentVersionId: null,
        createdBy: currentUser,
        createdAt: now,
        modifiedBy: currentUser,
        modifiedAt: now,
        contentHash: demoHash(input.title + topic),
        title: input.title,
        topic,
        miniPrompt: `Imported from ${input.sourceName}`,
        state: 'SCRIPT_DRAFT',
        outputLocale: input.outputLocale,
        scriptForm: parsed.form,
        therapeuticArea: input.therapeuticArea,
        audience: input.audience,
        targetDurationMinutes: Math.max(1, Math.round(parsed.estimatedDurationSeconds / 60)),
        ownerId: currentUser.id,
        tags: [input.therapeuticArea || 'general', input.outputLocale, 'imported-script'],
      };
      const speakers: Speaker[] = parsed.speakers.map((s) => ({
        id: s.id,
        label: s.label,
        role: s.role,
        voiceProfileId: null,
      }));
      const segments: ScriptSegment[] = parsed.segments.map((seg, i) => ({
        id: `${scriptId}-seg-${i + 1}`,
        order: seg.order,
        speakerId: seg.speakerId,
        heading: seg.heading,
        directionCue: seg.directionCue,
        text: seg.text,
        claimIds: [],
        annotations: [],
      }));
      const fullText = segments.map((s) => s.text).join('\n');
      const script: ScriptVersion = {
        id: scriptId,
        version: 1,
        parentVersionId: null,
        createdBy: currentUser,
        createdAt: now,
        modifiedBy: currentUser,
        modifiedAt: now,
        contentHash: demoHash(fullText),
        projectId,
        templateId: TEMPLATE_BY_FORM[parsed.form],
        form: parsed.form,
        locale: input.outputLocale,
        title: parsed.title ?? input.title,
        speakers,
        segments,
        approved: false,
        estimatedDurationSeconds: parsed.estimatedDurationSeconds,
      };
      setState((s) => ({ ...s, projects: [project, ...s.projects], scripts: [script, ...s.scripts] }));
      persistItem('projects', project);
      persistItem('scripts', script);
      appendAudit({
        projectId,
        eventType: 'project.created',
        summary: 'Project created from an uploaded script',
        detail: { title: project.title, source: input.sourceName },
        contentHash: project.contentHash,
      });
      appendAudit({
        projectId,
        eventType: 'script.imported',
        summary: `Imported ${parsed.form} script (${segments.length} segment(s), ungrounded draft)`,
        detail: { scriptVersionId: scriptId, segments: segments.length, form: parsed.form, source: input.sourceName },
        contentHash: script.contentHash,
      });
      notify('ok', 'Project created from uploaded script (Script draft)');
      return project;
    },
    [appendAudit, notify, persistItem],
  );

  /**
   * Apply a workflow transition.
   *
   * Resolves only once the server has accepted (or refused) the move, so callers
   * that chain transitions — e.g. approve audio then advance to ready-to-publish
   * — can `await` each step. Firing two calls synchronously would have the second
   * one re-read React state that has not re-rendered yet, see the *previous*
   * state, and fail its own pre-check even though the first move succeeded.
   */
  const transitionProject = useCallback(
    async (projectId: string, to: WorkflowState, reason?: string): Promise<boolean> => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return false;
      // Client pre-check mirrors the server gate (edge + reason + role for the
      // role we're acting as) so we only optimistically apply legal moves.
      const check = authorizeTransition(project.state, to, [state.activeRole], reason);
      if (!check.allowed) {
        notify('error', check.reason ?? 'Transition not permitted.');
        return false;
      }
      if (
        to === 'AUDIO_APPROVED' &&
        state.qualityReports.some((r) => r.projectId === projectId && r.hasBlockingIssues)
      ) {
        notify('error', 'Audio cannot be approved while a critical pronunciation QA mismatch is unresolved.');
        return false;
      }
      const from = project.state;
      const optimistic: Project = { ...project, state: to, modifiedAt: new Date().toISOString() };
      setState((s) => ({
        ...s,
        projects: s.projects.map((p) => (p.id === projectId ? optimistic : p)),
      }));

      if (apiEnabled()) {
        // The server is authoritative: it re-validates the edge + role and writes
        // the canonical audit event. Reconcile on success, roll back on refusal.
        const actor = { id: currentUser.id, name: currentUser.displayName, roles: [state.activeRole] };
        const res = await apiTransition(projectId, to, reason, actor);
        if (!res.ok) {
          setState((s) => ({
            ...s,
            projects: s.projects.map((p) => (p.id === projectId ? { ...p, state: from } : p)),
          }));
          notify('error', res.error ?? 'The server rejected this change.');
          return false;
        }
        setState((s) => ({
          ...s,
          projects: res.project
            ? s.projects.map((p) => (p.id === projectId ? (res.project as unknown as Project) : p))
            : s.projects,
          auditEvents: res.audit
            ? [
                res.audit as unknown as AuditEvent,
                ...s.auditEvents.filter((a) => a.id !== (res.audit as { id: string }).id),
              ]
            : s.auditEvents,
        }));
      } else {
        // Offline: keep the in-memory audit trail so the demo stays coherent.
        appendAudit({
          projectId,
          eventType: 'state.transition',
          summary: `${from} → ${to}${reason ? ` (${reason})` : ''}`,
          detail: { from, to, reason: reason ?? null },
          contentHash: null,
        });
      }
      notify('ok', `Moved to ${to}`);
      return true;
    },
    [state.projects, state.activeRole, state.qualityReports, appendAudit, notify],
  );

  const setProjectLocale = useCallback(
    (projectId: string, locale: Locale) => {
      let updated: { id: string } | undefined;
      setState((s) => ({
        ...s,
        projects: s.projects.map((p) => {
          if (p.id !== projectId) return p;
          const next = { ...p, outputLocale: locale };
          updated = next;
          return next;
        }),
      }));
      if (updated) persistItem('projects', updated);
    },
    [persistItem],
  );

  const deleteProject = useCallback(
    (projectId: string) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return;
      // Tombstone the id so the deletion survives reloads even for seed
      // projects (the seed is re-applied on every load + hydration merge).
      const tombstones = loadDeletedProjectIds();
      tombstones.add(projectId);
      saveDeletedProjectIds(tombstones);
      // Remove the project and every project-scoped item from local state.
      setState((s) => {
        const next: StudioState = { ...s, projects: s.projects.filter((p) => p.id !== projectId) };
        for (const key of PROJECT_SCOPED_COLLECTIONS) {
          const arr = s[key] as ReadonlyArray<{ id: string; projectId?: string }> | undefined;
          if (Array.isArray(arr)) {
            (next as unknown as Record<string, unknown>)[key] = arr.filter((it) => it.projectId !== projectId);
          }
        }
        return next;
      });
      // Best-effort server cleanup from the current snapshot (project-scoped
      // items partition by projectId; the project doc partitions by id).
      for (const key of PROJECT_SCOPED_COLLECTIONS) {
        const arr = state[key] as ReadonlyArray<{ id: string; projectId?: string }> | undefined;
        if (!Array.isArray(arr)) continue;
        for (const it of arr) {
          if (it.projectId === projectId && apiEnabled()) void apiDeleteItem(key, it.id, projectId);
        }
      }
      if (apiEnabled()) void apiDeleteItem('projects', projectId);
      notify('ok', `Removed “${project.title}” and its production data.`);
    },
    [state, notify],
  );

  const acceptSource = useCallback(
    (sourceId: string) => {
      let updated: { id: string } | undefined;
      setState((s) => ({
        ...s,
        sources: s.sources.map((src) => {
          if (src.id !== sourceId) return src;
          const next = {
            ...src,
            status: 'accepted' as const,
            statusReason: null,
            storageContainer: 'source-approved' as const,
          };
          updated = next;
          return next;
        }),
      }));
      if (updated) persistItem('sources', updated);
      appendAudit({ projectId: null, eventType: 'source.accepted', summary: `Source accepted`, detail: { sourceId }, contentHash: null });
      notify('ok', 'Source accepted');
    },
    [appendAudit, notify, persistItem],
  );

  const rejectSource = useCallback(
    (sourceId: string, reason: string) => {
      let updated: { id: string } | undefined;
      setState((s) => ({
        ...s,
        sources: s.sources.map((src) => {
          if (src.id !== sourceId) return src;
          const next = { ...src, status: 'rejected' as const, statusReason: reason };
          updated = next;
          return next;
        }),
      }));
      if (updated) persistItem('sources', updated);
      appendAudit({ projectId: null, eventType: 'source.rejected', summary: `Source rejected: ${reason}`, detail: { sourceId, reason }, contentHash: null });
      notify('warn', 'Source rejected (retained in audit record)');
    },
    [appendAudit, notify, persistItem],
  );

  const toggleClaimPinned = useCallback(
    (claimId: string) => {
      let updated: { id: string } | undefined;
      setState((s) => ({
        ...s,
        claims: s.claims.map((c) => {
          if (c.id !== claimId) return c;
          const next = { ...c, pinned: !c.pinned };
          updated = next;
          return next;
        }),
      }));
      if (updated) persistItem('claims', updated);
    },
    [persistItem],
  );

  const toggleClaimExcluded = useCallback(
    (claimId: string) => {
      let updated: { id: string } | undefined;
      setState((s) => ({
        ...s,
        claims: s.claims.map((c) => {
          if (c.id !== claimId) return c;
          const next = { ...c, excluded: !c.excluded };
          updated = next;
          return next;
        }),
      }));
      if (updated) persistItem('claims', updated);
    },
    [persistItem],
  );

  const upsertAnnotation = useCallback(
    (scriptId: string, segmentId: string, annotation: SpeechAnnotation) => {
      let updated: { id: string } | undefined;
      setState((s) => ({
        ...s,
        scripts: s.scripts.map((sc) => {
          if (sc.id !== scriptId) return sc;
          const next = {
            ...sc,
            segments: sc.segments.map((seg) =>
              seg.id !== segmentId
                ? seg
                : {
                    ...seg,
                    annotations: [
                      ...seg.annotations.filter((a) => a.id !== annotation.id),
                      annotation,
                    ],
                  },
            ),
          };
          updated = next;
          return next;
        }),
      }));
      if (updated) persistItem('scripts', updated);
    },
    [persistItem],
  );

  const removeAnnotation = useCallback(
    (scriptId: string, segmentId: string, annotationId: string) => {
      let updated: { id: string } | undefined;
      setState((s) => ({
        ...s,
        scripts: s.scripts.map((sc) => {
          if (sc.id !== scriptId) return sc;
          const next = {
            ...sc,
            segments: sc.segments.map((seg) =>
              seg.id !== segmentId ? seg : { ...seg, annotations: seg.annotations.filter((a) => a.id !== annotationId) },
            ),
          };
          updated = next;
          return next;
        }),
      }));
      if (updated) persistItem('scripts', updated);
    },
    [persistItem],
  );

  const setScriptVoice = useCallback(
    (scriptId: string, voiceProfileId: string) => {
      let updated: { id: string } | undefined;
      setState((s) => ({
        ...s,
        scripts: s.scripts.map((sc) => {
          if (sc.id !== scriptId) return sc;
          const speakers = sc.speakers.length
            ? sc.speakers.map((sp) => ({ ...sp, voiceProfileId }))
            : [{ id: 'spk-narrator', label: 'Narrator', role: 'narrator' as const, voiceProfileId }];
          const next = { ...sc, speakers };
          updated = next;
          return next;
        }),
      }));
      if (updated) persistItem('scripts', updated);
    },
    [persistItem],
  );

  const addPronunciation = useCallback<StudioContextValue['addPronunciation']>(
    (entry) => {
      const full: PronunciationEntry = {
        ...entry,
        id: gen('pron'),
        version: 1,
        parentVersionId: null,
        createdBy: currentUser,
        createdAt: new Date().toISOString(),
        modifiedBy: currentUser,
        modifiedAt: new Date().toISOString(),
        contentHash: demoHash(entry.canonicalForm + (entry.ipa ?? '') + (entry.spokenForm ?? '')),
        reviewHistory: [],
      };
      setState((s) => ({ ...s, pronunciationEntries: [full, ...s.pronunciationEntries] }));
      persistItem('pronunciationEntries', full);
      notify('ok', `Added "${entry.canonicalForm}" to the pronunciation library (draft)`);
    },
    [notify, persistItem],
  );

  const setPronunciationStatus = useCallback(
    (entryId: string, status: PronunciationEntry['approvalStatus']) => {
      let updated: { id: string } | undefined;
      setState((s) => ({
        ...s,
        pronunciationEntries: s.pronunciationEntries.map((e) => {
          if (e.id !== entryId) return e;
          const next = { ...e, approvalStatus: status, modifiedAt: new Date().toISOString() };
          updated = next;
          return next;
        }),
      }));
      if (updated) persistItem('pronunciationEntries', updated);
      notify('ok', `Pronunciation ${status}`);
    },
    [notify, persistItem],
  );

  const overrideQaTerm = useCallback(
    (reportId: string, term: string, reason: string) => {
      let updated: { id: string } | undefined;
      setState((s) => ({
        ...s,
        qualityReports: s.qualityReports.map((r) => {
          if (r.id !== reportId) return r;
          const termChecks = r.termChecks.map((t) =>
            t.term === term
              ? { ...t, reviewerOverride: { by: currentUser, reason, at: new Date().toISOString() } }
              : t,
          );
          const hasBlockingIssues = termChecks.some((t) => t.critical && !t.matched && !t.reviewerOverride);
          const next = { ...r, termChecks, hasBlockingIssues };
          updated = next;
          return next;
        }),
      }));
      if (updated) persistItem('qualityReports', updated);
      appendAudit({ projectId: null, eventType: 'qa.override', summary: `QA override for "${term}": ${reason}`, detail: { term, reason }, contentHash: null });
      notify('warn', `Accepted "${term}" despite QA warning (reason recorded)`);
    },
    [appendAudit, notify, persistItem],
  );

  const addReview = useCallback<StudioContextValue['addReview']>(
    (review) => {
      const full: ReviewDecision = { ...review, id: gen('rev'), by: currentUser, at: new Date().toISOString() };
      setState((s) => ({ ...s, reviews: [full, ...s.reviews] }));
      persistItem('reviews', full);
      appendAudit({ projectId: review.projectId, eventType: `review.${review.action}`, summary: `${review.stage} ${review.action}`, detail: { targetId: review.targetId, comment: review.comment }, contentHash: review.targetContentHash });
    },
    [appendAudit, persistItem],
  );

  const addRecipient = useCallback<StudioContextValue['addRecipient']>((r) => {
    const full: Recipient = { ...r, id: gen('rcp') };
    setState((s) => ({ ...s, recipients: [...s.recipients, full] }));
    persistItem('recipients', full);
    notify('ok', `Recipient "${r.displayName}" added`);
    return full;
  }, [notify, persistItem]);

  const createDistributionList = useCallback(
    (name: string, purpose: string, recipientIds: string[]) => {
      let created: { id: string } | undefined;
      setState((s) => {
        const containsExternal = s.recipients.some((r) => recipientIds.includes(r.id) && r.isExternal);
        const list = {
          id: gen('dist'),
          version: 1,
          parentVersionId: null,
          createdBy: currentUser,
          createdAt: new Date().toISOString(),
          modifiedBy: currentUser,
          modifiedAt: new Date().toISOString(),
          contentHash: demoHash(name + recipientIds.join(',')),
          name,
          purpose,
          ownerId: currentUser.id,
          recipientIds,
          containsExternal,
        };
        created = list;
        return { ...s, distributionLists: [...s.distributionLists, list] };
      });
      if (created) persistItem('distributionLists', created);
      notify('ok', `Distribution list "${name}" created`);
    },
    [notify, persistItem],
  );

  const publish = useCallback<StudioContextValue['publish']>(
    (input) => {
      const project = state.projects.find((p) => p.id === input.projectId);
      if (!project) {
        notify('error', 'Project not found.');
        return;
      }
      // Pre-check the publisher gate + preconditions (the server re-enforces all).
      const check = authorizeTransition(project.state, 'PUBLISHED', [state.activeRole]);
      if (!check.allowed) {
        notify('error', check.reason ?? 'You are not permitted to publish.');
        return;
      }
      if (!input.disclosureStatement.trim()) {
        notify('error', 'A synthetic-media disclosure statement is required to publish.');
        return;
      }
      if (input.recipientIds.length === 0) {
        notify('error', 'Select at least one recipient to publish.');
        return;
      }

      if (apiEnabled()) {
        // Server creates the immutable publication + receipts and flips the state.
        const actor = { id: currentUser.id, name: currentUser.displayName, roles: [state.activeRole] };
        void apiPublish(input, actor).then((res) => {
          if (!res.ok || !res.publication || !res.project) {
            notify('error', res.error ?? 'The server rejected the publish.');
            return;
          }
          const pub = res.publication as unknown as StudioState['publications'][number];
          const receipts = (res.receipts ?? []) as unknown as StudioState['deliveryReceipts'];
          const savedProject = res.project as unknown as Project;
          const savedAudio = res.audioVersion as unknown as StudioState['audioVersions'][number] | null;
          setState((s) => ({
            ...s,
            publications: [pub, ...s.publications.filter((p) => p.id !== pub.id)],
            deliveryReceipts: [
              ...receipts,
              ...s.deliveryReceipts.filter((r) => !receipts.some((n) => n.id === r.id)),
            ],
            audioVersions: savedAudio
              ? s.audioVersions.map((a) => (a.id === savedAudio.id ? savedAudio : a))
              : s.audioVersions,
            projects: s.projects.map((p) => (p.id === savedProject.id ? savedProject : p)),
            auditEvents: res.audit
              ? [
                  res.audit as unknown as AuditEvent,
                  ...s.auditEvents.filter((a) => a.id !== (res.audit as { id: string }).id),
                ]
              : s.auditEvents,
          }));
          notify('ok', 'Published. Delivery receipts recorded.');
        });
        return;
      }

      // Offline: local publish so the demo works without a backend.
      const now = new Date().toISOString();
      const publication = {
        id: gen('pub'),
        version: 1,
        parentVersionId: null,
        createdBy: currentUser,
        createdAt: now,
        modifiedBy: currentUser,
        modifiedAt: now,
        contentHash: demoHash(input.audioVersionId + input.recipientIds.join(',')),
        projectId: input.projectId,
        audioVersionId: input.audioVersionId,
        scriptVersionId: input.scriptVersionId,
        channel: input.channel,
        distributionListId: null,
        recipientIds: input.recipientIds,
        disclosureStatement: input.disclosureStatement,
        acceptedSourceIds: input.acceptedSourceIds,
        publishedBy: currentUser,
        publishedAt: now,
        expiresAt: input.expiresAt,
        revoked: false,
      };
      const receipts = input.recipientIds.map((rid) => ({
        id: gen('rec'),
        publicationId: publication.id,
        recipientId: rid,
        channel: input.channel,
        status: 'delivered' as const,
        attemptedAt: now,
        deliveredAt: now,
        failureReason: null,
        idempotencyKey: demoHash(publication.id + rid),
      }));
      let savedAudio: { id: string } | undefined;
      let savedProject: { id: string } | undefined;
      setState((s) => ({
        ...s,
        publications: [publication, ...s.publications],
        deliveryReceipts: [...receipts, ...s.deliveryReceipts],
        audioVersions: s.audioVersions.map((a) => {
          if (a.id !== input.audioVersionId) return a;
          const next = { ...a, storageContainer: 'audio-approved' as const };
          savedAudio = next;
          return next;
        }),
        projects: s.projects.map((p) => {
          if (p.id !== input.projectId) return p;
          const next = { ...p, state: 'PUBLISHED' as const };
          savedProject = next;
          return next;
        }),
      }));
      persistItem('publications', publication);
      receipts.forEach((r) => persistItem('deliveryReceipts', r));
      if (savedAudio) persistItem('audioVersions', savedAudio);
      if (savedProject) persistItem('projects', savedProject);
      appendAudit({ projectId: input.projectId, eventType: 'audio.published', summary: `Published to ${input.recipientIds.length} recipient(s) via ${input.channel}`, detail: { channel: input.channel, recipients: input.recipientIds.length }, contentHash: null });
      notify('ok', 'Published. Delivery receipts recorded.');
    },
    [state.projects, state.activeRole, appendAudit, notify, persistItem],
  );

  const generateScript = useCallback<StudioContextValue['generateScript']>(
    async (projectId) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) {
        notify('error', 'Project not found.');
        return false;
      }
      // Grounded generation runs the deployed Foundry agent on the backend; it is
      // not available offline (the SPA keeps its authored sample script instead).
      if (!apiEnabled()) {
        notify('warn', 'Grounded generation requires the connected backend (Foundry). Not available offline.');
        return false;
      }
      // Drafting is a Creator action — mirror the server role gate for a clear message.
      if (state.activeRole !== 'Creator' && state.activeRole !== 'Administrator') {
        notify('error', 'Generating a script requires the Creator role.');
        return false;
      }

      const actor = { id: currentUser.id, name: currentUser.displayName, roles: [state.activeRole] };
      const res = await apiGenerateScript(projectId, actor);
      if (!res.ok || !res.script) {
        notify('error', res.error ?? 'The server could not generate a script.');
        return false;
      }
      const saved = res.script as unknown as StudioState['scripts'][number];
      setState((s) => ({
        ...s,
        scripts: [saved, ...s.scripts.filter((sc) => sc.id !== saved.id)],
        auditEvents: res.audit
          ? [
              res.audit as unknown as AuditEvent,
              ...s.auditEvents.filter((a) => a.id !== (res.audit as { id: string }).id),
            ]
          : s.auditEvents,
      }));
      notify('ok', 'Grounded script generated by the Foundry agent.');
      return true;
    },
    [state.projects, state.activeRole, notify],
  );

  const synthesizeEpisode = useCallback<StudioContextValue['synthesizeEpisode']>(
    async (projectId) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) {
        notify('error', 'Project not found.');
        return false;
      }
      if (!apiEnabled()) {
        notify('warn', 'Rendering a preview requires the connected backend (Azure AI Speech + Blob Storage). Not available offline.');
        return false;
      }
      if (state.activeRole !== 'Creator' && state.activeRole !== 'Administrator') {
        notify('error', 'Rendering audio requires the Creator role.');
        return false;
      }
      const actor = { id: currentUser.id, name: currentUser.displayName, roles: [state.activeRole] };
      // Send the voice the user selected (persisted on the script's speakers in
      // our own state) so the render is deterministic and matches the workbench,
      // regardless of whether the best-effort script persist reached the server.
      const script = state.scripts.find((s) => s.projectId === projectId);
      const voiceAssignments: Record<string, string> = {};
      for (const sp of script?.speakers ?? []) {
        if (sp.voiceProfileId) voiceAssignments[sp.id] = sp.voiceProfileId;
      }
      const voiceArg = Object.keys(voiceAssignments).length ? voiceAssignments : undefined;

      // Merge the finished render (audio + job + any chained QA report + audit)
      // into state. Shared by the async-poll and sync-fallback paths.
      const mergeRendered = (
        savedAudio: StudioState['audioVersions'][number] | undefined,
        savedJob: StudioState['synthesisJobs'][number] | undefined,
        savedReports: StudioState['qualityReports'],
        savedAudits: AuditEvent[],
      ) => {
        setState((s) => ({
          ...s,
          audioVersions: savedAudio
            ? [savedAudio, ...s.audioVersions.filter((a) => a.id !== savedAudio.id)]
            : s.audioVersions,
          synthesisJobs: savedJob
            ? [savedJob, ...s.synthesisJobs.filter((j) => j.id !== savedJob.id)]
            : s.synthesisJobs,
          qualityReports: savedReports.length
            ? [...savedReports, ...s.qualityReports.filter((r) => !savedReports.some((sr) => sr.id === r.id))]
            : s.qualityReports,
          auditEvents: savedAudits.length
            ? [...savedAudits.filter((a) => !s.auditEvents.some((e) => e.id === a.id)), ...s.auditEvents]
            : s.auditEvents,
        }));
      };

      // Prefer the background (Service Bus) render so the UI never holds a
      // ~1-minute connection open (which can appear "stuck" or time out behind a
      // proxy). Enqueue, then poll bootstrap for the job reaching a terminal
      // status. Falls back to the synchronous render when the queue is
      // unavailable.
      const queued = await apiSynthesizeEpisodeAsync(projectId, actor, voiceArg);
      if (queued.ok && queued.synthesisJob) {
        const jobId = queued.synthesisJob.id;
        notify('ok', 'Rendering the full episode with Azure AI Speech — this can take up to a minute. You can keep working while it finishes.');
        const DELAY_MS = 4000;
        const MAX_TRIES = 45; // ~3 minutes
        for (let i = 0; i < MAX_TRIES; i++) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
          const boot = await bootstrap();
          if (!boot) continue;
          const jobs = (boot.collections.synthesisJobs ?? []) as unknown as StudioState['synthesisJobs'];
          const job = jobs.find((j) => j.id === jobId);
          if (!job) continue;
          if (job.status === 'failed') {
            notify('error', `Rendering failed: ${(job as { logPath?: string }).logPath ?? 'unknown error'}`);
            return false;
          }
          if (job.status === 'succeeded') {
            const audios = (boot.collections.audioVersions ?? []) as unknown as StudioState['audioVersions'];
            const reports = (boot.collections.qualityReports ?? []) as unknown as StudioState['qualityReports'];
            const audits = (boot.collections.auditEvents ?? []) as unknown as AuditEvent[];
            mergeRendered(
              audios.find((a) => a.projectId === projectId),
              job,
              reports.filter((r) => (r as { projectId?: string }).projectId === projectId),
              audits.filter((a) => (a as { projectId?: string }).projectId === projectId),
            );
            notify('ok', 'Episode preview rendered with Azure AI Speech.');
            return true;
          }
        }
        notify('warn', 'The episode is still rendering in the background. Refresh in a moment to load the finished audio.');
        return false;
      }

      // Async queue not available (e.g. Service Bus not configured) — surface a
      // hard error, or fall back to the synchronous render for transient issues.
      const canFallback =
        queued.error === 'offline' ||
        queued.error === 'network' ||
        /501/.test(queued.error ?? '') ||
        /service bus/i.test(queued.error ?? '');
      if (!canFallback) {
        notify('error', queued.error ?? 'The server could not render the audio.');
        return false;
      }
      notify('ok', 'Rendering the full episode with Azure AI Speech — this can take up to a minute…');
      const res = await apiSynthesizeEpisode(projectId, actor, voiceArg);
      if (!res.ok || !res.audioVersion) {
        notify('error', res.error ?? 'The server could not render the audio.');
        return false;
      }
      mergeRendered(
        res.audioVersion as unknown as StudioState['audioVersions'][number],
        res.synthesisJob as unknown as StudioState['synthesisJobs'][number] | undefined,
        [],
        res.audit ? [res.audit as unknown as AuditEvent] : [],
      );
      notify('ok', 'Episode preview rendered with Azure AI Speech.');
      return true;
    },
    [state.projects, state.activeRole, state.scripts, notify],
  );

  const runPronunciationQa = useCallback<StudioContextValue['runPronunciationQa']>(
    async (projectId) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) {
        notify('error', 'Project not found.');
        return false;
      }
      if (!apiEnabled()) {
        notify('warn', 'Closed-loop QA requires the connected backend (Azure AI Speech transcription). Not available offline.');
        return false;
      }
      if (!['Creator', 'AudioReviewer', 'Administrator'].includes(state.activeRole)) {
        notify('error', 'Running pronunciation QA requires the Creator or AudioReviewer role.');
        return false;
      }
      const actor = { id: currentUser.id, name: currentUser.displayName, roles: [state.activeRole] };
      const res = await apiRunPronunciationQa(projectId, actor);
      if (!res.ok || !res.qualityReport) {
        notify('error', res.error ?? 'The server could not run pronunciation QA.');
        return false;
      }
      const savedReport = res.qualityReport as unknown as StudioState['qualityReports'][number];
      const linkedAudio = res.audioVersion as unknown as StudioState['audioVersions'][number] | undefined;
      setState((s) => ({
        ...s,
        qualityReports: [savedReport, ...s.qualityReports.filter((r) => r.id !== savedReport.id)],
        audioVersions: linkedAudio
          ? [linkedAudio, ...s.audioVersions.filter((a) => a.id !== linkedAudio.id)]
          : s.audioVersions,
        auditEvents: res.audit
          ? [res.audit as unknown as AuditEvent, ...s.auditEvents.filter((a) => a.id !== (res.audit as { id: string }).id)]
          : s.auditEvents,
      }));
      notify(
        savedReport.hasBlockingIssues ? 'warn' : 'ok',
        savedReport.hasBlockingIssues
          ? 'Closed-loop QA found a blocking pronunciation mismatch — review before approving.'
          : 'Closed-loop pronunciation QA passed.',
      );
      return true;
    },
    [state.projects, state.activeRole, notify],
  );

  const value = useMemo<StudioContextValue>(
    () => ({
      ...state,
      currentUser,
      setActiveRole,
      notify,
      dismissNotification,
      getProject,
      createProject,
      createProjectFromScript,
      transitionProject,
      setProjectLocale,
      deleteProject,
      acceptSource,
      rejectSource,
      toggleClaimPinned,
      toggleClaimExcluded,
      upsertAnnotation,
      removeAnnotation,
      setScriptVoice,
      addPronunciation,
      setPronunciationStatus,
      overrideQaTerm,
      addReview,
      addRecipient,
      createDistributionList,
      publish,
      generateScript,
      synthesizeEpisode,
      runPronunciationQa,
    }),
    [
      state,
      setActiveRole,
      notify,
      dismissNotification,
      getProject,
      createProject,
      createProjectFromScript,
      transitionProject,
      setProjectLocale,
      deleteProject,
      acceptSource,
      rejectSource,
      toggleClaimPinned,
      toggleClaimExcluded,
      upsertAnnotation,
      removeAnnotation,
      setScriptVoice,
      addPronunciation,
      setPronunciationStatus,
      overrideQaTerm,
      addReview,
      addRecipient,
      createDistributionList,
      publish,
      generateScript,
      synthesizeEpisode,
      runPronunciationQa,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used within a StudioProvider');
  return ctx;
}
