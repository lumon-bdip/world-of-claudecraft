import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

function castBarrier(
  level: number,
  spec: 'fire' | 'frost',
  abilityId: 'blazing_barrier' | 'ice_barrier',
): { absorb: number; cost: number; maxHp: number } {
  const sim = new Sim({ seed: 707, playerClass: 'mage', autoEquip: true });
  sim.setPlayerLevel(level);
  expect(sim.setSpec(spec)).toBe(true);
  sim.player.resource = sim.player.maxResource;
  const manaBefore = sim.player.resource;

  sim.castAbility(abilityId);

  const barrier = sim.player.auras.find((aura) => aura.id === abilityId);
  expect(barrier?.kind).toBe('absorb');
  return {
    absorb: barrier?.value ?? 0,
    cost: manaBefore - sim.player.resource,
    maxHp: sim.player.maxHp,
  };
}

describe('mage personal barrier rank scaling', () => {
  it.each([
    ['frost', 'ice_barrier'],
    ['fire', 'blazing_barrier'],
  ] as const)('%s uses an early-game barrier instead of the level-20 absorb value', (spec, id) => {
    const level7 = castBarrier(7, spec, id);

    expect(level7.absorb).toBe(50);
    expect(level7.cost).toBe(45);
    expect(level7.absorb / level7.maxHp).toBeLessThan(0.4);
  });

  it.each([
    ['frost', 'ice_barrier'],
    ['fire', 'blazing_barrier'],
  ] as const)('%s barrier grows through ranks and retains the level-20 value', (spec, id) => {
    expect(castBarrier(5, spec, id)).toMatchObject({ absorb: 50, cost: 45 });
    expect(castBarrier(11, spec, id)).toMatchObject({ absorb: 50, cost: 45 });
    expect(castBarrier(12, spec, id)).toMatchObject({ absorb: 90, cost: 65 });
    expect(castBarrier(17, spec, id)).toMatchObject({ absorb: 90, cost: 65 });
    expect(castBarrier(18, spec, id)).toMatchObject({ absorb: 130, cost: 90 });
    expect(castBarrier(20, spec, id)).toMatchObject({ absorb: 130, cost: 90 });
  });
});
