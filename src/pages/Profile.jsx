import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Paper, Typography, Box, Stack, CircularProgress } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import FollowButton from '../components/FollowButton';
import Feed from '../components/Feed';

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
  const [result, setResult] = useState(undefined); // undefined = loading, null = not found

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

  return (
    <>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h5" fontWeight={700}>@{profile.username}</Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2"><b>{counts.followers}</b> followers</Typography>
              <Typography variant="body2"><b>{counts.following}</b> following</Typography>
            </Stack>
          </Box>
          {profile.id !== user.id && <FollowButton targetId={profile.id} onChange={reload} />}
        </Box>
      </Paper>

      <Feed authorId={profile.id} />
    </>
  );
}

export default function Profile() {
  const { username } = useParams();
  // key resets all state when navigating between profiles
  return <ProfileView key={username} username={username} />;
}
