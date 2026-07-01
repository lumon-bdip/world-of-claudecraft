// Registry-wide DENY-BY-DEFAULT functional coverage gate for the Phase 12 BOLA
// seam (docs/api-pipeline/).
//
// tests/server/http/completeness.test.ts already asserts the METADATA marker:
// checkRequireOwnedCoverage([...apiRoutes]) is empty, so every account-owned :id
// route DECLARES meta.requireOwned { ownerScope: 'account' }. That is a static
// promise about the route table, not about what the route actually DOES.
//
// This file adds the functional guarantee the metadata cannot give: that every
// account-owned :id route in the registry actually MOUNTS an account-scoped owner
// loader that DENIES a non-owned / absent id with a 404 (deny-by-default), before
// the handler's success body is ever produced. It is the load-bearing BOLA
// coverage test the packet leans on: a route that carried the marker but forgot to
// mount requireOwnedCharacter would ship a cross-account read hole that the
// metadata check waves through; this sweep turns that into a red test.
//
// How it works: the account db seam is driven with a fake whose getCharacter
// ALWAYS returns null (the deny path: no owned row for the caller), the auth guard
// is satisfied with a valid full-scope bearer, and each route's real middleware
// chain is run via compose(). A route with the loader mounted answers the player-
// owned 404 and never reaches its handler; a route missing the loader would fall
// through to its 200 handler, which the negative control proves the sweep detects.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CharactersRuntime,
  configureCharactersRuntime,
  resetCharactersDbForTests,
  resetCharactersRuntimeForTests,
  setCharactersDbForTests,
} from '../../../server/characters';
import { compose } from '../../../server/http/compose';
import { apiRoutes } from '../../../server/http/registry';
import type { Ctx, Middleware, RouteDef } from '../../../server/http/types';
import { json } from '../../../server/http_util';
import { fakeCtx } from '../helpers/fake_ctx';
import type { FakeRes } from '../helpers/fake_http';

// A well-formed 64-hex bearer so the character guards' BEARER_PATTERN matches and
// the (stubbed) accountAndScopeForToken lookup is reached.
const VALID_TOKEN = 'a'.repeat(64);
// The authenticated caller the auth guards resolve the bearer to.
const CALLER_ACCOUNT_ID = 7;
// A valid positive :id, so requireOwned's num({ int, min: 1 }) decode passes and
// the account-scoped loader (which then misses) is actually exercised.
const REQUESTED_ID = '5';

// An unlocked, unmoderated account: the character auth guards read only .locked
// (and .message on a lock), so this passes the moderation gate for every caller.
const NOT_LOCKED = {
  locked: false,
  banned: false,
  suspendedUntil: null,
  reason: '',
  message: '',
  chatMutedUntil: null,
  chatStrikes: 0,
};

// The account-owned :id routes the sweep covers: every registry route whose
// meta.requireOwned is account-scoped. Phase 12's character :id subroutes
// (standing, sheet, rename, takeover, delete) are the only ones today.
const accountOwnedRoutes: RouteDef[] = apiRoutes.filter(
  (route) => route.meta?.requireOwned?.ownerScope === 'account',
);

// Substitute each :param segment with the concrete REQUESTED_ID so ctx.path/url
// read as a real request path (cosmetic here: the sweep invokes the middleware
// chain directly, so params are set explicitly rather than by the router).
function concretePath(path: string): string {
  return path
    .split('/')
    .map((segment) => (segment.startsWith(':') ? REQUESTED_ID : segment))
    .join('/');
}

// Install the denying character db seam: the bearer resolves to a full-scope
// account, the moderation gate passes, and getCharacter ALWAYS misses (the
// deny-by-default path the loader must answer with a 404). lifetimeXpStanding is
// stubbed to null too, so even if a route somehow skipped the loader its handler
// would not touch Postgres.
function installDenyingCharacterDb(): void {
  setCharactersDbForTests({
    accountAndScopeForToken: async () => ({ accountId: CALLER_ACCOUNT_ID, scope: 'full' as const }),
    moderationStatusForAccount: async () => NOT_LOCKED,
    getCharacter: async () => null,
    lifetimeXpStanding: async () => null,
  });
}

// Install a fully stubbed runtime so a handler that DID run (the negative control,
// or a regression where the loader is missing) cannot crash on an unconfigured
// runtime. The deny sweep never reaches these; they exist so the failure mode of a
// missing loader is a clean 200, not an unrelated throw.
function installFakeRuntime(): void {
  const runtime: CharactersRuntime = {
    isCharacterOnline: vi.fn(() => false),
    takeOverCharacter: vi.fn(async () => 'not-online' as const),
    rekeyMarketSeller: vi.fn(() => false),
    saveMarket: vi.fn(async () => {}),
    // The fresh-character state is never serialized on the deny path; a bare object
    // is enough to satisfy the type for any handler that does run (negative control).
    initialCharacterState: vi.fn(
      () => ({}) as ReturnType<CharactersRuntime['initialCharacterState']>,
    ),
    publicOrigin: vi.fn(() => 'http://localhost'),
  };
  configureCharactersRuntime(runtime);
}

// Build an AUTHED ctx for a route: valid bearer, the route's method, a concrete
// path, and params.id set to a valid numeric id (the router is bypassed, so params
// are supplied directly).
function authedCtx(route: RouteDef): Ctx {
  return fakeCtx({
    method: route.method,
    url: concretePath(route.path),
    headers: { authorization: `Bearer ${VALID_TOKEN}` },
    params: { id: REQUESTED_ID },
  });
}

/** Read the FakeRes backing a fakeCtx so we can assert on the captured result. */
function resOf(ctx: Ctx): FakeRes {
  return ctx.res as unknown as FakeRes;
}

// Run a route's full middleware chain plus a spy-wrapped handler as the terminal
// onion frame, returning the FakeRes and the handler spy. The spy proves whether
// the handler's success body was ever produced.
async function runRoute(
  route: RouteDef,
  ctx: Ctx,
): Promise<{ res: FakeRes; handler: ReturnType<typeof vi.fn> }> {
  const handler = vi.fn(async (c: Ctx) => {
    await route.handler(c);
  });
  const stack: Middleware[] = [...(route.middleware ?? []), handler as unknown as Middleware];
  await compose(stack)(ctx);
  return { res: resOf(ctx), handler };
}

describe('ownership coverage: registry-wide deny-by-default sweep', () => {
  beforeEach(() => {
    // Silence the loader's structured bola_denied stderr line (defaultDenyLog) so
    // the sweep does not spam the test output with one warn per denied route.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installDenyingCharacterDb();
    installFakeRuntime();
  });

  afterEach(() => {
    resetCharactersDbForTests();
    resetCharactersRuntimeForTests();
    vi.restoreAllMocks();
  });

  it('selects a non-vacuous set of account-owned :id routes (at least the five character subroutes)', () => {
    expect(accountOwnedRoutes.length).toBeGreaterThanOrEqual(5);
  });

  for (const route of accountOwnedRoutes) {
    it(`denies a non-owned id on ${route.method} ${route.path} with a 404 and never runs the handler`, async () => {
      const ctx = authedCtx(route);
      const { res, handler } = await runRoute(route, ctx);

      // The account-scoped loader missed (getCharacter returned null), so the route
      // answers the player-owned anti-enumeration 404. This can only happen if the
      // loader is actually mounted in the chain: proof of deny-by-default.
      expect(res.statusCode).toBe(404);
      // The handler-owned success body is NEVER produced: the loader short-circuits
      // (no next()), so control never reaches the terminal handler frame.
      expect(handler).not.toHaveBeenCalled();
      // The denial carries a legacy player-owned prose body (exact text differs per
      // route: 'character not found' vs 'not found'), never a success payload.
      expect(JSON.parse(res.body).error).toMatch(/^(character not found|not found)$/);
    });
  }

  it('negative control: an account-owned route MISSING the loader answers 200, so the sweep is non-vacuous', async () => {
    // A synthetic RouteDef that DECLARES account ownership (so the sweep's predicate
    // would select it) but whose middleware is only an auth-passing stub: the owner
    // loader is deliberately absent. Kept LOCAL to the test (never added to
    // apiRoutes). Under the exact same denying environment as the real routes, its
    // handler runs and writes 200, proving the sweep's 404 assertion actually
    // detects the loader's presence and would FAIL for a route that forgot to mount
    // requireOwnedCharacter.
    const authStub: Middleware = async (ctx, next) => {
      ctx.account = { accountId: CALLER_ACCOUNT_ID, scope: 'full' };
      await next();
    };
    const missingLoaderRoute: RouteDef = {
      method: 'GET',
      path: '/api/characters/:id/synthetic-no-loader',
      surface: 'api',
      middleware: [authStub],
      handler: async (ctx) => {
        json(ctx.res, 200, { ok: true });
      },
      meta: { requireOwned: { kind: 'character', ownerScope: 'account' } },
    };
    // It matches the same predicate the sweep selects on.
    expect(missingLoaderRoute.meta?.requireOwned?.ownerScope).toBe('account');

    const ctx = authedCtx(missingLoaderRoute);
    const { res, handler } = await runRoute(missingLoaderRoute, ctx);

    expect(res.statusCode).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    // A route without the loader does NOT produce the deny 404 the sweep asserts,
    // which is exactly why the sweep would go red for such a route.
    expect(res.statusCode).not.toBe(404);
  });
});

describe('ownership coverage: operator scope is not yet present (Phase 17 forward guard)', () => {
  it('the registry has no operator-scoped requireOwned route today', () => {
    // The account-scoped loader (requireOwnedCharacter) is the only ownership loader
    // wired so far. Phase 17 introduces the admin/operator surface, which gets its
    // OWN admin-scope loader (denial 403, not the account 404). Until then the deny
    // sweep must not silently skip an operator-scoped :id route: assert none exists,
    // so when the first operator route lands this guard fails and forces the sweep to
    // be extended to cover the operator loader too.
    const operatorOwnedRoutes = apiRoutes.filter(
      (route) => route.meta?.requireOwned?.ownerScope === 'operator',
    );
    expect(operatorOwnedRoutes).toEqual([]);
  });
});
