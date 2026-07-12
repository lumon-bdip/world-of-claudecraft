// The character-select Steam Link button gating (src/ui/steam_link.ts): the
// button must key off the shell's REAL capability (wocDesktop.steamLinkSupported,
// backed by the desktop-steam-capability IPC), not the mere presence of the
// steamLinkTicket bridge method, which every Electron shell exposes including
// packaged website builds where a ticket can never be minted. Driven with a
// hand-rolled fake DOM (jsdom is deliberately not a dependency) and a stubbed
// wocDesktop bridge.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../src/net/online';
import { userFacingApiError } from '../src/ui/api_error_i18n';
import { refreshSteamLinkStatus, wireSteamLink } from '../src/ui/steam_link';

// steam_link.ts consults DESKTOP_APP at call time; force the desktop arm so the
// bridge path under test is reachable in plain Node.
vi.mock('../src/net/online', () => ({ DESKTOP_APP: true }));

interface FakeElement {
  hidden: boolean;
  textContent: string | null;
  listeners: Record<string, () => void>;
  addEventListener(type: string, handler: () => void): void;
}

function installDom(): Record<string, FakeElement> {
  const elements: Record<string, FakeElement> = {};
  for (const id of ['cs-steam-group', 'steam-status', 'btn-steam-link', 'btn-steam-unlink']) {
    const listeners: Record<string, () => void> = {};
    elements[id] = {
      hidden: false,
      textContent: '',
      listeners,
      addEventListener(type: string, handler: () => void) {
        listeners[type] = handler;
      },
    };
  }
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
  };
  return elements;
}

// Drain the promise chain a click handler kicked off (no timers in play).
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Flush the pending microtask (promise) chain WITHOUT advancing the clock, so a
// fake-timer test can settle the async link/unlink flow and then still control
// the 4s flash-restore timer explicitly. Microtasks are never faked, so this
// works whether real or fake timers are installed.
async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

// The login trio is what desktopBridge() requires; the Steam methods ride on top.
function installBridge(steamMethods: Record<string, unknown>): void {
  (globalThis as { wocDesktop?: unknown }).wocDesktop = {
    openBrowserLogin: async () => {},
    takeLoginCode: async () => null,
    onLoginCode: () => () => {},
    ...steamMethods,
  };
}

// An authed, server-advertised, not-yet-linked player: the one state where the
// Link button is a candidate to show at all.
const unlinkedApi = {
  token: 'session-token',
  steamAdvert: async () => true,
  steamStatus: async () => ({ enabled: true, linked: false }),
} as unknown as Api;

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { wocDesktop?: unknown }).wocDesktop;
  // The flash-surfacing tests below install a window shim and fake timers; undo
  // both so the capability-gating tests keep running under real timers.
  delete (globalThis as { window?: unknown }).window;
  vi.useRealTimers();
});

describe('refreshSteamLinkStatus capability gating', () => {
  it('hides the Link button when the shell reports Steam unsupported (website build)', async () => {
    const elements = installDom();
    installBridge({
      steamLinkTicket: async () => null,
      steamLinkSupported: async () => false,
    });
    await refreshSteamLinkStatus(unlinkedApi);
    expect(elements['cs-steam-group'].hidden).toBe(false);
    expect(elements['btn-steam-link'].hidden).toBe(true);
  });

  it('shows the Link button when the shell reports Steam supported', async () => {
    const elements = installDom();
    installBridge({
      steamLinkTicket: async () => 'deadbeef',
      steamLinkSupported: async () => true,
    });
    await refreshSteamLinkStatus(unlinkedApi);
    expect(elements['cs-steam-group'].hidden).toBe(false);
    expect(elements['btn-steam-link'].hidden).toBe(false);
  });

  it('falls back to ticket-method presence on older shells without the capability probe', async () => {
    const elements = installDom();
    installBridge({ steamLinkTicket: async () => 'deadbeef' });
    await refreshSteamLinkStatus(unlinkedApi);
    expect(elements['btn-steam-link'].hidden).toBe(false);
  });

  it('keeps hiding the Link button when even the ticket method is absent', async () => {
    const elements = installDom();
    installBridge({});
    await refreshSteamLinkStatus(unlinkedApi);
    expect(elements['btn-steam-link'].hidden).toBe(true);
  });

  it('falls back to ticket-method presence when the capability probe throws', async () => {
    // A transient bridge error must not hide a working Link button; the server
    // stays the authority, so the worst case is a click that mints null.
    const elements = installDom();
    installBridge({
      steamLinkTicket: async () => 'deadbeef',
      steamLinkSupported: async () => {
        throw new Error('ipc hiccup');
      },
    });
    await refreshSteamLinkStatus(unlinkedApi);
    expect(elements['btn-steam-link'].hidden).toBe(false);
  });
});

describe('startSteamLink capability guard', () => {
  it('never mints a ticket when the shell reports Steam unsupported', async () => {
    const elements = installDom();
    const mint = vi.fn(async () => 'deadbeef');
    installBridge({
      steamLinkTicket: mint,
      steamLinkSupported: async () => false,
    });
    const steamLink = vi.fn(async () => ({}));
    const api = {
      token: 'session-token',
      steamAdvert: async () => true,
      steamStatus: async () => ({ enabled: true, linked: false }),
      steamLink,
    } as unknown as Api;
    wireSteamLink(api);
    elements['btn-steam-link'].listeners.click();
    await flushAsync();
    expect(mint).not.toHaveBeenCalled();
    expect(steamLink).not.toHaveBeenCalled();
  });

  it('mints and posts the ticket when the shell reports Steam supported', async () => {
    const elements = installDom();
    const mint = vi.fn(async () => 'deadbeef');
    installBridge({
      steamLinkTicket: mint,
      steamLinkSupported: async () => true,
    });
    const steamLink = vi.fn(async () => ({}));
    const api = {
      token: 'session-token',
      steamAdvert: async () => true,
      steamStatus: async () => ({ enabled: true, linked: false }),
      steamLink,
    } as unknown as Api;
    wireSteamLink(api);
    elements['btn-steam-link'].listeners.click();
    await flushAsync();
    expect(mint).toHaveBeenCalledTimes(1);
    expect(steamLink).toHaveBeenCalledWith('deadbeef');
  });

  it('a double click mints exactly one ticket: the in-flight latch drops re-entry', async () => {
    // Two rapid clicks without the latch mint twice: the second mint makes the
    // shell cancel a ticket the server may still be verifying, and strands the
    // first handle uncancelled. The latch holds until the attempt settles.
    const elements = installDom();
    let releaseMint: (ticket: string) => void = () => {};
    const mint = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseMint = resolve;
        }),
    );
    installBridge({ steamLinkTicket: mint, steamLinkSupported: async () => true });
    const steamLink = vi.fn(async () => ({}));
    const api = {
      token: 'session-token',
      steamAdvert: async () => true,
      steamStatus: async () => ({ enabled: true, linked: false }),
      steamLink,
    } as unknown as Api;
    wireSteamLink(api);
    elements['btn-steam-link'].listeners.click();
    await flushAsync(); // past the capability probe: the mint is now pending
    elements['btn-steam-link'].listeners.click(); // mid-flight: must be dropped
    await flushAsync();
    expect(mint).toHaveBeenCalledTimes(1);
    releaseMint('deadbeef');
    await flushAsync();
    expect(steamLink).toHaveBeenCalledTimes(1);
    expect(steamLink).toHaveBeenCalledWith('deadbeef');
    // The latch releases once the attempt settles: a later click mints again.
    elements['btn-steam-link'].listeners.click();
    await flushAsync();
    expect(mint).toHaveBeenCalledTimes(2);
  });
});

// flashSteamStatus writes into #steam-status for 4s. Its restore guard only
// checks textContent, so a status refresh that toggles the element's `hidden`
// after the flash would swallow the error early; and an unlink failure gave no
// user feedback at all. These drive the wired buttons with a window shim (the
// flash uses window.setTimeout, absent in the node test env) under fake timers.
describe('link/unlink failure surfacing', () => {
  // The latch test above deliberately leaves a mint in flight, so the module-level
  // linkInFlight latch stays set; a fresh import gives these attempts a clean latch
  // instead of having the wired click silently dropped as re-entry.
  let steam: typeof import('../src/ui/steam_link');
  beforeEach(async () => {
    vi.resetModules();
    steam = await import('../src/ui/steam_link');
  });

  it('keeps the link error visible after the trailing status refresh, then restores after 4s', async () => {
    vi.useFakeTimers();
    const elements = installDom();
    (globalThis as { window?: unknown }).window = globalThis;
    installBridge({
      steamLinkTicket: async () => 'deadbeef',
      steamLinkSupported: async () => true,
    });
    const err = { code: 'steam.invalid_ticket' };
    const steamLink = vi.fn(async () => {
      throw err;
    });
    const api = {
      token: 'session-token',
      steamAdvert: async () => true,
      steamStatus: async () => ({ enabled: true, linked: false }),
      steamLink,
    } as unknown as Api;

    steam.wireSteamLink(api);
    await settleMicrotasks(); // the wire's initial refresh: unlinked -> status hidden
    elements['btn-steam-link'].listeners.click();
    await settleMicrotasks(); // mint -> steamLink reject -> refresh -> flash

    const status = elements['steam-status'];
    // Decisive: the trailing unlinked refresh (hidden = true) must not swallow
    // the flash. Red on the old order, where the refresh ran after the flash and
    // hid the error within a frame.
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe(userFacingApiError(err));

    // The 4s flash window then restores the prior (hidden, unlinked) status.
    await vi.advanceTimersByTimeAsync(4000);
    expect(status.textContent).toBe('');
    expect(status.hidden).toBe(true);
  });

  it('surfaces a localized error when the unlink call fails (previously silent)', async () => {
    vi.useFakeTimers();
    const elements = installDom();
    (globalThis as { window?: unknown }).window = globalThis;
    installBridge({
      steamLinkTicket: async () => 'deadbeef',
      steamLinkSupported: async () => true,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = { code: 'steam.upstream' };
    const unlinkSteam = vi.fn(async () => {
      throw err;
    });
    const api = {
      token: 'session-token',
      steamAdvert: async () => true,
      steamStatus: async () => ({ enabled: true, linked: true, steamId: 'STEAM_1:1' }),
      unlinkSteam,
    } as unknown as Api;

    steam.wireSteamLink(api);
    await settleMicrotasks(); // initial refresh: linked -> unlink button shown
    elements['btn-steam-unlink'].listeners.click();
    await settleMicrotasks(); // unlink rejects -> dev log + localized flash

    const status = elements['steam-status'];
    // Red on the old code: the unlink failure was console-only, leaving the
    // linked status text in place with no error surfaced to the player.
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe(userFacingApiError(err));
    // The dev-channel log still fires alongside the localized flash.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
