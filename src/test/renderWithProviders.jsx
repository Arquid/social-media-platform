import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { AuthContext } from '../context/authContextObject';
import { ToastProvider } from '../context/ToastContext';
import { theme } from '../theme';

export const TEST_USER = { id: 'me-1', email: 'me@example.test' };

// Renders a component inside the router, toast and auth providers.
// Pass user: null to simulate a logged-out visitor.
// Pass withTheme: true to use the real light/dark theme (needed by the theme toggle).
export function renderWithProviders(
  ui,
  { user = TEST_USER, loading = false, route = '/', withTheme = false } = {}
) {
  const auth = {
    session: user ? { user } : null,
    user,
    loading,
    signOut: () => {},
  };

  const page = (
    <ToastProvider>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthContext.Provider>
    </ToastProvider>
  );

  return render(
    withTheme ? (
      <ThemeProvider theme={theme} defaultMode="system" noSsr>
        {page}
      </ThemeProvider>
    ) : (
      page
    )
  );
}
