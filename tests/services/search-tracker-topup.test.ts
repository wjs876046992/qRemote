jest.mock('@/services/api/torrents', () => ({
  torrentsApi: { getTorrentList: jest.fn(), addTrackers: jest.fn() },
}));
jest.mock('@/services/connectivity-log', () => ({
  clogDebug: jest.fn(),
  clogInfo: jest.fn(),
  clogWarn: jest.fn(),
  clogError: jest.fn(),
}));

import {
  TRACKER_TOPUP_ATTEMPTS,
  TRACKER_TOPUP_DELAY_MS,
  abortableDelay,
  addTrackersWhenTorrentAppears,
  prepareTrackerTopUp,
} from '@/services/search-tracker-topup';
import { torrentsApi } from '@/services/api/torrents';
import { clogWarn } from '@/services/connectivity-log';
import { TorrentInfo } from '@/types/api';

const getTorrentList = torrentsApi.getTorrentList as jest.Mock;
const addTrackers = torrentsApi.addTrackers as jest.Mock;

const ID = 'a'.repeat(40);
const followUp = { torrentId: ID, trackers: ['udp://extra:1', 'udp://extra:2'] };
const torrent = { hash: ID, name: 'x' } as TorrentInfo;

/** Let queued promise callbacks run without moving the fake clock. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function advance(ms: number) {
  jest.advanceTimersByTime(ms);
  await flush();
}

describe('search-tracker-topup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('abortableDelay', () => {
    it('resolves after the delay', async () => {
      const done = jest.fn();
      void abortableDelay(1000).then(done);
      await advance(999);
      expect(done).not.toHaveBeenCalled();
      await advance(1);
      expect(done).toHaveBeenCalled();
    });

    it('resolves immediately on abort, or if already aborted', async () => {
      const controller = new AbortController();
      const done = jest.fn();
      void abortableDelay(60_000, controller.signal).then(done);
      controller.abort();
      await flush();
      expect(done).toHaveBeenCalled();

      const already = jest.fn();
      void abortableDelay(60_000, controller.signal).then(already);
      await flush();
      expect(already).toHaveBeenCalled();
    });
  });

  describe('addTrackersWhenTorrentAppears', () => {
    it('looks the torrent up by ID and adds the trackers once it exists', async () => {
      getTorrentList
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValue([torrent]);
      addTrackers.mockResolvedValue(undefined);
      const controller = new AbortController();
      const done = addTrackersWhenTorrentAppears(followUp, controller.signal);

      await advance(TRACKER_TOPUP_DELAY_MS);
      await advance(TRACKER_TOPUP_DELAY_MS);
      expect(addTrackers).not.toHaveBeenCalled();
      await advance(TRACKER_TOPUP_DELAY_MS);
      await done;

      expect(getTorrentList).toHaveBeenCalledTimes(3);
      expect(getTorrentList).toHaveBeenCalledWith(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        [ID],
      );
      expect(addTrackers).toHaveBeenCalledTimes(1);
      expect(addTrackers).toHaveBeenCalledWith(ID, followUp.trackers);
    });

    it('keeps waiting through a failed lookup', async () => {
      getTorrentList
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValue([torrent]);
      addTrackers.mockResolvedValue(undefined);
      const done = addTrackersWhenTorrentAppears(followUp, new AbortController().signal);
      await advance(TRACKER_TOPUP_DELAY_MS);
      await advance(TRACKER_TOPUP_DELAY_MS);
      await done;
      expect(addTrackers).toHaveBeenCalledTimes(1);
    });

    it('does not retry a failed addTrackers, and does not throw', async () => {
      getTorrentList.mockResolvedValue([torrent]);
      addTrackers.mockRejectedValue(new Error('boom'));
      const done = addTrackersWhenTorrentAppears(followUp, new AbortController().signal);
      await advance(TRACKER_TOPUP_DELAY_MS);
      await expect(done).resolves.toBeUndefined();
      expect(addTrackers).toHaveBeenCalledTimes(1);
      expect(clogWarn).toHaveBeenCalled();
    });

    it('gives up quietly when the torrent never appears', async () => {
      getTorrentList.mockResolvedValue([]);
      const done = addTrackersWhenTorrentAppears(followUp, new AbortController().signal);
      for (let i = 0; i < TRACKER_TOPUP_ATTEMPTS; i++) await advance(TRACKER_TOPUP_DELAY_MS);
      await expect(done).resolves.toBeUndefined();
      expect(getTorrentList).toHaveBeenCalledTimes(TRACKER_TOPUP_ATTEMPTS);
      expect(addTrackers).not.toHaveBeenCalled();
    });

    it('stops when aborted, without touching the torrent', async () => {
      getTorrentList.mockResolvedValue([torrent]);
      const controller = new AbortController();
      const done = addTrackersWhenTorrentAppears(followUp, controller.signal);
      controller.abort();
      await flush();
      await done;
      await advance(TRACKER_TOPUP_DELAY_MS * 3);
      expect(getTorrentList).not.toHaveBeenCalled();
      expect(addTrackers).not.toHaveBeenCalled();
    });
  });

  describe('prepareTrackerTopUp', () => {
    it('returns nothing to do when the client already has the torrent', async () => {
      getTorrentList.mockResolvedValue([torrent]);
      const activePolls = new Set<AbortController>();
      expect(await prepareTrackerTopUp(followUp, activePolls)).toBeNull();
      expect(activePolls.size).toBe(0);
    });

    it('returns nothing to do when the existence check fails (when unsure, touch nothing)', async () => {
      getTorrentList.mockRejectedValue(new Error('Connection timeout'));
      expect(await prepareTrackerTopUp(followUp, new Set())).toBeNull();
    });

    it('returns a starter that registers a cancellable poll and tops the torrent up', async () => {
      getTorrentList.mockResolvedValueOnce([]); // pre-add check: not there yet
      const activePolls = new Set<AbortController>();
      const start = await prepareTrackerTopUp(followUp, activePolls);
      expect(start).toEqual(expect.any(Function));
      expect(activePolls.size).toBe(0);

      getTorrentList.mockResolvedValue([torrent]);
      addTrackers.mockResolvedValue(undefined);
      start?.();
      expect(activePolls.size).toBe(1);

      await advance(TRACKER_TOPUP_DELAY_MS);
      await flush();
      expect(addTrackers).toHaveBeenCalledWith(ID, followUp.trackers);
      expect(activePolls.size).toBe(0);
    });

    it('lets the screen abort the poll on unmount', async () => {
      getTorrentList.mockResolvedValueOnce([]);
      const activePolls = new Set<AbortController>();
      const start = await prepareTrackerTopUp(followUp, activePolls);
      getTorrentList.mockResolvedValue([torrent]);
      start?.();
      for (const controller of activePolls) controller.abort();
      await advance(TRACKER_TOPUP_DELAY_MS * 2);
      expect(addTrackers).not.toHaveBeenCalled();
      expect(activePolls.size).toBe(0);
    });
  });
});
