import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import LoadMore from './LoadMore';

// A fake IntersectionObserver that the test controls: "the button comes near the screen" is a call
let observers;
let inView; // when true an observer reports "near the screen" as soon as it starts watching (like a real one)

class FakeObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.active = false;
    observers.push(this);
  }

  observe(element) {
    this.element = element;
    this.active = true;
    if (inView) queueMicrotask(() => this.active && this.callback([{ isIntersecting: true }]));
  }

  disconnect() {
    this.active = false;
  }
}

const watching = () => observers.filter((o) => o.active);
const comeNearTheScreen = () => act(async () => {
  watching().forEach((o) => o.callback([{ isIntersecting: true }]));
});
const goFarFromTheScreen = () => act(async () => {
  watching().forEach((o) => o.callback([{ isIntersecting: false }]));
});

// A page takes a moment to come, like in real life
const later = (value) => new Promise((resolve) => { setTimeout(() => resolve(value), 5); });

// Like the lists of the app: the button is locked while the page is on its way
function List({ onLoad, ...props }) {
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    const result = await onLoad();
    setLoading(false);
    return result;
  }
  return <LoadMore onLoad={load} loading={loading} {...props} />;
}

beforeEach(() => {
  observers = [];
  inView = false;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoadMore with infinite scroll', () => {
  it('shows the button, and loads nothing while the button is far from the screen', async () => {
    const onLoad = vi.fn().mockResolvedValue(true);
    render(<List onLoad={onLoad} />);

    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
    await goFarFromTheScreen();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('loads the next page by itself when the button comes near the screen', async () => {
    const onLoad = vi.fn().mockResolvedValue(true);
    render(<List onLoad={onLoad} />);

    await comeNearTheScreen();

    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('starts loading a little before the button is on the screen, so the list does not stop at the end', () => {
    render(<List onLoad={vi.fn()} />);

    expect(watching()).toHaveLength(1);
    expect(watching()[0].options.rootMargin).toBe('400px');
  });

  it('watches the area of the button, which stays when the button is locked', () => {
    render(<List onLoad={vi.fn()} />);

    expect(watching()[0].element).toContainElement(screen.getByRole('button', { name: 'Load more' }));
  });

  it('loads once for one arrival, even if the observer reports twice in a row', async () => {
    let finish;
    const onLoad = vi.fn(() => new Promise((resolve) => { finish = () => resolve(true); }));
    render(<List onLoad={onLoad} />);
    const [observer] = watching();

    // A watcher that has been disconnected hears nothing any more, like a real one
    await act(async () => {
      if (observer.active) observer.callback([{ isIntersecting: true }]);
      if (observer.active) observer.callback([{ isIntersecting: true }]);
    });

    expect(observer.active).toBe(false);
    expect(onLoad).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it('is locked while a page is on its way: "Loading...", no new page, and nobody is watching', async () => {
    let finish;
    const onLoad = vi.fn(() => new Promise((resolve) => { finish = () => resolve(true); }));
    render(<List onLoad={onLoad} />);

    await comeNearTheScreen();

    expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled();
    expect(watching()).toHaveLength(0);
    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
  });

  it('looks again when a page has come: if the button is still near the screen the next page follows', async () => {
    inView = true;
    let pages = 0;
    const onLoad = vi.fn(async () => {
      pages += 1;
      if (pages === 3) inView = false; // after the third page the button has been pushed away
      await new Promise((resolve) => setTimeout(resolve, 5)); // a page takes time to come
      return true;
    });

    render(<List onLoad={onLoad} />);

    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(3));
    await act(async () => {});
    expect(onLoad).toHaveBeenCalledTimes(3);
  });

  it('looks again after a page even when it came so fast that the button never seemed to be locked', async () => {
    inView = true;
    let pages = 0;
    const onLoad = vi.fn(async () => {
      pages += 1;
      if (pages === 3) inView = false;
      return true; // at once: the list is the same before and after
    });

    render(<LoadMore onLoad={onLoad} loading={false} />);

    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(3));
  });

  it('does not load again and again when there was nothing to load', async () => {
    inView = true;
    const onLoad = vi.fn().mockResolvedValue(undefined); // the list had no last item to continue from

    render(<List onLoad={onLoad} />);

    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('stops loading by itself after an error, even if the button is still near the screen', async () => {
    inView = true;
    const onLoad = vi.fn(() => later(false));

    render(<List onLoad={onLoad} />);

    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    await act(async () => { await later(); });
    await act(async () => { await later(); });
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(watching()).toHaveLength(0);
    // The button is there to try again
    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
  });

  it('after an error the button tries again, and when that works the scrolling takes over again', async () => {
    inView = true;
    const results = [false, true];
    const onLoad = vi.fn(async () => {
      const result = results.shift() ?? true;
      if (results.length === 0) inView = false; // the second page pushes the button away
      return later(result);
    });
    render(<List onLoad={onLoad} />);
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    await act(async () => { await later(); }); // the error has come

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(watching()).toHaveLength(1); // watching again
    await comeNearTheScreen();
    expect(onLoad).toHaveBeenCalledTimes(3);
  });

  it('stops again when the try after an error fails too', async () => {
    inView = true;
    const onLoad = vi.fn(() => later(false));
    render(<List onLoad={onLoad} />);
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    await act(async () => { await later(); }); // the error has come

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await act(async () => { await later(); });
    await act(async () => { await later(); });

    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(watching()).toHaveLength(0);
  });

  it('uses the newest onLoad of the page (the list has changed since the first render)', async () => {
    const first = vi.fn().mockResolvedValue(true);
    const second = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<LoadMore onLoad={first} loading={false} />);

    rerender(<LoadMore onLoad={second} loading={false} />);
    await comeNearTheScreen();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops watching when it goes away', () => {
    const { unmount } = render(<List onLoad={vi.fn()} />);
    expect(watching()).toHaveLength(1);

    unmount();

    expect(watching()).toHaveLength(0);
  });
});

describe('LoadMore as a plain button', () => {
  it('loads when the button is pressed, also in a browser with no IntersectionObserver', async () => {
    vi.unstubAllGlobals();
    delete window.IntersectionObserver;
    const onLoad = vi.fn().mockResolvedValue(true);
    render(<List onLoad={onLoad} />);

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('can be pressed while it is near the screen too, and is locked while loading', async () => {
    let finish;
    const onLoad = vi.fn(() => new Promise((resolve) => { finish = () => resolve(true); }));
    render(<List onLoad={onLoad} />);

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled();
    expect(onLoad).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it('has the text, size and place the list asks for', () => {
    render(<LoadMore onLoad={vi.fn()} loading={false} label="Show more" size="small" align="start" sx={{ mt: 2 }} />);

    const button = screen.getByRole('button', { name: 'Show more' });
    expect(button.className).toMatch(/MuiButton-sizeSmall/);
    expect(getComputedStyle(button.parentElement).justifyContent).toBe('flex-start');
  });

  it('is in the middle by default', () => {
    render(<LoadMore onLoad={vi.fn()} loading={false} />);

    expect(getComputedStyle(screen.getByRole('button').parentElement).justifyContent).toBe('center');
  });

  it('shows "Loading..." when the list says it is loading', () => {
    render(<LoadMore onLoad={vi.fn()} loading label="Show more" />);

    expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled();
  });
});
