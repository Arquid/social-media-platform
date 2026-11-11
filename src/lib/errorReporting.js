// Error reporting: tells the developer about errors that happen in other people's browsers.
//
// It is OFF unless VITE_SENTRY_DSN is set (see .env.example), so the app, the tests and local
// development send nothing anywhere by default. The Sentry code is loaded only when it is used.
//
// What is sent is small on purpose: the message, the stack and the path of the page.
// No user, no cookies, no query or hash of the address (a password reset link carries a secret
// there), and no history of clicks, requests or console messages.

const MAX_REPORTS_PER_PAGE_LOAD = 20; // a loop of errors must not become a flood

// Noise that is not a bug of the app: a user who is offline, a browser quirk
const IGNORED_ERRORS = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  /Failed to fetch/i,
  /Load failed/i,
  /NetworkError when attempting to fetch/i,
];

let sentry = null; // the Sentry code, once it is loaded
let waiting = []; // reports made while it was still loading
let enabled = false;
let sent = 0;

// Only the origin and the path stay: the query and the hash can hold tokens
export function cleanUrl(url) {
  if (typeof url !== 'string') return url;
  try {
    const parsed = new URL(url, 'http://localhost');
    const base = /^[a-z][a-z0-9+.-]*:/i.test(url) ? parsed.origin : '';
    return `${base}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

export function cleanEvent(event) {
  delete event.user;
  if (event.request) {
    event.request.url = cleanUrl(event.request.url);
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      delete event.request.headers.Referer;
      delete event.request.headers.Cookie;
    }
  }
  return event;
}

// Only the moves between pages are kept, and without the secrets of the address
export function cleanBreadcrumb(breadcrumb) {
  if (breadcrumb.category !== 'navigation') return null;
  return {
    ...breadcrumb,
    data: { from: cleanUrl(breadcrumb.data?.from), to: cleanUrl(breadcrumb.data?.to) },
  };
}

// Supabase errors are plain objects, not Error: make them readable in the report
function toError(error, label) {
  if (error instanceof Error) return error;
  const wrapped = new Error(`${label}: ${error?.message ?? String(error)}`);
  wrapped.code = error?.code;
  return wrapped;
}

function send(error, label, extra) {
  try {
    const wrapped = toError(error, label);
    sentry.captureException(wrapped, {
      tags: { where: label },
      extra: { code: wrapped.code, ...extra },
    });
  } catch {
    // reporting must never break the app
  }
}

export async function initErrorReporting(dsn = import.meta.env.VITE_SENTRY_DSN) {
  if (!dsn || enabled) return;
  enabled = true;
  try {
    const loaded = await import('@sentry/react');
    loaded.init({
      dsn,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      maxBreadcrumbs: 20,
      ignoreErrors: IGNORED_ERRORS,
      beforeSend: cleanEvent,
      beforeBreadcrumb: cleanBreadcrumb,
    });
    sentry = loaded;
    waiting.forEach(([error, label, extra]) => send(error, label, extra));
  } catch {
    enabled = false; // for example a blocker stopped the file: the app works without it
  }
  waiting = [];
}

export function reportError(error, label = 'unexpected', extra) {
  if (!enabled || sent >= MAX_REPORTS_PER_PAGE_LOAD) return;
  sent += 1;
  if (sentry) send(error, label, extra);
  else waiting.push([error, label, extra]);
}

// What the code did before (write to the console), plus a report
export function logError(label, error) {
  console.error(label, error);
  reportError(error, label.replace(/:$/, ''));
}