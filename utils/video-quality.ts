/**
 * Video-quality detection for Search results (#268). qBittorrent's search API
 * has no resolution field, so the only signal is the release name
 * (`Movie.2023.1080p.BluRay.x264-GRP`, `Show S01E01 [2160p]`, `Movie (4K)`).
 * Pure — no React, no storage.
 *
 * Names are split into alphanumeric tokens and each token is matched whole, so
 * a resolution only counts when it stands on its own: `x264` / `h264` / `x265`
 * never read as 264 / 265, `4k` inside another word never matches, and a bare
 * year or number (`1080`, `2160`, `2020`) without the `p`/`i` suffix is ignored.
 */

/** Rank returned when no resolution marker is found; always sorts last. */
export const UNKNOWN_QUALITY_RANK = 0;

/** Display label for a rank — see {@link getVideoQualityLabel}. */
export type VideoQualityLabel = '2160p' | '1440p' | '1080p' | '720p' | 'SD';

/** Rank by vertical resolution. 3.5 keeps 1440p between 1080p and 2160p. */
const HEIGHT_RANK: Record<number, number> = {
  2160: 4,
  1440: 3.5,
  1080: 3,
  720: 2,
  576: 1,
  540: 1,
  480: 1,
  360: 1,
  240: 1,
};

/** Standalone tokens that name a quality without a pixel height. */
const WORD_RANK: Record<string, number> = {
  '4k': 4,
  uhd: 4,
  fullhd: 3,
  fhd: 3,
  sdtv: 1,
  dvdrip: 1,
  dvd: 1,
  dvd5: 1,
  dvd9: 1,
};

// `1080p`, `1080i`, and the frame-rate-suffixed `1080p60` / `2160p30`.
const HEIGHT_TOKEN = /^(\d{3,4})[pi](?:\d{2,3})?$/;
// `1920x1080` — the height is what counts. `x264` has no leading digits, so it
// can't match.
const DIMENSION_TOKEN = /^\d{3,4}x(\d{3,4})$/;
// "[SD]" / "(SD)" as an explicit tag. A bare "sd" word is too ambiguous
// ("SD Gundam"), so it only counts when bracketed.
const BRACKETED_SD = /[[(]\s*sd\s*[\])]/i;

function rankToken(token: string): number {
  const word = WORD_RANK[token];
  if (word !== undefined) return word;
  const match = HEIGHT_TOKEN.exec(token) ?? DIMENSION_TOKEN.exec(token);
  if (match) return HEIGHT_RANK[Number(match[1])] ?? UNKNOWN_QUALITY_RANK;
  return UNKNOWN_QUALITY_RANK;
}

function computeRank(fileName: string): number {
  const tokens = fileName.toLowerCase().split(/[^a-z0-9]+/);
  let best = BRACKETED_SD.test(fileName) ? 1 : UNKNOWN_QUALITY_RANK;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    let rank = rankToken(token);
    // Two-word spellings: "Ultra HD", "Full HD".
    if (tokens[i + 1] === 'hd') {
      if (token === 'ultra') rank = Math.max(rank, 4);
      else if (token === 'full') rank = Math.max(rank, 3);
    }
    if (rank > best) best = rank;
  }
  return best;
}

// Sorting calls the ranker O(n log n) times over the same few thousand names,
// and every sort-direction toggle re-runs it, so memoize. Bounded so a long
// session of searches can't grow it without limit.
const RANK_CACHE_LIMIT = 5000;
const rankCache = new Map<string, number>();

/**
 * Ranks a release name by the highest video quality it advertises:
 * 2160p / 4K / UHD → 4, 1440p → 3.5, 1080p / 1080i / FHD → 3, 720p → 2,
 * 576p–240p / SD tags / DVD rips → 1, nothing recognizable → 0. When several
 * markers appear the highest wins. "2K" is deliberately not recognized — it
 * means 1440p or 2048x1080 depending on who's talking.
 */
export function getVideoQualityRank(fileName: string): number {
  if (!fileName) return UNKNOWN_QUALITY_RANK;
  const cached = rankCache.get(fileName);
  if (cached !== undefined) return cached;
  const rank = computeRank(fileName);
  if (rankCache.size >= RANK_CACHE_LIMIT) rankCache.clear();
  rankCache.set(fileName, rank);
  return rank;
}

/** Short display label for a rank, or null when the quality is unknown. */
export function getVideoQualityLabel(rank: number): VideoQualityLabel | null {
  if (rank >= 4) return '2160p';
  if (rank >= 3.5) return '1440p';
  if (rank >= 3) return '1080p';
  if (rank >= 2) return '720p';
  if (rank >= 1) return 'SD';
  return null;
}

/** The slice of a Search result {@link compareByQuality} reads. */
export interface QualityComparable {
  fileName: string;
  nbSeeders?: number;
}

/**
 * Comparator for the Search tab's "Quality" sort. `direction` 'desc' puts the
 * best quality first.
 *
 * Results with no recognizable quality always sort last, in either direction
 * — "unknown" isn't worse than 720p, it's just unsorted, and burying it under
 * the known results is what the user wants either way. Ties (including
 * unknown-vs-unknown) break by seeders, most first, regardless of direction;
 * qBittorrent's -1 "unknown seeders" sentinel counts as 0.
 */
export function compareByQuality(
  a: QualityComparable,
  b: QualityComparable,
  direction: 'asc' | 'desc',
): number {
  const rankA = getVideoQualityRank(a.fileName);
  const rankB = getVideoQualityRank(b.fileName);
  const aUnknown = rankA === UNKNOWN_QUALITY_RANK;
  const bUnknown = rankB === UNKNOWN_QUALITY_RANK;
  if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
  if (rankA !== rankB) return direction === 'asc' ? rankA - rankB : rankB - rankA;
  return Math.max(0, b.nbSeeders ?? 0) - Math.max(0, a.nbSeeders ?? 0);
}
