import { useEffect, useState, useCallback } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, TextField, Button, Typography, Link, Stack } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

async function fetchComments(postId) {
  const { data } = await supabase
    .from('comments')
    .select('*, profiles!comments_user_id_fkey(username)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  return data ?? [];
}

export default function CommentSection({ postId }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');

  const load = useCallback(async () => {
    setComments(await fetchComments(postId));
  }, [postId]);

  useEffect(() => {
    let active = true;

    fetchComments(postId).then((data) => {
      if (active) setComments(data);
    });

    const channel = supabase
      .channel(`comments-${postId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `post_id=eq.${postId}` },
        load
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [load, postId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;

    const { error } = await supabase
      .from('comments')
      .insert({ post_id: postId, user_id: user.id, content: text.trim() });

    if (error) {
      showToast(`Could not add comment: ${error.message}`);
      return;
    }

    setText('');
    load();
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Stack spacing={1} sx={{ mb: 1 }}>
        {comments.map((c) => (
          <Typography key={c.id} variant="body2">
            <Link component={RouterLink} to={`/profile/${c.profiles.username}`} underline="hover" fontWeight={600}>
              @{c.profiles.username}
            </Link>{' '}
            {c.content}
          </Typography>
        ))}
      </Stack>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Write a comment..."
          aria-label="Write a comment"
          value={text}
          onChange={(e) => setText(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 300 } }}
        />
        <Button type="submit" disabled={!text.trim()}>Send</Button>
      </form>
    </Box>
  );
}
