import { getServerAuthMode, applyServerAuthMode } from '@/utils/authMode';

describe('getServerAuthMode', () => {
  it('returns "password" when neither useApiKey nor bypassAuth is set', () => {
    expect(getServerAuthMode({})).toBe('password');
  });

  it('returns "password" for a legacy record with bypassAuth explicitly false', () => {
    expect(getServerAuthMode({ bypassAuth: false })).toBe('password');
  });

  it('returns "none" when bypassAuth is true', () => {
    expect(getServerAuthMode({ bypassAuth: true })).toBe('none');
  });

  it('returns "apiKey" when useApiKey is true', () => {
    expect(getServerAuthMode({ useApiKey: true })).toBe('apiKey');
  });

  it('prefers "apiKey" when both useApiKey and bypassAuth are true (hand-edited/imported record)', () => {
    expect(getServerAuthMode({ useApiKey: true, bypassAuth: true })).toBe('apiKey');
  });

  it('returns "quiProxy" when useQuiProxy is true', () => {
    expect(getServerAuthMode({ useQuiProxy: true })).toBe('quiProxy');
  });

  it('prefers "quiProxy" over every other flag (precedence: quiProxy > apiKey > none > password)', () => {
    expect(getServerAuthMode({ useQuiProxy: true, useApiKey: true, bypassAuth: true })).toBe(
      'quiProxy',
    );
    expect(getServerAuthMode({ useQuiProxy: false, useApiKey: true, bypassAuth: true })).toBe(
      'apiKey',
    );
  });
});

describe('applyServerAuthMode', () => {
  const creds = {
    username: '  admin  ',
    password: '  hunter2  ',
    apiKey: '  qbt_abc  ',
    quiProxyKey: '  quikey123  ',
  };

  it('password mode: keeps trimmed username/password, blanks apiKey, bypassAuth false', () => {
    const result = applyServerAuthMode('password', creds);
    expect(result).toEqual({
      username: 'admin',
      password: 'hunter2',
      bypassAuth: false,
      useApiKey: false,
      apiKey: '',
      useQuiProxy: false,
      quiProxyKey: '',
    });
  });

  it('apiKey mode: blanks username/password, keeps trimmed apiKey, useApiKey true', () => {
    const result = applyServerAuthMode('apiKey', creds);
    expect(result).toEqual({
      username: '',
      password: '',
      bypassAuth: false,
      useApiKey: true,
      apiKey: 'qbt_abc',
      useQuiProxy: false,
      quiProxyKey: '',
    });
  });

  it('none mode: blanks everything, bypassAuth true', () => {
    const result = applyServerAuthMode('none', creds);
    expect(result).toEqual({
      username: '',
      password: '',
      bypassAuth: true,
      useApiKey: false,
      apiKey: '',
      useQuiProxy: false,
      quiProxyKey: '',
    });
  });

  it('quiProxy mode: blanks username/password/apiKey, keeps the trimmed key, useQuiProxy true', () => {
    const result = applyServerAuthMode('quiProxy', creds);
    expect(result).toEqual({
      username: '',
      password: '',
      bypassAuth: false,
      useApiKey: false,
      apiKey: '',
      useQuiProxy: true,
      quiProxyKey: 'quikey123',
    });
  });

  it('never carries a stale qui key into another mode', () => {
    for (const mode of ['password', 'apiKey', 'none'] as const) {
      const result = applyServerAuthMode(mode, creds);
      expect(result.quiProxyKey).toBe('');
      expect(result.useQuiProxy).toBe(false);
    }
  });
});
