import {
  collectGroupTrackers,
  extractBtih,
  findResolutionCandidates,
  groupSearchResults,
  mergeMagnets,
  nameSizeKey,
  normalizeName,
  planGroupAdd,
  ResolvedSource,
  singletonGroups,
} from '@/utils/search-grouping';
import { SearchResult } from '@/types/api';

const H1 = '0123456789abcdef0123456789abcdef01234567';
const H2 = 'fedcba9876543210fedcba9876543210fedcba98';
const H3 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** Independent RFC 4648 base32 encoder, to build base32 magnets from a hex hash. */
function hexToBase32(hex: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of hex.match(/../g) ?? [])
    bits += parseInt(byte, 16).toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    fileName: 'Some Movie 2024 1080p',
    fileSize: 1_000_000,
    fileUrl: 'https://idx.example/dl/1.torrent',
    nbLeechers: 1,
    nbSeeders: 10,
    siteUrl: 'https://idx.example',
    descrLink: '',
    ...overrides,
  };
}

const magnet = (hash: string, extra = '') => `magnet:?xt=urn:btih:${hash}${extra}`;

describe('extractBtih', () => {
  it('reads a 40-char hex btih and lowercases it', () => {
    expect(extractBtih(magnet(H1))).toBe(H1);
    expect(extractBtih(magnet(H1.toUpperCase()))).toBe(H1);
    expect(extractBtih(magnet('0123456789ABCDEF0123456789abcdef01234567'))).toBe(H1);
  });

  it('decodes a 32-char base32 btih, in either case', () => {
    const b32 = hexToBase32(H1);
    expect(b32).toHaveLength(32);
    expect(extractBtih(magnet(b32))).toBe(H1);
    expect(extractBtih(magnet(b32.toLowerCase()))).toBe(H1);
    expect(extractBtih(magnet(hexToBase32(H2)))).toBe(H2);
  });

  it('finds btih regardless of parameter order, scheme case and percent-encoding', () => {
    expect(extractBtih(`magnet:?dn=Some%20Name&tr=udp%3A%2F%2Ft%3A1&xt=urn:btih:${H1}`)).toBe(H1);
    expect(extractBtih(`MAGNET:?xt=urn%3Abtih%3A${H1}&dn=x`)).toBe(H1);
    expect(extractBtih(`  ${magnet(H1)}  `)).toBe(H1);
    expect(extractBtih(`magnet:?xt.1=urn:btih:${H1}`)).toBe(H1);
  });

  it('picks the btih topic when a hybrid magnet also carries a v2 btmh topic', () => {
    const btmh = `xt=urn:btmh:1220${'ab'.repeat(32)}`;
    expect(extractBtih(`magnet:?${btmh}&xt=urn:btih:${H1}`)).toBe(H1);
  });

  it('returns null for v2-only (btmh) magnets', () => {
    expect(extractBtih(`magnet:?xt=urn:btmh:1220${'ab'.repeat(32)}`)).toBeNull();
  });

  it('returns null for non-magnets and malformed input', () => {
    expect(extractBtih('https://idx.example/dl/1.torrent')).toBeNull();
    expect(extractBtih('')).toBeNull();
    expect(extractBtih(null)).toBeNull();
    expect(extractBtih(undefined)).toBeNull();
    expect(extractBtih('magnet:?dn=no-hash')).toBeNull();
    expect(extractBtih('magnet:?xt=urn:btih:tooshort')).toBeNull();
    expect(extractBtih(`magnet:?xt=urn:btih:${'z'.repeat(40)}`)).toBeNull();
    expect(extractBtih(`magnet:?xt=urn:sha1:${H1}`)).toBeNull();
    // base32 alphabet has no 0, 1, 8 or 9.
    expect(extractBtih(`magnet:?xt=urn:btih:${'0'.repeat(32)}`)).toBeNull();
  });
});

describe('normalizeName / nameSizeKey', () => {
  it('lowercases and collapses separators so differently-punctuated titles match', () => {
    expect(normalizeName('Some.Movie.2024.1080p.WEB-DL')).toBe('some movie 2024 1080p web dl');
    expect(normalizeName('Some_Movie 2024  1080p WEB DL')).toBe('some movie 2024 1080p web dl');
  });

  it('drops a bracketed indexer tag but keeps quality tags', () => {
    expect(normalizeName('Some Movie 2024 [MyIndexer]')).toBe('some movie 2024');
    expect(normalizeName('[1337x] Some Movie 2024')).toBe('some movie 2024');
    expect(normalizeName('Some Movie [1080p]')).toBe('some movie 1080p');
  });

  it('handles empty input', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName('  ...  ')).toBe('');
  });

  it('builds a key from the normalized name and exact size', () => {
    expect(nameSizeKey(result({ fileName: 'A.B', fileSize: 5 }))).toBe('a b|5');
    expect(nameSizeKey(result({ fileName: 'a_b [Idx]', fileSize: 5 }))).toBe('a b|5');
    expect(nameSizeKey(result({ fileName: 'A.B', fileSize: 6 }))).not.toBe('a b|5');
  });

  it('is null when the size is unknown (<= 0) or the name is empty', () => {
    expect(nameSizeKey(result({ fileSize: 0 }))).toBeNull();
    expect(nameSizeKey(result({ fileSize: -1 }))).toBeNull();
    expect(nameSizeKey(result({ fileSize: undefined as unknown as number }))).toBeNull();
    expect(nameSizeKey(result({ fileName: '', fileSize: 10 }))).toBeNull();
    expect(nameSizeKey(result({ fileName: '[Idx]', fileSize: 10 }))).toBeNull();
  });
});

describe('findResolutionCandidates', () => {
  it('returns only http(s) torrent links that share a name+size key with another result', () => {
    const a = result({ fileUrl: 'https://a.example/1.torrent', nbSeeders: 5 });
    const b = result({ fileUrl: 'https://b.example/1.torrent', nbSeeders: 9 });
    const lonely = result({
      fileName: 'Different',
      fileUrl: 'https://c.example/2.torrent',
      nbSeeders: 99,
    });
    const sameNameOtherSize = result({
      fileSize: 2_000_000,
      fileUrl: 'https://d.example/3.torrent',
    });
    const out = findResolutionCandidates([a, lonely, b, sameNameOtherSize]);
    expect(out).toEqual([b, a]);
  });

  it('counts a magnet as the "other" result, but never returns magnets', () => {
    const torrent = result({ fileUrl: 'https://a.example/1.torrent' });
    const mag = result({ fileUrl: magnet(H1) });
    expect(findResolutionCandidates([torrent, mag])).toEqual([torrent]);
  });

  it('skips non-http links (e.g. relative or file URLs)', () => {
    const a = result({ fileUrl: 'file:///tmp/a.torrent' });
    const b = result({ fileUrl: 'https://b.example/1.torrent' });
    expect(findResolutionCandidates([a, b])).toEqual([b]);
  });

  it('does not treat the same fileUrl listed twice as two results', () => {
    const a = result({ fileUrl: 'https://a.example/1.torrent' });
    expect(findResolutionCandidates([a, { ...a }])).toEqual([]);
  });

  it('orders by seeders (desc), keeping input order for ties, and honors the limit', () => {
    const rs = [1, 2, 3, 4].map((n) =>
      result({ fileUrl: `https://i${n}.example/x.torrent`, nbSeeders: n === 4 ? 50 : 7 }),
    );
    expect(findResolutionCandidates(rs).map((r) => r.fileUrl)).toEqual([
      'https://i4.example/x.torrent',
      'https://i1.example/x.torrent',
      'https://i2.example/x.torrent',
      'https://i3.example/x.torrent',
    ]);
    expect(findResolutionCandidates(rs, 2)).toHaveLength(2);
    expect(findResolutionCandidates(rs, 0)).toEqual([]);
  });

  it('is empty for no results', () => {
    expect(findResolutionCandidates([])).toEqual([]);
  });
});

describe('groupSearchResults', () => {
  it('groups magnet results by btih regardless of name, size or spelling', () => {
    const a = result({ fileName: 'Alpha', fileSize: 1, fileUrl: magnet(H1), nbSeeders: 3 });
    const b = result({
      fileName: 'Beta',
      fileSize: 2,
      fileUrl: magnet(hexToBase32(H1)),
      nbSeeders: 8,
    });
    const c = result({ fileName: 'Gamma', fileUrl: magnet(H2) });
    const groups = groupSearchResults([a, b, c]);
    expect(groups).toHaveLength(2);
    expect(groups[0].members).toEqual([b, a]);
    expect(groups[0].hash).toBe(H1);
    expect(groups[0].id).toBe(`h:${H1}`);
    expect(groups[1].members).toEqual([c]);
  });

  it('picks the member with the most seeders as primary and reports max (not sum) seeders', () => {
    const low = result({ fileUrl: magnet(H1, '&dn=low'), nbSeeders: 4 });
    const high = result({ fileUrl: magnet(H1, '&dn=high'), nbSeeders: 40 });
    const [group] = groupSearchResults([low, high]);
    expect(group.primary).toBe(high);
    expect(group.maxSeeders).toBe(40);
    expect(group.sourceCount).toBe(2);
    expect(group.members[0]).toBe(group.primary);
  });

  it('breaks seeder ties by larger size, then name, then URL — independent of input order', () => {
    const big = result({ fileUrl: magnet(H1, '&x=1'), nbSeeders: 5, fileSize: 9, fileName: 'zzz' });
    const small = result({
      fileUrl: magnet(H1, '&x=2'),
      nbSeeders: 5,
      fileSize: 3,
      fileName: 'aaa',
    });
    expect(groupSearchResults([small, big])[0].primary).toBe(big);
    expect(groupSearchResults([big, small])[0].primary).toBe(big);

    const nameA = result({
      fileUrl: magnet(H1, '&x=3'),
      nbSeeders: 5,
      fileSize: 3,
      fileName: 'aaa',
    });
    const nameB = result({
      fileUrl: magnet(H1, '&x=4'),
      nbSeeders: 5,
      fileSize: 3,
      fileName: 'bbb',
    });
    expect(groupSearchResults([nameB, nameA])[0].primary).toBe(nameA);

    const urlA = result({ fileUrl: magnet(H1, '&a'), nbSeeders: 5, fileSize: 3, fileName: 'same' });
    const urlB = result({ fileUrl: magnet(H1, '&b'), nbSeeders: 5, fileSize: 3, fileName: 'same' });
    expect(groupSearchResults([urlB, urlA])[0].primary).toBe(urlA);
  });

  it('treats unknown (-1) seeders as zero', () => {
    const unknown = result({ fileUrl: magnet(H1, '&a'), nbSeeders: -1 });
    const known = result({ fileUrl: magnet(H1, '&b'), nbSeeders: 2 });
    const [group] = groupSearchResults([unknown, known]);
    expect(group.primary).toBe(known);
    const [only] = groupSearchResults([unknown]);
    expect(only.maxSeeders).toBe(0);
  });

  it('groups hash-less results by normalized name and exact size', () => {
    const a = result({
      fileName: 'Some.Movie.2024 [IdxA]',
      fileUrl: 'https://a.example/1.torrent',
      nbSeeders: 2,
    });
    const b = result({
      fileName: 'some movie 2024 [IdxB]',
      fileUrl: 'https://b.example/1.torrent',
      nbSeeders: 6,
    });
    const [group] = groupSearchResults([a, b]);
    expect(group.members).toEqual([b, a]);
    expect(group.hash).toBeUndefined();
    expect(group.id).toBe('n:some movie 2024|1000000');
  });

  it('does not group same-name results of different size', () => {
    const a = result({ fileUrl: 'https://a.example/1.torrent', fileSize: 100 });
    const b = result({ fileUrl: 'https://b.example/1.torrent', fileSize: 101 });
    expect(groupSearchResults([a, b])).toHaveLength(2);
  });

  it('never groups results with unknown sizes by name alone', () => {
    const a = result({ fileUrl: 'https://a.example/1.torrent', fileSize: -1 });
    const b = result({ fileUrl: 'https://b.example/1.torrent', fileSize: -1 });
    const groups = groupSearchResults([a, b]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.id)).toEqual([`u:${a.fileUrl}`, `u:${b.fileUrl}`]);
  });

  it('keeps magnets with different known hashes apart even when name and size match', () => {
    const a = result({ fileUrl: magnet(H1) });
    const b = result({ fileUrl: magnet(H2) });
    expect(groupSearchResults([a, b])).toHaveLength(2);
  });

  it('lets a resolved hash override the name+size guess: differing hashes split', () => {
    const a = result({ fileUrl: 'https://a.example/1.torrent' });
    const b = result({ fileUrl: 'https://b.example/1.torrent' });
    expect(groupSearchResults([a, b])).toHaveLength(1);
    const resolved = new Map<string, ResolvedSource>([
      [a.fileUrl, { hash: H1 }],
      [b.fileUrl, { hash: H2 }],
    ]);
    expect(groupSearchResults([a, b], resolved)).toHaveLength(2);
  });

  it('merges a resolved .torrent into the magnet group sharing its hash, whatever its name', () => {
    const mag = result({ fileName: 'Alpha', fileSize: 1, fileUrl: magnet(H1) });
    const torrent = result({
      fileName: 'Totally Other',
      fileSize: 77,
      fileUrl: 'https://a.example/1.torrent',
    });
    const resolved = new Map<string, ResolvedSource>([
      [torrent.fileUrl, { hash: H1.toUpperCase() }],
    ]);
    const groups = groupSearchResults([mag, torrent], resolved);
    expect(groups).toHaveLength(1);
    expect(groups[0].hash).toBe(H1);
    expect(groups[0].sourceCount).toBe(2);
  });

  it('attaches a hash-less result to the single hash group sharing its name+size key', () => {
    const mag = result({ fileUrl: magnet(H1), nbSeeders: 1 });
    const torrent = result({ fileUrl: 'https://a.example/1.torrent', nbSeeders: 9 });
    const [group] = groupSearchResults([mag, torrent]);
    expect(group.sourceCount).toBe(2);
    expect(group.hash).toBe(H1);
    expect(group.primary).toBe(torrent);
  });

  it('does not guess between two hash groups with the same name+size key', () => {
    const a = result({ fileUrl: magnet(H1) });
    const b = result({ fileUrl: magnet(H2) });
    const torrent = result({ fileUrl: 'https://a.example/1.torrent' });
    const groups = groupSearchResults([a, b, torrent]);
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.members.includes(torrent))?.sourceCount).toBe(1);
  });

  it('puts hash-less leftovers sharing a key in their own group when the hash groups are ambiguous', () => {
    const a = result({ fileUrl: magnet(H1) });
    const b = result({ fileUrl: magnet(H2) });
    const t1 = result({ fileUrl: 'https://a.example/1.torrent' });
    const t2 = result({ fileUrl: 'https://b.example/1.torrent' });
    const groups = groupSearchResults([a, b, t1, t2]);
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.members.includes(t1))?.members).toContain(t2);
  });

  it('leaves results nothing resembles as groups of one', () => {
    const a = result({ fileName: 'One', fileUrl: 'https://a.example/1.torrent' });
    const b = result({ fileName: 'Two', fileUrl: 'https://b.example/2.torrent' });
    const groups = groupSearchResults([a, b]);
    expect(groups.map((g) => g.sourceCount)).toEqual([1, 1]);
    expect(groups[0].primary).toBe(a);
  });

  it('keeps a resolved hash group intact when an unresolved member shares its name+size', () => {
    const a = result({ fileUrl: 'https://a.example/1.torrent', nbSeeders: 3 });
    const b = result({ fileUrl: 'https://b.example/1.torrent', nbSeeders: 1 });
    const resolved = new Map<string, ResolvedSource>([[a.fileUrl, { hash: H1 }]]);
    const groups = groupSearchResults([a, b], resolved);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe(`h:${H1}`);
  });

  it('places each group where its primary sat in the input', () => {
    const solo1 = result({
      fileName: 'Solo One',
      fileUrl: 'https://s1.example/1.torrent',
      nbSeeders: 50,
    });
    const dupLow = result({ fileUrl: magnet(H1, '&a'), nbSeeders: 1 });
    const solo2 = result({
      fileName: 'Solo Two',
      fileUrl: 'https://s2.example/1.torrent',
      nbSeeders: 40,
    });
    const dupHigh = result({ fileUrl: magnet(H1, '&b'), nbSeeders: 30 });
    const groups = groupSearchResults([solo1, dupLow, solo2, dupHigh]);
    // The duplicate group's primary is dupHigh (index 3), so it comes last.
    expect(groups.map((g) => g.primary)).toEqual([solo1, solo2, dupHigh]);
  });

  it('is deterministic: the same input yields the same ids, order and primaries, run after run', () => {
    const input = [
      result({ fileUrl: magnet(H1, '&a'), nbSeeders: 5 }),
      result({ fileName: 'Other', fileUrl: 'https://x.example/o.torrent' }),
      result({ fileUrl: magnet(H1, '&b'), nbSeeders: 5, fileSize: 1_000_000 }),
      result({ fileUrl: 'https://y.example/1.torrent', nbSeeders: 2 }),
    ];
    const first = groupSearchResults(input);
    const second = groupSearchResults([...input]);
    expect(second.map((g) => [g.id, g.primary.fileUrl, g.members.map((m) => m.fileUrl)])).toEqual(
      first.map((g) => [g.id, g.primary.fileUrl, g.members.map((m) => m.fileUrl)]),
    );
  });

  it('ignores a repeated fileUrl and returns no groups for no input', () => {
    const a = result();
    expect(groupSearchResults([a, { ...a }])).toHaveLength(1);
    expect(groupSearchResults([])).toEqual([]);
  });

  it('uses stable ids that do not depend on which member is primary', () => {
    const a = result({ fileUrl: magnet(H1, '&a'), nbSeeders: 1 });
    const b = result({ fileUrl: magnet(H1, '&b'), nbSeeders: 2 });
    const before = groupSearchResults([a]);
    const after = groupSearchResults([a, b]);
    expect(before[0].id).toBe(after[0].id);
  });
});

describe('singletonGroups', () => {
  it('wraps each result as a group of one without regrouping', () => {
    const a = result({ fileUrl: magnet(H1), nbSeeders: 3 });
    const b = result({ fileUrl: magnet(H1, '&b'), nbSeeders: 4 });
    const groups = singletonGroups([a, b]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ primary: a, members: [a], sourceCount: 1, maxSeeders: 3 });
    expect(new Set(groups.map((g) => g.id)).size).toBe(2);
  });
});

describe('mergeMagnets', () => {
  const tr = (url: string) => `&tr=${encodeURIComponent(url)}`;

  it('unions every tracker onto the first magnet, de-duplicated by decoded value', () => {
    const first = magnet(H1, `&dn=First%20Name${tr('udp://t1:80/announce')}`);
    const second = magnet(
      H1,
      `&dn=Second${tr('udp://t2:80/announce')}${tr('udp://t1:80/announce')}`,
    );
    const third = magnet(H1, `&tr=udp://t3:80/announce`);
    const merged = mergeMagnets([first, second, third]);
    expect(merged.startsWith('magnet:?')).toBe(true);
    expect(extractBtih(merged)).toBe(H1);
    const trackers = (merged.match(/(?:^|&|\?)tr=([^&]*)/g) ?? []).map((m) =>
      decodeURIComponent(m.replace(/^[?&]?tr=/, '')),
    );
    expect(trackers).toEqual([
      'udp://t1:80/announce',
      'udp://t2:80/announce',
      'udp://t3:80/announce',
    ]);
  });

  it('keeps the first magnet verbatim (xt, dn, other params and their encoding)', () => {
    const first = magnet(H1, `&dn=First%20Name%20%28x%29&xl=123${tr('udp://t1:80')}`);
    const merged = mergeMagnets([first, magnet(H1, `&dn=Other${tr('udp://t2:80')}`)]);
    expect(merged.startsWith(first)).toBe(true);
    expect(merged).toContain('dn=First%20Name%20%28x%29');
    expect(merged).not.toContain('dn=Other');
    expect(merged).toContain('xl=123');
  });

  it('treats the same tracker spelled with and without percent-encoding as one', () => {
    const merged = mergeMagnets([
      magnet(H1, '&tr=udp%3A%2F%2Ft1%3A80'),
      magnet(H1, '&tr=udp://t1:80'),
    ]);
    expect(merged.match(/tr=/g)).toHaveLength(1);
  });

  it('appends extra tracker URLs, encoded and de-duplicated', () => {
    const merged = mergeMagnets(
      [magnet(H1, tr('udp://t1:80'))],
      [
        'udp://t1:80',
        'https://t2.example/announce?k=a b',
        '  ',
        'https://t2.example/announce?k=a b',
      ],
    );
    expect(merged).toBe(
      `${magnet(H1, tr('udp://t1:80'))}&tr=${encodeURIComponent('https://t2.example/announce?k=a b')}`,
    );
  });

  it('recognizes numbered tracker keys (tr.1) and keeps them', () => {
    const merged = mergeMagnets([magnet(H1, '&tr.1=udp://t1:80'), magnet(H1, '&tr=udp://t1:80')]);
    expect(merged).toBe(magnet(H1, '&tr.1=udp://t1:80'));
  });

  it('returns the lone magnet unchanged', () => {
    const only = magnet(H1, `&dn=x${tr('udp://t1:80')}`);
    expect(mergeMagnets([only])).toBe(only);
  });

  it('ignores non-magnets and magnets for a different torrent', () => {
    const first = magnet(H1, tr('udp://t1:80'));
    const merged = mergeMagnets([
      'https://idx.example/1.torrent',
      first,
      magnet(H2, tr('udp://other:80')),
      magnet(H1, tr('udp://t2:80')),
    ]);
    expect(merged).toContain(encodeURIComponent('udp://t2:80'));
    expect(merged).not.toContain('other');
    expect(merged.startsWith(first)).toBe(true);
  });

  it('returns an empty string when there is no magnet to merge', () => {
    expect(mergeMagnets([])).toBe('');
    expect(mergeMagnets(['https://idx.example/1.torrent'])).toBe('');
  });

  it('merges magnets whose hash cannot be read without dropping their trackers', () => {
    const a = `magnet:?dn=a${tr('udp://t1:80')}`;
    const b = `magnet:?dn=b${tr('udp://t2:80')}`;
    expect(mergeMagnets([a, b])).toBe(`${a}${tr('udp://t2:80')}`);
  });
});

describe('collectGroupTrackers / planGroupAdd', () => {
  const t1 = result({ fileUrl: 'https://a.example/1.torrent', nbSeeders: 9 });
  const t2 = result({ fileUrl: 'https://b.example/1.torrent', nbSeeders: 3 });
  const resolvedBoth = new Map<string, ResolvedSource>([
    [t1.fileUrl, { hash: H1, trackers: ['udp://own:1', 'udp://shared:1'] }],
    [t2.fileUrl, { hash: H1, trackers: ['udp://shared:1', 'udp://extra:1'] }],
  ]);

  it("collects the other members' trackers the primary does not already list", () => {
    const [group] = groupSearchResults([t1, t2], resolvedBoth);
    expect(collectGroupTrackers(group, resolvedBoth)).toEqual({
      torrentId: H1,
      trackers: ['udp://extra:1'],
    });
  });

  it("prefers the resolver's torrentId over the grouping hash", () => {
    const resolved = new Map<string, ResolvedSource>([
      [t1.fileUrl, { hash: H1, torrentId: H3, trackers: [] }],
      [t2.fileUrl, { hash: H1, trackers: ['udp://extra:1'] }],
    ]);
    const [group] = groupSearchResults([t1, t2], resolved);
    expect(collectGroupTrackers(group, resolved)?.torrentId).toBe(H3);
  });

  it('is null for a group of one, when nothing new is known, or when there is no id', () => {
    const [single] = groupSearchResults([t1], resolvedBoth);
    expect(collectGroupTrackers(single, resolvedBoth)).toBeNull();

    const sameTrackers = new Map<string, ResolvedSource>([
      [t1.fileUrl, { hash: H1, trackers: ['udp://a:1'] }],
      [t2.fileUrl, { hash: H1, trackers: ['udp://a:1'] }],
    ]);
    const [dup] = groupSearchResults([t1, t2], sameTrackers);
    expect(collectGroupTrackers(dup, sameTrackers)).toBeNull();

    const [unresolved] = groupSearchResults([t1, t2]);
    expect(collectGroupTrackers(unresolved, new Map())).toBeNull();
  });

  it('plans a lone result as itself', () => {
    const [single] = groupSearchResults([t1]);
    expect(planGroupAdd(single)).toEqual({ result: t1, trackerFollowUp: null });
  });

  it('plans a .torrent-only group as the primary plus a tracker follow-up', () => {
    const [group] = groupSearchResults([t1, t2], resolvedBoth);
    const plan = planGroupAdd(group, resolvedBoth);
    expect(plan.result).toBe(t1);
    expect(plan.trackerFollowUp).toEqual({ torrentId: H1, trackers: ['udp://extra:1'] });
  });

  it("plans a group with magnets as one merged magnet (no follow-up), keeping the primary's identity", () => {
    const m1 = result({
      fileUrl: magnet(H1, '&tr=udp%3A%2F%2Fm1%3A1'),
      nbSeeders: 2,
      engineName: 'plugA',
    });
    const m2 = result({ fileUrl: magnet(H1, '&tr=udp%3A%2F%2Fm2%3A1'), nbSeeders: 1 });
    const [group] = groupSearchResults([m1, m2]);
    const plan = planGroupAdd(group);
    expect(plan.trackerFollowUp).toBeNull();
    expect(plan.result.fileUrl).toContain('udp%3A%2F%2Fm1%3A1');
    expect(plan.result.fileUrl).toContain('udp%3A%2F%2Fm2%3A1');
    expect(plan.result.engineName).toBe('plugA');
  });

  it('adds trackers read from a confirmed .torrent member to the merged magnet, but not an unconfirmed one', () => {
    const mag = result({ fileUrl: magnet(H1, '&tr=udp%3A%2F%2Fm1%3A1'), nbSeeders: 2 });
    const confirmed = result({ fileUrl: 'https://a.example/1.torrent', nbSeeders: 1 });
    const guessed = result({ fileUrl: 'https://b.example/1.torrent', nbSeeders: 1 });
    const resolved = new Map<string, ResolvedSource>([
      [confirmed.fileUrl, { hash: H1, trackers: ['udp://from-torrent:1'] }],
      // A stale/mismatching entry must not leak trackers of a different torrent.
      [guessed.fileUrl, { hash: H2, trackers: ['udp://other-torrent:1'] }],
    ]);
    const [group] = groupSearchResults([mag, confirmed, guessed], resolved);
    expect(group.sourceCount).toBe(2);
    const plan = planGroupAdd(group, resolved);
    expect(plan.result.fileUrl).toContain(encodeURIComponent('udp://from-torrent:1'));
    expect(plan.result.fileUrl).not.toContain('other-torrent');
  });
});
