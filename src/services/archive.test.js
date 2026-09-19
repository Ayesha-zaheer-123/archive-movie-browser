import test from 'node:test';
import assert from 'node:assert/strict';
import archiveService from './archive.js';

test('parseRuntime reads two-part values as MM:SS', () => {
  assert.equal(Math.round(archiveService.parseRuntime('20:33')), 21);
  assert.equal(Math.round(archiveService.parseRuntime('51:56')), 52);
  assert.equal(Math.round(archiveService.parseRuntime('08:30')), 9);
});

test('parseRuntime keeps the formats that already worked', () => {
  assert.equal(Math.round(archiveService.parseRuntime('1:17:26')), 77);
  assert.equal(archiveService.parseRuntime('108 min'), 108);
  assert.equal(archiveService.parseRuntime('71min'), 71);
  assert.equal(archiveService.parseRuntime(undefined), 0);
});

test('buildQuery matches all search words and drops query syntax characters', () => {
  const query = archiveService.buildQuery({ searchQuery: 'the "thing" \\ (1951)', collection: 'SciFi_Horror' });
  assert.ok(query.includes('title:(the AND thing AND 1951)'), query);
  assert.ok(!/["\\]/.test(query.replace('collection:"SciFi_Horror"', '')), query);
});

test('buildQuery ignores a search made only of punctuation', () => {
  assert.equal(archiveService.buildQuery({ searchQuery: '"" ()', collection: 'SciFi_Horror' }), 'collection:"SciFi_Horror"');
});

test('fetchMovies throws when Archive.org returns an error body with HTTP 200', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ error: 'a quoted string is empty' }) });
  try {
    await assert.rejects(() => archiveService.fetchMovies({}), /quoted string is empty/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('buildQuery matches genre aliases, not just the display name', () => {
  const query = archiveService.buildQuery({ genre: 'Sci-Fi', collection: 'feature_films' });
  assert.ok(query.includes('"Sci-Fi"') && query.includes('"science fiction"'), query);
});

// Serves pages of 4 docs where only every 4th has a long runtime
function mockArchive(totalPages) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    calls.push(page);
    const docs = page > totalPages ? [] : [0, 1, 2, 3].map(i => ({
      identifier: `p${page}-${i}`,
      title: `Movie ${page}-${i}`,
      runtime: i === 0 ? '1:30:00' : '5:00'
    }));
    return { ok: true, json: async () => ({ response: { docs, numFound: totalPages * 4 } }) };
  };
  return calls;
}

test('fetchFiltered keeps fetching pages until the batch is full', async () => {
  const realFetch = globalThis.fetch;
  const calls = mockArchive(10);
  try {
    const result = await archiveService.fetchFiltered({
      count: 3, rowsPerPage: 4, filter: m => m.runtimeMinutes >= 40
    });
    assert.equal(result.movies.length, 3);
    assert.deepEqual(calls, [1, 2, 3]);
    assert.equal(result.nextPage, 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fetchFiltered stops at the end of results and at the page cap', async () => {
  const realFetch = globalThis.fetch;
  try {
    mockArchive(2);
    const ended = await archiveService.fetchFiltered({ count: 10, rowsPerPage: 4, filter: m => m.runtimeMinutes >= 40 });
    assert.equal(ended.movies.length, 2);
    assert.equal(ended.nextPage, null);

    const calls = mockArchive(100);
    const capped = await archiveService.fetchFiltered({ count: 50, rowsPerPage: 4, maxPages: 3, filter: m => m.runtimeMinutes >= 40 });
    assert.deepEqual(calls, [1, 2, 3]);
    assert.equal(capped.nextPage, 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('fetchFiltered skips titles the caller has already seen', async () => {
  const realFetch = globalThis.fetch;
  mockArchive(5);
  try {
    const seenTitles = new Set(['movie 1-0']);
    const result = await archiveService.fetchFiltered({ count: 1, rowsPerPage: 4, seenTitles, filter: m => m.runtimeMinutes >= 40 });
    assert.equal(result.movies[0].title, 'Movie 2-0');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('buildQuery lowercases search words so AND/OR are not read as operators', () => {
  const query = archiveService.buildQuery({ searchQuery: 'AND OR', collection: 'SciFi_Horror' });
  assert.ok(query.includes('title:(and AND or)'), query);
});
