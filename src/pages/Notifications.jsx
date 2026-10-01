import { useEffect, useState, useCallback } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Paper, List, ListItem, ListItemButton, ListItemText, Typography } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

const MESSAGES = {
  like: 'liked your post',
  comment: 'commented on your post',
  follow: 'started following you',
};

function destinationOf(notification) {
  return notification.post_id
    ? `/post/${notification.post_id}`
    : `/profile/${notification.actor.username}`;
}

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
          <ListItem
            key={n.id}
            disablePadding
            divider
            sx={{ bgcolor: n.read ? 'transparent' : 'action.hover' }}
          >
            <ListItemButton component={RouterLink} to={destinationOf(n)}>
              <ListItemText
                primary={
                  <>
                    <b>@{n.actor.username}</b> {MESSAGES[n.type]}
                  </>
                }
                secondary={new Date(n.created_at).toLocaleString()}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
