import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { Box, CircularProgress, Typography, Button, Alert, Stack } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import PostCard from '../components/PostCard';

async function fetchPost(id) {
  const { data, error } = await supabase
    .from('posts_feed')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) console.error('Post query failed:', error);
  return { data, error };
}

function NotFound() {
  return (
    <Stack spacing={2} sx={{ mt: 4, alignItems: 'center' }}>
      <Typography>This post does not exist or has been deleted.</Typography>
      <Button component={RouterLink} to="/" variant="outlined">Back to the feed</Button>
    </Stack>
  );
}

function PostView({ id }) {
  const navigate = useNavigate();
  const [result, setResult] = useState(undefined);
  const reload = useCallback(async () => {
    setResult(await fetchPost(id));
  }, [id]);

  useEffect(() => {
    let active = true;
    const postId = Number(id);

    fetchPost(id).then((fetched) => {
      if (active) setResult(fetched);
    });

    async function refresh() {
      const fetched = await fetchPost(id);
      if (active) setResult(fetched);
    }

    const channel = supabase
      .channel(`post-${id}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'likes' },
        (payload) => {
          if ((payload.new.post_id ?? payload.old.post_id) === postId) refresh();
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments' },
        (payload) => {
          if (payload.new.post_id === postId) refresh();
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'posts' },
        (payload) => {
          if (payload.old.id === postId) setResult({ data: null, error: null });
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [id]);

  if (result === undefined) {
    return <Box sx={{ display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;
  }

  if (result.error) {
    return <Alert severity="error">Could not load the post: {result.error.message}</Alert>;
  }

  if (!result.data) return <NotFound />;

  return (
    <PostCard
      post={result.data}
      onChange={reload}
      onDelete={() => navigate('/', { replace: true })}
      defaultShowComments
    />
  );
}

export default function PostPage() {
  const { id } = useParams();

  if (!/^\d+$/.test(id)) return <NotFound />;

  return <PostView key={id} id={id} />;
}