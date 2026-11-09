import { useEffect, useState, useCallback, useRef } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, TextField, Button, Typography, Link, Stack, IconButton } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { supabase } from '../lib/supabaseClient';
import { isRateLimited } from '../lib/errors';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

const PAGE_SIZE = 20;

// Newest first. beforeId: the page below that comment. afterId: everything that came after it
async function fetchComments(postId, { beforeId, afterId } = {}) {
  let query = supabase
    .from('comments')
    .select('*, profiles!comments_user_id_fkey(username)')
    .eq('post_id', postId)
    .order('id', { ascending: false });

  if (afterId) query = query.gt('id', afterId);
  else if (beforeId) query = query.lt('id', beforeId).limit(PAGE_SIZE);
  else query = query.limit(PAGE_SIZE);

  const { data, error } = await query;
  return { data: data ?? [], error };
}

export default function CommentSection({ postId, onChange }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [comments, setComments] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState('');

  // Lets the handlers see what is on the screen without subscribing again
  const commentsRef = useRef([]);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  // New comments (yours or somebody else's) go to the top
  const loadNewer = useCallback(async () => {
    const newest = commentsRef.current[0];
    const { data } = await fetchComments(postId, { afterId: newest?.id });
    setComments((prev) => {
      const seen = new Set(prev.map((c) => c.id));
      return [...data.filter((c) => !seen.has(c.id)), ...prev];
    });
  }, [postId]);

  async function loadMore() {
    const oldest = commentsRef.current.at(-1);
    if (!oldest) return;

    setLoadingMore(true);
    const { data, error } = await fetchComments(postId, { beforeId: oldest.id });
    setLoadingMore(false);

    if (error) {
      showToast(`Could not load more comments: ${error.message}`);
      return;
    }
    setComments((prev) => {
      const seen = new Set(prev.map((c) => c.id));
      return [...prev, ...data.filter((c) => !seen.has(c.id))];
    });
    setHasMore(data.length === PAGE_SIZE);
  }

  useEffect(() => {
    let active = true;

    fetchComments(postId).then(({ data }) => {
      if (!active) return;
      setComments(data);
      setHasMore(data.length === PAGE_SIZE);
    });

    const channel = supabase
      .channel(`comments-${postId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` },
        loadNewer
      )
      // A deleted comment: the event has only its id (and cannot be filtered by post), so ignore
      // the ones that are not on the screen. Deleting is rare, so this is few messages.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'comments' }, (payload) => {
        const id = payload.old.id;
        setComments((prev) => (prev.some((c) => c.id === id) ? prev.filter((c) => c.id !== id) : prev));
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [postId, loadNewer]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;

    const { error } = await supabase
      .from('comments')
      .insert({ post_id: postId, user_id: user.id, content: text.trim() });

    if (error) {
      if (isRateLimited(error)) showToast(error.message, 'warning');
      else showToast(`Could not add comment: ${error.message}`);
      return;
    }

    setText('');
    loadNewer();
  }

  async function handleDelete(commentId) {
    const { error } = await supabase.from('comments').delete().eq('id', commentId);

    if (error) {
      showToast(`Could not delete comment: ${error.message}`);
      return;
    }

    setComments((prev) => prev.filter((c) => c.id !== commentId));
    onChange?.(); // the post card counts its comments again
  }

  return (
    <Box sx={{ mt: 1 }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Write a comment..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 300, 'aria-label': 'Write a comment' } }}
        />
        <Button type="submit" disabled={!text.trim()}>Send</Button>
      </form>
      <Stack spacing={1}>
        {comments.map((c) => (
          <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
              <Link component={RouterLink} to={`/profile/${c.profiles.username}`} underline="always" fontWeight={600}>
                @{c.profiles.username}
              </Link>{' '}
              {c.content}
            </Typography>
            {c.user_id === user.id && (
              <IconButton size="small" aria-label="Delete comment" onClick={() => handleDelete(c.id)}>
                <DeleteOutlineIcon fontSize="inherit" />
              </IconButton>
            )}
          </Box>
        ))}
      </Stack>
      {hasMore && (
        <Button size="small" onClick={loadMore} disabled={loadingMore} sx={{ mt: 1 }}>
          {loadingMore ? 'Loading...' : 'Load more comments'}
        </Button>
      )}
    </Box>
  );
}