import { useEffect, useState, useCallback } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { AppBar, Toolbar, Typography, IconButton, Badge, Button, Box } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';

async function fetchUnreadCount(userId) {
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  return count ?? 0;
}

async function fetchUsername(userId) {
  const { data } = await supabase.from('profiles').select('username').eq('id', userId).single();
  return data?.username ?? '';
}

export default function Navbar() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [username, setUsername] = useState('');

  const userId = user?.id;

  const refreshUnread = useCallback(async () => {
    if (userId) setUnread(await fetchUnreadCount(userId));
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    fetchUnreadCount(userId).then((n) => {
      if (active) setUnread(n);
    });
    fetchUsername(userId).then((name) => {
      if (active) setUsername(name);
    });

    const channel = supabase
      .channel(`navbar-notifications-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        refreshUnread
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId, refreshUnread]);

  async function handleLogout() {
    await signOut();
    navigate('/login');
  }

  return (
    <AppBar position="sticky" color="inherit" elevation={1}>
      <Toolbar sx={{ maxWidth: 600, width: '100%', mx: 'auto' }}>
        <Typography
          variant="h6"
          component={RouterLink}
          to="/"
          sx={{ flexGrow: 1, textDecoration: 'none', color: 'primary.main', fontWeight: 700 }}
        >
          Socialy
        </Typography>

        {user ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {username && (
              <Button component={RouterLink} to={`/profile/${username}`}>Profile</Button>
            )}
            <IconButton component={RouterLink} to="/notifications">
              <Badge badgeContent={unread} color="error">
                <NotificationsIcon />
              </Badge>
            </IconButton>
            <Button onClick={handleLogout}>Log out</Button>
          </Box>
        ) : (
          <Button component={RouterLink} to="/login">Log in</Button>
        )}
      </Toolbar>
    </AppBar>
  );
}
