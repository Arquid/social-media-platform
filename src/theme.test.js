import { describe, it, expect } from 'vitest';
import { getContrastRatio } from '@mui/material/styles';
import { theme } from './theme';

// WCAG: normal text needs a contrast of at least 4.5 : 1
const READABLE = 4.5;

describe('theme', () => {
  it('has a light and a dark color scheme', () => {
    expect(Object.keys(theme.colorSchemes).sort()).toEqual(['dark', 'light']);
  });

  it('switches with the data-mui-color-scheme attribute', () => {
    expect(theme.colorSchemeSelector).toBe('data');
  });

  it('keeps the rounded corners in both', () => {
    expect(theme.shape.borderRadius).toBe(12);
  });

  describe.each(['light', 'dark'])('the %s scheme', (name) => {
    const palette = () => theme.colorSchemes[name].palette;

    it('has a page background and a card background that differ', () => {
      expect(palette().background.default).not.toBe(palette().background.paper);
    });

    it('is readable: normal text on the page and on cards', () => {
      expect(getContrastRatio(palette().text.primary, palette().background.default)).toBeGreaterThanOrEqual(READABLE);
      expect(getContrastRatio(palette().text.primary, palette().background.paper)).toBeGreaterThanOrEqual(READABLE);
    });

    it('is readable: secondary text on cards', () => {
      expect(getContrastRatio(palette().text.secondary, palette().background.paper)).toBeGreaterThanOrEqual(READABLE);
    });

    it('is readable: the accent color (links, the app name) on the page and on cards', () => {
      expect(getContrastRatio(palette().primary.main, palette().background.default)).toBeGreaterThanOrEqual(READABLE);
      expect(getContrastRatio(palette().primary.main, palette().background.paper)).toBeGreaterThanOrEqual(READABLE);
    });

    it('is readable: text on a filled accent button', () => {
      expect(getContrastRatio(palette().primary.contrastText, palette().primary.main)).toBeGreaterThanOrEqual(READABLE);
    });
  });

  it('has a dark page background and a light one', () => {
    const lightness = (color) => {
      const [r, g, b] = color.match(/\w\w/g).map((hex) => parseInt(hex, 16));
      return (r + g + b) / 3;
    };

    expect(lightness(theme.colorSchemes.dark.palette.background.default)).toBeLessThan(60);
    expect(lightness(theme.colorSchemes.light.palette.background.default)).toBeGreaterThan(200);
  });
});
