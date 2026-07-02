# NAME-MAP — the locked rename contract

> STATUS: **PROPOSED / DRAFT.** G1 generates the full mapping and stops for operator sign-off.
> No rename track (V/C/W) runs until the operator flips this to **LOCKED** and freezes it.
> Once LOCKED it is append-only: a slice needing a string not here STOPS and asks.

This file is the single source of truth for every old -> new string, the analog of the
world-api `CommandName` table. Every rename slice applies it VERBATIM and never invents a name.
The `tests/ip_scrub.test.ts` scanner (G0) is keyed to the `old` column: a slice is done when its
`old` names no longer appear in any player-visible field.

## House style (what a good new name looks like)
Anchor to the game's OWN established original vocabulary, which is grim, grounded dark-fantasy:
- Zones: Eastbrook Vale, Mirefen Marsh, Thornpeak Heights. Factions: Gravecallers, Wyrmcult,
  Pale Choir, Drowned Moon. Bosses: Korzul the Gravewyrm, Voskar the Emberwing.
- Talents already de-WoW'd in `talents_warrior.ts`: Savagery, Weapon Mastery, Blademaster,
  Bulwark, Sharpened Blades, Kindred Spirits, Stormcaller.

Rules for a new name:
1. **Original + evocative + functional.** It should read as a real ability and hint at what it
   does. Keep the mechanic legible (a fire nuke still sounds like fire; a taunt still reads as a
   taunt).
2. **Concise.** 1-3 words, fits an action-bar tooltip (aim <= 22 chars; hard cap the longest
   existing UI budget).
3. **Preserve the mechanic-word where it is pure-generic AND safe.** Truly generic combat verbs
   (Charge, Cleave, Execute, Taunt, Sprint, Stealth, Slam, Ambush, Blind, Sap, Rend, Gouge,
   Vanish, Kick, Parry) are used across the whole genre; each is FLAGGED `generic-keep?` in the
   map so the operator decides per-row whether to keep or rename. Distinctive WoW names
   (Heroic Strike, Mortal Strike, Sinister Strike, Judgement, Lay on Hands, Sunder Armor,
   Frostbolt, Pyroblast, Polymorph, Eviscerate, Slice and Dice, ...) are ALWAYS renamed.
4. **Talent-ability pairing.** A talent that improves/grants an ability must use that ability's
   NEW name (e.g. "Improved <newFireball>"). The map lists the pair together.

## Hard IP constraints (G1 adversarially verifies every proposed name)
- **Not verbatim from WoW** (the whole point).
- **Not verbatim from ANY other known franchise** — screen against RuneScape, Final Fantasy,
  Guild Wars, Diablo, League of Legends, Dota, EverQuest, ESO. Prefer common-language fantasy
  compounds with no single-franchise ownership.
- **No collision with the game's EXISTING original names** (don't reuse a faction/boss/zone word
  as an ability), and **no internal duplicates** (two abilities can't share one new name).
- **Not a Blizzard-coined creature/proper-noun** (Murloc, Voidwalker, Felguard, Drakonid,
  Bristleback, Quilboar, Naga, Furbolg, ...).

## Format
One table per domain. Columns: `id` (frozen — never changes) | `old` (current display, the
scanner key) | `new` (PROPOSED) | `kind` | `flag`. `flag` in {`rename`, `generic-keep?`,
`coined-id` (C1/C2 also rename the id), `pairing`}.

---

## Abilities (V1) — `content/classes.ts` + `i18n.catalog/abilities.ts`
> G1 fills all ~150. Sample below sets the tone for operator review; the rest follow the same style.

### Warrior (sample)
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `heroic_strike` | Heroic Strike | Reaver Strike | ability | rename |
| `mortal_strike` | Mortal Strike | Maiming Strike | ability | rename |
| `bloodthirst` | Bloodthirst | Bloodletting | ability | rename |
| `shield_slam` | Shield Slam | Bulwark Bash | ability | rename |
| `sunder_armor` | Sunder Armor | Armor Rend | ability | rename |
| `thunder_clap` | Thunder Clap | Quaking Roar | ability | rename |
| `charge` | Charge | Charge | ability | generic-keep? |
| `execute` | Execute | Execute | ability | generic-keep? |

### Mage (sample)
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `fireball` | Fireball | Cinderbolt | ability | rename |
| `frostbolt` | Frostbolt | Rimelance | ability | rename |
| `pyroblast` | Pyroblast | Emberfall | ability | rename |
| `arcane_missiles` | Arcane Missiles | Aether Darts | ability | rename |
| `polymorph` | Polymorph | Ensorcel | ability | rename |
| `ice_barrier` | Ice Barrier | Rime Ward | ability | rename |

### Paladin (sample)
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `judgement` | Judgement | Verdict | ability | rename |
| `lay_on_hands` | Lay on Hands | Last Rite | ability | rename |
| `consecration` | Consecration | Hallowed Ground | ability | rename |
| `hammer_of_justice` | Hammer of Justice | Sundering Gavel | ability | rename |

*(Rogue, Hunter, Priest, Shaman, Warlock, Druid: G1 fills, same style.)*

---

## Talent trees + talents (V2) — `content/talents_classic.ts` + `talent_i18n.ts`
> All 27 spec/tree names are verbatim WoW and rename. Warrior trees are already done
> (`talents_warrior.ts`: kept as the style exemplar). Sample:

| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| spec `arcane` | Arcane | Aethermancy | tree | rename |
| spec `fire` | Fire | Pyromancy | tree | rename |
| spec `frost` | Frost | Cryomancy | tree | rename |
| spec `holy` (pal) | Holy | Radiance | tree | rename |
| node `blessing_of_sanctuary` | Blessing of Sanctuary | Ward of Refuge | talent | rename |
| node `ardent_defender` | Ardent Defender | Stalwart Aegis | talent | rename |
| node (improves fireball) | Improved Fireball | Improved Cinderbolt | talent | pairing |

*(G1 fills all ~330; spec names for Hunter/Rogue/Priest/Shaman/Warlock/Druid + all node names.)*

---

## Creatures (C1) — coined `MobFamily` ids + prose + flagged terms
> These rename the DISPLAY prose AND (coined-id) the code id atomically (types.ts, sim.ts,
> render/characters/manifest.ts, every content `family:` field). Display mob NAMES are already
> generic and mostly stay.

| id (frozen unless coined-id) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| family `murloc` | (code id + quest word "murloc") | `mudfin` (family id) | family-id | coined-id |
| quest prose | "where there is one murloc there are five" | (reworded, no "murloc") | prose | rename |
| item `slimy_murloc_scale` | Slimy Murloc Scale | Slimy Mudfin Scale | item | rename |
| family `kobold` | (code id + candle flavor) | `tunnelrat` (family id) | family-id | coined-id |
| loot `tallow_candle` + greeting | "candle-headed vermin" / Tallow Candle | (de-candled flavor) | prose/item | rename |
| term `Bristleback` | Bristleback Hides / Bristleback Maul / elder_bristleback | Bristlehide (or per-row) | term | rename |
| mob `Sanctum Drakonid` | Sanctum Drakonid | Sanctum Wyrmkin | mob | rename |
| quest `Mogger Must Fall` / Mogger | Mogger (Hogger parody) | operator call: keep as deliberate parody, or rename | mob | rename? |

---

## Warlock demon-pet roster (C2) — `content/warlock_pets.ts` + `summonDemon` + `entity_i18n`
> The exact WoW 7-slot demon lineup. Re-theme the WHOLE set (display + coined id). Verify pet
> ids are NOT persisted in CharacterState before renaming the id (if persisted, keep id +
> display-only).

| id (frozen unless coined-id) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `warlock_imp` | Imp | Cinderling | pet | coined-id |
| `warlock_voidwalker` | Voidwalker | Voidbound | pet | coined-id |
| `warlock_succubus` | Succubus | Temptress | pet | coined-id |
| `warlock_felhunter` | Felhunter | Spellhound | pet | coined-id |
| `warlock_felguard` | Felguard | Dreadguard | pet | coined-id |
| `warlock_infernal` | Infernal | Cinder Colossus | pet | coined-id |
| `warlock_doomguard` | Doomguard | Ruinlord | pet | coined-id |

---

## Items / sets / augments (W1) — `content/items.ts`, `item_sets.ts`, `augments.ts` + catalog
| id (frozen) | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `shadowmeld_tunic` | Shadowmeld Tunic | Nightmeld Tunic | item | rename |
| augment `lightwell` | Lightwell | Radiant Font | augment | rename |
| (tier-set names) | (7 sets, naming convention only, none verbatim) | operator call | set | generic-keep? |

*(Slimy Murloc Scale + Bristleback Maul are owned by C1; W1 covers the rest.)*

---

## Mob mechanic / aura names (W2) — inline `name` + `sim_i18n.ts` AURA_NAME_KEY
| location | old | new (PROPOSED) | kind | flag |
|---|---|---|---|---|
| `dungeons.ts` Bastion Revenant on-hit | Mortal Strike | Maiming Strike (match the ability) | aura | rename |
| `zone2.ts` Grubjaw purge | Devour Magic | Rend Enchantment | aura | rename |
| `zone3.ts` Corrupted Priest petSpell | Mind Blast | Psychic Lash | aura | rename |
| `dungeons.ts` Korgath stomp | War Stomp | Ground Slam (match peers) | aura | rename |

---

## Coverage checklist (G1 must fill every row before LOCK)
- [ ] All ~150 ability names (9 classes), each `rename` or `generic-keep?`
- [ ] All 27 spec/tree names + all ~330 talent node/choice/mastery names (pairing resolved)
- [ ] Creature families + prose + Bristleback/Drakonid/Mogger + Slimy Murloc Scale
- [ ] All 7 warlock pets (display + id), pet-id persistence checked
- [ ] All ~16 flagged items/sets/augments
- [ ] The 4 verbatim mob-mechanic names
- [ ] Operator decisions resolved on every `generic-keep?` and the Mogger parody
