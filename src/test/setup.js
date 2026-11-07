import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// jsdom has no matchMedia, which the light/dark theme of MUI asks for.
// By default the fake device prefers the light theme; a test can replace it.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

// findBy... and waitFor wait up to a second by default. A computer that is busy (or the slower run
// with the coverage measurement) can need longer; a test that passes does not wait any longer for it.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
  localStorage.clear(); // the theme choice is kept there
});
