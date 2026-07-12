// @vitest-environment jsdom
// Behavioral pin for the deed-tracker collapse header (src/ui/deed_tracker_painter.ts).
// The aria-expanded live sync and aria-controls contract were pinned only by source
// scans; this drives the real painter against a jsdom container and asserts the header
// attribute flips as the view collapses. The header's click/keydown delegation lives in
// hud.ts (it needs the full Hud) and stays source-pinned there.
import { describe, expect, it } from 'vitest';
import { DeedTrackerPainter } from '../src/ui/deed_tracker_painter';
import { type DeedTrackerView, makeDeedTrackerView } from '../src/ui/deeds_view';
import type { PainterHostWriters } from '../src/ui/painter_host';

// A live facet that performs the real DOM writes (no elision), so the rendered
// attributes/styles can be read back off the jsdom tree.
function liveWriters(): PainterHostWriters {
  return {
    setText: (el, text) => {
      el.textContent = text;
    },
    setDisplay: (el, display) => {
      el.style.display = display;
    },
    setTransform: (el, transform) => {
      el.style.transform = transform;
    },
    setWidth: (el, width) => {
      el.style.width = width;
    },
    setStyleProp: (el, prop, value) => {
      el.style.setProperty(prop, value);
    },
    toggleClass: (el, cls, on) => {
      el.classList.toggle(cls, on);
    },
    setAttr: (el, name, value) => {
      el.setAttribute(name, value);
    },
  };
}

// One visible, watched deed line; only `collapsed` varies between the two paints.
function view(collapsed: boolean): DeedTrackerView {
  const v = makeDeedTrackerView();
  v.visible = true;
  v.collapsed = collapsed;
  v.count = 1;
  v.lines[0].id = 'pvp_fiesta_first_bout';
  return v;
}

describe('DeedTrackerPainter: collapse header live sync', () => {
  it('flips aria-expanded true -> false and hides the watch list as the view collapses', () => {
    const root = document.createElement('div');
    const painter = new DeedTrackerPainter({ root: () => root, writers: liveWriters() });
    const header = root.querySelector('.dt-header') as HTMLElement;
    const list = root.querySelector('.dt-list') as HTMLElement;

    // The static skeleton carries the aria-controls -> watch-list wiring once.
    expect(header.getAttribute('aria-controls')).toBe('deed-watch-list');
    expect(list.id).toBe('deed-watch-list');

    // Expanded: the header advertises an open region and the list shows.
    painter.update(view(false));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(list.style.display).toBe('');

    // Collapsed: aria-expanded tracks the state and the list hides.
    painter.update(view(true));
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(list.style.display).toBe('none');
  });
});
