import { useEffect, useState, useCallback } from 'react';
import { CircularProgress, Typography, Box, Alert } from '@mui/material';
import { supabase, POST_SELECT } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import PostCard from './PostCard';

async function fetchPosts({ authorId, followingOnly, userId }) {
  let query = supabase
    .from('posts')
    .select(POST_SELECT)
    .order('created_at', { ascending: false })
    .limit(50);

  if (authorId) query = query.eq('user_id', authorId);

  if (followingOnly) {
    const { data: follows } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);
    const ids = (follows ?? []).map((f) => f.following_id);
    if (ids.length === 0) return { data: [] };
    query = query.in('user_id', ids);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Feed query failed:', error);
    return { error };
  }
  return { data };
}

export default function Feed({ authorId, followingOnly = false }) {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const userId = user.id;

  const load = useCallback(async () => {
    const result = await fetchPosts({ authorId, followingOnly, userId });
    if (result.data) setPosts(result.data);
    setError(result.error?.message ?? '');
  }, [authorId, followingOnly, userId]);

  useEffect(() => {
    let active = true;

    fetchPosts({ authorId, followingOnly, userId }).then((result) => {
      if (!active) return;
      if (result.data) setPosts(result.data);
      setError(result.error?.message ?? '');
      setLoading(false);
    });

    const channel = supabase
      .channel(`feed-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'likes' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, load)
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [authorId, followingOnly, userId, load]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;
  }

  if (error) {
    return <Alert severity="error">Could not load posts: {error}</Alert>;
  }

  if (posts.length === 0) {
    return <Typography color="text.secondary" align="center">No posts yet.</Typography>;
  }

  return posts.map((post) => <PostCard key={post.id} post={post} onChange={load} />);
}
