import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import ThemeToggle from './ThemeToggle';
import { theme } from '../theme';

const STORAGE_KEY = 'mui-mode'; // where MUI remembers the choice
const originalMatchMedia = window.matchMedia;

// A fake matchMedia tells which theme the device prefers
function setDevicePreference(dark) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

function renderToggle() {
  return render(
    <ThemeProvider theme={theme} defaultMode="system" noSsr>
      <ThemeToggle />
    </ThemeProvider>
  );
}

const toLight = () => screen.getByRole('button', { name: 'Switch to light theme' });
const toDark = () => screen.getByRole('button', { name: 'Switch to dark theme' });

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  describe('before the user has chosen', () => {
    it('offers the dark theme when the device is light', () => {
      setDevicePreference(false);
      renderToggle();

      expect(toDark()).toBeInTheDocument();
      expect(screen.getByTestId('DarkModeIcon')).toBeInTheDocument();
    });

    it('offers the light theme when the device is dark', () => {
      setDevicePreference(true);
      renderToggle();

      expect(toLight()).toBeInTheDocument();
      expect(screen.getByTestId('LightModeIcon')).toBeInTheDocument();
    });

    it('has not saved anything yet', () => {
      setDevicePreference(true);
      renderToggle();

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('choosing', () => {
    it('switches a light device to dark and remembers it', async () => {
      setDevicePreference(false);
      renderToggle();

      await userEvent.click(toDark());

      expect(toLight()).toBeInTheDocument();
      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    });

    it('switches a dark device to light and remembers it', async () => {
      setDevicePreference(true);
      renderToggle();

      await userEvent.click(toLight());

      expect(toDark()).toBeInTheDocument();
      expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    });

    it('switches back and forth', async () => {
      setDevicePreference(false);
      renderToggle();

      await userEvent.click(toDark());
      await userEvent.click(toLight());
      await userEvent.click(toDark());

      expect(toLight()).toBeInTheDocument();
      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    });
  });

  describe('remembering', () => {
    it('keeps the choice when the page is opened again', async () => {
      setDevicePreference(false);
      const first = renderToggle();
      await userEvent.click(toDark());
      first.unmount();

      renderToggle();

      expect(toLight()).toBeInTheDocument(); // still dark
    });

    it('lets the saved choice win over the device setting', () => {
      setDevicePreference(true); // the device is dark...
      localStorage.setItem(STORAGE_KEY, 'light'); // ...but the user chose light

      renderToggle();

      expect(toDark()).toBeInTheDocument();
    });

    it('lets a saved dark choice win over a light device', () => {
      setDevicePreference(false);
      localStorage.setItem(STORAGE_KEY, 'dark');

      renderToggle();

      expect(toLight()).toBeInTheDocument();
    });
  });

  it('shows nothing when there is no theme provider, instead of crashing', () => {
    const { container } = render(<ThemeToggle />);

    expect(container).toBeEmptyDOMElement();
  });
});
