import { useEffect, useRef, useState, useCallback } from 'react';
import { CircularProgress, Typography, Box, Alert, Button } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import PostCard from './PostCard';

const PAGE_SIZE = 20;

async function fetchFollowingIds(userId) {
  const { data } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId);
  return (data ?? []).map((f) => f.following_id);
}

// Fetches one page of posts. beforeId is the cursor: only posts older than it are returned.
async function fetchPosts({ authorId, followingIds, beforeId }) {
  if (followingIds && followingIds.length === 0) return { data: [] };

  let query = supabase
    .from('posts_feed')
    .select('*')
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);

  if (authorId) query = query.eq('user_id', authorId);
  if (followingIds) query = query.in('user_id', followingIds);
  if (beforeId) query = query.lt('id', beforeId);

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
  const { showToast } = useToast();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');

  const userId = user.id;

  // Lets event handlers check which posts are on screen without re-subscribing
  const postsRef = useRef([]);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  // Remembers who the user follows so "Load more" does not need to fetch it again
  const followingIdsRef = useRef(null);

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

  async function loadMore() {
    const last = postsRef.current[postsRef.current.length - 1];
    if (!last) return;

    setLoadingMore(true);
    const result = await fetchPosts({
      authorId,
      followingIds: followingIdsRef.current,
      beforeId: last.id,
    });
    setLoadingMore(false);

    if (result.error) {
      showToast(`Could not load more posts: ${result.error.message}`);
      return;
    }

    // Skip posts that are already in the list (e.g. added by realtime)
    setPosts((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...result.data.filter((p) => !seen.has(p.id))];
    });
    setHasMore(result.data.length === PAGE_SIZE);
  }

  useEffect(() => {
    let active = true;

    async function loadFirstPage() {
      const followingIds = followingOnly ? await fetchFollowingIds(userId) : null;
      followingIdsRef.current = followingIds;
      return fetchPosts({ authorId, followingIds });
    }

    loadFirstPage().then((result) => {
      if (!active) return;
      if (result.data) {
        setPosts(result.data);
        setHasMore(result.data.length === PAGE_SIZE);
      }
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

  return (
    <>
      {posts.map((post) => (
        <PostCard key={post.id} post={post} onChange={refreshPost} onDelete={removePost} />
      ))}

      {hasMore && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
          <Button onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </Box>
      )}
    </>
  );
}