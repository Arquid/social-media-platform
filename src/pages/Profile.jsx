import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Paper, Typography, Box, Stack, CircularProgress, Button } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import FollowButton from '../components/FollowButton';
import Feed from '../components/Feed';
import UserAvatar from '../components/UserAvatar';
import EditProfileDialog from '../components/EditProfileDialog';

async function fetchProfile(username) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .maybeSingle();

  if (!profile) return null;

  const [followers, following] = await Promise.all([
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', profile.id),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', profile.id),
  ]);

  return {
    profile,
    counts: { followers: followers.count ?? 0, following: following.count ?? 0 },
  };
}

function ProfileView({ username }) {
  const { user } = useAuth();
  const [result, setResult] = useState(undefined);
  const [editing, setEditing] = useState(false);

  const reload = useCallback(async () => {
    setResult(await fetchProfile(username));
  }, [username]);

  useEffect(() => {
    let active = true;
    fetchProfile(username).then((data) => {
      if (active) setResult(data);
    });
    return () => {
      active = false;
    };
  }, [username]);

  if (result === undefined) {
    return <Box sx={{ display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;
  }

  if (result === null) return <Typography>User not found.</Typography>;

  const { profile, counts } = result;
  const isOwnProfile = profile.id === user.id;

  return (
    <>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <UserAvatar username={profile.username} avatarPath={profile.avatar_path} size={72} />

          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h5" fontWeight={700} noWrap>
              {profile.display_name || `@${profile.username}`}
            </Typography>
            {profile.display_name && (
              <Typography variant="body2" color="text.secondary">@{profile.username}</Typography>
            )}
            {profile.bio && (
              <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{profile.bio}</Typography>
            )}
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2"><b>{counts.followers}</b> followers</Typography>
              <Typography variant="body2"><b>{counts.following}</b> following</Typography>
            </Stack>
          </Box>

          {isOwnProfile ? (
            <Button variant="outlined" onClick={() => setEditing(true)}>Edit profile</Button>
          ) : (
            <FollowButton targetId={profile.id} onChange={reload} />
          )}
        </Box>
      </Paper>

      {editing && (
        <EditProfileDialog
          profile={profile}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}

      <Feed authorId={profile.id} />
    </>
  );
}

export default function Profile() {
  const { username } = useParams();
  // key resets all state when navigating between profiles
  return <ProfileView key={username} username={username} />;
}
