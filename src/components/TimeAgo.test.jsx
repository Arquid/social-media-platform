import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import TimeAgo from './TimeAgo';

// Local-time dates, so the tests give the same result in every time zone
const NOW = new Date(2026, 5, 15, 12, 0, 0);
const before = (ms) => new Date(NOW.getTime() - ms);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('TimeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows how long ago it was', () => {
    render(<TimeAgo date={before(3 * HOUR)} />);

    expect(screen.getByText('3 hours ago')).toBeInTheDocument();
  });

  it('is a <time> element with the exact moment in its dateTime attribute', () => {
    const date = before(3 * HOUR);
    render(<TimeAgo date={date} />);

    const element = screen.getByText('3 hours ago');
    expect(element.tagName).toBe('TIME');
    expect(element).toHaveAttribute('dateTime', date.toISOString());
  });

  it('shows the exact date and time as a tooltip', () => {
    render(<TimeAgo date={new Date(2026, 5, 15, 9, 5)} />);

    // 9:05 is 2 hours 55 minutes before the fake "now" of 12:00, shown rounded down
    const title = screen.getByText('2 hours ago').getAttribute('title').replace(/\s/g, ' ');
    expect(title).toBe('Jun 15, 2026, 9:05 AM');
  });

  it('accepts the text format the database sends', () => {
    const fromDatabase = before(5 * MINUTE).toISOString().replace('Z', '+00:00');
    render(<TimeAgo date={fromDatabase} />);

    expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
  });

  it('shows a date for something older than a week', () => {
    render(<TimeAgo date={new Date(2026, 4, 20, 9, 0)} />);

    expect(screen.getByText('May 20')).toBeInTheDocument();
  });

  it('shows "yesterday" and "just now" in their own words', () => {
    render(
      <>
        <TimeAgo date={before(DAY)} />
        <TimeAgo date={before(10 * SECOND)} />
      </>
    );

    expect(screen.getByText('yesterday')).toBeInTheDocument();
    expect(screen.getByText('just now')).toBeInTheDocument();
  });

  it('keeps up with the clock: "just now" becomes "1 minute ago" without a reload', () => {
    render(<TimeAgo date={NOW} />);
    expect(screen.getByText('just now')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(60 * SECOND));

    expect(screen.getByText('1 minute ago')).toBeInTheDocument();
    expect(screen.queryByText('just now')).not.toBeInTheDocument();
  });

  it('keeps counting: 5 minutes later it says "5 minutes ago"', () => {
    render(<TimeAgo date={NOW} />);

    act(() => vi.advanceTimersByTime(5 * MINUTE));

    expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
  });

  it('shows nothing for something that is not a date, instead of a wrong text', () => {
    const { container } = render(<TimeAgo date="nonsense" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('stops its timer when it is removed from the screen', () => {
    const { unmount } = render(<TimeAgo date={NOW} />);
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
