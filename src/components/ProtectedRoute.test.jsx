import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import { renderWithProviders } from '../test/renderWithProviders';

function renderApp(options) {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<div>Login page</div>} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <div>Secret content</div>
          </ProtectedRoute>
        }
      />
    </Routes>,
    options
  );
}

describe('ProtectedRoute', () => {
  it('shows the protected content to a logged-in user', () => {
    renderApp();
    expect(screen.getByText('Secret content')).toBeInTheDocument();
  });

  it('redirects a visitor to the login page', () => {
    renderApp({ user: null });
    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });

  it('shows a spinner and no content while auth is loading', () => {
    renderApp({ user: null, loading: true });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });
});
