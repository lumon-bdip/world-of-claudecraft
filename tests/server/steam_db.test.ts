// The steam_links SQL boundary's one transaction: displaceSteamLink, the
// reclaim-by-proof write. The route suite mocks this module whole, so the
// load-bearing SQL lives untested without this file: the FOR UPDATE
// serialization, the `account_id <> $2` guard that can never delete the
// caller's own row, the displacedAccountId computation, and the 23505
// ROLLBACK re-classification (account_linked vs steam_taken). Mirrors the
// tests/character_db.test.ts pool.connect() client-stub pattern.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// server/db.ts builds a pg Pool and requires DATABASE_URL at import time; stub
// both so the module loads and every query goes through a spy.
const dbMock = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query: dbMock.query, connect: dbMock.connect };
  },
}));

import { displaceSteamLink } from '../../server/steam/steam_db';

beforeEach(() => {
  dbMock.query.mockReset();
  dbMock.connect.mockReset();
});

function clientStub() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 } as never);
  const release = vi.fn();
  return { query, release };
}

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  });
}

const STEAM_ID = '76561198000000001';

describe('displaceSteamLink', () => {
  it('displaces another account: FOR UPDATE lock, guarded DELETE, INSERT, COMMIT, old owner reported', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as never);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
      .mockResolvedValueOnce({ rows: [{ account_id: 99 }], rowCount: 1 } as never); // SELECT

    await expect(displaceSteamLink(7, STEAM_ID)).resolves.toEqual({
      result: 'ok',
      displacedAccountId: 99,
    });

    const calls = client.query.mock.calls;
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls[1][0]).toMatch(/FOR UPDATE/);
    expect(calls[1][1]).toEqual([STEAM_ID]);
    // The guarded DELETE can only remove a DIFFERENT account's row.
    expect(calls[2][0]).toMatch(/DELETE FROM steam_links/);
    expect(calls[2][0]).toMatch(/account_id <> \$2/);
    expect(calls[2][1]).toEqual([STEAM_ID, 7]);
    expect(calls[3][0]).toMatch(/INSERT INTO steam_links/);
    expect(calls[3][1]).toEqual([7, STEAM_ID]);
    expect(calls[4][0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('inserts without a DELETE when the steam id is unclaimed (nothing displaced)', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as never);
    // BEGIN and SELECT both resolve to the empty default.
    await expect(displaceSteamLink(7, STEAM_ID)).resolves.toEqual({
      result: 'ok',
      displacedAccountId: null,
    });
    const texts = client.query.mock.calls.map((c) => String(c[0]));
    expect(texts.some((t) => /DELETE/.test(t))).toBe(false);
    expect(texts).toEqual([
      'BEGIN',
      expect.stringMatching(/FOR UPDATE/),
      expect.stringMatching(/INSERT INTO steam_links/),
      'COMMIT',
    ]);
  });

  it("never deletes the caller's own row: a self-owned id skips the DELETE and re-classifies the 23505 as account_linked", async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as never);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
      .mockResolvedValueOnce({ rows: [{ account_id: 7 }], rowCount: 1 } as never) // SELECT: own row
      .mockRejectedValueOnce(uniqueViolation()); // INSERT trips the PK
    // The catch-arm classification read (steamLinkForAccount) rides the pool:
    // the caller still holds a link, so the race reads as account_linked.
    dbMock.query.mockResolvedValueOnce({
      rows: [{ account_id: 7, steam_id: STEAM_ID, created_at: '2026-07-12T00:00:00Z' }],
      rowCount: 1,
    } as never);

    await expect(displaceSteamLink(7, STEAM_ID)).resolves.toEqual({
      result: 'account_linked',
      displacedAccountId: null,
    });
    const texts = client.query.mock.calls.map((c) => String(c[0]));
    expect(texts.some((t) => /DELETE/.test(t))).toBe(false);
    expect(texts).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('re-classifies a lost concurrent race as steam_taken when the caller ends up unlinked', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as never);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // SELECT: unclaimed
      .mockRejectedValueOnce(uniqueViolation()); // a racer's INSERT landed first
    dbMock.query.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never); // caller unlinked

    await expect(displaceSteamLink(7, STEAM_ID)).resolves.toEqual({
      result: 'steam_taken',
      displacedAccountId: null,
    });
    const texts = client.query.mock.calls.map((c) => String(c[0]));
    expect(texts).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rethrows a non-unique failure after ROLLBACK and always releases the client', async () => {
    const client = clientStub();
    dbMock.connect.mockResolvedValue(client as never);
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never) // BEGIN
      .mockRejectedValueOnce(new Error('connection reset')); // SELECT dies

    await expect(displaceSteamLink(7, STEAM_ID)).rejects.toThrow('connection reset');
    const texts = client.query.mock.calls.map((c) => String(c[0]));
    expect(texts).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
