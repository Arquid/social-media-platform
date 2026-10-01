import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import UserAvatar from './UserAvatar';

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path) => ({ data: { publicUrl: `http://storage.test/avatars/${path}` } }),
      }),
    },
  },
}));

describe('UserAvatar', () => {
  it('shows the first letter of the username in capitals when there is no picture', () => {
    render(<UserAvatar username="alice" />);

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows the picture from storage when the user has one', () => {
    render(<UserAvatar username="alice" avatarPath="u1/photo.png" />);

    const image = screen.getByRole('img', { name: "alice's avatar" });
    expect(image).toHaveAttribute('src', 'http://storage.test/avatars/u1/photo.png');
  });

  it('uses the given size', () => {
    const { container } = render(<UserAvatar username="alice" size={72} />);

    expect(container.firstChild).toHaveStyle({ width: '72px', height: '72px' });
  });
});
