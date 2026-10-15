import { describe, it, expect } from 'vitest';
import { formatRelativeTime, formatFullDate } from './time';

// All dates are built in local time, so the tests give the same result in every time zone
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime(); // 15 June 2026, 12:00

const secondsAgo = (s) => new Date(NOW - s * 1000);
const SECOND = 1;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

const ago = (seconds) => formatRelativeTime(secondsAgo(seconds), NOW);

describe('formatRelativeTime', () => {
  describe('recent times', () => {
    it.each([
      [0, 'just now'],
      [10 * SECOND, 'just now'],
      [44 * SECOND, 'just now'],
    ])('%i seconds ago is "%s"', (seconds, expected) => {
      expect(ago(seconds)).toBe(expected);
    });

    it.each([
      [45 * SECOND, '1 minute ago'],
      [59 * SECOND, '1 minute ago'],
      [60 * SECOND, '1 minute ago'],
      [89 * SECOND, '1 minute ago'],
      [2 * MINUTE, '2 minutes ago'],
      [5 * MINUTE, '5 minutes ago'],
      [30 * MINUTE, '30 minutes ago'],
      [59 * MINUTE + 59, '59 minutes ago'],
    ])('%i seconds ago is "%s"', (seconds, expected) => {
      expect(ago(seconds)).toBe(expected);
    });

    it.each([
      [HOUR, '1 hour ago'],
      [HOUR + 59 * MINUTE, '1 hour ago'],
      [3 * HOUR, '3 hours ago'],
      [12 * HOUR, '12 hours ago'],
      [23 * HOUR + 59 * MINUTE, '23 hours ago'],
    ])('%i seconds ago is "%s"', (seconds, expected) => {
      expect(ago(seconds)).toBe(expected);
    });

    it.each([
      [DAY, 'yesterday'],
      [DAY + 23 * HOUR, 'yesterday'],
      [2 * DAY, '2 days ago'],
      [4 * DAY, '4 days ago'],
      [7 * DAY - 1, '6 days ago'],
    ])('%i seconds ago is "%s"', (seconds, expected) => {
      expect(ago(seconds)).toBe(expected);
    });
  });

  describe('older times become dates', () => {
    it('shows the day and month for a date earlier this year', () => {
      expect(formatRelativeTime(new Date(2026, 5, 8, 12, 0), NOW)).toBe('Jun 8'); // exactly 7 days
      expect(formatRelativeTime(new Date(2026, 4, 20, 9, 30), NOW)).toBe('May 20');
      expect(formatRelativeTime(new Date(2026, 0, 2, 23, 59), NOW)).toBe('Jan 2');
    });

    it('adds the year for a date from an earlier year', () => {
      expect(formatRelativeTime(new Date(2025, 11, 19, 8, 0), NOW)).toBe('Dec 19, 2025');
      expect(formatRelativeTime(new Date(2024, 1, 29, 8, 0), NOW)).toBe('Feb 29, 2024');
    });

    it('compares the year with the year of "now", not of the real clock', () => {
      const lateDecember = new Date(2026, 11, 28, 12, 0).getTime();

      expect(formatRelativeTime(new Date(2026, 11, 1, 12, 0), lateDecember)).toBe('Dec 1');
      expect(formatRelativeTime(new Date(2025, 11, 31, 12, 0), lateDecember)).toBe('Dec 31, 2025');
    });

    it('switches from relative to a date exactly at 7 days', () => {
      expect(ago(7 * DAY - 1)).toBe('6 days ago');
      expect(ago(7 * DAY)).toBe('Jun 8');
    });
  });

  describe('times in the future (a clock that is a little ahead)', () => {
    const inSeconds = (s) => formatRelativeTime(new Date(NOW + s * 1000), NOW);

    it('treats a few seconds ahead as "just now"', () => {
      expect(inSeconds(20)).toBe('just now');
      expect(inSeconds(44)).toBe('just now');
    });

    it('describes further ahead times as "in ..."', () => {
      expect(inSeconds(5 * MINUTE)).toBe('in 5 minutes');
      expect(inSeconds(2 * HOUR)).toBe('in 2 hours');
      expect(inSeconds(3 * DAY)).toBe('in 3 days');
    });

    it('shows a date for a far future time', () => {
      expect(formatRelativeTime(new Date(2026, 8, 1, 12, 0), NOW)).toBe('Sep 1');
      expect(formatRelativeTime(new Date(2027, 0, 5, 12, 0), NOW)).toBe('Jan 5, 2027');
    });
  });

  describe('kinds of input', () => {
    const date = secondsAgo(3 * HOUR);

    it('accepts a Date, a timestamp and a text', () => {
      expect(formatRelativeTime(date, NOW)).toBe('3 hours ago');
      expect(formatRelativeTime(date.getTime(), NOW)).toBe('3 hours ago');
      expect(formatRelativeTime(date.toISOString(), NOW)).toBe('3 hours ago');
    });

    it('accepts the time format the database sends', () => {
      // Supabase returns timestamptz as "2026-06-15T09:00:00.123456+00:00"
      const fromDatabase = new Date(NOW - 3 * HOUR * 1000).toISOString().replace('Z', '+00:00');
      expect(formatRelativeTime(fromDatabase, NOW)).toBe('3 hours ago');
    });

    it('returns an empty text for something that is not a date', () => {
      expect(formatRelativeTime('nonsense', NOW)).toBe('');
      expect(formatRelativeTime(undefined, NOW)).toBe('');
      expect(formatRelativeTime(new Date('invalid'), NOW)).toBe('');
    });

    it('uses the real clock when "now" is not given', () => {
      expect(formatRelativeTime(new Date(Date.now() - 5 * 60 * 1000))).toBe('5 minutes ago');
      expect(formatRelativeTime(new Date())).toBe('just now');
    });
  });
});

describe('formatFullDate', () => {
  // Newer Node versions put a narrow no-break space before AM/PM; make it a normal space
  const plain = (text) => text.replace(/\s/g, ' ');

  it('shows the date and the time', () => {
    expect(plain(formatFullDate(new Date(2026, 9, 12, 8, 15)))).toBe('Oct 12, 2026, 8:15 AM');
    expect(plain(formatFullDate(new Date(2025, 11, 31, 23, 5)))).toBe('Dec 31, 2025, 11:05 PM');
  });

  it('accepts a text and a timestamp', () => {
    const date = new Date(2026, 9, 12, 8, 15);
    expect(plain(formatFullDate(date.toISOString()))).toBe('Oct 12, 2026, 8:15 AM');
    expect(plain(formatFullDate(date.getTime()))).toBe('Oct 12, 2026, 8:15 AM');
  });

  it('returns an empty text for something that is not a date', () => {
    expect(formatFullDate('nonsense')).toBe('');
    expect(formatFullDate(undefined)).toBe('');
  });
});
