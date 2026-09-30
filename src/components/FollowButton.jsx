import { useEffect, useState } from 'react';
import { Button } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

async function fetchIsFollowing(followerId, targetId) {
  const { data } = await supabase
    .from('follows')
    .select('follower_id')
    .match({ follower_id: followerId, following_id: targetId })
    .maybeSingle();
  return !!data;
}

export default function FollowButton({ targetId, onChange }) {
  const { user } = useAuth();
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    let active = true;
    fetchIsFollowing(user.id, targetId).then((value) => {
      if (active) setFollowing(value);
    });
    return () => {
      active = false;
    };
  }, [user.id, targetId]);

  async function toggle() {
    if (following) {
      await supabase.from('follows').delete().match({ follower_id: user.id, following_id: targetId });
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: targetId });
    }
    setFollowing(!following);
    onChange?.();
  }

  return (
    <Button variant={following ? 'outlined' : 'contained'} onClick={toggle}>
      {following ? 'Unfollow' : 'Follow'}
    </Button>
  );
}
