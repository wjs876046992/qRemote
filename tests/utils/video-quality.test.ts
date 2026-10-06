import {
  UNKNOWN_QUALITY_RANK,
  compareByQuality,
  getVideoQualityLabel,
  getVideoQualityRank,
} from '@/utils/video-quality';

describe('getVideoQualityRank', () => {
  describe('2160p / 4K / UHD → 4', () => {
    it.each([
      'Movie.2023.2160p.UHD.BluRay.x265-GRP',
      'Show S01E01 [2160p]',
      'Movie (4K)',
      'Movie 4K HDR Remux',
      'Movie.2019.UHD.BluRay.REMUX',
      'Movie.2021.UHD.WEB-DL.DDP5.1.HDR',
      'Movie.2160p60.WEB',
      'Movie 3840x2160',
      'Movie Ultra HD Edition',
      'Movie.ULTRA.HD.2020',
    ])('%s', (name) => {
      expect(getVideoQualityRank(name)).toBe(4);
    });
  });

  describe('1440p → 3.5', () => {
    it.each(['Game.Trailer.1440p', 'Clip [1440p60]', 'Clip 2560x1440'])('%s', (name) => {
      expect(getVideoQualityRank(name)).toBe(3.5);
    });
  });

  describe('1080p / 1080i / FHD → 3', () => {
    it.each([
      'Movie.2023.1080p.BluRay.x264-GRP',
      'Movie 2020 1080P WEB-DL',
      'Show.S02E05.1080i.HDTV.MPEG2',
      'Movie.1080p60.WEB',
      'Movie (FHD)',
      'Movie.FullHD.2018',
      'Movie Full HD 2018',
      'Movie 1920x1080 x264',
      'Movie_2022_1080p_x265_10bit',
      'Movie x265 10bit 1080p',
      '[Group] Anime - 01 [1080p][HEVC]',
    ])('%s', (name) => {
      expect(getVideoQualityRank(name)).toBe(3);
    });
  });

  describe('720p → 2', () => {
    it.each([
      'Movie.2023.720p.BluRay.x264-GRP',
      'Show.S01E01.720p.HDTV.x264',
      'Movie 720p50',
      'Movie 1280x720',
      'Movie (720P)',
    ])('%s', (name) => {
      expect(getVideoQualityRank(name)).toBe(2);
    });
  });

  describe('SD → 1', () => {
    it.each([
      'Movie.2005.480p.DVDRip.XviD',
      'Movie.576p.PAL',
      'Show.S01E01.576i',
      'Clip 360p',
      'Anime 540p',
      'Movie.1999.DVDRip.XviD-GRP',
      'Movie.DVD9.Full.Disc',
      'Show.S01.SDTV.x264',
      'Movie 720x480',
      'Movie [SD]',
      'Movie (SD)',
    ])('%s', (name) => {
      expect(getVideoQualityRank(name)).toBe(1);
    });
  });

  describe('unknown → 0', () => {
    it.each([
      '',
      'Some Album - Greatest Hits (FLAC)',
      'Artist - Discography 1990-2020 [MP3 320kbps]',
      'The Great Novel (epub)',
      'Ubuntu 24.04 desktop amd64.iso',
      'Movie.2023.BluRay.x264-GRP',
      'Movie.2023.HDRip.XviD',
      'Movie HD',
    ])('%j', (name) => {
      expect(getVideoQualityRank(name)).toBe(UNKNOWN_QUALITY_RANK);
    });

    it('tolerates a missing name from a misbehaving plugin', () => {
      expect(getVideoQualityRank(undefined as unknown as string)).toBe(0);
      expect(getVideoQualityRank(null as unknown as string)).toBe(0);
    });
  });

  describe('word boundaries and false positives', () => {
    it('does not read x264 / x265 / h264 / h.265 as a resolution', () => {
      expect(getVideoQualityRank('Movie.x264-GRP')).toBe(0);
      expect(getVideoQualityRank('Movie.x265-GRP')).toBe(0);
      expect(getVideoQualityRank('Movie.h264.AAC')).toBe(0);
      expect(getVideoQualityRank('Movie H.264 AAC')).toBe(0);
      expect(getVideoQualityRank('Movie.H.265.HEVC')).toBe(0);
    });

    it('ignores bare numbers and years without the p/i suffix', () => {
      expect(getVideoQualityRank('Movie 1080')).toBe(0);
      expect(getVideoQualityRank('Movie 2160')).toBe(0);
      expect(getVideoQualityRank('Movie 720')).toBe(0);
      expect(getVideoQualityRank('Movie.2020.BluRay')).toBe(0);
      expect(getVideoQualityRank('1080 Everest 2160 Days')).toBe(0);
    });

    it('does not match 4k / uhd inside another word', () => {
      expect(getVideoQualityRank('Break4kids')).toBe(0);
      expect(getVideoQualityRank('Tuhdor.Collection')).toBe(0);
      expect(getVideoQualityRank('uhdtv-ish')).toBe(0);
      expect(getVideoQualityRank('Movie44k')).toBe(0);
    });

    it('does not match a resolution glued into a longer token', () => {
      expect(getVideoQualityRank('Movie.a1080p')).toBe(0);
      expect(getVideoQualityRank('Movie.1080pp')).toBe(0);
      expect(getVideoQualityRank('Movie.21080p')).toBe(0);
    });

    it('ignores heights that are not a standard video resolution', () => {
      expect(getVideoQualityRank('Movie.999p')).toBe(0);
      expect(getVideoQualityRank('Movie 1920x1081')).toBe(0);
    });

    it('treats "2K" as ambiguous and does not rank it', () => {
      expect(getVideoQualityRank('Movie 2K Remaster')).toBe(0);
    });

    it('only honors a bare "sd" when it is bracketed', () => {
      expect(getVideoQualityRank('SD Gundam Collection')).toBe(0);
      expect(getVideoQualityRank('Movie [sd]')).toBe(1);
    });

    it('requires "ultra"/"full" to be directly followed by "hd"', () => {
      expect(getVideoQualityRank('Ultra Violence Full Moon HD')).toBe(0);
    });
  });

  describe('separators', () => {
    it.each([
      ['Movie.2023.1080p.BluRay', 3],
      ['Movie_2023_1080p_BluRay', 3],
      ['Movie-2023-1080p-BluRay', 3],
      ['Movie 2023 1080p BluRay', 3],
      ['[1080p]Movie', 3],
      ['Movie[1080p]', 3],
      ['Movie(1080p)', 3],
      ['Movie{1080p}', 3],
      ['1080p', 3],
    ])('%s → %s', (name, rank) => {
      expect(getVideoQualityRank(name)).toBe(rank);
    });
  });

  describe('multiple markers', () => {
    it('picks the highest', () => {
      expect(getVideoQualityRank('Movie 720p to 1080p upscale')).toBe(3);
      expect(getVideoQualityRank('Movie.1080p.and.2160p.Pack')).toBe(4);
      expect(getVideoQualityRank('Pack [480p / 720p / 1080p]')).toBe(3);
      expect(getVideoQualityRank('Movie 4K UHD 2160p')).toBe(4);
    });
  });

  it('is consistent when the same name is ranked repeatedly (memoized)', () => {
    expect(getVideoQualityRank('Cached.Movie.1080p')).toBe(3);
    expect(getVideoQualityRank('Cached.Movie.1080p')).toBe(3);
  });

  it('keeps ranking correctly after the memo cache overflows', () => {
    for (let i = 0; i < 5200; i++) getVideoQualityRank(`Overflow.${i}.720p`);
    expect(getVideoQualityRank('Overflow.0.720p')).toBe(2);
    expect(getVideoQualityRank('Overflow.final.2160p')).toBe(4);
  });
});

describe('getVideoQualityLabel', () => {
  it.each([
    [4, '2160p'],
    [3.5, '1440p'],
    [3, '1080p'],
    [2, '720p'],
    [1, 'SD'],
  ])('rank %s → %s', (rank, label) => {
    expect(getVideoQualityLabel(rank)).toBe(label);
  });

  it('returns null for unknown quality', () => {
    expect(getVideoQualityLabel(0)).toBeNull();
    expect(getVideoQualityLabel(-1)).toBeNull();
  });

  it('round-trips with getVideoQualityRank', () => {
    expect(getVideoQualityLabel(getVideoQualityRank('Movie.2160p'))).toBe('2160p');
    expect(getVideoQualityLabel(getVideoQualityRank('Movie.1080p'))).toBe('1080p');
    expect(getVideoQualityLabel(getVideoQualityRank('Movie.720p'))).toBe('720p');
    expect(getVideoQualityLabel(getVideoQualityRank('Movie.480p'))).toBe('SD');
    expect(getVideoQualityLabel(getVideoQualityRank('Album FLAC'))).toBeNull();
  });
});

describe('compareByQuality', () => {
  const r = (fileName: string, nbSeeders?: number) => ({ fileName, nbSeeders });
  const sortNames = (items: ReturnType<typeof r>[], dir: 'asc' | 'desc') =>
    [...items].sort((a, b) => compareByQuality(a, b, dir)).map((x) => x.fileName);

  const uhd = r('A.2160p', 5);
  const fhd = r('B.1080p', 5);
  const hd = r('C.720p', 5);
  const sd = r('D.480p', 5);
  const unknown = r('E.Album.FLAC', 500);

  it('desc puts the best quality first', () => {
    expect(sortNames([hd, uhd, sd, fhd], 'desc')).toEqual([
      'A.2160p',
      'B.1080p',
      'C.720p',
      'D.480p',
    ]);
  });

  it('asc puts the worst quality first', () => {
    expect(sortNames([hd, uhd, sd, fhd], 'asc')).toEqual([
      'D.480p',
      'C.720p',
      'B.1080p',
      'A.2160p',
    ]);
  });

  it('keeps unknown-quality results last in desc, however many seeders they have', () => {
    expect(sortNames([unknown, sd, uhd], 'desc')).toEqual(['A.2160p', 'D.480p', 'E.Album.FLAC']);
  });

  it('keeps unknown-quality results last in asc too', () => {
    expect(sortNames([unknown, uhd, sd], 'asc')).toEqual(['D.480p', 'A.2160p', 'E.Album.FLAC']);
  });

  it('breaks quality ties by seeders, most first, in both directions', () => {
    const lo = r('X.1080p', 3);
    const hi = r('Y.1080p', 90);
    const mid = r('Z.1080p', 40);
    expect(sortNames([lo, hi, mid], 'desc')).toEqual(['Y.1080p', 'Z.1080p', 'X.1080p']);
    expect(sortNames([lo, hi, mid], 'asc')).toEqual(['Y.1080p', 'Z.1080p', 'X.1080p']);
  });

  it('breaks ties among unknown-quality results by seeders too', () => {
    const a = r('Album One', 2);
    const b = r('Album Two', 80);
    expect(sortNames([a, b], 'desc')).toEqual(['Album Two', 'Album One']);
    expect(sortNames([a, b], 'asc')).toEqual(['Album Two', 'Album One']);
  });

  it('treats -1 and missing seeders as 0 in the tiebreak', () => {
    const unknownSeeders = r('U.1080p', -1);
    const missing = r('M.1080p', undefined);
    const one = r('O.1080p', 1);
    expect(sortNames([unknownSeeders, missing, one], 'desc')[0]).toBe('O.1080p');
    // -1 and undefined both count as 0, so they compare equal.
    expect(compareByQuality(unknownSeeders, missing, 'desc')).toBe(0);
  });

  it('returns 0 for identical quality and seeders', () => {
    expect(compareByQuality(r('A.1080p', 7), r('B.1080p', 7), 'desc')).toBe(0);
  });

  it('is antisymmetric across the unknown boundary', () => {
    expect(compareByQuality(unknown, hd, 'desc')).toBeGreaterThan(0);
    expect(compareByQuality(hd, unknown, 'desc')).toBeLessThan(0);
    expect(compareByQuality(unknown, hd, 'asc')).toBeGreaterThan(0);
    expect(compareByQuality(hd, unknown, 'asc')).toBeLessThan(0);
  });

  it('ranks 1440p between 1080p and 2160p', () => {
    const qhd = r('Q.1440p', 5);
    expect(sortNames([fhd, uhd, qhd], 'desc')).toEqual(['A.2160p', 'Q.1440p', 'B.1080p']);
  });
});
