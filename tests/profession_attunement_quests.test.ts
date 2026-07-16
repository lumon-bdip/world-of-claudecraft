import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PAIR_TARGETS, normalizeArchetypeState } from '../src/sim/professions/archetype';
import { Sim } from '../src/sim/sim';
import { COMMAND_NAMES } from '../src/world_api';

const LORE_QUEST = 'q_archetype_acceptance';
const AMENDS_QUEST = 'q_prof_make_amends';
const HOBBY_QUEST = 'q_prof_hobby_switch';
const ARMOR_WEAPON = 'armorcrafting+weaponcrafting';
const WEAPON_JEWEL = 'weaponcrafting+jewelcrafting';

function makeSim(seed = 9042): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

function moveToSmith(sim: Sim, pid = sim.playerId): void {
  const smith = [...sim.entities.values()].find((e) => e.templateId === 'smith_haldren');
  if (!smith) throw new Error('smith_haldren missing');
  const player = sim.entities.get(pid);
  if (!player) throw new Error('player missing');
  player.pos.x = smith.pos.x + 1;
  player.pos.z = smith.pos.z;
}

function unlockProfessionQuests(sim: Sim, pid = sim.playerId): void {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('player meta missing');
  meta.questsDone.add('q_prof_intro');
}

function acceptProfessionQuest(sim: Sim, questId: string, selection: string): void {
  moveToSmith(sim);
  sim.acceptQuest(questId, selection);
}

function completeAndTurnIn(sim: Sim, questId: string): void {
  const qp = sim.questLog.get(questId);
  if (!qp) throw new Error(`${questId} was not accepted`);
  qp.counts = [...(qp.resolvedCounts ?? [])];
  qp.state = 'ready';
  moveToSmith(sim);
  sim.turnInQuest(questId);
}

function attuneNewPair(sim: Sim, selection: string): void {
  acceptProfessionQuest(sim, LORE_QUEST, selection);
  completeAndTurnIn(sim, LORE_QUEST);
}

describe('live profession attunement quests', () => {
  it('only exposes profession quests that have a legal selection target', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);

    expect(sim.questState(LORE_QUEST)).toBe('available');
    expect(sim.questState(AMENDS_QUEST)).toBe('unavailable');
    expect(sim.questState(HOBBY_QUEST)).toBe('unavailable');

    attuneNewPair(sim, ARCHETYPE_PAIR_TARGETS[0]);
    expect(sim.questState(AMENDS_QUEST)).toBe('unavailable');
    expect(sim.questState(HOBBY_QUEST)).toBe('available');

    attuneNewPair(sim, ARCHETYPE_PAIR_TARGETS[1]);
    expect(sim.questState(AMENDS_QUEST)).toBe('available');

    for (const target of ARCHETYPE_PAIR_TARGETS.slice(2)) attuneNewPair(sim, target);
    expect(sim.questState(LORE_QUEST)).toBe('unavailable');
  });

  it('attunes an adjacent pair only when the persisted lore-quest selection completes', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);

    acceptProfessionQuest(sim, LORE_QUEST, ARMOR_WEAPON);
    expect(sim.activeArchetype).toBeNull();
    expect(sim.questLog.get(LORE_QUEST)?.selection).toBe(ARMOR_WEAPON);

    completeAndTurnIn(sim, LORE_QUEST);
    expect(sim.craftingIdentity).toMatchObject({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      attunedPairs: [ARMOR_WEAPON],
    });
    expect(sim.archetypeSwitchCount).toBe(0);
  });

  it('rejects malformed, non-adjacent, and already-attuned lore targets at acceptance', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    moveToSmith(sim);

    sim.acceptQuest(LORE_QUEST, 'not-a-pair');
    sim.acceptQuest(LORE_QUEST, 'armorcrafting+cooking');
    expect(sim.questLog.has(LORE_QUEST)).toBe(false);

    attuneNewPair(sim, ARMOR_WEAPON);
    sim.acceptQuest(LORE_QUEST, ARMOR_WEAPON);
    expect(sim.questLog.has(LORE_QUEST)).toBe(false);
  });

  it('uses lore for a new pair and escalating make-amends for a previously held pair', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attuneNewPair(sim, ARMOR_WEAPON);
    attuneNewPair(sim, WEAPON_JEWEL);
    expect(sim.archetypeSwitchCount).toBe(0);

    acceptProfessionQuest(sim, AMENDS_QUEST, ARMOR_WEAPON);
    const first = sim.questLog.get(AMENDS_QUEST);
    expect(first?.resolvedCounts).toEqual([5]);
    completeAndTurnIn(sim, AMENDS_QUEST);
    expect(sim.craftingIdentity.activeArchetype).toBe('armorcrafting');
    expect(sim.archetypeSwitchCount).toBe(1);

    acceptProfessionQuest(sim, AMENDS_QUEST, WEAPON_JEWEL);
    expect(sim.questLog.get(AMENDS_QUEST)?.resolvedCounts).toEqual([8]);
  });

  it('switches the explicit hobby only to the other opposite candidate', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attuneNewPair(sim, ARMOR_WEAPON);
    expect(sim.hobbyCraft).toBe('cooking');

    acceptProfessionQuest(sim, HOBBY_QUEST, 'inscription');
    completeAndTurnIn(sim, HOBBY_QUEST);
    expect(sim.hobbyCraft).toBe('inscription');

    acceptProfessionQuest(sim, HOBBY_QUEST, 'alchemy');
    expect(sim.questLog.has(HOBBY_QUEST)).toBe(false);
  });

  it('round-trips active pair, explicit hobby, history, and an accepted quest selection', () => {
    const sim = makeSim();
    unlockProfessionQuests(sim);
    attuneNewPair(sim, ARMOR_WEAPON);
    acceptProfessionQuest(sim, HOBBY_QUEST, 'inscription');

    const saved = sim.serializeCharacter(sim.playerId);
    const reloaded = makeSim(9043);
    const pid = reloaded.addPlayer('warrior', 'Reloaded', { state: saved ?? undefined });

    expect(reloaded.craftingIdentityFor(pid)).toMatchObject({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'cooking',
      attunedPairs: [ARMOR_WEAPON],
    });
    expect(reloaded.players.get(pid)?.questLog.get(HOBBY_QUEST)).toMatchObject({
      selection: 'inscription',
      resolvedCounts: [3],
    });
  });

  it('normalizes an old pair save with deterministic hobby and deduplicated history', () => {
    expect(
      normalizeArchetypeState({
        activeArchetype: 'armorcrafting',
        pairedMajor: 'weaponcrafting',
        switchCount: 2,
        amendsProgress: 4,
      }),
    ).toEqual({
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'cooking',
      attunedPairs: [ARMOR_WEAPON],
      switchCount: 2,
      amendsProgress: 4,
    });
  });

  it('does not add a direct profession-transition command to the client protocol', () => {
    expect(COMMAND_NAMES).not.toContain('attune_profession');
    expect(COMMAND_NAMES).not.toContain('switch_hobby');
    expect(COMMAND_NAMES).not.toContain('advance_amends');
  });
});
