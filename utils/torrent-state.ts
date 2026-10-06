/**
 * Canonical getStateColor / getStateLabel for torrent state display.
 *
 * Reconciled from TorrentCard.tsx (switch-based, most complete),
 * torrent/[hash].tsx (if-else chain), and ExpandableTorrentCard.tsx (ternary).
 *
 * `colors` is passed as a parameter so these stay pure — no hook calls.
 */

interface StateColors {
  stateUploadAndDownload: string;
  stateUploadOnly: string;
  stateSeeding: string;
  stateDownloading: string;
  stateMetadata: string;
  statePaused: string;
  stateError: string;
  stateChecking: string;
  stateQueued: string;
  stateStalled: string;
  stateOther: string;
}

export function getStateColor(
  state: string,
  progress: number,
  dlspeed: number,
  upspeed: number,
  colors: StateColors,
): string {
  const downloading = dlspeed > 0;
  const uploading = upspeed > 0;

  if (downloading && uploading) return colors.stateUploadAndDownload;
  if (uploading && !downloading) return colors.stateUploadOnly;

  if (state === 'stalledUP' && progress >= 1) return colors.stateSeeding;

  // qBittorrent can leave a torrent reporting a download-side stopped state
  // (stoppedDL/pausedDL) even once it has nothing left to download — treat
  // it the same as stoppedUP/pausedUP (see isTorrentCompleted).
  if ((state === 'stoppedDL' || state === 'pausedDL') && progress >= 1) {
    return colors.stateSeeding;
  }

  switch (state) {
    case 'downloading':
    case 'forcedDL':
      return colors.stateDownloading;
    case 'metaDL':
    case 'forcedMetaDL':
      return colors.stateMetadata;
    case 'uploading':
    case 'forcedUP':
      return colors.stateUploadOnly;
    case 'pausedDL':
    case 'stoppedDL':
      return colors.statePaused;
    case 'pausedUP':
    case 'stoppedUP':
      // Stopped/paused after finishing — qBittorrent's own WebUI calls this
      // "Completed", not "Paused"; use the same positive color as seeding.
      return colors.stateSeeding;
    case 'error':
    case 'missingFiles':
    case 'stalledDL':
      return colors.stateError;
    case 'checkingDL':
    case 'checkingUP':
      return colors.stateChecking;
    case 'queuedDL':
    case 'queuedUP':
      return colors.stateQueued;
    case 'stalledUP':
      return colors.stateStalled;
    case 'allocating':
    case 'checkingResumeData':
    case 'moving':
    case 'unknown':
    default:
      return colors.stateOther;
  }
}

/**
 * `progress` is the raw fraction (0–1); a torrent is complete/seeding once
 * it reaches 100%, regardless of its exact state (uploading, stalledUP,
 * forcedUP, paused-after-completion, ...).
 */
export function isTorrentComplete(progress: number): boolean {
  return progress >= 1;
}

/**
 * Mirrors qBittorrent's own `TorrentImpl::isCompleted()` (and the
 * `qbittorrent-api` Python client's `TorrentState.is_complete`): a torrent is
 * "completed" once it has finished downloading and moved to an upload/seed-side
 * state, regardless of whether it's actively seeding, paused/stopped, queued,
 * checking, or stalled while in that state.
 *
 * This alone is NOT sufficient to detect completion, though: qBittorrent's own
 * state machine has a known gap where a torrent that finishes downloading while
 * stopped (e.g. added pre-stopped over existing 100%-complete data, or stopped
 * mid-check) can be left reporting `stoppedDL`/`pausedDL` — the "downloading"
 * side — indefinitely, even though it never has anything left to download (see
 * `isTorrentCompleted`, which combines this with a `progress` fallback).
 */
export function isCompletedState(state: string): boolean {
  switch (state) {
    case 'uploading':
    case 'stalledUP':
    case 'checkingUP':
    case 'pausedUP':
    case 'stoppedUP':
    case 'queuedUP':
    case 'forcedUP':
      return true;
    default:
      return false;
  }
}

/**
 * The authoritative "is this torrent done" check: true if `state` is on the
 * upload/seed side (see `isCompletedState`) OR `progress` has reached 100%.
 * The progress fallback exists because qBittorrent doesn't always flip a
 * torrent's state to the upload side when it finishes while stopped/paused —
 * it can stay on `stoppedDL`/`pausedDL` with nothing left to download. Prefer
 * this over `isCompletedState` alone whenever `progress` is available (e.g.
 * the "Completed" filter) to avoid missing those torrents.
 */
export function isTorrentCompleted(state: string, progress: number): boolean {
  return isCompletedState(state) || isTorrentComplete(progress);
}

/**
 * States where qBittorrent is actively working on the torrent: downloading,
 * seeding, or checking. Stalled counts as active (it is running, just without
 * peers); queued, stopped/paused, moving, and error states do not.
 */
export function isActiveState(state: string): boolean {
  switch (state) {
    case 'downloading':
    case 'forcedDL':
    case 'metaDL':
    case 'forcedMetaDL':
    case 'stalledDL':
    case 'uploading':
    case 'forcedUP':
    case 'stalledUP':
    case 'checkingDL':
    case 'checkingUP':
    case 'checkingResumeData':
      return true;
    default:
      return false;
  }
}

/**
 * While seeding, qBittorrent's ETA counts down to the share limit.
 * `8640000` is qBittorrent's sentinel for an infinite/unknown ETA.
 */
export function hasEta(eta: number, state: string): boolean {
  return eta > 0 && eta < 8640000 && isActiveState(state);
}

type TranslateFn = (key: string) => string;

export function getStateLabel(
  state: string,
  progress: number,
  dlspeed: number,
  upspeed: number,
  t?: TranslateFn,
): string {
  const s = (key: string, fallback: string) => (t ? t(`states.${key}`) : fallback);
  const downloading = dlspeed > 0;
  const uploading = upspeed > 0;

  if (downloading && uploading) return s('dlAndUl', 'DL + UL');
  if (uploading && !downloading) return s('uploading', 'Uploading');

  if (state === 'stalledUP' && progress >= 1) return s('seeding', 'Seeding');

  // qBittorrent can leave a torrent reporting a download-side stopped state
  // (stoppedDL/pausedDL) even once it has nothing left to download — treat
  // it the same as stoppedUP/pausedUP (see isTorrentCompleted).
  if ((state === 'stoppedDL' || state === 'pausedDL') && progress >= 1) {
    return s('completed', 'Completed');
  }

  switch (state) {
    case 'downloading':
      return s('downloading', 'Downloading');
    case 'metaDL':
      return s('metadata', 'Metadata');
    case 'forcedMetaDL':
      return s('forcedMeta', 'Forced Meta');
    case 'forcedDL':
      return s('forcedDl', 'Forced DL');
    case 'uploading':
      return s('uploading', 'Uploading');
    case 'forcedUP':
      return s('forcedUp', 'Forced UP');
    case 'pausedDL':
      return s('paused', 'Paused');
    case 'stoppedDL':
      return s('stopped', 'Stopped');
    case 'pausedUP':
    case 'stoppedUP':
      // Stopped/paused after finishing — qBittorrent's own WebUI calls this
      // "Completed", not "Paused" (confirmed against its dynamicTable.js,
      // true both for the legacy pausedUP and current stoppedUP naming).
      return s('completed', 'Completed');
    case 'error':
      return s('error', 'Error');
    case 'missingFiles':
      return s('missingFiles', 'Missing Files');
    case 'checkingDL':
    case 'checkingUP':
      return s('checking', 'Checking');
    case 'queuedDL':
    case 'queuedUP':
      return s('queued', 'Queued');
    case 'stalledDL':
      return s('stalledDl', 'Stalled DL');
    case 'stalledUP':
      return s('stalledUp', 'Stalled UP');
    case 'allocating':
      return s('allocating', 'Allocating');
    case 'checkingResumeData':
      return s('checking', 'Checking');
    case 'moving':
      return s('moving', 'Moving');
    default:
      return state;
  }
}
