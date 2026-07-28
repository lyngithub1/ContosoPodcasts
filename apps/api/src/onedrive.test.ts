/**
 * Tests for the OneDrive / SharePoint delivery adapter.
 *
 * Graph is faked at the `fetch` boundary, so these exercise the real adapter
 * logic: folder creation, name sanitization, the 4 MiB simple-vs-resumable
 * upload decision, chunk framing, idempotent replace semantics, and the
 * guarantee that no bearer token leaks into an error message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

vi.mock('./azure.js', () => ({
  getToken: async () => 'FAKE-TOKEN-do-not-leak',
  credential: () => ({}),
}));

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[] = [];

function headersToObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

/** Minimal Graph stand-in covering the endpoints the adapter uses. */
function installGraphStub(overrides: { failUpload?: boolean; uploadStatus?: number } = {}) {
  const stub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method, headers: headersToObject(init?.headers), body: init?.body });

    // Folder creation
    if (url.endsWith('/children') && method === 'POST') {
      return new Response(JSON.stringify({ id: 'folder-1' }), { status: 201 });
    }
    // Resumable session creation
    if (url.endsWith('/createUploadSession')) {
      return new Response(JSON.stringify({ uploadUrl: 'https://upload.example/session/abc' }), { status: 200 });
    }
    // Chunk upload against the pre-authorized session URL
    if (url.startsWith('https://upload.example/session/')) {
      if (method === 'DELETE') return new Response(null, { status: 204 });
      const range = headersToObject(init?.headers)['content-range'] ?? '';
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(range);
      const end = m ? Number(m[2]) : 0;
      const total = m ? Number(m[3]) : 0;
      if (end + 1 >= total) {
        return new Response(JSON.stringify({ name: 'ep.mp3', webUrl: 'https://contoso.sharepoint.com/ep.mp3', size: total }), { status: 201 });
      }
      return new Response(null, { status: 202 });
    }
    // Simple content upload
    if (url.includes(':/content')) {
      if (overrides.failUpload) {
        return new Response(
          JSON.stringify({ error: { code: 'accessDenied', message: 'Insufficient privileges' } }),
          { status: overrides.uploadStatus ?? 403 },
        );
      }
      const name = decodeURIComponent(url.split('root:/')[1]?.split(':/content')[0] ?? '').split('/').pop() ?? 'f';
      return new Response(JSON.stringify({ name, webUrl: `https://contoso.sharepoint.com/${name}`, size: 123 }), { status: 201 });
    }
    return new Response('unexpected', { status: 500 });
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}

async function loadAdapter() {
  vi.resetModules();
  return import('./onedrive.js');
}

beforeEach(() => {
  calls = [];
  process.env.GRAPH_DRIVE_ID = 'drive-123';
  process.env.ONEDRIVE_FOLDER_PATH = 'Podcast Studio/Published';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('oneDriveEnabled', () => {
  it('is disabled when no drive id is configured', async () => {
    delete process.env.GRAPH_DRIVE_ID;
    const { oneDriveEnabled } = await loadAdapter();
    expect(oneDriveEnabled()).toBe(false);
  });

  it('is enabled once a drive id is set', async () => {
    const { oneDriveEnabled } = await loadAdapter();
    expect(oneDriveEnabled()).toBe(true);
  });

  it('refuses to deliver when not configured', async () => {
    delete process.env.GRAPH_DRIVE_ID;
    const { deliverEpisode } = await loadAdapter();
    await expect(
      deliverEpisode({
        title: 'X', projectId: 'p1', audio: Buffer.from('a'), transcript: null,
        disclosureStatement: 'd', publishedAt: 'now', publishedBy: 'me', contentHash: 'h', durationSeconds: 60,
      }),
    ).rejects.toThrow(/not configured/i);
  });
});

describe('deliverEpisode', () => {
  it('creates the folder chain, then uploads audio, transcript, and README', async () => {
    installGraphStub();
    const { deliverEpisode } = await loadAdapter();

    const out = await deliverEpisode({
      title: 'HIV Briefing',
      projectId: 'p1',
      audio: Buffer.from('small audio'),
      transcript: 'hello transcript',
      disclosureStatement: 'This audio is AI-generated.',
      publishedAt: '2026-07-27T00:00:00Z',
      publishedBy: 'Pat',
      contentHash: 'sha256:abc',
      durationSeconds: 600,
    });

    expect(out.folder).toBe('Podcast Studio/Published/HIV Briefing');
    expect(out.files.map((f) => f.name)).toEqual(['HIV Briefing.mp3', 'HIV Briefing - transcript.txt', 'README.txt']);
    expect(out.audioUrl).toContain('https://');

    // Three folder segments created in order, parents before children.
    const folderCalls = calls.filter((c) => c.url.endsWith('/children'));
    expect(folderCalls).toHaveLength(3);
    expect(folderCalls[0]!.url).toContain('/root/children');
    expect(JSON.parse(String(folderCalls[0]!.body)).name).toBe('Podcast Studio');
    expect(JSON.parse(String(folderCalls[2]!.body)).name).toBe('HIV Briefing');
  });

  it('omits the transcript file when there is no transcript', async () => {
    installGraphStub();
    const { deliverEpisode } = await loadAdapter();
    const out = await deliverEpisode({
      title: 'No Transcript', projectId: 'p1', audio: Buffer.from('a'), transcript: null,
      disclosureStatement: 'd', publishedAt: 'now', publishedBy: 'me', contentHash: 'h', durationSeconds: 1,
    });
    expect(out.files.map((f) => f.name)).toEqual(['No Transcript.mp3', 'README.txt']);
  });

  it('embeds the disclosure in the README sidecar', async () => {
    installGraphStub();
    const { deliverEpisode } = await loadAdapter();
    await deliverEpisode({
      title: 'Disclosure Test', projectId: 'p1', audio: Buffer.from('a'), transcript: null,
      disclosureStatement: 'SYNTHETIC VOICES USED HERE', publishedAt: 'now', publishedBy: 'me',
      contentHash: 'h', durationSeconds: 1,
    });
    const readmeCall = calls.find((c) => c.url.includes('README.txt'));
    const body = Buffer.from(readmeCall!.body as Uint8Array).toString('utf8');
    expect(body).toContain('SYNTHETIC VOICES USED HERE');
    expect(body).toContain('AI-GENERATED AUDIO');
  });

  it('sanitizes characters OneDrive rejects in item names', async () => {
    installGraphStub();
    const { deliverEpisode } = await loadAdapter();
    const out = await deliverEpisode({
      title: 'A/B: "risky" <name>|test*', projectId: 'p1', audio: Buffer.from('a'), transcript: null,
      disclosureStatement: 'd', publishedAt: 'now', publishedBy: 'me', contentHash: 'h', durationSeconds: 1,
    });
    expect(out.folder).not.toMatch(/[\\:*?"<>|]/);
    expect(out.files[0]!.name).not.toMatch(/[\\:*?"<>|]/);
  });

  it('falls back to the project id when the title sanitizes to nothing', async () => {
    installGraphStub();
    const { deliverEpisode } = await loadAdapter();
    const out = await deliverEpisode({
      title: '???', projectId: 'proj-fallback', audio: Buffer.from('a'), transcript: null,
      disclosureStatement: 'd', publishedAt: 'now', publishedBy: 'me', contentHash: 'h', durationSeconds: 1,
    });
    expect(out.folder).toContain('proj-fallback');
  });

  it('truncates long titles so the full path stays well inside platform limits', async () => {
    installGraphStub();
    const { deliverEpisode } = await loadAdapter();
    // A realistic German medical title — these run past 100 characters.
    const longTitle =
      'Doravirine plus Islatravir zur Initialtherapie bei HIV-1: Ergebnisse nach achtundvierzig Wochen im Vergleich zu Bictegravir';
    const out = await deliverEpisode({
      title: longTitle, projectId: 'p1', audio: Buffer.from('a'), transcript: 'x',
      disclosureStatement: 'd', publishedAt: 'now', publishedBy: 'me', contentHash: 'h', durationSeconds: 1,
    });

    const episodeSegment = out.folder.split('/').pop()!;
    expect(episodeSegment.length).toBeLessThanOrEqual(60);
    for (const f of out.files) expect(f.name.length).toBeLessThanOrEqual(80);
    // Windows clients syncing the library are bound by MAX_PATH (260).
    const longestPath = `${out.folder}/${out.files.map((f) => f.name).sort((a, b) => b.length - a.length)[0]}`;
    expect(longestPath.length).toBeLessThan(200);
  });

  it('does not leave a trailing dot when truncation lands on one', async () => {
    installGraphStub();
    const { deliverEpisode } = await loadAdapter();
    const out = await deliverEpisode({
      title: 'A'.repeat(59) + '.' + 'B'.repeat(30), projectId: 'p1', audio: Buffer.from('a'), transcript: null,
      disclosureStatement: 'd', publishedAt: 'now', publishedBy: 'me', contentHash: 'h', durationSeconds: 1,
    });
    expect(out.folder.split('/').pop()).not.toMatch(/\.$/);
  });

  it('uses replace semantics so re-publishing is idempotent', async () => {
    installGraphStub();
    const { deliverEpisode } = await loadAdapter();
    await deliverEpisode({
      title: 'Idem', projectId: 'p1', audio: Buffer.from('a'), transcript: null,
      disclosureStatement: 'd', publishedAt: 'now', publishedBy: 'me', contentHash: 'h', durationSeconds: 1,
    });
    const upload = calls.find((c) => c.url.includes(':/content'));
    expect(upload!.url).toContain('conflictBehavior=replace');
  });

  it('surfaces a Graph permission error without leaking the bearer token', async () => {
    installGraphStub({ failUpload: true });
    const { deliverEpisode } = await loadAdapter();
    await expect(
      deliverEpisode({
        title: 'Denied', projectId: 'p1', audio: Buffer.from('a'), transcript: null,
        disclosureStatement: 'd', publishedAt: 'now', publishedBy: 'me', contentHash: 'h', durationSeconds: 1,
      }),
    ).rejects.toThrow(/accessDenied|Insufficient privileges/);

    try {
      await deliverEpisode({
        title: 'Denied', projectId: 'p1', audio: Buffer.from('a'), transcript: null,
        disclosureStatement: 'd', publishedAt: 'now', publishedBy: 'me', contentHash: 'h', durationSeconds: 1,
      });
    } catch (err) {
      expect((err as Error).message).not.toContain('FAKE-TOKEN');
    }
  });
});

describe('large uploads', () => {
  it('uses a resumable session above 4 MiB and frames chunks correctly', async () => {
    installGraphStub();
    const { deliverEpisode } = await loadAdapter();

    const big = Buffer.alloc(5 * 1024 * 1024, 1); // 5 MiB > 4 MiB threshold
    const out = await deliverEpisode({
      title: 'Big Episode', projectId: 'p1', audio: big, transcript: null,
      disclosureStatement: 'd', publishedAt: 'now', publishedBy: 'me', contentHash: 'h', durationSeconds: 600,
    });
    expect(out.audioUrl).toContain('https://');

    expect(calls.some((c) => c.url.endsWith('/createUploadSession'))).toBe(true);

    const chunks = calls.filter((c) => c.url.startsWith('https://upload.example/session/') && c.method === 'PUT');
    expect(chunks.length).toBeGreaterThan(1);

    // Contiguous, correctly-framed, and covering the whole buffer.
    let expectedStart = 0;
    for (const c of chunks) {
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(c.headers['content-range']!)!;
      expect(Number(m[1])).toBe(expectedStart);
      expect(Number(m[3])).toBe(big.length);
      expectedStart = Number(m[2]) + 1;
    }
    expect(expectedStart).toBe(big.length);

    // The pre-authorized session URL must not carry our Graph token.
    for (const c of chunks) expect(c.headers['authorization']).toBeUndefined();
  });

  it('keeps small files on the single-request path', async () => {
    installGraphStub();
    const { deliverEpisode } = await loadAdapter();
    await deliverEpisode({
      title: 'Small', projectId: 'p1', audio: Buffer.alloc(1024), transcript: null,
      disclosureStatement: 'd', publishedAt: 'now', publishedBy: 'me', contentHash: 'h', durationSeconds: 1,
    });
    expect(calls.some((c) => c.url.endsWith('/createUploadSession'))).toBe(false);
    expect(calls.some((c) => c.url.includes(':/content'))).toBe(true);
  });
});
