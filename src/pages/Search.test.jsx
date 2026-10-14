import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import Search from './Search';
import { renderWithProviders } from '../test/renderWithProviders';
import { searchProfiles } from '../lib/search';

vi.mock('../lib/search', async (importOriginal) => ({
  ...(await importOriginal()),
  searchProfiles: vi.fn(),
}));
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: `http://storage.test/${p}` } }) }) },
  },
}));

const alice = { id: 'a', username: 'alice', display_name: 'Alice Smith', bio: 'I like cats', avatar_path: null };
const bobby = { id: 'b', username: 'bobby', display_name: 'Bobby', bio: '', avatar_path: 'b/me.png' };
const noName = { id: 'c', username: 'carol', display_name: null, bio: 'Only a bio', avatar_path: null };

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Shows the current address and how it was reached (PUSH adds a history entry, REPLACE does not)
function Where() {
  const { pathname, search } = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <div data-testid="address">{pathname + search}</div>
      <div data-testid="navigation-type">{navigationType}</div>
    </>
  );
}

let user;

function renderPage(route = '/search') {
  return renderWithProviders(
    <Routes>
      <Route path="/search" element={<><Search /><Where /></>} />
      <Route path="/profile/:username" element={<div>A profile page</div>} />
    </Routes>,
    { route }
  );
}

const box = () => screen.getByRole('searchbox', { name: 'Search users' });
const address = () => screen.getByTestId('address').textContent;
const typeAndWait = async (text, wait = 350) => {
  await user.type(box(), text);
  await act(async () => vi.advanceTimersByTime(wait));
};

describe('Search page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();
    searchProfiles.mockResolvedValue({ users: [alice], error: '' });
    user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('before searching', () => {
    it('starts with a focused, empty box and a hint', () => {
      renderPage();

      expect(box()).toHaveFocus();
      expect(box()).toHaveValue('');
      expect(screen.getByText(/type at least 2 characters/i)).toBeInTheDocument();
      expect(searchProfiles).not.toHaveBeenCalled();
    });

    it('does not search for a single character', async () => {
      renderPage();

      await typeAndWait('a');

      expect(searchProfiles).not.toHaveBeenCalled();
      expect(screen.getByText(/type at least 2 characters/i)).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    it('does not search for spaces', async () => {
      renderPage();

      await typeAndWait('     ');

      expect(searchProfiles).not.toHaveBeenCalled();
    });
  });

  describe('searching', () => {
    it('waits until the typing stops and then searches once', async () => {
      renderPage();

      await user.type(box(), 'alice');
      expect(searchProfiles).not.toHaveBeenCalled(); // still inside the delay

      await act(async () => vi.advanceTimersByTime(350));

      expect(searchProfiles).toHaveBeenCalledTimes(1);
      expect(searchProfiles).toHaveBeenCalledWith('alice');
    });

    it('trims spaces around the text', async () => {
      renderPage();

      await typeAndWait('  ali  ');

      expect(searchProfiles).toHaveBeenCalledTimes(1);
      expect(searchProfiles).toHaveBeenCalledWith('ali');
    });

    it('shows a spinner while waiting for the delay and the answer', async () => {
      const pending = deferred();
      searchProfiles.mockReturnValue(pending.promise);
      renderPage();

      await user.type(box(), 'ali');
      expect(screen.getByRole('progressbar')).toBeInTheDocument(); // during the delay

      await act(async () => vi.advanceTimersByTime(350));
      expect(screen.getByRole('progressbar')).toBeInTheDocument(); // during the search

      await act(async () => pending.resolve({ users: [alice], error: '' }));
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });

    it('lists the people with links to their profiles', async () => {
      searchProfiles.mockResolvedValue({ users: [alice, bobby], error: '' });
      renderPage();

      await typeAndWait('b');
      await typeAndWait('o');

      const list = await screen.findByRole('list', { name: 'Search results' });
      expect(list).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Alice Smith/ })).toHaveAttribute('href', '/profile/alice');
      expect(screen.getByRole('link', { name: /Bobby/ })).toHaveAttribute('href', '/profile/bobby');
    });

    it('shows the display name, @username and bio of each person', async () => {
      renderPage();

      await typeAndWait('ali');

      expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('@alice · I like cats')).toBeInTheDocument();
    });

    it('shows only @username when there is no bio', async () => {
      searchProfiles.mockResolvedValue({ users: [bobby], error: '' });
      renderPage();

      await typeAndWait('bob');

      expect(await screen.findByText('@bobby')).toBeInTheDocument();
    });

    it('falls back to @username as the name, and shows the bio, when there is no display name', async () => {
      searchProfiles.mockResolvedValue({ users: [noName], error: '' });
      renderPage();

      await typeAndWait('car');

      expect(await screen.findByText('@carol')).toBeInTheDocument();
      expect(screen.getByText('Only a bio')).toBeInTheDocument();
    });

    it('shows each person\'s picture, or their first letter', async () => {
      searchProfiles.mockResolvedValue({ users: [alice, bobby], error: '' });
      renderPage();

      await typeAndWait('bo');

      expect(await screen.findByRole('img', { name: "bobby's avatar" })).toHaveAttribute(
        'src',
        'http://storage.test/b/me.png'
      );
      expect(screen.getByText('A')).toBeInTheDocument();
    });

    it('opens a profile when a person is clicked', async () => {
      renderPage();
      await typeAndWait('ali');

      await user.click(await screen.findByRole('link', { name: /Alice Smith/ }));

      expect(await screen.findByText('A profile page')).toBeInTheDocument();
    });

    it('says so when nobody is found', async () => {
      searchProfiles.mockResolvedValue({ users: [], error: '' });
      renderPage();

      await typeAndWait('xyz');

      expect(await screen.findByText('No users found for "xyz".')).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('shows an error message when the search fails', async () => {
      searchProfiles.mockResolvedValue({ users: [], error: 'network down' });
      renderPage();

      await typeAndWait('ali');

      expect(await screen.findByText('Could not search: network down')).toBeInTheDocument();
      expect(screen.queryByText(/No users found/)).not.toBeInTheDocument();
    });

    it('searches again when the text changes', async () => {
      renderPage();
      await typeAndWait('ali');
      await screen.findByText('Alice Smith');

      searchProfiles.mockResolvedValue({ users: [bobby], error: '' });
      await typeAndWait('ce'); // "alice"

      expect(searchProfiles).toHaveBeenLastCalledWith('alice');
      expect(await screen.findByText('Bobby')).toBeInTheDocument();
      expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    });

    it('hides the old results as soon as the text becomes too short', async () => {
      renderPage();
      await typeAndWait('al');
      await screen.findByText('Alice Smith');

      await user.type(box(), '{Backspace}');

      expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
      expect(screen.getByText(/type at least 2 characters/i)).toBeInTheDocument();
    });

    it('does not show the old results while the new ones are on their way', async () => {
      renderPage();
      await typeAndWait('ali');
      await screen.findByText('Alice Smith');

      searchProfiles.mockReturnValue(deferred().promise); // never answers
      await user.type(box(), 'c');

      expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });

    it('ignores an old slow answer that arrives after a newer one', async () => {
      const slow = deferred();
      searchProfiles
        .mockReturnValueOnce(slow.promise)
        .mockResolvedValueOnce({ users: [bobby], error: '' });
      renderPage();

      await typeAndWait('al'); // the first search starts and stays open
      await typeAndWait('i'); // "ali": the second search starts and finishes
      expect(await screen.findByText('Bobby')).toBeInTheDocument();

      await act(async () => slow.resolve({ users: [alice], error: '' })); // the old answer arrives late

      expect(screen.getByText('Bobby')).toBeInTheDocument();
      expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    });
  });

  describe('the address', () => {
    it('puts the text into the address while typing', async () => {
      renderPage();

      await user.type(box(), 'ali');

      expect(address()).toBe('/search?q=ali');
    });

    it('does not add a history entry for every letter (the address is replaced)', async () => {
      renderPage();

      await user.type(box(), 'alice');

      // REPLACE: the back button goes to the page before the search, not letter by letter
      expect(address()).toBe('/search?q=alice');
      expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
    });

    it('removes the text from the address when the box is emptied', async () => {
      renderPage();
      await user.type(box(), 'ali');

      await user.clear(box());

      expect(address()).toBe('/search');
    });

    it('stores the trimmed text in the address', async () => {
      renderPage();

      await user.type(box(), '  ali  ');

      expect(address()).toBe('/search?q=ali');
    });

    it('starts from the address: fills the box and searches', async () => {
      renderPage('/search?q=ali');

      expect(box()).toHaveValue('ali');
      await act(async () => vi.advanceTimersByTime(350));

      expect(searchProfiles).toHaveBeenCalledWith('ali');
      expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
    });

    it('shows the hint, and does not search, for a too short text in the address', async () => {
      renderPage('/search?q=a');

      expect(box()).toHaveValue('a');
      await act(async () => vi.advanceTimersByTime(350));

      expect(searchProfiles).not.toHaveBeenCalled();
      expect(screen.getByText(/type at least 2 characters/i)).toBeInTheDocument();
    });
  });
});
