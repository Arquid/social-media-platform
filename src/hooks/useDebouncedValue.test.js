import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const wait = (ms) => act(() => vi.advanceTimersByTime(ms));

  it('returns the starting value straight away', () => {
    const { result } = renderHook(() => useDebouncedValue('first', 300));

    expect(result.current).toBe('first');
  });

  it('shows a new value only after the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'b' });
    expect(result.current).toBe('a');

    wait(299);
    expect(result.current).toBe('a');

    wait(1);
    expect(result.current).toBe('b');
  });

  it('starts counting again on every change, so only the last value comes through', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: '' },
    });

    for (const typed of ['a', 'al', 'ali']) {
      rerender({ value: typed });
      wait(200); // always less than the delay
    }
    expect(result.current).toBe(''); // nothing has come through yet

    wait(100);
    expect(result.current).toBe('ali');
  });

  it('never shows the values in between', () => {
    const seen = [];
    const { rerender } = renderHook(
      ({ value }) => {
        const debounced = useDebouncedValue(value, 300);
        seen.push(debounced);
        return debounced;
      },
      { initialProps: { value: 'a' } }
    );

    rerender({ value: 'b' });
    wait(100);
    rerender({ value: 'c' });
    wait(300);

    expect(new Set(seen)).toEqual(new Set(['a', 'c']));
  });

  it('uses 300 ms when no delay is given', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'b' });
    wait(299);
    expect(result.current).toBe('a');
    wait(1);
    expect(result.current).toBe('b');
  });

  it('follows a different delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 1000), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'b' });
    wait(999);
    expect(result.current).toBe('a');
    wait(1);
    expect(result.current).toBe('b');
  });

  it('works for other kinds of values too', () => {
    const first = { id: 1 };
    const second = { id: 2 };
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 100), {
      initialProps: { value: first },
    });

    rerender({ value: second });
    wait(100);

    expect(result.current).toBe(second);
  });

  it('cancels the waiting timer when it is removed from the screen', () => {
    const { rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'b' });
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
