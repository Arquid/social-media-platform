import { useState } from 'react';
import { Paper, TextField, Button, Box, Alert } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { isRateLimited } from '../lib/errors';
import { useAuth } from '../hooks/useAuth';

export default function PostForm({ onPosted }) {
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [rateLimited, setRateLimited] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!content.trim()) return;

    setSubmitting(true);
    const { error } = await supabase
      .from('posts')
      .insert({ user_id: user.id, content: content.trim() });
    setSubmitting(false);

    if (error) {
      if (!isRateLimited(error)) console.error('Post insert failed:', error);
      setRateLimited(isRateLimited(error));
      setError(error.message);
      return;
    }

    setRateLimited(false);
    setError('');
    setContent('');
    onPosted?.();
  }

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <form onSubmit={handleSubmit}>
        {error && <Alert severity={rateLimited ? 'warning' : 'error'} sx={{ mb: 1 }}>{error}</Alert>}
        <TextField
          fullWidth
          multiline
          minRows={2}
          placeholder="What's on your mind?"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <Button type="submit" variant="contained" disabled={submitting || !content.trim()}>
            Post
          </Button>
        </Box>
      </form>
    </Paper>
  );
}
