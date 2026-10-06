/**
 * search-grouping.ts — group Search results that are really the same torrent
 * (#267), so one torrent offered by several indexers shows up as one row and
 * can be added once with every indexer's trackers.
 *
 * qBittorrent's search results carry NO info hash — only fileUrl, name, size and
 * counts. A hash is knowable from a result in exactly two ways:
 *   1. its `fileUrl` is a magnet link (`xt=urn:btih:…`) — free, see `extractBtih`;
 *   2. the server resolved it via torrents/fetchMetadata (qBit 5.2+) — the
 *      `resolved` map handed to `groupSearchResults`, filled by
 *      hooks/useSearchHashResolver.ts. Only worth doing for `.torrent` URLs that
 *      already look like duplicates, see `findResolutionCandidates`.
 * Everything else can only be GUESSED at: same normalized name AND exactly the
 * same byte size.
 *
 * Grouping rules, in order of authority:
 *   - Results with a known hash group by that hash. Two different known hashes
 *     NEVER share a group, however alike their name and size are.
 *   - A result with no known hash joins the hash group sharing its name+size key
 *     when exactly one such group exists (if two exist the guess is ambiguous, so
 *     it does not pick one).
 *   - Remaining hash-less results group with each other by name+size key.
 *   - Anything else stays a group of one.
 *
 * Pure and deterministic: the same results (in the same order) always yield the
 * same groups, and a group's members are ordered by their own data rather than
 * by arrival order.
 */
import { SearchResult } from '@/types/api';
import { isMagnetLink } from '@/utils/magnet';
import { stripBracketTag } from '@/utils/searchResult';

/** What the hash resolver learned about one result's `fileUrl`. */
export interface ResolvedSource {
  /**
   * Lowercase hex hash results are grouped by: the v1 info hash when the torrent
   * has one (the same value a magnet's `btih` carries), otherwise the torrent ID.
   */
  hash: string;
  /** qBittorrent's torrent ID, for its per-torrent endpoints. Differs from `hash` only for v2-only torrents. */
  torrentId?: string;
  /** Tracker URLs inside the .torrent. Empty/absent when only the hash is known. */
  trackers?: string[];
}

export interface SearchResultGroup {
  /**
   * Stable across polls for as long as the group's identity doesn't change —
   * `h:<hash>`, `n:<name+size key>` or `u:<fileUrl>` — so a row keeps its
   * expanded state while more results stream in.
   */
  id: string;
  /** The member with the most seeders; the row that represents the group. */
  primary: SearchResult;
  /** Every member, primary first. */
  members: SearchResult[];
  /** `members.length` — how many results (indexer copies) were merged. */
  sourceCount: number;
  /** Highest seeder count among members (never negative). Not a sum: peers overlap. */
  maxSeeders: number;
  /** The info hash every hashed member shares, when one is known. */
  hash?: string;
}

const EMPTY_RESOLVED: ReadonlyMap<string, ResolvedSource> = new Map();

// ─────────────────────────────────────────────────────────────── magnets ──────

const HEX_40 = /^[0-9a-f]{40}$/i;
const BASE32_32 = /^[a-z2-7]{32}$/i;
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 32 base32 chars (160 bits) → 40 lowercase hex chars. */
function base32ToHex(input: string): string {
  let bits = 0;
  let value = 0;
  let hex = '';
  for (const char of input.toLowerCase()) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      hex += ((value >>> bits) & 0xff).toString(16).padStart(2, '0');
      value &= (1 << bits) - 1;
    }
  }
  return hex;
}

/** The raw `key=value` pieces of a magnet's query string, or null if it is not a magnet. */
function magnetTokens(magnet: string): { prefix: string; tokens: string[] } | null {
  const trimmed = magnet.trim();
  if (!isMagnetLink(trimmed)) return null;
  const queryStart = trimmed.indexOf('?') + 1;
  return {
    prefix: trimmed.slice(0, queryStart),
    tokens: trimmed
      .slice(queryStart)
      .split('&')
      .filter((token) => token.length > 0),
  };
}

function tokenParts(token: string): { key: string; value: string } {
  const eq = token.indexOf('=');
  return {
    key: safeDecode(eq === -1 ? token : token.slice(0, eq)).toLowerCase(),
    value: eq === -1 ? '' : safeDecode(token.slice(eq + 1)),
  };
}

/**
 * The v1 info hash of a magnet link, as 40 lowercase hex chars — accepting the
 * hex and base32 spellings of `xt=urn:btih:`, in any case. Null for anything
 * that isn't a magnet, has no usable `btih`, or carries only a v2 `btmh` topic.
 */
export function extractBtih(source: string | null | undefined): string | null {
  if (!source) return null;
  const parsed = magnetTokens(source);
  if (!parsed) return null;
  for (const token of parsed.tokens) {
    const { key, value } = tokenParts(token);
    if (!/^xt(\.\d+)?$/.test(key)) continue;
    const match = /^urn:btih:(.+)$/i.exec(value.trim());
    if (!match) continue;
    const candidate = match[1].trim();
    if (HEX_40.test(candidate)) return candidate.toLowerCase();
    if (BASE32_32.test(candidate)) return base32ToHex(candidate);
  }
  return null;
}

function isTrackerKey(key: string): boolean {
  return key === 'tr' || /^tr\.\d+$/.test(key);
}

/**
 * Merge several magnet links for the SAME torrent into one carrying every
 * tracker. The first magnet supplies `xt`, `dn` and every other parameter
 * verbatim; trackers from the others (and `extraTrackers`, plain URLs) are
 * appended once each, compared on their decoded text. Anything that isn't a
 * magnet — or whose `btih` differs from the first magnet's — is ignored, so two
 * different torrents can never be fused. Returns '' when no magnet was given.
 */
export function mergeMagnets(magnetUrls: string[], extraTrackers: string[] = []): string {
  const parsed = magnetUrls
    .map((url) => ({ url, magnet: magnetTokens(url) }))
    .filter((entry): entry is { url: string; magnet: NonNullable<typeof entry.magnet> } =>
      Boolean(entry.magnet),
    );
  if (parsed.length === 0) return '';

  const [first, ...others] = parsed;
  const firstHash = extractBtih(first.url);
  const tokens = [...first.magnet.tokens];
  const seen = new Set<string>();
  for (const token of tokens) {
    const { key, value } = tokenParts(token);
    if (isTrackerKey(key) && value.trim()) seen.add(value.trim());
  }

  for (const { url, magnet } of others) {
    const hash = extractBtih(url);
    if (firstHash && hash && hash !== firstHash) continue;
    for (const token of magnet.tokens) {
      const { key, value } = tokenParts(token);
      const tracker = value.trim();
      if (!isTrackerKey(key) || !tracker || seen.has(tracker)) continue;
      seen.add(tracker);
      tokens.push(token);
    }
  }

  for (const extra of extraTrackers) {
    const tracker = extra.trim();
    if (!tracker || seen.has(tracker)) continue;
    seen.add(tracker);
    tokens.push(`tr=${encodeURIComponent(tracker)}`);
  }

  return `${first.magnet.prefix}${tokens.join('&')}`;
}

// ──────────────────────────────────────────────────────── name + size keys ────

/**
 * Title reduced to what stays the same across indexers: no bracketed indexer
 * tag, lowercase, and every run of separators/punctuation ("." "_" "-" …)
 * collapsed to one space, so "Movie.2024.1080p [A]" and "movie 2024 1080p"
 * compare equal.
 */
export function normalizeName(name: string): string {
  return stripBracketTag(name ?? '')
    .toLowerCase()
    .replace(/[\s._\-+,;:!?'"`~()[\]{}<>|/\\]+/g, ' ')
    .trim();
}

/**
 * The best-effort "same torrent?" key: normalized name plus exact byte size.
 * Null when either is unusable — qBittorrent reports -1 for an unknown size, and
 * a name that normalizes to nothing says nothing.
 */
export function nameSizeKey(result: SearchResult): string | null {
  if (!(result.fileSize > 0)) return null;
  const name = normalizeName(result.fileName);
  return name ? `${name}|${result.fileSize}` : null;
}

// ──────────────────────────────────────────────────────── resolution targets ──

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/**
 * The results worth confirming through torrents/fetchMetadata: http(s) `.torrent`
 * links (magnets already reveal their hash) that share a name+size key with at
 * least one OTHER result — i.e. that already look like a duplicate. A result
 * nobody else resembles has nothing to be grouped with, so it is never fetched.
 * Ordered by seeders, most first, so a cap (`limit`) keeps the most relevant.
 */
export function findResolutionCandidates(results: SearchResult[], limit?: number): SearchResult[] {
  const urlsByKey = new Map<string, Set<string>>();
  for (const result of results) {
    const key = nameSizeKey(result);
    if (!key) continue;
    const urls = urlsByKey.get(key) ?? new Set<string>();
    urls.add(result.fileUrl);
    urlsByKey.set(key, urls);
  }

  const candidates = results.filter((result) => {
    if (!result.fileUrl || isMagnetLink(result.fileUrl) || !isHttpUrl(result.fileUrl)) return false;
    const key = nameSizeKey(result);
    return key !== null && (urlsByKey.get(key)?.size ?? 0) >= 2;
  });
  // Array.prototype.sort is stable, so equal seeder counts keep their input order.
  candidates.sort((a, b) => seeders(b) - seeders(a));
  return limit === undefined ? candidates : candidates.slice(0, Math.max(0, limit));
}

// ─────────────────────────────────────────────────────────────── grouping ─────

function seeders(result: SearchResult): number {
  return Math.max(0, result.nbSeeders ?? 0);
}

/** Best member first: seeders, then size, then name, then URL — all from the data itself. */
function compareMembers(a: SearchResult, b: SearchResult): number {
  if (seeders(a) !== seeders(b)) return seeders(b) - seeders(a);
  const sizeA = a.fileSize ?? 0;
  const sizeB = b.fileSize ?? 0;
  if (sizeA !== sizeB) return sizeB - sizeA;
  const nameA = a.fileName || '';
  const nameB = b.fileName || '';
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  const urlA = a.fileUrl || '';
  const urlB = b.fileUrl || '';
  if (urlA !== urlB) return urlA < urlB ? -1 : 1;
  return 0;
}

interface Entry {
  result: SearchResult;
  index: number;
  hash: string | null;
  key: string | null;
}

/** The hash a result is known to have, if any: from its magnet link, else from the resolver. */
function knownHash(result: SearchResult, resolved: ReadonlyMap<string, ResolvedSource>) {
  const fromMagnet = extractBtih(result.fileUrl);
  if (fromMagnet) return fromMagnet;
  const fromResolver = resolved.get(result.fileUrl)?.hash?.trim().toLowerCase();
  return fromResolver || null;
}

function pushTo<K>(map: Map<K, Entry[]>, key: K, entry: Entry): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(entry);
  else map.set(key, [entry]);
}

/**
 * Group `results` (already filtered, any order) per the module rules. Groups are
 * returned in the order of their primary's position in `results`, so replacing a
 * list with its groups keeps every row roughly where it was; the caller re-sorts
 * them by primary. Repeated `fileUrl`s are ignored after their first appearance.
 */
export function groupSearchResults(
  results: SearchResult[],
  resolved: ReadonlyMap<string, ResolvedSource> = EMPTY_RESOLVED,
): SearchResultGroup[] {
  const seenUrls = new Set<string>();
  const entries: Entry[] = [];
  results.forEach((result, index) => {
    if (seenUrls.has(result.fileUrl)) return;
    seenUrls.add(result.fileUrl);
    entries.push({ result, index, hash: knownHash(result, resolved), key: nameSizeKey(result) });
  });

  const byHash = new Map<string, Entry[]>();
  const unhashed: Entry[] = [];
  for (const entry of entries) {
    if (entry.hash) pushTo(byHash, entry.hash, entry);
    else unhashed.push(entry);
  }

  // Which known hashes does each name+size key occur under? Built from the hashed
  // entries only, so attaching a hash-less result below never changes the answer
  // for the next one — the outcome doesn't depend on result order.
  const hashesByKey = new Map<string, Set<string>>();
  for (const [hash, bucket] of byHash) {
    for (const entry of bucket) {
      if (!entry.key) continue;
      const hashes = hashesByKey.get(entry.key) ?? new Set<string>();
      hashes.add(hash);
      hashesByKey.set(entry.key, hashes);
    }
  }

  const byKey = new Map<string, Entry[]>();
  const loners: Entry[] = [];
  for (const entry of unhashed) {
    if (!entry.key) {
      loners.push(entry);
      continue;
    }
    const hashes = hashesByKey.get(entry.key);
    if (hashes && hashes.size === 1) {
      // A name+size guess that agrees with exactly one known hash.
      pushTo(byHash, [...hashes][0], entry);
    } else {
      pushTo(byKey, entry.key, entry);
    }
  }

  const groups: Array<{ group: SearchResultGroup; firstIndex: number }> = [];
  const build = (id: string, bucket: Entry[], hash?: string) => {
    const members = bucket.map((entry) => entry.result).sort(compareMembers);
    const primary = members[0];
    const group: SearchResultGroup = {
      id,
      primary,
      members,
      sourceCount: members.length,
      maxSeeders: seeders(primary),
    };
    if (hash) group.hash = hash;
    // Position the group where its primary sat in the input.
    const firstIndex = bucket.find((entry) => entry.result === primary)?.index ?? 0;
    groups.push({ group, firstIndex });
  };

  for (const [hash, bucket] of byHash) build(`h:${hash}`, bucket, hash);
  for (const [key, bucket] of byKey) build(`n:${key}`, bucket);
  for (const entry of loners) build(`u:${entry.result.fileUrl}`, [entry]);

  groups.sort((a, b) => a.firstIndex - b.firstIndex);
  return groups.map(({ group }) => group);
}

/** Wrap results as groups of one — the "grouping off" shape, same ids a loner gets. */
export function singletonGroups(results: SearchResult[]): SearchResultGroup[] {
  return results.map((result) => ({
    id: `u:${result.fileUrl}`,
    primary: result,
    members: [result],
    sourceCount: 1,
    maxSeeders: seeders(result),
  }));
}

// ───────────────────────────────────────────────────────────── adding a group ──

/**
 * Trackers worth attaching to a torrent added from a group made of `.torrent`
 * links: everything the resolver learned from the OTHER members that the
 * primary's own file doesn't already list, together with the torrent ID to
 * attach them to. Null when there is nothing to add or no ID to add it to.
 */
export function collectGroupTrackers(
  group: SearchResultGroup,
  resolved: ReadonlyMap<string, ResolvedSource>,
): { torrentId: string; trackers: string[] } | null {
  if (group.sourceCount < 2) return null;
  const primaryEntry = resolved.get(group.primary.fileUrl);
  const own = new Set(primaryEntry?.trackers ?? []);
  let torrentId = primaryEntry?.torrentId ?? primaryEntry?.hash;
  const extra: string[] = [];
  for (const member of group.members) {
    if (member === group.primary) continue;
    const entry = resolved.get(member.fileUrl);
    if (!entry) continue;
    torrentId = torrentId ?? entry.torrentId ?? entry.hash;
    for (const tracker of entry.trackers ?? []) {
      if (!own.has(tracker) && !extra.includes(tracker)) extra.push(tracker);
    }
  }
  return torrentId && extra.length > 0 ? { torrentId, trackers: extra } : null;
}

/** How to add a whole group: what to hand the add path, and the tracker top-up to follow it. */
export interface GroupAddPlan {
  /** Stands in for the group in the existing add path; `fileUrl` may be a merged magnet. */
  result: SearchResult;
  /** Set only when a `.torrent` is added and other members' trackers should be attached afterwards. */
  trackerFollowUp: { torrentId: string; trackers: string[] } | null;
}

/**
 * Decide how adding a group works.
 *  - Any magnet member: add ONE merged magnet (`mergeMagnets`) carrying every
 *    member magnet's trackers, plus trackers the resolver read out of `.torrent`
 *    members of the same hash — no follow-up needed.
 *  - Otherwise: add the primary as usual, and top its trackers up afterwards
 *    from the other members (`collectGroupTrackers`).
 * A group of one is just its primary.
 */
export function planGroupAdd(
  group: SearchResultGroup,
  resolved: ReadonlyMap<string, ResolvedSource> = EMPTY_RESOLVED,
): GroupAddPlan {
  if (group.sourceCount < 2) return { result: group.primary, trackerFollowUp: null };

  const magnets = group.members.filter((member) => isMagnetLink(member.fileUrl));
  if (magnets.length > 0) {
    const groupHash = group.hash ?? extractBtih(magnets[0].fileUrl);
    const torrentTrackers: string[] = [];
    for (const member of group.members) {
      if (isMagnetLink(member.fileUrl)) continue;
      const entry = resolved.get(member.fileUrl);
      // Only .torrent files confirmed to be this very torrent contribute trackers.
      if (!entry || !groupHash || entry.hash.toLowerCase() !== groupHash) continue;
      for (const tracker of entry.trackers ?? []) {
        if (!torrentTrackers.includes(tracker)) torrentTrackers.push(tracker);
      }
    }
    const merged = mergeMagnets(
      magnets.map((member) => member.fileUrl),
      torrentTrackers,
    );
    return { result: { ...group.primary, fileUrl: merged }, trackerFollowUp: null };
  }

  return { result: group.primary, trackerFollowUp: collectGroupTrackers(group, resolved) };
}
