// Unit coverage for the Phase 17 admin route layer (server/admin.ts).
//
// The ~30 handleAdminApi branches moved off the inline if-ladder onto RouteDefs the
// Phase 9 dispatcher serves under API_DISPATCH 'new' (main.ts routes /admin/api
// through its own flag-gated dispatcher whose delegate is the legacy handleAdminApi).
// It is a PARITY-FIRST migration: every handler reproduces its legacy branch and
// writes the SAME { success, data, error } admin envelope byte-for-byte. This slice
// pins:
//  - the FROZEN envelope contract (a success body, an error body, a data:{ ok:true }
//    body) and that surface 'admin' + meta.envelope 'admin' select serializeAdmin;
//  - the requireAdmin gate: db-free 401 on a missing bearer, 401 on a non-admin, and
//    a valid admin reaches the handler (no read-only-scope 403, no moderation gate);
//  - the admin.login limiter: its own in-handler rateLimited (429), the 401 bad-cred
//    and 403 no-admin-access shapes, all anonymous (no requireAdmin);
//  - the operator :id loader: a valid id reaches the handler, a NaN id 422s;
//  - the page/limit pagination contract (page/limit, NOT page/pageSize), lenient
//    coerce-and-clamp (a bad page defaults, never 422), the rows/total/page/limit shape;
//  - the enum :action restructure: the four actions decode, a fifth 422s;
//  - every game.* side effect (disconnect, chat-mute-live, filter/IP reload, kick);
//  - every guard (admin-target 400s, invalid-ip 400s, bad-tier 400) and 404
//    (report/word/ip/account not found);
//  - the best-effort emailSecurityIncident isolation (a mail failure never fails the
//    moderation), and the adminBodyValidationRemap 500 (internal.error) on a throw.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// admin.ts imports it, so set a dummy URL. The pool never connects: every db read is
// a fake via setAdminDbForTests, the game hooks are a fake via configureAdminRuntime,
// and every asserted path returns before any real query.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase17_admin';

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AdminRuntime,
  configureAdminRuntime,
  resetAdminDbForTests,
  resetAdminRuntimeForTests,
  routes,
  setAdminDbForTests,
} from '../../server/admin';
import { compose } from '../../server/http/compose';
import { withErrors } from '../../server/http/middleware/with_errors';
import { apiRegistry } from '../../server/http/registry';
import type { Method, Middleware } from '../../server/http/types';
import {
  rateLimited,
  resetRateLimitClock,
  resetRateLimits,
  setRateLimitClock,
} from '../../server/ratelimit';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

// A well-formed bearer header (64 lowercase-hex, matching the gate BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;
// The admin caller the gate resolves the bearer to; isAdminAccount(id) returns true
// ONLY for this id, so a moderation target (a different id) reads as a non-admin.
const ADMIN_ACCOUNT_ID = 7;
// The admin-login per-minute ceiling (server/admin.ts ADMIN_LOGIN_MAX_PER_MINUTE).
const ADMIN_LOGIN_MAX = 10;
// A frozen instant so a limiter drain sits inside one 60s window.
const FIXED_NOW_MS = 1_700_000_000_000;

// Loose fake-db overrides: the admin bundle's real return types are strict db-row
// shapes, so tests supply minimal fakes and this single cast point loosens them. The
// handler serializes whatever the fake returns; the assertions pin the exact shape.
type DbOverrides = Record<string, unknown>;
function setDb(overrides: DbOverrides): void {
  setAdminDbForTests(overrides as Parameters<typeof setAdminDbForTests>[0]);
}

// Install the admin db seam so requireAdmin resolves the bearer to the admin caller.
// isAdminAccount is caller-aware: true for the caller, false for any other id (so a
// moderation target reads as a normal account). Extra reads are layered per test.
function authedAdminDb(overrides: DbOverrides = {}): void {
  setDb({
    accountForToken: async () => ADMIN_ACCOUNT_ID,
    isAdminAccount: async (id: number) => id === ADMIN_ACCOUNT_ID,
    ...overrides,
  });
}

// A default game-session runtime with sensible live reads; overrides carry the vi.fn
// spies a side-effect test asserts on. Returned so a test can read the spy calls.
function installAdminRuntime(overrides: Partial<Record<keyof AdminRuntime, unknown>> = {}) {
  const rt = {
    adminStats: vi.fn(() => ({
      online: 3,
      onlineAccounts: 2,
      peakOnline: 5,
      uptimeSeconds: 100,
      tickMsAvg: 1,
      simEntities: 10,
      rssBytes: 1,
      heapUsedBytes: 1,
    })),
    liveSessions: vi.fn(() => []),
    suspiciousPlayers: vi.fn(() => []),
    isIpBlocked: vi.fn(() => false),
    liveSharedIps: vi.fn(() => []),
    liveAccountIds: vi.fn(() => new Set<number>()),
    disconnectAccount: vi.fn(),
    muteAccountChat: vi.fn(),
    liftChatMuteLive: vi.fn(),
    resetChatStrikesLive: vi.fn(),
    reloadChatFilter: vi.fn(async () => {}),
    reloadBlockedIps: vi.fn(async () => {}),
    disconnectByIp: vi.fn(),
    ...overrides,
  };
  configureAdminRuntime(rt as unknown as AdminRuntime);
  return rt;
}

/** Read status/body/content-type off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): {
  status: number;
  body: unknown;
  raw: string;
  contentType: string | undefined;
} {
  const fake = res as unknown as FakeRes;
  const raw = fake.body;
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    body = undefined;
  }
  return {
    status: fake.statusCode,
    body,
    raw,
    contentType: fake.headers['content-type'] as string | undefined,
  };
}

/** Grab a route by method + path (paths repeat across methods, so both are needed). */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** Drive a full route chain (its real middleware + handler) under withErrors. */
async function runRoute(
  method: Method,
  path: string,
  opts: {
    url?: string;
    body?: unknown;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  } = {},
) {
  const route = routeFor(method, path);
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  const ctx = fakeCtx({
    method,
    url: opts.url ?? path,
    headers: opts.headers,
    body: opts.body,
    params: opts.params,
  });
  const stack: Middleware[] = [
    withErrors({ surface: route.meta?.envelope }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

beforeEach(() => {
  setRateLimitClock(() => FIXED_NOW_MS);
  resetRateLimits();
  resetAdminDbForTests();
});

afterEach(() => {
  resetRateLimits();
  resetRateLimitClock();
  resetAdminDbForTests();
  resetAdminRuntimeForTests();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. The { success, data, error } envelope contract (FROZEN).
// ---------------------------------------------------------------------------

describe('admin envelope contract (frozen)', () => {
  it('a SUCCESS body is { success: true, data: <payload>, error: null }', async () => {
    authedAdminDb({ listBlockedIps: async () => [{ id: 1, ip: '1.2.3.4' }] });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/blocked-ips', {
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { rows: [{ id: 1, ip: '1.2.3.4' }] },
      error: null,
    });
    expect(r.contentType).toBe('application/json');
  });

  it('an ERROR body is { success: false, data: null, error: <string> }', async () => {
    authedAdminDb({ cleanIp: () => '' });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/ip-associations', {
      url: '/admin/api/ip-associations?ip=nonsense',
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'a valid IP address is required' });
  });

  it('a data:{ ok:true } body rides inside the same envelope', async () => {
    authedAdminDb({ setAccountDeactivated: async () => {} });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
  });

  it('every admin RouteDef declares surface admin + meta.envelope admin', () => {
    for (const r of routes) {
      expect(r.surface, r.path).toBe('admin');
      expect(r.meta?.envelope, r.path).toBe('admin');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The requireAdmin gate (mirrors the legacy adminAccountId(req) resolver).
// ---------------------------------------------------------------------------

describe('requireAdmin gate', () => {
  it('401s a missing bearer DB-free with the legacy admin body', async () => {
    const accountForToken = vi.fn(async () => ADMIN_ACCOUNT_ID);
    const isAdminAccount = vi.fn(async () => true);
    setDb({ accountForToken, isAdminAccount });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview');
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'admin authentication required' });
    // A missing bearer never reaches the token lookup.
    expect(accountForToken).not.toHaveBeenCalled();
  });

  it('401s a valid bearer whose account is NOT an admin', async () => {
    setDb({ accountForToken: async () => 42, isAdminAccount: async () => false });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'admin authentication required' });
  });

  it('401s a bearer that resolves to no account', async () => {
    setDb({ accountForToken: async () => null, isAdminAccount: async () => true });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'admin authentication required' });
  });

  it('lets a valid admin through to the handler', async () => {
    authedAdminDb({
      overviewCounts: async () => ({ peakOnlineToday: 0, peakOnlineAllTime: 0 }),
      providerUsageSnapshot: () => ({ generatedAt: 0, windows: [], metrics: [], caches: [] }),
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(200);
    expect((r.body as { success: boolean }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. POST /admin/api/login (anonymous; its own in-handler rateLimited limiter).
// ---------------------------------------------------------------------------

describe('POST /admin/api/login', () => {
  it('is registered anonymous (NO requireAdmin middleware)', () => {
    const login = routeFor('POST', '/admin/api/login');
    expect(login.middleware ?? []).toEqual([]);
  });

  it('429s when its OWN rateLimited bucket is exhausted (legacy prose)', async () => {
    // Its limiter is the legacy rateLimited (ADMIN_LOGIN_MAX per IP), isolated from the
    // new POLICIES table: drain the shared IP window to the cap and the 11th trips.
    for (let i = 0; i < ADMIN_LOGIN_MAX; i++) rateLimited(makeReq(), ADMIN_LOGIN_MAX);
    const r = await runRoute('POST', '/admin/api/login', {
      body: { username: 'a', password: 'b' },
    });
    expect(r.status).toBe(429);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'too many attempts, wait a minute and try again',
    });
  });

  it('401s bad credentials db-free when the username is absent (anti-enumeration)', async () => {
    const findAccount = vi.fn(async () => null);
    setDb({ findAccount, rateLimited: () => false });
    const r = await runRoute('POST', '/admin/api/login', { body: {} });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ success: false, data: null, error: 'invalid username or password' });
    // No username string -> findAccount is never called (matches the golden).
    expect(findAccount).not.toHaveBeenCalled();
  });

  it('403s a valid non-admin account (no admin access)', async () => {
    setDb({
      rateLimited: () => false,
      findAccount: async () => ({ id: 9, username: 'bob', password_hash: 'h' }) as never,
      verifyPassword: async () => true,
      isAdminAccount: async () => false,
    });
    const r = await runRoute('POST', '/admin/api/login', {
      body: { username: 'bob', password: 'pw' },
    });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'this account does not have admin access',
    });
  });

  it('200s a valid admin login with the token + username', async () => {
    setDb({
      rateLimited: () => false,
      findAccount: async () => ({ id: 9, username: 'bob', password_hash: 'h' }) as never,
      verifyPassword: async () => true,
      isAdminAccount: async () => true,
      touchLogin: async () => {},
      newToken: () => 'tok123',
      saveToken: async () => {},
    });
    const r = await runRoute('POST', '/admin/api/login', {
      body: { username: 'bob', password: 'pw' },
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      success: true,
      data: { token: 'tok123', username: 'bob' },
      error: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 4. The operator :id loader (requireAdminTarget) + enum :action decode.
// ---------------------------------------------------------------------------

describe('operator :id loader + enum :action', () => {
  it('reaches the handler with a valid numeric :id', async () => {
    authedAdminDb({ setAccountDeactivated: async () => {} });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
    });
    expect(r.status).toBe(200);
    expect(r.reached).toBe(true);
  });

  it('422s a non-numeric :id before any handler runs', async () => {
    const setAccountDeactivated = vi.fn(async () => {});
    authedAdminDb({ setAccountDeactivated });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: 'abc' },
      body: {},
    });
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ success: false, data: null, error: 'validation.failed' });
    expect(r.reached).toBe(false);
    expect(setAccountDeactivated).not.toHaveBeenCalled();
  });

  it('422s a non-positive :id (0)', async () => {
    authedAdminDb({ setAccountDeactivated: async () => {} });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reactivate', {
      headers: { authorization: BEARER },
      params: { id: '0' },
      body: {},
    });
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ success: false, data: null, error: 'validation.failed' });
  });

  for (const action of ['suspend', 'unsuspend', 'ban', 'unban'] as const) {
    it(`decodes the valid action "${action}" and reaches moderateAccount`, async () => {
      const moderateAccount = vi.fn(async () => {});
      authedAdminDb({ moderateAccount, accountMailTarget: async () => null });
      installAdminRuntime();
      const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
        headers: { authorization: BEARER },
        params: { id: '5', action },
        body: {},
      });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
      expect(moderateAccount).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 5, adminAccountId: ADMIN_ACCOUNT_ID, action }),
      );
    });
  }

  it('422s a fifth action outside the enum (never calls moderateAccount)', async () => {
    const moderateAccount = vi.fn(async () => {});
    authedAdminDb({ moderateAccount });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '5', action: 'frobnicate' },
      body: {},
    });
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ success: false, data: null, error: 'validation.failed' });
    expect(moderateAccount).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. The page/limit pagination contract (page/limit, NOT page/pageSize).
// ---------------------------------------------------------------------------

describe('page/limit pagination contract', () => {
  it('passes page + limit through to the db read and preserves the rows/total/page/limit shape', async () => {
    const listAccounts = vi.fn(async (search: string, page: number, limit: number) => ({
      rows: [{ id: 1 }],
      total: 1,
      page,
      limit,
      search,
    }));
    authedAdminDb({ listAccounts });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/accounts', {
      url: '/admin/api/accounts?page=2&limit=10&search=bob',
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    expect(listAccounts).toHaveBeenCalledWith('bob', 2, 10);
    expect(r.body).toEqual({
      success: true,
      data: { rows: [{ id: 1 }], total: 1, page: 2, limit: 10, search: 'bob' },
      error: null,
    });
  });

  it('clamps limit to MAX_PAGE_LIMIT (200) and floors page at 1', async () => {
    const listAccounts = vi.fn(async (_s: string, page: number, limit: number) => ({
      page,
      limit,
    }));
    authedAdminDb({ listAccounts });
    installAdminRuntime();
    await runRoute('GET', '/admin/api/accounts', {
      url: '/admin/api/accounts?page=-5&limit=9999',
      headers: { authorization: BEARER },
    });
    expect(listAccounts).toHaveBeenCalledWith('', 1, 200);
  });

  it('is LENIENT: a non-numeric page/limit DEFAULTS (never 422)', async () => {
    const listAccounts = vi.fn(async (_s: string, page: number, limit: number) => ({
      page,
      limit,
    }));
    authedAdminDb({ listAccounts });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/accounts', {
      url: '/admin/api/accounts?page=abc&limit=xyz',
      headers: { authorization: BEARER },
    });
    expect(r.status).toBe(200);
    // page defaults to 1, limit to DEFAULT_PAGE_LIMIT (25); NOT a validation 422.
    expect(listAccounts).toHaveBeenCalledWith('', 1, 25);
  });

  it('bug-reports uses page/limit and the { rows, total, page, limit } shape', async () => {
    const listBugReports = vi.fn(async (limit: number, offset: number) => ({
      rows: [{ id: 1 }],
      total: 1,
      _limit: limit,
      _offset: offset,
    }));
    authedAdminDb({ listBugReports });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/bug-reports', {
      url: '/admin/api/bug-reports?page=3&limit=20',
      headers: { authorization: BEARER },
    });
    expect(listBugReports).toHaveBeenCalledWith(20, 40);
    expect(r.body).toEqual({
      success: true,
      data: { rows: [{ id: 1 }], total: 1, page: 3, limit: 20 },
      error: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Game-session side effects preserved.
// ---------------------------------------------------------------------------

describe('game.* side effects preserved', () => {
  it('blocked-ips POST reloads the live list and kicks the IP', async () => {
    authedAdminDb({ addBlockedIp: async () => '9.9.9.9' });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/blocked-ips', {
      headers: { authorization: BEARER },
      body: { ip: '9.9.9.9', reason: 'spam' },
    });
    expect(r.status).toBe(200);
    expect(rt.reloadBlockedIps).toHaveBeenCalledTimes(1);
    expect(rt.disconnectByIp).toHaveBeenCalledWith('9.9.9.9', 'Connection to the server was lost.');
  });

  it('a suspend disconnects the target account and fires the best-effort mail', async () => {
    const emailSecurityIncident = vi.fn();
    authedAdminDb({
      moderateAccount: async () => {},
      accountMailTarget: async () =>
        ({ id: 5, username: 'x', email: 'x@y.z', locale: 'en', marketing_opt_in: false }) as never,
      emailSecurityIncident,
    });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '5', action: 'suspend' },
      body: { reason: 'griefing' },
    });
    expect(r.status).toBe(200);
    expect(rt.disconnectAccount).toHaveBeenCalledWith(5, 'This account is suspended.');
  });

  it('chat-mute mutes the live sessions', async () => {
    authedAdminDb({ muteAccountChat: async () => {} });
    const rt = installAdminRuntime();
    await runRoute('POST', '/admin/api/moderation/accounts/:id/chat-mute', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { expiresAt: '2030-01-01', reason: 'spam' },
    });
    expect(rt.muteAccountChat).toHaveBeenCalledWith(5, '2030-01-01', 'spam');
  });

  it('force-rename disconnects the character owner', async () => {
    authedAdminDb({ forceCharacterRename: async () => ({ accountId: 88 }) });
    const rt = installAdminRuntime();
    await runRoute('POST', '/admin/api/moderation/characters/:id/force-rename', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: { reason: 'bad name' },
    });
    expect(rt.disconnectAccount).toHaveBeenCalledWith(
      88,
      'A moderator requires one of your characters to be renamed.',
    );
  });

  it('reset-strikes pushes the live reset when a row was updated', async () => {
    authedAdminDb({ resetChatStrikes: async () => true });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/reset-strikes', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
    });
    expect(r.status).toBe(200);
    expect(rt.resetChatStrikesLive).toHaveBeenCalledWith(5);
  });

  it('a chat-filter word add reloads the live filter', async () => {
    authedAdminDb({ addFilterWord: async () => true });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/chat-filter/words', {
      headers: { authorization: BEARER },
      body: { word: 'bad', tier: 'soft' },
    });
    expect(r.status).toBe(200);
    expect(rt.reloadChatFilter).toHaveBeenCalledTimes(1);
  });

  it('the best-effort mail is ISOLATED: a moderateAccount success still 200s even if a target lookup rejects', async () => {
    authedAdminDb({
      moderateAccount: async () => {},
      accountMailTarget: async () => {
        throw new Error('mail db down');
      },
    });
    const rt = installAdminRuntime();
    // The email is fired as a void .then().catch(), so the 200 is written synchronously
    // after moderateAccount + disconnect; a later mail rejection cannot fail the action.
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: '5', action: 'ban' },
      body: {},
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, data: { ok: true }, error: null });
    expect(rt.disconnectAccount).toHaveBeenCalledWith(5, 'This account has been banned.');
  });
});

// ---------------------------------------------------------------------------
// 7. Guards + 404s preserved.
// ---------------------------------------------------------------------------

describe('guards + not-found bodies preserved', () => {
  it('400s a suspend on an ADMIN target (admin accounts cannot be suspended or banned)', async () => {
    const moderateAccount = vi.fn(async () => {});
    authedAdminDb({ moderateAccount });
    installAdminRuntime();
    // Target the admin id: isAdminAccount(ADMIN_ACCOUNT_ID) is true.
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/:action', {
      headers: { authorization: BEARER },
      params: { id: String(ADMIN_ACCOUNT_ID), action: 'ban' },
      body: {},
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'admin accounts cannot be suspended or banned',
    });
    expect(moderateAccount).not.toHaveBeenCalled();
  });

  it('400s a chat-mute on an ADMIN target (admin accounts cannot be chat muted)', async () => {
    authedAdminDb({ muteAccountChat: async () => {} });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/accounts/:id/chat-mute', {
      headers: { authorization: BEARER },
      params: { id: String(ADMIN_ACCOUNT_ID) },
      body: {},
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({
      success: false,
      data: null,
      error: 'admin accounts cannot be chat muted',
    });
  });

  it('400s a chat-filter word with an invalid tier', async () => {
    authedAdminDb();
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/chat-filter/words', {
      headers: { authorization: BEARER },
      body: { word: 'x', tier: 'medium' },
    });
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, data: null, error: 'tier must be "soft" or "hard"' });
  });

  it('404s an ignore on a report that is not open', async () => {
    authedAdminDb({ ignoreReport: async () => false });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/moderation/reports/:id/ignore', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'open report not found' });
  });

  it('404s a word delete that removed nothing', async () => {
    authedAdminDb({ removeFilterWord: async () => false });
    const rt = installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/chat-filter/words/:id/delete', {
      headers: { authorization: BEARER },
      params: { id: '5' },
      body: {},
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'word not found' });
    // A miss does NOT reload the live filter.
    expect(rt.reloadChatFilter).not.toHaveBeenCalled();
  });

  it('404s a blocked-ips/delete that removed nothing (after a valid ip)', async () => {
    authedAdminDb({ cleanIp: () => '9.9.9.9', removeBlockedIp: async () => false });
    installAdminRuntime();
    const r = await runRoute('POST', '/admin/api/blocked-ips/delete', {
      headers: { authorization: BEARER },
      body: { ip: '9.9.9.9' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'IP not found' });
  });

  it('404s an accounts/:id detail for an absent account (handler-owned, NOT the loader)', async () => {
    authedAdminDb({ accountDetail: async () => null });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/accounts/:id', {
      headers: { authorization: BEARER },
      params: { id: '5' },
    });
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ success: false, data: null, error: 'account not found' });
  });
});

// ---------------------------------------------------------------------------
// 8. adminBodyValidationRemap: an unexpected throw becomes a 500 admin envelope.
// ---------------------------------------------------------------------------

describe('adminBodyValidationRemap (unexpected 500)', () => {
  it('serializes an unexpected throw as a 500 { success:false, data:null, error:"internal.error" }', async () => {
    authedAdminDb({
      overviewCounts: async () => {
        throw new Error('db exploded');
      },
    });
    installAdminRuntime();
    const r = await runRoute('GET', '/admin/api/overview', { headers: { authorization: BEARER } });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ success: false, data: null, error: 'internal.error' });
    expect(r.contentType).toBe('application/json');
    // The admin envelope, NOT problem+json.
    expect(r.contentType).not.toBe('application/problem+json');
  });
});

// ---------------------------------------------------------------------------
// 9. Route wiring sanity via apiRegistry (the registry the dispatcher queries).
// ---------------------------------------------------------------------------

describe('admin route wiring (apiRegistry.resolve)', () => {
  it('resolves the login route to a matched RouteDef', () => {
    expect(apiRegistry.resolve('POST', '/admin/api/login').kind).toBe('matched');
  });

  it('resolves a wrong method on a migrated read to methodNotAllowed (delegated to legacy)', () => {
    const result = apiRegistry.resolve('PUT', '/admin/api/overview');
    expect(result.kind).toBe('methodNotAllowed');
    if (result.kind === 'methodNotAllowed') {
      expect(result.allow).toContain('GET');
    }
  });

  it('resolves an unknown admin path to notFound (delegated to legacy handleAdminApi)', () => {
    expect(apiRegistry.resolve('GET', '/admin/api/does-not-exist').kind).toBe('notFound');
  });
});
