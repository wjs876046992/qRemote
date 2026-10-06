/**
 * qui Client Proxy (#272) — the apiClient must route requests through
 * `<basePath>/proxy/<key>`, send no Bearer header, map qui's 401 to a clear
 * message, and never let the key reach the connectivity log or a thrown error.
 */

jest.mock('@/services/connectivity-log', () => ({
  clogDebug: jest.fn(),
  clogInfo: jest.fn(),
  clogWarn: jest.fn(),
  clogError: jest.fn(),
}));

type RequestInterceptorFn = (config: Record<string, unknown>) => Record<string, unknown>;
type ResponseInterceptorErrorFn = (error: unknown) => unknown;

let capturedRequestInterceptor: RequestInterceptorFn | null = null;
let capturedResponseInterceptorError: ResponseInterceptorErrorFn | null = null;

const mockAxiosInstance = {
  interceptors: {
    request: {
      use: jest.fn((fn: RequestInterceptorFn) => {
        capturedRequestInterceptor = fn;
      }),
    },
    response: {
      use: jest.fn((_success: unknown, error: ResponseInterceptorErrorFn) => {
        capturedResponseInterceptorError = error;
      }),
    },
  },
  defaults: { timeout: 10000 },
  post: jest.fn(),
  get: jest.fn(),
};

class MockAxiosError extends Error {
  code?: string;
  config?: Record<string, unknown>;
  response?: { status?: number; data?: unknown; headers?: Record<string, unknown> };
  isAxiosError = true;
}

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => mockAxiosInstance),
  },
  AxiosHeaders: class {},
  AxiosError: MockAxiosError,
}));

jest.mock('@/utils/apiVersion', () => ({
  getApiFeatures: jest.fn(() => ({})),
}));

import { apiClient } from '@/services/api/client';
import { clogDebug, clogError, clogInfo, clogWarn } from '@/services/connectivity-log';
import { QUI_KEY_REJECTED_MESSAGE } from '@/utils/quiProxy';
import type { ServerConfig } from '@/types/api';

const KEY = 'sup3rS3cretKey0123456789abcdef';

function makeQuiServer(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: 'qui-server',
    name: 'qui',
    host: 'qui.example.com',
    port: 7476,
    username: '',
    password: '',
    useHttps: true,
    useQuiProxy: true,
    quiProxyKey: KEY,
    basePath: '/',
    ...overrides,
  };
}

function runRequestInterceptor(server: ServerConfig, url = '/api/v2/app/version') {
  apiClient.setServer(server);
  if (!capturedRequestInterceptor) throw new Error('Request interceptor not captured');
  const config = { headers: {} as Record<string, string>, method: 'get', url };
  return capturedRequestInterceptor(config) as {
    baseURL: string;
    url: string;
    headers: Record<string, string>;
  };
}

function loggedText(): string {
  return [clogDebug, clogInfo, clogWarn, clogError]
    .flatMap((fn) => (fn as jest.Mock).mock.calls)
    .map((call: unknown[]) => String(call[1]))
    .join('\n');
}

function errorFor(config: Record<string, unknown>, status: number, data?: unknown) {
  const err = new MockAxiosError('request failed');
  err.config = config;
  err.response = { status, data };
  return err;
}

function thrownBy(fn: () => unknown): Error & { status?: number } {
  try {
    fn();
  } catch (error) {
    return error as Error & { status?: number };
  }
  throw new Error('expected the interceptor to throw');
}

describe('apiClient — qui proxy mode (#272)', () => {
  afterEach(() => {
    apiClient.setServer(null);
    jest.clearAllMocks();
  });

  describe('request interceptor', () => {
    it('puts /proxy/<key> in the baseURL', () => {
      const config = runRequestInterceptor(makeQuiServer());
      expect(config.baseURL).toBe(`https://qui.example.com:7476/proxy/${KEY}`);
    });

    it('keeps the qui base path in front of /proxy/<key>', () => {
      const config = runRequestInterceptor(makeQuiServer({ basePath: '/qui' }));
      expect(config.baseURL).toBe(`https://qui.example.com:7476/qui/proxy/${KEY}`);
    });

    it('works without a port', () => {
      const config = runRequestInterceptor(makeQuiServer({ port: undefined, useHttps: false }));
      expect(config.baseURL).toBe(`http://qui.example.com/proxy/${KEY}`);
    });

    it('does not touch the baseURL of an ordinary server whose base path contains "proxy"', () => {
      const config = runRequestInterceptor(
        makeQuiServer({ useQuiProxy: false, quiProxyKey: '', basePath: '/proxy/qbt' }),
      );
      expect(config.baseURL).toBe('https://qui.example.com:7476/proxy/qbt');
    });

    it('ignores a leftover key when the server is not in qui mode', () => {
      const config = runRequestInterceptor(makeQuiServer({ useQuiProxy: false }));
      expect(config.baseURL).toBe('https://qui.example.com:7476');
    });

    it('sends no Bearer header, even if a stale API key is also set', () => {
      const config = runRequestInterceptor(makeQuiServer({ useApiKey: true, apiKey: 'qbt_stale' }));
      expect(config.headers['Authorization']).toBeUndefined();
    });

    it('still applies proxy Basic Auth for a gateway in front of qui', () => {
      const config = runRequestInterceptor(
        makeQuiServer({
          useBasicAuth: true,
          basicAuthUsername: 'gate',
          basicAuthPassword: 'pass',
        }),
      );
      expect(config.headers['Authorization']).toMatch(/^Basic /);
    });

    it('still applies custom headers', () => {
      const config = runRequestInterceptor(
        makeQuiServer({
          useCustomHeaders: true,
          customHeaders: [{ key: 'X-Tunnel-Token', value: 'tok' }],
        }),
      );
      expect(config.headers['X-Tunnel-Token']).toBe('tok');
    });

    it('does not log the key in the request debug line', () => {
      runRequestInterceptor(makeQuiServer({ basePath: '/qui' }));
      expect(clogDebug).toHaveBeenCalledWith(
        'HTTP',
        'GET https://qui.example.com:7476/qui/proxy/••••/api/v2/app/version',
      );
      expect(loggedText()).not.toContain(KEY);
    });

    it("logs ordinary servers' URLs verbatim, even when the path contains /proxy/", () => {
      runRequestInterceptor(
        makeQuiServer({ useQuiProxy: false, quiProxyKey: '', basePath: '/proxy/qbt' }),
      );
      expect(clogDebug).toHaveBeenCalledWith(
        'HTTP',
        'GET https://qui.example.com:7476/proxy/qbt/api/v2/app/version',
      );
    });
  });

  describe('response interceptor', () => {
    function failingRequest(status: number, data?: unknown) {
      const config = runRequestInterceptor(makeQuiServer({ basePath: '/qui' }));
      jest.clearAllMocks(); // only inspect logs produced by the failure itself
      return errorFor(config as unknown as Record<string, unknown>, status, data);
    }

    it('maps qui\'s 401 "Invalid API key" to a clear message', () => {
      const err = failingRequest(401, 'Invalid API key\n');
      const thrown = thrownBy(() => capturedResponseInterceptorError!(err));
      expect(thrown.message).toBe(QUI_KEY_REJECTED_MESSAGE);
      expect(thrown.status).toBe(401);
    });

    it('maps qui\'s 401 "Missing API key" the same way', () => {
      const err = failingRequest(401, 'Missing API key');
      const thrown = thrownBy(() => capturedResponseInterceptorError!(err));
      expect(thrown.message).toBe(QUI_KEY_REJECTED_MESSAGE);
    });

    it('does not map an unrelated 401 body', () => {
      const err = failingRequest(401, 'Unauthorized');
      const thrown = thrownBy(() => capturedResponseInterceptorError!(err));
      expect(thrown.message).toBe('Unauthorized');
    });

    it('does not claim a key rejection for a non-qui server', () => {
      apiClient.setServer(makeQuiServer({ useQuiProxy: false }));
      const config = capturedRequestInterceptor!({ headers: {}, method: 'get', url: '/x' });
      const err = errorFor(config, 401, 'Invalid API key');
      const thrown = thrownBy(() => capturedResponseInterceptorError!(err));
      expect(thrown.message).toBe('Invalid API key');
    });

    it('redacts the key from the 404 message and log', () => {
      const err = failingRequest(404);
      const thrown = thrownBy(() => capturedResponseInterceptorError!(err));
      expect(thrown.message).toContain('Endpoint not found');
      expect(thrown.message).toContain('/qui/proxy/••••/api/v2/app/version');
      expect(thrown.message).not.toContain(KEY);
      expect(loggedText()).not.toContain(KEY);
    });

    it('redacts the key from generic error logs and messages', () => {
      const err = failingRequest(500, `upstream failed for /proxy/${KEY}/api/v2/x`);
      const thrown = thrownBy(() => capturedResponseInterceptorError!(err));
      expect(thrown.message).not.toContain(KEY);
      expect(thrown.message).toContain('/proxy/••••/');
      expect(loggedText()).not.toContain(KEY);
    });

    it('redacts the key from network-error logs', () => {
      const config = runRequestInterceptor(makeQuiServer());
      jest.clearAllMocks();
      const err = errorFor(config as unknown as Record<string, unknown>, 0);
      err.response = undefined;
      err.code = 'ERR_NETWORK';
      const thrown = thrownBy(() => capturedResponseInterceptorError!(err));
      expect(thrown.message).toBe('Connection timeout. Please check your server connection.');
      expect(loggedText()).not.toContain(KEY);
      expect(loggedText()).toContain('/proxy/••••/');
    });

    it('still redacts a late failure from a qui server after switching to another server', () => {
      const config = runRequestInterceptor(makeQuiServer());
      // The app has since moved on to an ordinary server.
      apiClient.setServer(makeQuiServer({ id: 'other', useQuiProxy: false, quiProxyKey: '' }));
      jest.clearAllMocks();
      const err = errorFor(config as unknown as Record<string, unknown>, 404);
      const thrown = thrownBy(() => capturedResponseInterceptorError!(err));
      expect(thrown.message).not.toContain(KEY);
      expect(loggedText()).not.toContain(KEY);
    });

    it("leaves an ordinary server's 404 URL untouched, even with /proxy/ in its path", () => {
      apiClient.setServer(
        makeQuiServer({ id: 'plain', useQuiProxy: false, quiProxyKey: '', basePath: '/proxy/qbt' }),
      );
      const config = capturedRequestInterceptor!({ headers: {}, method: 'get', url: '/api/v2/x' });
      const err = errorFor(config, 404);
      const thrown = thrownBy(() => capturedResponseInterceptorError!(err));
      expect(thrown.message).toContain('/proxy/qbt/api/v2/x');
    });
  });
});
