import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module keeps its state (loaded or not, how many reports): each test gets a fresh copy of it
const sentry = { init: vi.fn(), captureException: vi.fn() };
let reporting;

async function load({ sentryModule = sentry } = {}) {
  vi.resetModules();
  vi.doMock('@sentry/react', () => {
    if (sentryModule === 'fails') throw new Error('blocked');
    return sentryModule;
  });
  reporting = await import('./errorReporting');
}

const DSN = 'https://public@example.ingest.sentry.io/1';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('cleanUrl', () => {
  beforeEach(() => load());

  it('keeps the origin and the path, and drops the query and the hash', () => {
    expect(reporting.cleanUrl('https://app.example.com/reset-password?code=secret#access_token=abc'))
      .toBe('https://app.example.com/reset-password');
  });

  it('drops the secrets of a plain path too', () => {
    expect(reporting.cleanUrl('/post/12?token=secret#frag')).toBe('/post/12');
  });

  it('keeps the port of the address', () => {
    expect(reporting.cleanUrl('http://localhost:5173/search?q=ann')).toBe('http://localhost:5173/search');
  });

  it('leaves a value that is not text alone', () => {
    expect(reporting.cleanUrl(undefined)).toBeUndefined();
    expect(reporting.cleanUrl(null)).toBeNull();
  });
});

describe('cleanEvent', () => {
  beforeEach(() => load());

  const dirty = () => ({
    message: 'boom',
    user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' },
    request: {
      url: 'https://app.example.com/reset-password?code=secret#access_token=abc',
      query_string: 'code=secret',
      cookies: { session: 'abc' },
      data: { password: 'hunter2' },
      headers: { Referer: 'https://app.example.com/?code=secret', Cookie: 'a=b', 'User-Agent': 'Edge' },
    },
  });

  it('removes the user, the cookies, the request data and the secrets of the address', () => {
    const event = reporting.cleanEvent(dirty());

    expect(event.user).toBeUndefined();
    expect(event.request.url).toBe('https://app.example.com/reset-password');
    expect(event.request.query_string).toBeUndefined();
    expect(event.request.cookies).toBeUndefined();
    expect(event.request.data).toBeUndefined();
    expect(event.request.headers.Referer).toBeUndefined();
    expect(event.request.headers.Cookie).toBeUndefined();
    expect(JSON.stringify(event)).not.toMatch(/secret|hunter2|a@b\.c|access_token/);
  });

  it('keeps what helps to find the bug', () => {
    const event = reporting.cleanEvent(dirty());

    expect(event.message).toBe('boom');
    expect(event.request.headers['User-Agent']).toBe('Edge');
  });

  it('works for an event that has no request, and for a request with no headers', () => {
    expect(reporting.cleanEvent({ message: 'x' })).toEqual({ message: 'x' });
    expect(reporting.cleanEvent({ request: { url: '/a?b=1' } })).toEqual({ request: { url: '/a' } });
  });
});

describe('cleanBreadcrumb', () => {
  beforeEach(() => load());

  it('keeps the moves between pages, without the secrets of the addresses', () => {
    const crumb = reporting.cleanBreadcrumb({
      category: 'navigation',
      data: { from: '/login?next=%2Fa', to: '/reset-password#access_token=abc' },
    });

    expect(crumb.data).toEqual({ from: '/login', to: '/reset-password' });
  });

  it.each(['console', 'fetch', 'xhr', 'ui.click', 'ui.input'])('drops a %s breadcrumb', (category) => {
    expect(reporting.cleanBreadcrumb({ category, message: 'private text', data: { url: '/rest?x=1' } })).toBeNull();
  });
});

describe('initErrorReporting', () => {
  it('does nothing without an address: Sentry is not even loaded', async () => {
    await load();

    await reporting.initErrorReporting('');
    await reporting.initErrorReporting(undefined);

    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('is off when the environment has no address', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    await load();

    await reporting.initErrorReporting();

    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('starts Sentry with the address of the environment', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', DSN);
    await load();

    await reporting.initErrorReporting();

    expect(sentry.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: DSN }));
  });

  it('starts Sentry with the private settings: no personal data, cleaned events and breadcrumbs, no tracing or replay', async () => {
    await load();

    await reporting.initErrorReporting(DSN);

    const options = sentry.init.mock.calls[0][0];
    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend).toBe(reporting.cleanEvent);
    expect(options.beforeBreadcrumb).toBe(reporting.cleanBreadcrumb);
    expect(options.maxBreadcrumbs).toBeLessThanOrEqual(20);
    expect(options.environment).toBe(import.meta.env.MODE);
    expect(options.tracesSampleRate).toBeUndefined();
    expect(options.replaysSessionSampleRate).toBeUndefined();
    expect(options.replaysOnErrorSampleRate).toBeUndefined();
    expect(options.integrations).toBeUndefined();
  });

  it('ignores the noise of a user who is offline', async () => {
    await load();
    await reporting.initErrorReporting(DSN);

    const { ignoreErrors } = sentry.init.mock.calls[0][0];
    const ignored = (message) => ignoreErrors.some((rule) => (rule instanceof RegExp ? rule.test(message) : rule === message));

    expect(ignored('TypeError: Failed to fetch')).toBe(true);
    expect(ignored('Load failed')).toBe(true);
    expect(ignored('NetworkError when attempting to fetch resource.')).toBe(true);
    expect(ignored('ResizeObserver loop completed with undelivered notifications')).toBe(true);
    expect(ignored('Cannot read properties of undefined')).toBe(false);
  });

  it('starts only once', async () => {
    await load();

    await reporting.initErrorReporting(DSN);
    await reporting.initErrorReporting(DSN);

    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it('keeps the app working when Sentry cannot be loaded', async () => {
    await load({ sentryModule: 'fails' });

    await expect(reporting.initErrorReporting(DSN)).resolves.toBeUndefined();
    expect(() => reporting.reportError(new Error('x'))).not.toThrow();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('keeps the app working when Sentry cannot start', async () => {
    await load();
    sentry.init.mockImplementationOnce(() => { throw new Error('bad address'); });

    await expect(reporting.initErrorReporting(DSN)).resolves.toBeUndefined();
    reporting.reportError(new Error('x'));

    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});

describe('reportError', () => {
  beforeEach(() => load());

  it('sends nothing when reporting is off', () => {
    reporting.reportError(new Error('boom'), 'interface');

    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('sends the error, and tells where it happened', async () => {
    await reporting.initErrorReporting(DSN);
    const error = new Error('boom');

    reporting.reportError(error, 'interface');

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const [sent, options] = sentry.captureException.mock.calls[0];
    expect(sent).toBe(error);
    expect(options.tags).toEqual({ where: 'interface' });
  });

  it('turns an error of the database (a plain object) into a readable error with its code', async () => {
    await reporting.initErrorReporting(DSN);

    reporting.reportError({ message: 'permission denied', code: '42501', details: 'Key (username)=(ann) exists' }, 'Search failed');

    const [sent, options] = sentry.captureException.mock.calls[0];
    expect(sent).toBeInstanceOf(Error);
    expect(sent.message).toBe('Search failed: permission denied');
    expect(options.extra.code).toBe('42501');
    // The details of a row can hold what people wrote: they stay out
    expect(JSON.stringify(sentry.captureException.mock.calls[0])).not.toContain('ann');
  });

  it('copes with an error that is only text', async () => {
    await reporting.initErrorReporting(DSN);

    reporting.reportError('just words', 'odd');

    expect(sentry.captureException.mock.calls[0][0].message).toBe('odd: just words');
  });

  it('adds the extra information it is given', async () => {
    await reporting.initErrorReporting(DSN);

    reporting.reportError(new Error('boom'), 'interface', { componentStack: '\n at Bomb' });

    expect(sentry.captureException.mock.calls[0][1].extra.componentStack).toBe('\n at Bomb');
  });

  it('has a label when none is given', async () => {
    await reporting.initErrorReporting(DSN);

    reporting.reportError(new Error('boom'));

    expect(sentry.captureException.mock.calls[0][1].tags.where).toBe('unexpected');
  });

  it('sends the reports that were made while Sentry was still loading, in order, once', async () => {
    const loading = reporting.initErrorReporting(DSN);

    reporting.reportError(new Error('first'), 'a');
    reporting.reportError(new Error('second'), 'b');
    expect(sentry.captureException).not.toHaveBeenCalled();
    await loading;

    expect(sentry.captureException.mock.calls.map(([error]) => error.message)).toEqual(['first', 'second']);
    reporting.reportError(new Error('third'), 'c');
    expect(sentry.captureException).toHaveBeenCalledTimes(3);
  });

  it('sends at most 20 reports for one page load, so a loop does not become a flood', async () => {
    await reporting.initErrorReporting(DSN);

    for (let i = 0; i < 50; i += 1) reporting.reportError(new Error(`e${i}`), 'loop');

    expect(sentry.captureException).toHaveBeenCalledTimes(20);
  });

  it('counts the reports that were waiting, too', async () => {
    const loading = reporting.initErrorReporting(DSN);
    for (let i = 0; i < 30; i += 1) reporting.reportError(new Error(`e${i}`), 'loop');
    await loading;

    expect(sentry.captureException).toHaveBeenCalledTimes(20);
  });

  it('never throws, even when Sentry does', async () => {
    await reporting.initErrorReporting(DSN);
    sentry.captureException.mockImplementation(() => { throw new Error('sdk broke'); });

    expect(() => reporting.reportError(new Error('boom'), 'interface')).not.toThrow();
  });
});

describe('logError', () => {
  beforeEach(() => load());

  it('writes to the console exactly as before, with the same arguments', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = { message: 'nope', code: 'X1' };

    reporting.logError('Feed query failed:', error);

    expect(consoleError).toHaveBeenCalledWith('Feed query failed:', error);
  });

  it('also reports the error, with the label without its colon', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await reporting.initErrorReporting(DSN);

    reporting.logError('Feed query failed:', { message: 'nope', code: 'X1' });

    const [sent, options] = sentry.captureException.mock.calls[0];
    expect(sent.message).toBe('Feed query failed: nope');
    expect(options.tags.where).toBe('Feed query failed');
  });

  it('only writes to the console when reporting is off', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    reporting.logError('Search failed:', new Error('x'));

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});
