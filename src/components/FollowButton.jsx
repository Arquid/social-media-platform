import { useEffect, useState } from 'react';
import { Button } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

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
  const { showToast } = useToast();
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
    const { error } = following
      ? await supabase.from('follows').delete().match({ follower_id: user.id, following_id: targetId })
      : await supabase.from('follows').insert({ follower_id: user.id, following_id: targetId });

    if (error) {
      showToast(`Could not ${following ? 'unfollow' : 'follow'} user: ${error.message}`);
      return;
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
