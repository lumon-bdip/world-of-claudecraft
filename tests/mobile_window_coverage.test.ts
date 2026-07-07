import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Phase 5 mobile-HUD-parity coverage guard.
//
// Every desktop HUD window (an element with class `window` and an id) must have a
// deliberate mobile-touch decision: either it is brought into the shared "mobile
// sheet base" pattern (at least one `body.mobile-touch ... #id ...` rule pins or
// sizes or floors it), or it is listed in MOBILE_WINDOW_EXCEPTIONS with a reason.
//
// This is the future-proofing half of the phase: a NEW window added to the markup
// without a mobile rule and without an exception entry FAILS this test, so it can
// never silently ship as an unstyled desktop-only box on touch.
//
// The window ids come from BOTH build entries (index.html at `/`, play.html at
// `/play`; vite.config.ts) since the HUD chrome ships in both, PLUS any window
// created dynamically in src/ui (scraped below). The mobile-touch rules are read
// from every src/styles/*.css module (the flattened cascade an entry loads via the
// src/styles/index.css barrel).
const HTML_ENTRIES = ['../index.html', '../play.html'];
const STYLES_DIR = '../src/styles';
const UI_DIR = '../src/ui';

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8');
}

// The static `.window` ids from a markup entry.
function windowIdsFromHtml(html: string): string[] {
  return [...html.matchAll(/id="([a-z0-9-]+)"\s+class="[^"]*\bwindow\b[^"]*"/g)].map((m) => m[1]);
}

// Windows created at runtime carry a `window` className in a src/ui module rather
// than living in the static markup (today only #confirm-dialog, reused by the input
// dialog). To pick a future dynamic window up automatically, pair a `<var>.id = 'X'`
// assignment with a `<var>.className = 'window ...'` on the SAME variable within a
// short line-distance. Matching the id AND the window className on the same element
// is what keeps sibling containers (#emote-wheel, #loot-rolls, #skin-event: divs in
// the same module that are NOT .window boxes) from being mis-scraped as windows.
function dynamicWindowIds(): { ids: string[]; scannedFiles: number; hadWindowClass: number } {
  const dir = fileURLToPath(new URL(UI_DIR, import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  const ids = new Set<string>();
  let hadWindowClass = 0;
  const idRe = /(\w+)\.id\s*=\s*['"]([a-z0-9-]+)['"]/g;
  for (const f of files) {
    const src = readFileSync(`${dir}/${f}`, 'utf8');
    if (!/\.className\s*=\s*['"]window(?:\s+[^'"]*)?['"]/.test(src)) continue;
    hadWindowClass++;
    for (const m of src.matchAll(idRe)) {
      const [, varName, id] = m;
      // Require the same variable to receive a `window` className nearby (within the
      // element's construction block, allow generous slack for id/aria/style lines).
      const near = src.slice(m.index, m.index + 600);
      const classRe = new RegExp(`${varName}\\.className\\s*=\\s*['"]window(?:\\s+[^'"]*)?['"]`);
      if (classRe.test(near)) ids.add(id);
    }
  }
  return { ids: [...ids], scannedFiles: files.length, hadWindowClass };
}

// Windows deliberately NOT brought into the mobile sheet pattern, each with a
// reason. These pass coverage without a mobile-touch positioning rule.
const MOBILE_WINDOW_EXCEPTIONS: Record<string, string> = {
  'loot-window':
    'cursor-popped by design: the loot roll popup spawns at the drop, not as a docked sheet',
  'confirm-dialog':
    'small centered modal (dynamic, reused by the input dialog); the base .window centering is correct on touch',
  'delve-rite-panel': 'in-run gameplay overlay, not a menu window that docks to a sheet',
  'lockpick-panel': 'in-run gameplay overlay, not a menu window that docks to a sheet',
};

// A src/styles/*.css module contains a positioning/floor rule for #id on touch when
// some `body.mobile-touch ... #id ...` selector names the id. Comments are stripped
// so a commented id cannot spoof coverage.
function stylesText(): string {
  const dir = fileURLToPath(new URL(STYLES_DIR, import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.css'));
  return files
    .map((f) => readFileSync(`${dir}/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
    .join('\n');
}

function hasMobileRule(css: string, id: string): boolean {
  // A selector line that starts with `body.mobile-touch` (optionally with extra
  // state classes) and names `#id` as the target or an ancestor of the target.
  const re = new RegExp(`body\\.mobile-touch[^,{}]*#${id}(?![-a-z0-9])`, 'g');
  return re.test(css);
}

describe('mobile window coverage (Phase 5 parity)', () => {
  const htmlIds = HTML_ENTRIES.flatMap((e) => windowIdsFromHtml(read(e)));
  const dyn = dynamicWindowIds();
  const allIds = [...new Set([...htmlIds, ...dyn.ids])].sort();
  const css = stylesText();

  it('scrapes a plausible set of window ids from both entries plus src/ui', () => {
    // Sanity floor: the static markup carries the full HUD window family; if this
    // collapses, the scrape regex broke and the coverage assertions are hollow.
    expect(allIds.length).toBeGreaterThanOrEqual(20);
    // The dynamic scrape must have inspected src/ui and found the window-creating
    // module(s); #confirm-dialog is the one dynamic window today.
    expect(dyn.hadWindowClass).toBeGreaterThanOrEqual(1);
    expect(allIds).toContain('confirm-dialog');
  });

  it('every window is either sheeted on mobile or an explicit exception', () => {
    const unclassified: string[] = [];
    for (const id of allIds) {
      if (id in MOBILE_WINDOW_EXCEPTIONS) continue;
      if (hasMobileRule(css, id)) continue;
      unclassified.push(id);
    }
    expect(
      unclassified,
      'these windows have no body.mobile-touch rule naming their id and are not in ' +
        `MOBILE_WINDOW_EXCEPTIONS (add a mobile sheet rule or an exception with a reason):\n${unclassified.join('\n')}`,
    ).toEqual([]);
  });

  it('each Phase 5 sheeted window carries a mobile-touch rule', () => {
    const phase5 = [
      'calendar-window',
      'crafting-window',
      'mailbox-window',
      'emote-editor',
      'arena-window',
      'valecup-window',
      'delve-board',
      'leaderboard-window',
      'loot-settings-window',
    ];
    const missing = phase5.filter((id) => !hasMobileRule(css, id));
    expect(missing, `Phase 5 windows missing a mobile-touch rule:\n${missing.join('\n')}`).toEqual(
      [],
    );
  });

  it('every exception id names a real window and carries a reason string', () => {
    for (const [id, reason] of Object.entries(MOBILE_WINDOW_EXCEPTIONS)) {
      expect(allIds, `exception #${id} is not a scraped window id`).toContain(id);
      expect(reason.length, `exception #${id} needs a non-empty reason`).toBeGreaterThan(10);
    }
  });
});
