import { Avatar } from '@mui/material';
import { getAvatarUrl } from '../lib/avatars';

export default function UserAvatar({ username, avatarPath, size = 40 }) {
  return (
    <Avatar
      src={getAvatarUrl(avatarPath)}
      alt={`${username}'s avatar`}
      sx={{ width: size, height: size }}
    >
      {username?.[0]?.toUpperCase()}
    </Avatar>
  );
}