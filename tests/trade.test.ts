// Direct unit tests for the extracted trade module (src/sim/social/trade.ts).
// The module is driven through a minimal fake SimContext (no full Sim): the
// inventory hub is a per-pid bag Map, players/entities are plain stubs. This
// proves the trade logic is decoupled and exercises the swap, the guards, the
// cancel path, and the updateTradesAndInvites invite-expiry + drift sweep.

import { describe, expect, it } from 'vitest';
import type { SimContext } from '../src/sim/sim_context';
import * as tradeMod from '../src/sim/social/trade';

function makeTradeCtx() {
  const players = new Map<number, any>();
  const entities = new Map<number, any>();
  const trades = new Map<number, any>();
  const tradeInvites = new Map<number, { fromPid: number; expires: number }>();
  const partyInvites = new Map<number, { fromPid: number; expires: number }>();
  const duelInvites = new Map<number, { fromPid: number; expires: number }>();
  const bags = new Map<number, Map<string, number>>();
  const events: any[] = [];
  let time = 0;
  const bag = (pid: number) => {
    let b = bags.get(pid);
    if (!b) {
      b = new Map();
      bags.set(pid, b);
    }
    return b;
  };
  const ctx = {
    get time() {
      return time;
    },
    players,
    entities,
    trades,
    tradeInvites,
    partyInvites,
    duelInvites,
    resolve: (pid?: number) => {
      const meta = players.get(pid!);
      const e = entities.get(pid!);
      return meta && e ? { meta, e } : null;
    },
    error: (pid: number, text: string) => events.push({ type: 'error', pid, text }),
    bumpDeedStat: () => {},
    emit: (ev: any) => events.push(ev),
    hasPendingSocialInvite: (tp: number) =>
      partyInvites.has(tp) || tradeInvites.has(tp) || duelInvites.has(tp),
    countItem: (itemId: string, pid?: number) => bag(pid!).get(itemId) ?? 0,
    // This fake bag store has no per-instance concept, so every held copy is
    // fungible: countFungibleItem/removeFungibleItem mirror countItem/removeItem.
    countFungibleItem: (itemId: string, pid?: number) => bag(pid!).get(itemId) ?? 0,
    addItem: (itemId: string, count: number, pid?: number) =>
      bag(pid!).set(itemId, (bag(pid!).get(itemId) ?? 0) + count),
    removeItem: (itemId: string, count: number, pid?: number) =>
      bag(pid!).set(itemId, Math.max(0, (bag(pid!).get(itemId) ?? 0) - count)),
    removeFungibleItem: (itemId: string, count: number, pid?: number) =>
      bag(pid!).set(itemId, Math.max(0, (bag(pid!).get(itemId) ?? 0) - count)),
  } as unknown as SimContext;
  function addPlayer(pid: number, name: string, x: number, copper: number) {
    // inventory/bags are the real PlayerMeta fields the capacity gate reads at
    // tradeConfirm (the swap simulation); the hub Map above stays the item store.
    players.set(pid, {
      entityId: pid,
      name,
      copper,
      inventory: [],
      bags: [null, null, null, null],
    });
    entities.set(pid, { id: pid, pos: { x, y: 0, z: 0 }, dead: false });
  }
  return {
    ctx,
    players,
    entities,
    trades,
    tradeInvites,
    partyInvites,
    events,
    addPlayer,
    bag,
    setTime: (t: number) => (time = t),
  };
}

describe('trade module (direct, no Sim)', () => {
  it('full trade: request/accept open a session; confirm swaps items + copper atomically', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 100);
    h.addPlayer(2, 'Borin', 3, 50);
    h.bag(1).set('wolf_fang', 3);
    h.bag(2).set('baked_bread', 2);

    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBeTruthy();

    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'wolf_fang', count: 2 }], 30, 1);
    tradeMod.tradeSetOffer(h.ctx, [{ itemId: 'baked_bread', count: 1 }], 10, 2);
    tradeMod.tradeConfirm(h.ctx, 1);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBeTruthy(); // not done until both confirm
    tradeMod.tradeConfirm(h.ctx, 2);

    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null); // session cleared
    expect(h.bag(1).get('wolf_fang')).toBe(1);
    expect(h.bag(2).get('wolf_fang')).toBe(2);
    expect(h.bag(1).get('baked_bread')).toBe(1);
    expect(h.bag(2).get('baked_bread')).toBe(1);
    expect(h.players.get(1).copper).toBe(100 - 30 + 10);
    expect(h.players.get(2).copper).toBe(50 - 10 + 30);
    expect(h.events.some((e) => e.type === 'tradeDone')).toBe(true);
  });

  it('rejects an out-of-range request and does not create an invite', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 999, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    expect(h.events.some((e) => e.type === 'error' && /too far away/.test(e.text))).toBe(true);
    expect(h.tradeInvites.has(2)).toBe(false);
  });

  it('a pending invitation blocks a second request', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    h.partyInvites.set(2, { fromPid: 9, expires: 999 });
    tradeMod.tradeRequest(h.ctx, 2, 1);
    expect(
      h.events.some((e) => e.type === 'error' && /already has a pending invitation/.test(e.text)),
    ).toBe(true);
    expect(h.tradeInvites.has(2)).toBe(false);
  });

  it('tradeCancel closes an open session and notifies both sides', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    tradeMod.tradeCancel(h.ctx, 1);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null);
    expect(h.events.filter((e) => e.type === 'log' && e.text === 'Trade cancelled.').length).toBe(
      2,
    );
  });

  it('preserves an instanced item payload (enchant/signature/rolled quality) across a swap', () => {
    // A dedicated fake ctx, not the shared makeTradeCtx bag store: this one models
    // one instanced copy explicitly, mirroring how removePreferFungible/addItemInstance
    // behave on the real Sim (src/sim/items.ts), so the trade payload-preservation fix
    // (src/sim/social/trade.ts transferOffer) is exercised end to end.
    const players = new Map<number, any>();
    const entities = new Map<number, any>();
    const trades = new Map<number, any>();
    const tradeInvites = new Map<number, { fromPid: number; expires: number }>();
    const partyInvites = new Map<number, { fromPid: number; expires: number }>();
    const duelInvites = new Map<number, { fromPid: number; expires: number }>();
    const events: any[] = [];
    const instance = { signedBy: 'Ayla', rolled: { quality: 'epic' } };
    // pid 1 holds exactly one instanced copy of 'wolf_fang' (no plain copies).
    players.set(1, {
      entityId: 1,
      name: 'Ayla',
      copper: 0,
      inventory: [{ itemId: 'wolf_fang', count: 1, instance }],
      bags: [null, null, null, null],
    });
    players.set(2, {
      entityId: 2,
      name: 'Borin',
      copper: 0,
      inventory: [],
      bags: [null, null, null, null],
    });
    entities.set(1, { id: 1, pos: { x: 0, y: 0, z: 0 }, dead: false });
    entities.set(2, { id: 2, pos: { x: 1, y: 0, z: 0 }, dead: false });
    const ctx = {
      time: 0,
      players,
      entities,
      trades,
      tradeInvites,
      partyInvites,
      duelInvites,
      resolve: (pid?: number) => {
        const meta = players.get(pid!);
        const e = entities.get(pid!);
        return meta && e ? { meta, e } : null;
      },
      error: (pid: number, text: string) => events.push({ type: 'error', pid, text }),
      bumpDeedStat: () => {},
      emit: (ev: any) => events.push(ev),
      hasPendingSocialInvite: (tp: number) =>
        partyInvites.has(tp) || tradeInvites.has(tp) || duelInvites.has(tp),
      countItem: (itemId: string, pid?: number) =>
        players.get(pid!).inventory.filter((s: any) => s.itemId === itemId).length,
      countFungibleItem: (itemId: string, pid?: number) =>
        players.get(pid!).inventory.filter((s: any) => s.itemId === itemId && !s.instance).length,
      removeFungibleItem: () => {},
      addItem: (itemId: string, count: number, pid?: number) => {
        const inv = players.get(pid!).inventory;
        for (let i = 0; i < count; i++) inv.push({ itemId, count: 1 });
      },
      addItemInstance: (itemId: string, inst: any, pid?: number) => {
        players.get(pid!).inventory.push({ itemId, count: 1, instance: inst });
      },
      removeItem: (itemId: string, count: number, pid?: number) => {
        const inv = players.get(pid!).inventory;
        const removed: any[] = [];
        for (let i = inv.length - 1; i >= 0 && removed.length < count; i--) {
          if (inv[i].itemId !== itemId) continue;
          removed.push(inv[i].instance);
          inv.splice(i, 1);
        }
        return removed;
      },
    } as unknown as SimContext;

    tradeMod.tradeRequest(ctx, 2, 1);
    tradeMod.tradeAccept(ctx, 2);
    tradeMod.tradeSetOffer(ctx, [{ itemId: 'wolf_fang', count: 1 }], 0, 1);
    tradeMod.tradeConfirm(ctx, 1);
    tradeMod.tradeConfirm(ctx, 2);

    expect(players.get(1).inventory).toHaveLength(0);
    expect(players.get(2).inventory).toHaveLength(1);
    // The bug this pins: a naive removeItem+addItem swap re-grants a PLAIN copy
    // and silently drops `instance`, destroying the enchant/signature/quality.
    expect(players.get(2).inventory[0].instance).toEqual(instance);
  });

  it('updateTradesAndInvites expires stale invites and cancels drifted trades', () => {
    const h = makeTradeCtx();
    h.addPlayer(1, 'Ayla', 0, 0);
    h.addPlayer(2, 'Borin', 1, 0);
    // a stale invite in each map (expires < time = 0) is swept
    h.partyInvites.set(7, { fromPid: 1, expires: -1 });
    // an open trade whose parties have drifted out of range is cancelled
    tradeMod.tradeRequest(h.ctx, 2, 1);
    tradeMod.tradeAccept(h.ctx, 2);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBeTruthy();
    h.entities.get(2).pos.x = 999;
    tradeMod.updateTradesAndInvites(h.ctx);
    expect(h.partyInvites.has(7)).toBe(false);
    expect(tradeMod.tradeFor(h.ctx, 1)).toBe(null);
  });
});
