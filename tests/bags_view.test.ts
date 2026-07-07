import { describe, expect, it } from 'vitest';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { DEFAULT_BAG_FILTER, type ItemLookup } from '../src/ui/bag_filter';
import {
  type BagMode,
  bagItemAction,
  bagQualityKey,
  bagShiftLinks,
  bagTooltipHintKey,
  buildBagGrid,
} from '../src/ui/bags_view';

// The bags core decides the mode-dependent click + tooltip (the 6-way branch) and
// the filtered grid model (empty / no-match / items), reusing bag_filter for the
// actual filter/sort. These tests pin the priority order, the grid states, and the
// ClientWorld-vs-Sim parity (the same inventory drives identical models
// whether read off a Sim or a ClientWorld mirror).

const NO_MODE: BagMode = {
  tradeOpen: false,
  mailAttach: false,
  marketSell: false,
  vendorOpen: false,
  petFeed: false,
};

const ITEMS: Record<string, ItemDef> = {
  sword: { kind: 'weapon', name: 'Sword', quality: 'rare' } as ItemDef,
  potion: { kind: 'potion', name: 'Potion', quality: 'common' } as ItemDef,
  bread: { kind: 'food', name: 'Bread', quality: 'common' } as ItemDef,
  questItem: { kind: 'quest', name: 'Relic', quality: 'epic' } as ItemDef,
  bound: { kind: 'armor', name: 'Bound Plate', quality: 'uncommon', noMarketList: true } as ItemDef,
  rod: { kind: 'tool', name: 'Fishing Rod', use: { type: 'fishing' } } as ItemDef,
};
const lookup: ItemLookup = (id) => ITEMS[id];

describe('bagShiftLinks', () => {
  it('links to chat in every mode except at a vendor (split-stack owns shift there)', () => {
    expect(bagShiftLinks(NO_MODE)).toBe(true);
    expect(bagShiftLinks({ ...NO_MODE, tradeOpen: true })).toBe(true);
    expect(bagShiftLinks({ ...NO_MODE, marketSell: true })).toBe(true);
    expect(bagShiftLinks({ ...NO_MODE, petFeed: true })).toBe(true);
    expect(bagShiftLinks({ ...NO_MODE, vendorOpen: true })).toBe(false);
  });
});

describe('bagItemAction priority order', () => {
  it('honors trade > market-sell > vendor > pet-feed > quest > use', () => {
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, tradeOpen: true })).toBe('trade');
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, marketSell: true })).toBe('marketSell');
    expect(bagItemAction(ITEMS.questItem, { ...NO_MODE, marketSell: true })).toBe(
      'marketSellBlockedQuest',
    );
    expect(bagItemAction(ITEMS.bound, { ...NO_MODE, marketSell: true })).toBe(
      'marketSellBlockedNoMarket',
    );
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, vendorOpen: true })).toBe('vendorSell');
    expect(bagItemAction(ITEMS.bread, { ...NO_MODE, petFeed: true })).toBe('petFeed');
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, petFeed: true })).toBe('petFeedBlocked');
    expect(bagItemAction(ITEMS.questItem, NO_MODE)).toBe('discardQuest');
    expect(bagItemAction(ITEMS.potion, NO_MODE)).toBe('use');
  });
});

describe('bag mode chain order pin (insertion guard)', () => {
  // Pins the RELATIVE order between simultaneously-on modes, not just each mode
  // alone (the priority-order test above flips one flag at a time, so a ladder
  // reorder between two on-modes could survive it). The cascade peels every mode
  // in ladder order and ends by proving it reached NO_MODE, so adding a BagMode
  // flag without adding its peel step in the right rung fails here by type and
  // by value. Extend this cascade in the SAME commit as any BagMode change.
  const ALL_MODES: BagMode = {
    tradeOpen: true,
    mailAttach: true,
    marketSell: true,
    vendorOpen: true,
    petFeed: true,
  };

  it('peels the action ladder one rung at a time: trade > mail-attach > market-sell > vendor > pet-feed > kind fallbacks', () => {
    let mode = { ...ALL_MODES };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('trade');
    mode = { ...mode, tradeOpen: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('mailAttach');
    mode = { ...mode, mailAttach: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('marketSell');
    mode = { ...mode, marketSell: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('vendorSell');
    mode = { ...mode, vendorOpen: false };
    expect(bagItemAction(ITEMS.bread, mode)).toBe('petFeed');
    expect(bagItemAction(ITEMS.sword, mode)).toBe('petFeedBlocked');
    mode = { ...mode, petFeed: false };
    expect(mode).toEqual(NO_MODE);
    expect(bagItemAction(ITEMS.questItem, mode)).toBe('discardQuest');
    expect(bagItemAction(ITEMS.sword, mode)).toBe('use');
  });

  it('blocked variants block in place, they never fall through to a lower rung', () => {
    // A mail-blocked item must NOT fall to market-sell even with that mode on.
    expect(bagItemAction(ITEMS.questItem, { ...ALL_MODES, tradeOpen: false })).toBe(
      'mailAttachBlocked',
    );
    expect(bagItemAction(ITEMS.bound, { ...ALL_MODES, tradeOpen: false })).toBe(
      'mailAttachBlocked',
    );
    // A market-blocked item must NOT fall to vendor even with vendor on.
    expect(
      bagItemAction(ITEMS.questItem, { ...ALL_MODES, tradeOpen: false, mailAttach: false }),
    ).toBe('marketSellBlockedQuest');
    expect(bagItemAction(ITEMS.bound, { ...ALL_MODES, tradeOpen: false, mailAttach: false })).toBe(
      'marketSellBlockedNoMarket',
    );
  });

  it('peels the tooltip-hint ladder the same way (pet-feed contributes no hint)', () => {
    let mode = { ...ALL_MODES };
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('itemUi.tooltip.clickTradeOffer');
    mode = { ...mode, tradeOpen: false };
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('hudChrome.mailbox.clickAttach');
    expect(bagTooltipHintKey(ITEMS.questItem, mode)).toBe('hudChrome.mailbox.cannotMail');
    mode = { ...mode, mailAttach: false };
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('itemUi.tooltip.clickMarketList');
    mode = { ...mode, marketSell: false };
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('itemUi.tooltip.clickSell');
    mode = { ...mode, vendorOpen: false };
    // Pet-feed has no tooltip hint: a weapon falls through to the kind branch.
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('itemUi.tooltip.clickEquip');
    mode = { ...mode, petFeed: false };
    expect(mode).toEqual(NO_MODE);
  });

  it('shift-to-chat-link stays vendor-owned even with every mode on', () => {
    expect(bagShiftLinks(ALL_MODES)).toBe(false);
    expect(bagShiftLinks({ ...ALL_MODES, vendorOpen: false })).toBe(true);
  });
});

describe('bagTooltipHintKey', () => {
  it('matches the mode-then-kind branch', () => {
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, tradeOpen: true })).toBe(
      'itemUi.tooltip.clickTradeOffer',
    );
    expect(bagTooltipHintKey(ITEMS.questItem, { ...NO_MODE, marketSell: true })).toBe(
      'itemUi.tooltip.cannotMarket',
    );
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, marketSell: true })).toBe(
      'itemUi.tooltip.clickMarketList',
    );
    expect(bagTooltipHintKey(ITEMS.questItem, { ...NO_MODE, vendorOpen: true })).toBe(
      'itemUi.tooltip.cannotVendor',
    );
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, vendorOpen: true })).toBe(
      'itemUi.tooltip.clickSell',
    );
    expect(bagTooltipHintKey(ITEMS.questItem, NO_MODE)).toBe('itemUi.tooltip.clickDestroy');
    expect(bagTooltipHintKey(ITEMS.sword, NO_MODE)).toBe('itemUi.tooltip.clickEquip');
    expect(bagTooltipHintKey(ITEMS.bread, NO_MODE)).toBe('itemUi.tooltip.clickConsume');
    expect(bagTooltipHintKey(ITEMS.potion, NO_MODE)).toBe('itemUi.tooltip.clickUseInstant');
    expect(bagTooltipHintKey(ITEMS.rod, NO_MODE)).toBe('itemUi.tooltip.clickUse');
    expect(bagTooltipHintKey({ kind: 'junk' }, NO_MODE)).toBe('');
  });
});

describe('bagQualityKey', () => {
  it('falls back to common when quality is unset', () => {
    expect(bagQualityKey({ quality: 'epic' })).toBe('epic');
    expect(bagQualityKey({})).toBe('common');
  });
});

describe('buildBagGrid', () => {
  const inv: InvSlot[] = [
    { itemId: 'sword', count: 1 },
    { itemId: 'potion', count: 5 },
    { itemId: 'questItem', count: 1 },
  ];

  it('reports empty for an empty bag', () => {
    expect(buildBagGrid([], lookup, DEFAULT_BAG_FILTER).state).toBe('empty');
  });

  it('reports items with the full unfiltered list (recent order preserved)', () => {
    const model = buildBagGrid(inv, lookup, DEFAULT_BAG_FILTER);
    expect(model.state).toBe('items');
    expect(model.visible.map((s) => s.itemId)).toEqual(['sword', 'potion', 'questItem']);
  });

  it('reuses bag_filter: a category filter narrows the visible rows', () => {
    const weaponsOnly = buildBagGrid(inv, lookup, { ...DEFAULT_BAG_FILTER, category: 'weapon' });
    expect(weaponsOnly.state).toBe('items');
    expect(weaponsOnly.visible.map((s) => s.itemId)).toEqual(['sword']);
  });

  it('reports no-match when the filter excludes everything in a non-empty bag', () => {
    const none = buildBagGrid(inv, lookup, { ...DEFAULT_BAG_FILTER, search: 'zzzzz' });
    expect(none.state).toBe('noMatch');
    expect(none.visible).toEqual([]);
  });

  it('is a pure projection (same input -> same output)', () => {
    expect(buildBagGrid(inv, lookup, DEFAULT_BAG_FILTER)).toEqual(
      buildBagGrid(inv, lookup, DEFAULT_BAG_FILTER),
    );
  });
});

describe('ClientWorld-vs-Sim parity', () => {
  // The Sim exposes its inventory array directly; a ClientWorld mirrors it from a
  // server snapshot (a JSON round-trip). Drive the grid model from both and assert
  // identical output, with a quality sort to exercise the ordering path.
  it('yields identical grid models from a Sim-shaped and a mirror-shaped inventory', () => {
    const simInv: InvSlot[] = [
      { itemId: 'potion', count: 3 },
      { itemId: 'sword', count: 1 },
      { itemId: 'questItem', count: 1 },
    ];
    const cliInv = JSON.parse(JSON.stringify(simInv)) as InvSlot[];
    const filter = { ...DEFAULT_BAG_FILTER, sort: 'quality' as const };
    expect(buildBagGrid(simInv, lookup, filter)).toEqual(buildBagGrid(cliInv, lookup, filter));
  });
});
