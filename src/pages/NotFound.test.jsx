import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import NotFound from './NotFound';
import { renderWithProviders } from '../test/renderWithProviders';

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<div>Feed page</div>} />
      <Route path="*" element={<NotFound />} />
    </Routes>,
    { route: '/nothing-here' }
  );
}

describe('NotFound', () => {
  it('tells the user that the page does not exist', () => {
    renderPage();

    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText(/address you opened does not exist/i)).toBeInTheDocument();
  });

  it('links back to the feed', async () => {
    renderPage();

    const link = screen.getByRole('link', { name: 'Back to the feed' });
    expect(link).toHaveAttribute('href', '/');

    await userEvent.click(link);
    expect(await screen.findByText('Feed page')).toBeInTheDocument();
  });
});
