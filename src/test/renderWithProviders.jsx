import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../context/authContextObject';
import { ToastProvider } from '../context/ToastContext';

export const TEST_USER = { id: 'me-1', email: 'me@example.test' };

// Renders a component inside the router, toast and auth providers.
// Pass user: null to simulate a logged-out visitor.
export function renderWithProviders(ui, { user = TEST_USER, loading = false, route = '/' } = {}) {
  const auth = {
    session: user ? { user } : null,
    user,
    loading,
    signOut: () => {},
  };

  return render(
    <ToastProvider>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthContext.Provider>
    </ToastProvider>
  );
}
