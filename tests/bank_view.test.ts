import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { type BankItemLookup, bankSlotAction, buildBankView } from '../src/ui/bank_view';
import type { BankInfo } from '../src/world_api';

// The bank core maps the proximity-gated BankInfo snapshot (null away from a
// banker) to a flat render model (capacity / ordered slots / empty pad / buy
// panel) and decides the slot click action (whole withdraw vs the shift
// split-stack prompt, which an instanced slot suppresses). These tests pin the
// grid model, the over-capacity clamp, the buy ladder, the click matrix, and the
// ClientWorld-vs-Sim parity (the same snapshot drives an identical model whether
// read off a Sim or a JSON-mirrored ClientWorld).

// Only the quality is looked up; a quality-less item and an unknown id both fall
// back to 'common'.
const ITEMS: Record<string, { quality?: string }> = {
  sword: { quality: 'rare' },
  potion: { quality: 'common' },
  bread: {}, // quality-less -> 'common'
  signed_blade: { quality: 'epic' },
};
const lookup: BankItemLookup = (id) => ITEMS[id];

function bankInfo(over: Partial<BankInfo> = {}): BankInfo {
  return {
    slots: [],
    capacity: 24,
    purchasedSlots: 0,
    bonusSlots: 0,
    nextExpansionCost: 500,
    ...over,
  };
}

describe('buildBankView', () => {
  it('reports away from a null (no banker in reach) snapshot', () => {
    expect(buildBankView(null, lookup)).toEqual({ kind: 'away' });
  });

  it('reports an empty bank with a full empty pad', () => {
    const view = buildBankView(bankInfo({ capacity: 24 }), lookup);
    expect(view.kind).toBe('bank');
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.empty).toBe(true);
    expect(view.slots).toEqual([]);
    expect(view.capacity.used).toBe(0);
    expect(view.emptyCells).toBe(24); // emptyCells === capacity for an empty bank
  });

  it('projects the occupied grid preserving order, count display, and quality', () => {
    const slots: InvSlot[] = [
      { itemId: 'sword', count: 1 }, // count 1 -> showCount false, quality rare
      { itemId: 'potion', count: 5 }, // count > 1 -> showCount true, quality common
      { itemId: 'bread', count: 3 }, // quality-less -> 'common'
    ];
    const view = buildBankView(bankInfo({ slots, capacity: 24 }), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.empty).toBe(false);
    expect(view.slots.map((s) => s.slotIndex)).toEqual([0, 1, 2]);
    expect(view.slots.map((s) => s.itemId)).toEqual(['sword', 'potion', 'bread']);
    expect(view.slots[0]).toEqual({
      slotIndex: 0,
      itemId: 'sword',
      count: 1,
      showCount: false,
      qualityKey: 'rare',
    });
    expect(view.slots[1].showCount).toBe(true);
    expect(view.slots[1].qualityKey).toBe('common');
    expect(view.slots[2].showCount).toBe(true);
    expect(view.slots[2].qualityKey).toBe('common'); // quality-less falls back
  });

  it('pins the capacity counter (a 37/48 fixture)', () => {
    const slots: InvSlot[] = Array.from({ length: 37 }, () => ({ itemId: 'potion', count: 1 }));
    const view = buildBankView(
      bankInfo({ slots, capacity: 48, purchasedSlots: 18, bonusSlots: 6 }),
      lookup,
    );
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.capacity).toEqual({ used: 37, total: 48, purchasedSlots: 18, bonusSlots: 6 });
    expect(view.emptyCells).toBe(11); // 48 - 37
  });

  it('clamps the empty pad to 0 on an over-capacity (legacy/tampered) save', () => {
    const slots: InvSlot[] = Array.from({ length: 50 }, () => ({ itemId: 'potion', count: 1 }));
    const view = buildBankView(bankInfo({ slots, capacity: 48 }), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.capacity.used).toBe(50);
    expect(view.emptyCells).toBe(0); // never negative
  });

  it('threads a mid-ladder expansion cost into the buy panel', () => {
    const view = buildBankView(bankInfo({ nextExpansionCost: 2500 }), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.buy).toEqual({ nextCost: 2500, blockSlots: 6, maxed: false });
  });

  it('reports maxed when there is no next expansion', () => {
    const view = buildBankView(bankInfo({ nextExpansionCost: null }), lookup);
    if (view.kind !== 'bank') throw new Error('expected bank');
    expect(view.buy.nextCost).toBe(null);
    expect(view.buy.maxed).toBe(true);
    expect(view.buy.blockSlots).toBe(6);
  });
});

describe('bankSlotAction', () => {
  it('plain-clicks a whole withdraw', () => {
    expect(bankSlotAction({ itemId: 'sword', count: 1 }, 0, false)).toEqual({
      kind: 'withdraw',
      slotIndex: 0,
    });
  });

  it('shift + a multi-count fungible opens the split-stack prompt with max = count', () => {
    expect(bankSlotAction({ itemId: 'potion', count: 5 }, 2, true)).toEqual({
      kind: 'withdrawPartial',
      slotIndex: 2,
      max: 5,
    });
  });

  it('shift + a single-count stack is a whole withdraw (nothing to split)', () => {
    expect(bankSlotAction({ itemId: 'sword', count: 1 }, 1, true)).toEqual({
      kind: 'withdraw',
      slotIndex: 1,
    });
  });

  it('shift + an instanced slot withdraws whole regardless of count', () => {
    // count 2 is deliberate: it proves the instance guard, not the count, routes
    // this to a whole withdraw (the sim never splits a per-instance payload).
    const slot: InvSlot = { itemId: 'signed_blade', count: 2, instance: { signer: 'Fernando' } };
    expect(bankSlotAction(slot, 3, true)).toEqual({ kind: 'withdraw', slotIndex: 3 });
  });

  it('is a no-op on an empty cell (undefined slot)', () => {
    expect(bankSlotAction(undefined, 4, false)).toEqual({ kind: 'none' });
  });
});

describe('ClientWorld-vs-Sim parity', () => {
  // The Sim exposes its cloned bank snapshot directly; a ClientWorld mirrors it
  // from a server snapshot (a JSON round-trip). Drive the model from both a
  // Sim-shaped snapshot (with an instanced payload and nonzero bonusSlots) and its
  // JSON mirror, and assert identical output.
  it('yields identical models from a Sim-shaped and a mirror-shaped snapshot', () => {
    const simInfo: BankInfo = {
      slots: [
        { itemId: 'sword', count: 1 },
        { itemId: 'potion', count: 12 },
        {
          itemId: 'signed_blade',
          count: 1,
          instance: { signer: 'Fernando', rolled: { quality: 'epic', stats: { ap: 5 } } },
        },
      ],
      capacity: 36,
      purchasedSlots: 6,
      bonusSlots: 6,
      nextExpansionCost: 2500,
    };
    const cliInfo = JSON.parse(JSON.stringify(simInfo)) as BankInfo;
    expect(buildBankView(simInfo, lookup)).toEqual(buildBankView(cliInfo, lookup));
  });
});
