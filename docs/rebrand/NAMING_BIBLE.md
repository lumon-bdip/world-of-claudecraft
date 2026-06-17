# Rebrand Naming Bible — "Realms of Eldermere"

Working document for the total rebrand of the game formerly named *World of
ClaudeCraft*. This is the single source of truth for the new identity, the
old to new name mapping, and the engineering rules that keep the rename from
breaking the simulation.

## 1. Legal basis

- Upstream code is MIT licensed (`LICENSE`, copyright Levy Street, 2026). We may
  modify, rebrand, and ship. The only obligation is to retain the original MIT
  copyright and permission notice in the distribution. Do not delete that notice.
- New work in this fork can carry its own copyright on top.
- Bundled art (`public/` GLB models, textures, HDRIs) is covered by `CREDITS.md`,
  which has separate terms from the code. Review it before any public release.
- The new name and all coined fantasy terms below are original. We deliberately
  avoid trademarked Tolkien terms (Hobbit, Mordor, Gondor, Middle-earth, Shire,
  Rohan, Mithril, and so on). The brief was the *style* of high fantasy, not the
  Tolkien names themselves.

## 2. New identity

| Field | Old | New |
|---|---|---|
| Game title | World of ClaudeCraft | Realms of Eldermere |
| Short name (PWA) | ClaudeCraft | Eldermere |
| World name | (implicit) | Eldermere |
| Tone | classic-style web MMO | classic-style web MMO (unchanged) |

Design language: Old-English and Norse root words, weathered and lyrical.
Favored morphemes: elder-, -mere (lake), -fell (hill), -holt/-holm (wood),
-gard/-mark (enclosure/border), -wyrm, -barrow, -hallow, thorn-, grey-, ash-.

## 3. The load-bearing engineering rule

**Keep every code `id`. Change only displayed text and its translations.**

Entities are referenced across the engine by stable string IDs (`warrior`,
`forest_wolf`, `eastbrook_vale`, `hollow_crypt`, `q_wolves`, `worn_sword`).
Those IDs are wired into render character models, talent trees, loot tables,
quest cross-references (`giverNpcId`, objective `mobId`), and sim logic.
**Renaming an ID ripples everywhere and will break things.** The displayed
name comes from a separate translation layer keyed by ID, so renaming the
*display* is safe and is all a rebrand needs.

Example: the class whose id is `warrior` can read on screen as a new name in
all 14 languages while the engine still calls it `warrior`.

## 4. What a single content rename touches (impact map)

For one named entity (say a mob), a correct rename edits all of:

1. **Content source** — `src/sim/content/*.ts`: the English `name`/`text`. This
   is the canonical fallback and the seed for the sim/server English matchers.
2. **Entity translation tables** — `src/ui/i18n.ts` and `src/ui/phase9_i18n.ts`:
   the value behind `entities.<kind>.<id>.<field>` in **all 14 locales**.
   Resolution path is `tEntity()` in `src/ui/entity_i18n.ts`.
3. **Talent tables** — `src/ui/talent_i18n.ts` for talent nodes (separate phase).
4. **Sim/server English matchers** — `src/ui/sim_i18n.ts` and
   `src/ui/server_i18n.ts`: when the sim or server emits an English string that
   is re-localized at the client boundary, the matcher key must track the new
   English. The S3 guard (`tests/localization_fixes.test.ts`) enforces this.
5. **Static HTML** — `index.html` references some entity keys directly via
   `data-i18n="entities.zones.eastbrook_vale.name"`.
6. **Tests** — `tests/localization_coverage.test.ts` and others hardcode exact
   translated strings against specific IDs (for example `forest_wolf` ->
   "Waldwolf" in German, `eastbrook_vale` -> "Eastbrook-Tal"). Those expected
   values must be updated to the new translations.

### Enforcement the rename must satisfy (from the test suite)

- `verifyKeys(en, locale)`: every locale carries 100% of English keys, non-empty,
  no `TODO`/`TBD`/`FIXME`/`PLACEHOLDER` markers.
- Anti-English-copy: for items, mobs, NPCs, quests, zones, dungeons, and talents,
  each non-English locale value must **not equal** the English source. Real
  translations are mandatory, not English copies.
- Spot-checks: specific IDs assert specific translated strings, in several
  languages, including CJK and Cyrillic.

## 5. Cross-reference integrity (the "what breaks elsewhere" checklist)

When touching content, do not change these without following every reference:

- **Quest objectives** reference mob IDs and item IDs. NPCs reference quest IDs;
  quests reference giver/turn-in NPC IDs. Loot tables reference item IDs.
- **Talent trees** validate at import and throw on duplicate IDs, cycles, or
  unreachable point gates. A malformed tree crashes app load.
- **Item class restrictions** use archetype groups (WAR/MAG/ROG), not the class
  display names. Renaming class display text does not touch restrictions.
- **Render character models** key off class IDs and some creature families.
- **Icons** are procedural and key off ability/item IDs plus name keywords; new
  English names can shift the keyword fallback, so verify icons after item/ability
  renames (cosmetic only, never a crash).

## 6. Wave plan (each wave ends green: tsc + vitest)

- **Wave 0 — Brand identity.** Game title/short name across HTML, manifest,
  package metadata, brand i18n keys (all 14 locales), server join broadcast +
  its matcher, and coupled tests. (This document's first execution.)
- **Wave 1 — Classes + abilities** (`phase7`): 9 class display names + lore,
  ~114 ability names + descriptions, all 14 locales, talent names that echo class
  identity.
- **Wave 2 — Zones + POIs + NPCs** (`phase9`): zone names/welcome, ~32 POI labels,
  ~20 NPC name/title/greeting; update `index.html` zone key reference and zone
  spot-check tests.
- **Wave 3 — Mobs + items** (`phase8`/`phase9`): ~104 creature names, ~266 item
  names; update mob/item spot-check tests.
- **Wave 4 — Quests + dungeons** (`phase9`): ~71 quest title/text/completion +
  objectives, 4 dungeon names/enter/leave; update quest/dungeon spot-checks.
- **Wave 5 — Talents** (`phase12`): ~96 nodes, spec names, mastery passives.
- **Wave 6 — Docs, wiki, README, release notes, logos** (cosmetic + assets;
  new logo art is a real-art task, not code).

### Items intentionally left for an explicit decision (infrastructure)

These are not display text; changing them affects live infrastructure and should
not be swept in with the cosmetic rename:

- Domain `worldofclaudecraft.com` (`src/main.ts` SITE_URL, hreflang, canonical).
- GitHub repo URL `github.com/levy-street/world-of-claudecraft`.
- Logo binary assets (`woc_*.png/webp`, `worldofclaude.png`,
  `worldofclaudecraft-logo.png`) — file refs can be renamed but the images still
  show old art until redrawn.

## 7. Anchor name mapping (proposed; classes/zones/dungeons)

IDs in parentheses never change.

### Zones
| id | Old display | New display | Levels |
|---|---|---|---|
| eastbrook_vale | Eastbrook Vale | Greywillow Vale | 1-7 |
| (zone2) Mirefen Marsh | Mirefen Marsh | Sablefen Mire | 6-13 |
| (zone3) Thornpeak Heights | Thornpeak Heights | Thornfell Reaches | 13-20 |
| temple | Drowned Temple | The Sunken Hallow | 15-18 |

### Dungeons
| id | Old display | New display |
|---|---|---|
| hollow_crypt | Hollow Crypt | The Barrow Hollow |
| sunken_bastion | Sunken Bastion | Drownhold Bastion |
| gravewyrm_sanctum | Gravewyrm Sanctum | Wyrmbarrow Sanctum |
| (temple dungeon) | Drowned Temple | The Sunken Hallow |

### Classes (display only; ability kits unchanged)
| id | Old display | New display |
|---|---|---|
| warrior | Warrior | Warden |
| paladin | Paladin | Lightsworn |
| hunter | Hunter | Ranger |
| rogue | Rogue | Shadowblade |
| priest | Priest | Cleric |
| shaman | Shaman | Spiritcaller |
| mage | Mage | Arcanist |
| warlock | Warlock | Doomweaver |
| druid | Druid | Wildshaper |

Class display names are SHIPPED (Wave 1) in all 14 locales. Engine class IDs
unchanged. The `/inspect` and `/stats` server readouts build from the canonical
English class name, so their tests were updated to the new names; those two
command strings remain English-only at the sim boundary (a pre-existing
localization gap, tracked for a later pass).

## 8. Progress log

- Wave 0 (brand): DONE, green.
- Wave 1 (class display names + aria, 14 locales + canonical): DONE, green.
- Remaining: zones/dungeons, NPCs, mobs, items, quests, abilities, talents,
  class lore prose, then docs/wiki/logos.
