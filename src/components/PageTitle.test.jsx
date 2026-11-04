import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PageTitle from './PageTitle';

describe('PageTitle', () => {
  it('is a first level heading with the given text', () => {
    render(<PageTitle>Notifications</PageTitle>);

    expect(screen.getByRole('heading', { level: 1, name: 'Notifications' })).toBeInTheDocument();
  });

  it('is not drawn on the screen: it is clipped to a one pixel box', () => {
    render(<PageTitle>Home</PageTitle>);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveStyle({ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden' });
  });
});
