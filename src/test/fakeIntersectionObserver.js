import { vi } from 'vitest';
import { act } from '@testing-library/react';

// jsdom has no IntersectionObserver. This puts a fake one in its place, and the test decides when
// "the button comes near the screen". Call vi.unstubAllGlobals() afterwards.
export function installFakeIntersectionObserver() {
  const observers = [];

  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
      observers.push(this);
    }

    observe() {
      this.active = true;
    }

    disconnect() {
      this.active = false;
    }
  }

  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

  const watching = () => observers.filter((observer) => observer.active);
  const comeNearTheScreen = () => act(async () => {
    watching().forEach((observer) => observer.callback([{ isIntersecting: true }]));
  });

  return { watching, comeNearTheScreen };
}
