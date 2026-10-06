import { renderHook, act } from '@testing-library/react-native';
import {
  MAX_CONCURRENT,
  MAX_RESOLUTIONS_PER_JOB,
  MAX_TRIES,
  POLL_DELAY_MS,
  UseSearchHashResolverOptions,
  useSearchHashResolver,
} from '@/hooks/useSearchHashResolver';
import { torrentsApi } from '@/services/api/torrents';
import { SearchResult, TorrentMetadataResult } from '@/types/api';

jest.mock('@/services/api/torrents', () => ({
  torrentsApi: { fetchMetadata: jest.fn() },
}));

const fetchMetadata = jest.mocked(torrentsApi.fetchMetadata);

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

function dup(n: number, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    fileName: 'Some Movie 2024',
    fileSize: 1_000_000,
    fileUrl: `https://idx${n}.example/dl/${n}.torrent`,
    nbLeechers: 0,
    nbSeeders: 100 - n,
    siteUrl: `https://idx${n}.example`,
    descrLink: '',
    engineName: `plugin${n}`,
    ...overrides,
  };
}

const ready = (hash: string, trackers: string[] = []): TorrentMetadataResult => ({
  status: 'ready',
  infohashV1: hash,
  hash,
  trackers,
});
const pending = (): TorrentMetadataResult => ({ status: 'pending' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let chained promise callbacks (fetch → settle → pump → next fetch) all run. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await settle();
}

const baseOptions = (
  overrides: Partial<UseSearchHashResolverOptions> = {},
): UseSearchHashResolverOptions => ({
  results: [dup(1), dup(2)],
  jobId: 1,
  enabled: true,
  features: { supportsFetchMetadata: true, supportsFetchMetadataDownloader: true },
  isAggregatedSource: false,
  ...overrides,
});

async function setup(initial: UseSearchHashResolverOptions = baseOptions()) {
  const hook = await renderHook(
    (props: UseSearchHashResolverOptions) => useSearchHashResolver(props),
    {
      initialProps: initial,
    },
  );
  await settle();
  return hook;
}

describe('useSearchHashResolver', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchMetadata.mockReset();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('resolves duplicate-looking .torrent results to their hash and trackers', async () => {
    fetchMetadata
      .mockResolvedValueOnce(ready(HASH_A.toUpperCase(), ['udp://t1:1']))
      .mockResolvedValueOnce(ready(HASH_B));
    const { result } = await setup();

    expect(fetchMetadata).toHaveBeenCalledTimes(2);
    const first = result.current.get('https://idx1.example/dl/1.torrent');
    expect(first).toEqual({ hash: HASH_A, torrentId: HASH_A, trackers: ['udp://t1:1'] });
    expect(result.current.get('https://idx2.example/dl/2.torrent')?.hash).toBe(HASH_B);
  });

  it('prefers the v1 hash for grouping and keeps the torrent ID separately', async () => {
    fetchMetadata.mockResolvedValue({
      status: 'ready',
      infohashV1: HASH_A,
      infohashV2: 'c'.repeat(64),
      hash: 'd'.repeat(40),
      trackers: [],
    });
    const { result } = await setup(baseOptions({ results: [dup(1), dup(2)] }));
    expect(result.current.get('https://idx1.example/dl/1.torrent')).toMatchObject({
      hash: HASH_A,
      torrentId: 'd'.repeat(40),
    });
  });

  it('only requests duplicate-looking http(s) torrent links — not magnets or one-offs', async () => {
    fetchMetadata.mockResolvedValue(ready(HASH_A));
    const magnet = dup(3, { fileUrl: `magnet:?xt=urn:btih:${HASH_A}` });
    const lonely = dup(4, {
      fileName: 'Totally Different',
      fileUrl: 'https://idx4.example/d.torrent',
    });
    await setup(baseOptions({ results: [dup(1), magnet, lonely] }));

    // dup(1) shares its name+size with the magnet; the magnet and the loner are not fetched.
    const sources = fetchMetadata.mock.calls.map((call) => call[0]);
    expect(sources).toEqual(['https://idx1.example/dl/1.torrent']);
  });

  it('passes the owning search plugin as downloader only when supported and not aggregated', async () => {
    fetchMetadata.mockResolvedValue(ready(HASH_A));
    await setup();
    expect(fetchMetadata.mock.calls[0][1]).toBe('plugin1');
    expect(fetchMetadata.mock.calls[0][2]).toBeInstanceOf(AbortSignal);

    fetchMetadata.mockClear();
    await setup(baseOptions({ isAggregatedSource: true }));
    expect(fetchMetadata.mock.calls[0][1]).toBeUndefined();

    // Results that all share one siteUrl look like a proxying plugin even before
    // the screen's latch catches up, so the plugin is not asked to fetch them.
    fetchMetadata.mockClear();
    await setup(
      baseOptions({
        results: [
          dup(1, { siteUrl: 'https://hub.example' }),
          dup(2, { siteUrl: 'https://hub.example/' }),
        ],
      }),
    );
    expect(fetchMetadata.mock.calls[0][1]).toBeUndefined();

    fetchMetadata.mockClear();
    await setup(
      baseOptions({
        features: { supportsFetchMetadata: true, supportsFetchMetadataDownloader: false },
      }),
    );
    expect(fetchMetadata.mock.calls[0][1]).toBeUndefined();

    fetchMetadata.mockClear();
    await setup(baseOptions({ results: [dup(1, { engineName: undefined }), dup(2)] }));
    const byUrl = Object.fromEntries(fetchMetadata.mock.calls.map((c) => [c[0], c[1]]));
    expect(byUrl['https://idx1.example/dl/1.torrent']).toBeUndefined();
    expect(byUrl['https://idx2.example/dl/2.torrent']).toBe('plugin2');
  });

  it('makes no requests when disabled, unsupported, or without a job', async () => {
    fetchMetadata.mockResolvedValue(ready(HASH_A));
    await setup(baseOptions({ enabled: false }));
    await setup(
      baseOptions({
        features: { supportsFetchMetadata: false, supportsFetchMetadataDownloader: false },
      }),
    );
    await setup(baseOptions({ jobId: null }));
    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it('starts as soon as it is enabled, without re-requesting anything already resolved', async () => {
    fetchMetadata.mockResolvedValue(ready(HASH_A));
    const { rerender } = await setup(baseOptions({ enabled: false }));
    expect(fetchMetadata).not.toHaveBeenCalled();

    await rerender(baseOptions({ enabled: true }));
    await settle();
    expect(fetchMetadata).toHaveBeenCalledTimes(2);

    // Same results arriving again on the next poll tick, and a toggle off/on.
    await rerender(baseOptions({ results: [dup(1), dup(2)] }));
    await rerender(baseOptions({ enabled: false }));
    await rerender(baseOptions({ enabled: true }));
    await settle();
    expect(fetchMetadata).toHaveBeenCalledTimes(2);
  });

  it(`keeps at most ${MAX_CONCURRENT} sources in progress at once`, async () => {
    const gates = Array.from({ length: 6 }, () => deferred<TorrentMetadataResult>());
    let call = 0;
    fetchMetadata.mockImplementation(() => gates[call++].promise);
    const results = Array.from({ length: 6 }, (_, i) => dup(i + 1));
    await setup(baseOptions({ results }));

    expect(fetchMetadata).toHaveBeenCalledTimes(MAX_CONCURRENT);
    await act(async () => gates[0].resolve(ready(HASH_A)));
    await settle();
    expect(fetchMetadata).toHaveBeenCalledTimes(MAX_CONCURRENT + 1);
    await act(async () => gates[1].resolve(ready(HASH_A)));
    await act(async () => gates[2].resolve(ready(HASH_A)));
    await settle();
    expect(fetchMetadata).toHaveBeenCalledTimes(6);
  });

  it(`starts at most ${MAX_RESOLUTIONS_PER_JOB} resolutions per job, most-seeded first`, async () => {
    fetchMetadata.mockResolvedValue(ready(HASH_A));
    const results = Array.from({ length: 45 }, (_, i) => dup(i + 1, { nbSeeders: i + 1 }));
    const { result } = await setup(baseOptions({ results }));

    expect(fetchMetadata).toHaveBeenCalledTimes(MAX_RESOLUTIONS_PER_JOB);
    expect(result.current.size).toBe(MAX_RESOLUTIONS_PER_JOB);
    // Highest-seeded first: dup(45) has 45 seeders, dup(16) has 16.
    const requested = fetchMetadata.mock.calls.map((c) => c[0]);
    expect(requested[0]).toBe('https://idx45.example/dl/45.torrent');
    expect(requested).toContain('https://idx16.example/dl/16.torrent');
    expect(requested).not.toContain('https://idx15.example/dl/15.torrent');
  });

  it('keeps polling a pending source every 2s until the metadata arrives', async () => {
    const callsPerSource: Record<string, number> = {};
    fetchMetadata.mockImplementation(async (source) => {
      const n = (callsPerSource[source] = (callsPerSource[source] ?? 0) + 1);
      return n < 3 ? pending() : ready(HASH_A, ['udp://t:1']);
    });
    const { result } = await setup();
    expect(fetchMetadata).toHaveBeenCalledTimes(2); // first poll of each source
    expect(result.current.size).toBe(0);

    await advance(POLL_DELAY_MS - 1);
    expect(fetchMetadata).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchMetadata).toHaveBeenCalledTimes(4);
    await advance(POLL_DELAY_MS);
    expect(fetchMetadata).toHaveBeenCalledTimes(6);
    expect(result.current.size).toBe(2);
    expect(result.current.get('https://idx1.example/dl/1.torrent')?.trackers).toEqual([
      'udp://t:1',
    ]);

    await advance(POLL_DELAY_MS * 3);
    expect(fetchMetadata).toHaveBeenCalledTimes(6);
  });

  it(`gives up after ${MAX_TRIES} unanswered polls and never asks again`, async () => {
    fetchMetadata.mockResolvedValue(pending());
    const { result, rerender } = await setup(baseOptions({ results: [dup(1), dup(2)] }));
    for (let i = 0; i < MAX_TRIES + 2; i++) await advance(POLL_DELAY_MS);

    expect(fetchMetadata).toHaveBeenCalledTimes(2 * MAX_TRIES);
    expect(result.current.size).toBe(0);

    await rerender(baseOptions({ results: [dup(1), dup(2)] }));
    await advance(POLL_DELAY_MS * 3);
    expect(fetchMetadata).toHaveBeenCalledTimes(2 * MAX_TRIES);
  });

  it('takes the hash from a 202 that already names the torrent, without further polling', async () => {
    fetchMetadata.mockResolvedValue({ status: 'pending', infohashV1: HASH_A, hash: HASH_A });
    const { result } = await setup();
    expect(result.current.get('https://idx1.example/dl/1.torrent')).toEqual({
      hash: HASH_A,
      torrentId: HASH_A,
      trackers: [],
    });
    await advance(POLL_DELAY_MS * 3);
    expect(fetchMetadata).toHaveBeenCalledTimes(2);
  });

  it('treats an error as unresolved — silently, once', async () => {
    fetchMetadata.mockRejectedValue(new Error("'x' is not a valid torrent file."));
    const { result, rerender } = await setup();
    expect(result.current.size).toBe(0);
    await rerender(baseOptions());
    await advance(POLL_DELAY_MS * 3);
    expect(fetchMetadata).toHaveBeenCalledTimes(2);
  });

  it('ignores a ready response that carries no hash', async () => {
    fetchMetadata.mockResolvedValue({ status: 'ready', trackers: ['udp://t:1'] });
    const { result } = await setup();
    expect(result.current.size).toBe(0);
  });

  it('starts over on a new search job: clears resolutions, re-requests, ignores stale replies', async () => {
    const stale = deferred<TorrentMetadataResult>();
    fetchMetadata.mockResolvedValueOnce(ready(HASH_A)).mockReturnValueOnce(stale.promise);
    const { result, rerender } = await setup(baseOptions({ jobId: 1 }));
    expect(result.current.size).toBe(1);

    fetchMetadata.mockResolvedValue(ready(HASH_B));
    await rerender(baseOptions({ jobId: 2 }));
    await settle();
    // Nothing from job 1 leaks into job 2; the same URLs are requested afresh.
    expect(fetchMetadata).toHaveBeenCalledTimes(4);
    expect(result.current.get('https://idx1.example/dl/1.torrent')?.hash).toBe(HASH_B);
    // The first job's slow reply lands now and must be dropped.
    await act(async () => stale.resolve(ready(HASH_A)));
    await settle();
    expect(result.current.get('https://idx2.example/dl/2.torrent')?.hash).toBe(HASH_B);
  });

  it('aborts in-flight requests when the job changes or the screen unmounts', async () => {
    const gate = deferred<TorrentMetadataResult>();
    fetchMetadata.mockReturnValue(gate.promise);
    const { rerender, unmount } = await setup(baseOptions({ jobId: 1 }));
    const firstSignal = fetchMetadata.mock.calls[0][2] as AbortSignal;
    expect(firstSignal.aborted).toBe(false);

    await rerender(baseOptions({ jobId: 2 }));
    expect(firstSignal.aborted).toBe(true);

    const secondSignal = fetchMetadata.mock.calls[
      fetchMetadata.mock.calls.length - 1
    ][2] as AbortSignal;
    expect(secondSignal.aborted).toBe(false);
    await unmount();
    expect(secondSignal.aborted).toBe(true);
  });

  it('stops polling a pending source when unmounted', async () => {
    fetchMetadata.mockResolvedValue(pending());
    const { unmount } = await setup();
    expect(fetchMetadata).toHaveBeenCalledTimes(2);
    await unmount();
    await advance(POLL_DELAY_MS * 3);
    expect(fetchMetadata).toHaveBeenCalledTimes(2);
  });

  it('picks up candidates that appear as more results stream in', async () => {
    fetchMetadata.mockResolvedValue(ready(HASH_A));
    const { rerender, result } = await setup(baseOptions({ results: [dup(1)] }));
    expect(fetchMetadata).not.toHaveBeenCalled();

    await rerender(baseOptions({ results: [dup(1), dup(2)] }));
    await settle();
    expect(fetchMetadata).toHaveBeenCalledTimes(2);
    expect(result.current.size).toBe(2);
  });
});
