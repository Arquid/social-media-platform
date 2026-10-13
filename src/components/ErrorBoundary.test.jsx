import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from './ErrorBoundary';

// A child that crashes while the flag is on
let broken = true;
let thrown = new Error('kaboom');

function Bomb() {
  if (broken) throw thrown;
  return <div>All good</div>;
}

describe('ErrorBoundary', () => {
  let consoleError;

  beforeEach(() => {
    broken = true;
    thrown = new Error('kaboom');
    // React logs every caught error; keep the test output clean (and check our own log)
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its children when nothing is wrong', () => {
    broken = false;
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error page instead of crashing the whole screen', () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByText(/could not be shown/i)).toBeInTheDocument();
    expect(screen.queryByText('All good')).not.toBeInTheDocument();
  });

  it('does not show technical details to the user', () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    expect(screen.queryByText(/kaboom/)).not.toBeInTheDocument();
  });

  it('logs the error so it can be investigated', () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    const logged = consoleError.mock.calls.find(([message]) => message === 'Unhandled error in the interface:');
    expect(logged).toBeTruthy();
    expect(logged[1]).toBe(thrown);
    expect(logged[2]).toContain('Bomb'); // the component stack
  });

  it('offers "Try again" and "Go to the feed" for a normal error', () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the feed' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Reload page' })).not.toBeInTheDocument();
  });

  it('"Try again" shows the page again when the problem is gone', async () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('"Try again" shows the error page again when it is still broken', async () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('is cleared when the key changes (this is what moving to another page does)', () => {
    const { rerender } = render(<ErrorBoundary key="/notifications"><Bomb /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    broken = false;
    rerender(<ErrorBoundary key="/"><Bomb /></ErrorBoundary>);

    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('only replaces its own area, the rest of the page keeps working', () => {
    render(
      <div>
        <nav>Navigation</nav>
        <ErrorBoundary><Bomb /></ErrorBoundary>
      </div>
    );

    expect(screen.getByText('Navigation')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('an inner boundary stops the error from reaching the outer one', () => {
    render(
      <ErrorBoundary>
        <p>Outer content</p>
        <ErrorBoundary><Bomb /></ErrorBoundary>
      </ErrorBoundary>
    );

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText('Outer content')).toBeInTheDocument();
  });

  it('copes with something that is not an Error being thrown', () => {
    thrown = 'just a string';
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it.each([
    'Failed to fetch dynamically imported module: http://localhost/assets/Profile-abc.js',
    'Loading chunk 12 failed.',
    'Importing a module script failed.',
  ])('recognises an outdated app version from "%s" and asks for a reload', (message) => {
    thrown = new Error(message);
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);

    expect(screen.getByText(/new version of the app may have been published/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    // Trying again cannot help here, because React remembers the failed file
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the feed' })).toBeInTheDocument();
  });
});
