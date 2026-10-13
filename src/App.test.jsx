import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link } from 'react-router-dom';
import App from './App';
import { renderWithProviders } from './test/renderWithProviders';

// The real pages and navbar have their own tests. Here only the routing and the error
// handling around them are tested, so they are replaced by simple stand-ins.
vi.mock('./components/Navbar', () => ({
  default: () => (
    <nav>
      Navigation
      <Link to="/">go home</Link>
      <Link to="/notifications">go to notifications</Link>
    </nav>
  ),
}));
vi.mock('./pages/Home', () => ({ default: () => <div>Home page</div> }));
vi.mock('./pages/Login', () => ({ default: () => <div>Login page</div> }));
vi.mock('./pages/Register', () => ({ default: () => <div>Register page</div> }));
vi.mock('./pages/Profile', () => ({ default: () => <div>Profile page</div> }));
vi.mock('./pages/PostPage', () => ({ default: () => <div>Post page</div> }));

let notificationsBroken = false;
vi.mock('./pages/Notifications', () => ({
  default: () => {
    if (notificationsBroken) throw new Error('notifications crashed');
    return <div>Notifications page</div>;
  },
}));

describe('App routing', () => {
  beforeEach(() => {
    notificationsBroken = false;
  });

  it('shows the matching page for known addresses', async () => {
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });

  it('shows the 404 page for an unknown address instead of silently going to the feed', async () => {
    renderWithProviders(<App />, { route: '/does-not-exist' });

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByText('Home page')).not.toBeInTheDocument();
  });

  it('shows the 404 page for deep unknown addresses, and for near misses of real ones', async () => {
    const { unmount } = renderWithProviders(<App />, { route: '/some/deep/unknown/path' });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    unmount();

    renderWithProviders(<App />, { route: '/notification' }); // missing "s"
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('shows the 404 page to visitors who are not logged in too', async () => {
    renderWithProviders(<App />, { route: '/does-not-exist', user: null });

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('still sends visitors from protected pages to the login page', async () => {
    renderWithProviders(<App />, { route: '/notifications', user: null });
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('"Back to the feed" on the 404 page leads home', async () => {
    renderWithProviders(<App />, { route: '/does-not-exist' });

    await userEvent.click(await screen.findByRole('link', { name: 'Back to the feed' }));

    expect(await screen.findByText('Home page')).toBeInTheDocument();
  });
});

describe('App error handling', () => {
  let consoleError;

  beforeEach(() => {
    notificationsBroken = true;
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the error page when a page crashes, and keeps the navigation working', async () => {
    renderWithProviders(<App />, { route: '/notifications' });

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.queryByText('Notifications page')).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });

  it('recovers when the user moves to another page', async () => {
    renderWithProviders(<App />, { route: '/notifications' });
    await screen.findByRole('heading', { name: 'Something went wrong' });

    await userEvent.click(screen.getByRole('link', { name: 'go home' }));

    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the error page again when the user comes back to the broken page', async () => {
    renderWithProviders(<App />, { route: '/notifications' });
    await screen.findByRole('heading', { name: 'Something went wrong' });
    await userEvent.click(screen.getByRole('link', { name: 'go home' }));
    await screen.findByText('Home page');

    await userEvent.click(screen.getByRole('link', { name: 'go to notifications' }));

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
  });

  it('shows the page normally once it works again and "Try again" is pressed', async () => {
    renderWithProviders(<App />, { route: '/notifications' });
    await screen.findByRole('heading', { name: 'Something went wrong' });

    notificationsBroken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Notifications page')).toBeInTheDocument();
  });
});
