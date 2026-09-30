import { useEffect, useState, useCallback } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Paper, List, ListItem, ListItemText, Typography, Link } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

const MESSAGES = {
  like: 'liked your post',
  comment: 'commented on your post',
  follow: 'started following you',
};

async function fetchNotifications(userId) {
  const { data } = await supabase
    .from('notifications')
    .select('*, actor:profiles!notifications_actor_id_fkey(username)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  return data ?? [];
}

export default function Notifications() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);

  const userId = user.id;

  const load = useCallback(async () => {
    setItems(await fetchNotifications(userId));
  }, [userId]);

  useEffect(() => {
    let active = true;

    // Show the list (with unread highlight) first, then mark everything as read
    fetchNotifications(userId).then(async (data) => {
      if (active) setItems(data);
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false);
    });

    const channel = supabase
      .channel(`notifications-page-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        load
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  if (items.length === 0) {
    return <Typography color="text.secondary" align="center">No notifications yet.</Typography>;
  }

  return (
    <Paper>
      <List>
        {items.map((n) => (
          <ListItem key={n.id} divider sx={{ bgcolor: n.read ? 'transparent' : 'action.hover' }}>
            <ListItemText
              primary={
                <>
                  <Link component={RouterLink} to={`/profile/${n.actor.username}`} underline="hover" fontWeight={700}>
                    @{n.actor.username}
                  </Link>{' '}
                  {MESSAGES[n.type]}
                </>
              }
              secondary={new Date(n.created_at).toLocaleString()}
            />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
