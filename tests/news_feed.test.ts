import { describe, expect, it } from 'vitest';
import { loadNewsInto, type NewsReleaseEntry, renderReleaseBody } from '../src/ui/news_feed';

describe('renderReleaseBody', () => {
  it('escapes raw HTML in the source markdown', () => {
    expect(renderReleaseBody('<script>alert(1)</script>')).not.toContain('<script>');
    expect(renderReleaseBody('<script>alert(1)</script>')).toContain('&lt;script&gt;');
  });

  it('renders headings, bullets, bold, italics, code, and safe links', () => {
    const html = renderReleaseBody(
      '# Title\n\n- one\n- two\n\n**bold** and *italic* and `code`\n\n[a link](https://example.com)',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">a link</a>',
    );
  });

  it('drops a non-http(s) link target, rendering it as plain text', () => {
    const html = renderReleaseBody('[danger](javascript:alert(1))');
    expect(html).not.toContain('<a href');
  });
});

class FakeHost {
  innerHTML = '';
}

describe('loadNewsInto', () => {
  it('paints an error state when the fetch rejects', async () => {
    const host = new FakeHost();
    await loadNewsInto(host as unknown as HTMLElement, async () => {
      throw new Error('network');
    });
    expect(host.innerHTML).toContain('news-error');
  });

  it('paints an empty state when there are no releases', async () => {
    const host = new FakeHost();
    await loadNewsInto(host as unknown as HTMLElement, async () => []);
    expect(host.innerHTML).toContain('news-empty');
  });

  it('paints one article per release on success', async () => {
    const host = new FakeHost();
    const releases: NewsReleaseEntry[] = [
      {
        id: 1,
        tag: 'v1.0.0',
        name: 'v1.0.0',
        body: '- fixed a bug',
        url: 'https://example.com/releases/1',
        prerelease: false,
        publishedAt: '2026-01-01T00:00:00Z',
      },
    ];
    await loadNewsInto(host as unknown as HTMLElement, async () => releases);
    expect(host.innerHTML).toContain('news-item');
    expect(host.innerHTML).toContain('fixed a bug');
  });

  it('is a no-op with a null host', async () => {
    await expect(loadNewsInto(null, async () => [])).resolves.toBeUndefined();
  });
});
