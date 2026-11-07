import { useEffect, useState, useCallback, useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Paper, List, ListItem, ListItemButton, ListItemText, Typography, Box, Button } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import TimeAgo from '../components/TimeAgo';
import PageTitle from '../components/PageTitle';

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

const PAGE_SIZE = 20;

// Newest first. beforeId: the page below that notification. afterId: everything that came after it
async function fetchNotifications(userId, { beforeId, afterId } = {}) {
  let query = supabase
    .from('notifications')
    .select('*, actor:profiles!notifications_actor_id_fkey(username)')
    .eq('user_id', userId)
    .order('id', { ascending: false });

  if (afterId) query = query.gt('id', afterId);
  else if (beforeId) query = query.lt('id', beforeId).limit(PAGE_SIZE);
  else query = query.limit(PAGE_SIZE);

  const { data, error } = await query;
  return { data: data ?? [], error };
}

export default function Notifications() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [items, setItems] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const userId = user.id;

  // Lets the handlers see what is on the screen without subscribing again
  const itemsRef = useRef([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // New notifications go to the top
  const loadNewer = useCallback(async () => {
    const newest = itemsRef.current[0];
    const { data } = await fetchNotifications(userId, { afterId: newest?.id });
    setItems((prev) => {
      const seen = new Set(prev.map((n) => n.id));
      return [...data.filter((n) => !seen.has(n.id)), ...prev];
    });
  }, [userId]);

  async function loadMore() {
    const oldest = itemsRef.current.at(-1);
    if (!oldest) return;

    setLoadingMore(true);
    const { data, error } = await fetchNotifications(userId, { beforeId: oldest.id });
    setLoadingMore(false);

    if (error) {
      showToast(`Could not load more notifications: ${error.message}`);
      return;
    }
    setItems((prev) => {
      const seen = new Set(prev.map((n) => n.id));
      return [...prev, ...data.filter((n) => !seen.has(n.id))];
    });
    setHasMore(data.length === PAGE_SIZE);
  }

  useEffect(() => {
    let active = true;

    // Show the list (with unread highlight) first, then mark everything as read
    fetchNotifications(userId).then(async ({ data }) => {
      if (active) {
        setItems(data);
        setHasMore(data.length === PAGE_SIZE);
      }
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
        loadNewer
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId, loadNewer]);

  if (items.length === 0) {
    return (
      <>
        <PageTitle>Notifications</PageTitle>
        <Typography color="text.secondary" align="center">No notifications yet.</Typography>
      </>
    );
  }

  return (
    <>
      <PageTitle>Notifications</PageTitle>
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
                  secondary={<TimeAgo date={n.created_at} />}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Paper>
      {hasMore && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <Button onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </Box>
      )}
    </>
  );
}
