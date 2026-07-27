/**
 * The identity mode must fail CLOSED.
 *
 * A half-configured `AUTH_MODE=entra` deployment silently falling back to the
 * spoofable `x-actor-*` header shim would look secured while accepting
 * client-supplied roles. These tests pin that behavior.
 *
 * `config` reads `process.env` at module load, so each case re-imports the
 * modules with a fresh registry after setting the environment.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

/** Load a fresh copy of the auth module under the current process.env. */
async function loadAuth() {
  vi.resetModules();
  return import('./auth.js');
}

/** Minimal Fastify stand-in — registerAuth only needs a logger and addHook. */
function fakeApp() {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    addHook: vi.fn(),
  } as never;
}

describe('registerAuth fail-closed behavior', () => {
  it('throws when AUTH_MODE=entra but the tenant is missing', async () => {
    process.env.AUTH_MODE = 'entra';
    delete process.env.AUTH_TENANT_ID;
    process.env.AUTH_AUDIENCE = 'api://podstudio-api';

    const { registerAuth } = await loadAuth();
    expect(() => registerAuth(fakeApp())).toThrow(/AUTH_TENANT_ID/);
  });

  it('throws when AUTH_MODE=entra but the audience is missing', async () => {
    process.env.AUTH_MODE = 'entra';
    process.env.AUTH_TENANT_ID = 'tenant-guid';
    delete process.env.AUTH_AUDIENCE;

    const { registerAuth } = await loadAuth();
    expect(() => registerAuth(fakeApp())).toThrow(/AUTH_AUDIENCE/);
  });

  it('refuses the header shim outside development unless explicitly allowed', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_MODE;
    delete process.env.ALLOW_HEADER_AUTH;

    const { registerAuth } = await loadAuth();
    expect(() => registerAuth(fakeApp())).toThrow(/header/i);
  });

  it('allows the header shim in production only with an explicit opt-in', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_MODE;
    process.env.ALLOW_HEADER_AUTH = 'true';

    const { registerAuth } = await loadAuth();
    const app = fakeApp();
    expect(() => registerAuth(app)).not.toThrow();
    // ...and says so loudly.
    expect((app as unknown as { log: { warn: ReturnType<typeof vi.fn> } }).log.warn).toHaveBeenCalled();
  });

  it('allows the header shim in development without extra configuration', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AUTH_MODE;
    delete process.env.ALLOW_HEADER_AUTH;

    const { registerAuth } = await loadAuth();
    expect(() => registerAuth(fakeApp())).not.toThrow();
  });

  it('installs the token hook when Entra is fully configured', async () => {
    process.env.AUTH_MODE = 'entra';
    process.env.AUTH_TENANT_ID = 'tenant-guid';
    process.env.AUTH_AUDIENCE = 'api://podstudio-api';

    const { registerAuth, entraAuthEnabled } = await loadAuth();
    const app = fakeApp();
    registerAuth(app);

    expect(entraAuthEnabled()).toBe(true);
    expect((app as unknown as { addHook: ReturnType<typeof vi.fn> }).addHook).toHaveBeenCalledWith(
      'onRequest',
      expect.any(Function),
    );
  });
});

describe('token hook', () => {
  it('rejects a request with no Bearer token', async () => {
    process.env.AUTH_MODE = 'entra';
    process.env.AUTH_TENANT_ID = 'tenant-guid';
    process.env.AUTH_AUDIENCE = 'api://podstudio-api';

    const { registerAuth } = await loadAuth();
    const hooks: Array<(req: unknown, reply: unknown) => Promise<unknown>> = [];
    const app = {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      addHook: (_name: string, fn: (req: unknown, reply: unknown) => Promise<unknown>) => hooks.push(fn),
    } as never;
    registerAuth(app);

    const code = vi.fn().mockReturnThis();
    const send = vi.fn();
    const reply = { code, send };
    await hooks[0]!({ url: '/api/bootstrap', method: 'GET', headers: {} }, reply);

    expect(code).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalledWith({ error: 'Missing Bearer token' });
  });

  it('lets health probes through without a token', async () => {
    process.env.AUTH_MODE = 'entra';
    process.env.AUTH_TENANT_ID = 'tenant-guid';
    process.env.AUTH_AUDIENCE = 'api://podstudio-api';

    const { registerAuth } = await loadAuth();
    const hooks: Array<(req: unknown, reply: unknown) => Promise<unknown>> = [];
    const app = {
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      addHook: (_name: string, fn: (req: unknown, reply: unknown) => Promise<unknown>) => hooks.push(fn),
    } as never;
    registerAuth(app);

    const code = vi.fn().mockReturnThis();
    const reply = { code, send: vi.fn() };
    await hooks[0]!({ url: '/healthz', method: 'GET', headers: {} }, reply);

    expect(code).not.toHaveBeenCalled();
  });
});
