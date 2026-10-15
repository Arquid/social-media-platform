import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNow } from './useNow';

const START = new Date(2026, 5, 15, 12, 0, 0).getTime();

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const wait = (ms) => act(() => vi.advanceTimersByTime(ms));

  it('starts with the current time', () => {
    const { result } = renderHook(() => useNow());

    expect(result.current).toBe(START);
  });

  it('updates every 30 seconds by default', () => {
    const { result } = renderHook(() => useNow());

    wait(29_999);
    expect(result.current).toBe(START);

    wait(1);
    expect(result.current).toBe(START + 30_000);

    wait(30_000);
    expect(result.current).toBe(START + 60_000);
  });

  it('follows a different interval', () => {
    const { result } = renderHook(() => useNow(5_000));

    wait(4_999);
    expect(result.current).toBe(START);
    wait(1);
    expect(result.current).toBe(START + 5_000);
  });

  it('keeps the time of the real clock, not a counter', () => {
    const { result } = renderHook(() => useNow(1_000));

    // The clock jumps ahead (for example the computer was asleep), then the next tick comes
    vi.setSystemTime(START + 10 * 60_000);
    wait(1_000); // the clock moves on by one second while waiting for the tick

    expect(result.current).toBe(START + 10 * 60_000 + 1_000);
  });

  it('starts a new timer when the interval changes, and removes the old one', () => {
    const { result, rerender } = renderHook(({ interval }) => useNow(interval), {
      initialProps: { interval: 10_000 },
    });
    expect(vi.getTimerCount()).toBe(1);

    rerender({ interval: 60_000 });
    expect(vi.getTimerCount()).toBe(1);

    wait(10_000);
    expect(result.current).toBe(START); // the old 10 s timer is gone
    wait(50_000);
    expect(result.current).toBe(START + 60_000);
  });

  it('stops its timer when it is removed from the screen', () => {
    const { unmount } = renderHook(() => useNow());
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
