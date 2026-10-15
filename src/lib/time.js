const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const JUST_NOW_SECONDS = 45;
const RELATIVE_LIMIT_DAYS = 7;

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function formatShortDate(timestamp, now) {
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  }).format(timestamp);
}

export function formatRelativeTime(date, now = Date.now()) {
  const timestamp = new Date(date).getTime();
  if (Number.isNaN(timestamp)) return '';

  const difference = timestamp - now;
  const seconds = Math.abs(difference) / 1000;
  const sign = difference < 0 ? -1 : 1;

  if (seconds < JUST_NOW_SECONDS) return 'just now';
  if (seconds < HOUR) return relative.format(sign * Math.max(1, Math.floor(seconds / MINUTE)), 'minute');
  if (seconds < DAY) return relative.format(sign * Math.floor(seconds / HOUR), 'hour');
  if (seconds < RELATIVE_LIMIT_DAYS * DAY) return relative.format(sign * Math.floor(seconds / DAY), 'day');

  return formatShortDate(timestamp, now);
}

export function formatFullDate(date) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}