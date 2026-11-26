import { describe, it, expect, vi, afterEach } from 'vitest';

async function load() {
  vi.resetModules();
  return import('./legal');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the version of the texts', () => {
  it('is a date, and the date in words is the same day', async () => {
    const { LEGAL_VERSION, LEGAL_UPDATED } = await load();

    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [year, month, day] = LEGAL_VERSION.split('-').map(Number);
    const monthName = new Date(year, month - 1, 1).toLocaleString('en-GB', { month: 'long' });
    expect(LEGAL_UPDATED).toBe(`${day} ${monthName} ${year}`);
  });

  it('is short enough for the database, which keeps at most 40 characters', async () => {
    const { LEGAL_VERSION } = await load();

    expect(LEGAL_VERSION.length).toBeLessThanOrEqual(40);
  });
});

describe('the contact address', () => {
  it('is the one in the settings', async () => {
    vi.stubEnv('VITE_CONTACT_EMAIL', 'privacy@example.test');

    expect((await load()).CONTACT_EMAIL).toBe('privacy@example.test');
  });

  it('has spaces around it taken away', async () => {
    vi.stubEnv('VITE_CONTACT_EMAIL', '  privacy@example.test  ');

    expect((await load()).CONTACT_EMAIL).toBe('privacy@example.test');
  });

  it.each(['', '   '])('is empty when the setting is empty (%j)', async (value) => {
    vi.stubEnv('VITE_CONTACT_EMAIL', value);

    expect((await load()).CONTACT_EMAIL).toBe('');
  });

  it('is empty when there is no setting at all', async () => {
    vi.stubEnv('VITE_CONTACT_EMAIL', undefined);

    expect((await load()).CONTACT_EMAIL).toBe('');
  });
});
