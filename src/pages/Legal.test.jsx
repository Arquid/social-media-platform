import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import Terms from './Terms';
import Privacy from './Privacy';
import { renderWithProviders } from '../test/renderWithProviders';

const legal = vi.hoisted(() => ({ contact: '' }));
vi.mock('../lib/legal', () => ({
  LEGAL_UPDATED: '26 November 2026',
  LEGAL_VERSION: '2026-11-26',
  get CONTACT_EMAIL() {
    return legal.contact;
  },
}));

const headings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

beforeEach(() => {
  legal.contact = '';
});

describe.each([
  ['Terms of Use', Terms],
  ['Privacy Policy', Privacy],
])('%s', (title, Page) => {
  it('has one first level heading with its name, and the date of the text', () => {
    renderWithProviders(<Page />, { user: null });

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText('Last updated 26 November 2026')).toBeInTheDocument();
  });

  it('is for everybody, also for somebody who is not logged in, and has sections with their own headings', () => {
    renderWithProviders(<Page />, { user: null });

    expect(screen.getAllByRole('region')).toEqual(screen.getAllByRole('region')); // the sections have names
    for (const section of screen.getAllByRole('region')) expect(section).toHaveAccessibleName();
    expect(headings().length).toBeGreaterThanOrEqual(6);
    expect(headings().at(-1)).toBe('Contact');
  });

  it('tells who to write to when there is no address, and gives the address as a link when there is one', () => {
    const { unmount } = renderWithProviders(<Page />, { user: null });
    expect(screen.getByText(/go to the person who runs this site/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /@/ })).not.toBeInTheDocument();
    unmount();

    legal.contact = 'privacy@example.test';
    renderWithProviders(<Page />, { user: null });
    expect(screen.getByRole('link', { name: 'privacy@example.test' })).toHaveAttribute('href', 'mailto:privacy@example.test');
    expect(screen.queryByText(/go to the person who runs this site/)).not.toBeInTheDocument();
  });
});

describe('the terms', () => {
  it('has the minimum age, the rules, how reports and moderation work, and how to end the account', () => {
    renderWithProviders(<Terms />, { user: null });

    expect(headings()).toEqual([
      'Using the service', 'Your content', 'Rules', 'Reports, blocking and moderation', 'Ending your account', 'No guarantees', 'Changes', 'Contact',
    ]);
    expect(screen.getByText('You must be at least 16 years old.')).toBeInTheDocument();
    expect(screen.getByText(/Reports are private: the person who is reported is not told who reported them/)).toBeInTheDocument();
    expect(screen.getByText(/limits on how fast you can post, like and follow/)).toBeInTheDocument();
  });

  it('points to what the app really offers: the download and the deletion on the profile page', () => {
    renderWithProviders(<Terms />, { user: null });

    expect(screen.getByText(/delete your account at any time from your profile page/)).toBeInTheDocument();
    expect(screen.getByText(/download your data from your profile page/)).toBeInTheDocument();
  });

  it('links to the privacy policy, and does not promise what is not built (no "accept again" step)', () => {
    renderWithProviders(<Terms />, { user: null });

    for (const link of screen.getAllByRole('link', { name: 'Privacy Policy' })) {
      expect(link).toHaveAttribute('href', '/privacy');
      expect(link.className).toMatch(/underlineAlways/);
    }
    expect(screen.getByRole('region', { name: 'Changes' })).not.toHaveTextContent(/accept the new version/);
  });
});

describe('the privacy policy', () => {
  it('lists what is held, who sees it, why, who handles it, cookies, how long, and the rights', () => {
    renderWithProviders(<Privacy />, { user: null });

    expect(headings()).toEqual([
      'What we hold about you', 'Who can see it', 'Why we use it', 'Who handles it for us', 'Cookies and similar storage',
      'How long we keep it', 'Your rights', 'Children', 'Changes', 'Contact',
    ]);
  });

  it('says what is true of the app: no cookies, no tracking, logged-in people only, reports kept private', () => {
    renderWithProviders(<Privacy />, { user: null });

    expect(screen.getByText(/We set no cookies and use no analytics, advertising or tracking/)).toBeInTheDocument();
    expect(screen.getByText(/They cannot be seen by people who are not logged in/)).toBeInTheDocument();
    expect(screen.getByText(/We do not sell your data/)).toBeInTheDocument();
    expect(screen.getByText(/Reports that other people make about you are kept private/)).toBeInTheDocument();
    expect(screen.getByText(/at least 16 years old/)).toBeInTheDocument();
  });

  it('names the buttons of the profile page by their real labels, for access and for deletion', () => {
    renderWithProviders(<Privacy />, { user: null });

    const rights = screen.getByRole('region', { name: 'Your rights' });
    expect(within(rights).getByText(/"Download my data" on your own profile page/)).toBeInTheDocument();
    expect(within(rights).getByText(/"Delete account" on your own profile page/)).toBeInTheDocument();
  });

  it('says what deleting the account removes, including the reports and the record of accepted terms', () => {
    renderWithProviders(<Privacy />, { user: null });

    const kept = screen.getByRole('region', { name: 'How long we keep it' });
    for (const word of ['profile', 'posts', 'comments', 'likes', 'follows', 'blocks', 'notifications', 'reports you sent', 'reports about you', 'record of accepted terms', 'pictures']) {
      expect(kept, word).toHaveTextContent(word);
    }
  });

  it('links to the terms, and does not promise what is not built', () => {
    renderWithProviders(<Privacy />, { user: null });

    expect(screen.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('region', { name: 'Changes' })).not.toHaveTextContent(/accept the new version/);
  });
});
