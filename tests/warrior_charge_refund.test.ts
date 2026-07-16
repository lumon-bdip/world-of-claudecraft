// Cleaving Blows (Fury passive): casting Red Harvest refunds one stored charge
// of Twinstrike (raging_gale) on the abilityCharges recharge model. The refund
// re-opens an empty pool (the empty-pool cooldown mirror goes) but never
// overfills, and it is strictly gated on the passive being known. Restored from
// the pre-unify Map-model suite (tests/warrior_new_passives.test.ts on the PTR
// reference branch) and ported to the one live charge model.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type TestSim = Sim & { nextId: number; addEntity(entity: Entity): void };

function makeFuryWarrior(seed = 7): { sim: TestSim; p: Entity; mob: Entity } {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as TestSim;
  sim.setPlayerLevel(20);
  expect(sim.setSpec('fury')).toBe(true);
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  mob.maxHp = 1_000_000;
  mob.hp = mob.maxHp;
  mob.hostile = true;
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return { sim, p, mob };
}

describe('Cleaving Blows (Fury): Red Harvest refunds a charge of Twinstrike', () => {
  it('refunds one spent raging_gale charge (1 -> 2) and clears the full pool timer', () => {
    const { sim, p } = makeFuryWarrior();
    p.gcdRemaining = 0;
    sim.castAbility('raging_gale'); // spend one of the two stored uses
    expect(p.abilityCharges?.raging_gale).toEqual({
      charges: 1,
      maxCharges: 2,
      recharge: 8,
      rechargeLength: 8,
    });
    p.resource = 100;
    p.gcdRemaining = 0;
    sim.castAbility('red_harvest');
    expect(p.abilityCharges?.raging_gale?.charges).toBe(2); // refunded to full
    expect(p.abilityCharges?.raging_gale?.recharge).toBe(0); // full pool: timer cleared
    expect(p.cooldowns.has('raging_gale')).toBe(false);
  });

  it('a refund from an EMPTY pool re-opens it and keeps the recharge running', () => {
    const { sim, p } = makeFuryWarrior(9);
    p.gcdRemaining = 0;
    sim.castAbility('raging_gale');
    p.gcdRemaining = 0;
    sim.castAbility('raging_gale');
    expect(p.abilityCharges?.raging_gale?.charges).toBe(0);
    expect(p.cooldowns.get('raging_gale')).toBe(8); // empty-pool cooldown mirror
    p.resource = 100;
    p.gcdRemaining = 0;
    sim.castAbility('red_harvest');
    expect(p.abilityCharges?.raging_gale?.charges).toBe(1);
    expect(p.abilityCharges?.raging_gale?.recharge).toBe(8); // second use still recharging
    expect(p.cooldowns.has('raging_gale')).toBe(false); // castable again right away
  });

  it('does NOT refund when the passive is absent', () => {
    const { sim, p } = makeFuryWarrior(11);
    const meta = sim.meta(p.id);
    if (!meta) throw new Error('missing player meta');
    meta.known = meta.known.filter((known) => known.def.id !== 'cleaving_blows');
    p.gcdRemaining = 0;
    sim.castAbility('raging_gale');
    expect(p.abilityCharges?.raging_gale?.charges).toBe(1);
    p.resource = 100;
    p.gcdRemaining = 0;
    sim.castAbility('red_harvest');
    expect(p.abilityCharges?.raging_gale?.charges).toBe(1); // no refund
  });

  it('never overfills: Red Harvest with a full Twinstrike pool leaves it at 2 of 2', () => {
    const { sim, p } = makeFuryWarrior(13);
    p.gcdRemaining = 0;
    sim.castAbility('raging_gale');
    p.resource = 100;
    p.gcdRemaining = 0;
    sim.castAbility('red_harvest'); // back to full
    expect(p.abilityCharges?.raging_gale?.charges).toBe(2);
    p.resource = 100;
    p.gcdRemaining = 0;
    sim.castAbility('red_harvest'); // full pool: nothing to refund
    expect(p.abilityCharges?.raging_gale?.charges).toBe(2);
  });
});
