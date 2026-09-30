import { useEffect, useRef, useState, useCallback } from 'react';
import { CircularProgress, Typography, Box, Alert } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import PostCard from './PostCard';

async function fetchPosts({ authorId, followingOnly, userId }) {
  let query = supabase
    .from('posts_feed')
    .select('*')
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

// Fetches a single row from the feed view (used to refresh one post)
async function fetchPostById(id) {
  const { data, error } = await supabase
    .from('posts_feed')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) console.error('Post refresh failed:', error);
  return { data, error };
}

async function isFollowing(followerId, targetId) {
  const { data } = await supabase
    .from('follows')
    .select('follower_id')
    .match({ follower_id: followerId, following_id: targetId })
    .maybeSingle();
  return !!data;
}

export default function Feed({ authorId, followingOnly = false }) {
  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const userId = user.id;

  // Lets event handlers check which posts are on screen without re-subscribing
  const postsRef = useRef([]);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  const removePost = useCallback((postId) => {
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }, []);

  const refreshPost = useCallback(async (postId) => {
    // Ignore posts that are not in this feed
    if (!postsRef.current.some((p) => p.id === postId)) return;

    const { data, error } = await fetchPostById(postId);
    if (error) return;

    setPosts((prev) =>
      data ? prev.map((p) => (p.id === postId ? data : p)) : prev.filter((p) => p.id !== postId)
    );
  }, []);

  useEffect(() => {
    let active = true;

    fetchPosts({ authorId, followingOnly, userId }).then((result) => {
      if (!active) return;
      if (result.data) setPosts(result.data);
      setError(result.error?.message ?? '');
      setLoading(false);
    });

    async function handleNewPost(row) {
      if (authorId && row.user_id !== authorId) return;
      if (followingOnly && !(await isFollowing(userId, row.user_id))) return;

      const { data } = await fetchPostById(row.id);
      if (!active || !data) return;

      // Skip if the post is already in the list
      setPosts((prev) => (prev.some((p) => p.id === data.id) ? prev : [data, ...prev]));
    }

    const channel = supabase
      .channel(`feed-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'posts' },
        (payload) => handleNewPost(payload.new)
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'posts' },
        (payload) => removePost(payload.old.id)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'likes' },
        (payload) => refreshPost(payload.new.post_id ?? payload.old.post_id)
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments' },
        (payload) => refreshPost(payload.new.post_id)
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [authorId, followingOnly, userId, refreshPost, removePost]);

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>;
  }

  if (error) {
    return <Alert severity="error">Could not load posts: {error}</Alert>;
  }

  if (posts.length === 0) {
    return <Typography color="text.secondary" align="center">No posts yet.</Typography>;
  }

  return posts.map((post) => (
    <PostCard key={post.id} post={post} onChange={refreshPost} onDelete={removePost} />
  ));
}