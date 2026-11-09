import { useState, useOptimistic, useTransition } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Card, CardContent, CardActions, Typography, IconButton, Link, Collapse, Box, TextField, Button,
} from '@mui/material';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import CommentSection from './CommentSection';
import UserAvatar from './UserAvatar';
import TimeAgo from './TimeAgo';

const MAX_POST_LENGTH = 500;

export default function PostCard({ post, onChange, onDelete, defaultShowComments = false }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [showComments, setShowComments] = useState(defaultShowComments);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [shownPost, setShownLiked] = useOptimistic(post, (current, nextLiked) => {
    // The fresh post can arrive while the request is still being finished. If it already
    // contains the change, do not count it twice (the number would flash one too high).
    if (current.liked_by_me === nextLiked) return current;

    return {
      ...current,
      liked_by_me: nextLiked,
      like_count: current.like_count + (nextLiked ? 1 : -1),
    };
  });

  const liked = shownPost.liked_by_me;
  const likeCount = shownPost.like_count;
  const commentCount = post.comment_count;
  const isOwner = post.user_id === user.id;

  function toggleLike() {
    if (isPending) return;

    startTransition(async () => {
      const nextLiked = !liked;
      setShownLiked(nextLiked);

      const { error } = nextLiked
        ? await supabase.from('likes').insert({ post_id: post.id, user_id: user.id })
        : await supabase.from('likes').delete().match({ post_id: post.id, user_id: user.id });

      if (error) {
        showToast(`Could not update like: ${error.message}`);
        return;
      }

      await onChange?.(post.id);
    });
  }

  async function handleDelete() {
    const { error } = await supabase.from('posts').delete().eq('id', post.id);

    if (error) {
      showToast(`Could not delete post: ${error.message}`);
      return;
    }
    onDelete?.(post.id);
  }

  function startEditing() {
    setDraft(post.content);
    setEditing(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;

    // Nothing changed: close without bothering the database (and without marking it "edited")
    if (text === post.content) {
      setEditing(false);
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('posts').update({ content: text }).eq('id', post.id);
    setSaving(false);

    if (error) {
      showToast(`Could not save the post: ${error.message}`);
      return;
    }

    setEditing(false);
    await onChange?.(post.id); // loads the post again: new text and the "edited" mark
  }

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <UserAvatar username={post.username} avatarPath={post.avatar_path} size={36} />
          <Link component={RouterLink} to={`/profile/${post.username}`} underline="hover" fontWeight={700}>
            @{post.username}
          </Link>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            <TimeAgo date={post.created_at} />
            {post.edited_at && (
              <span title={`Edited ${new Date(post.edited_at).toLocaleString()}`}> · edited</span>
            )}
          </Typography>
        </Box>

        {editing ? (
          <form onSubmit={handleSave}>
            <TextField
              autoFocus
              fullWidth
              multiline
              minRows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={saving}
              sx={{ mt: 1 }}
              slotProps={{ htmlInput: { maxLength: MAX_POST_LENGTH, 'aria-label': 'Edit post text' } }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
              <Button onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
              <Button type="submit" variant="contained" disabled={saving || !draft.trim()}>Save</Button>
            </Box>
          </form>
        ) : (
          <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{post.content}</Typography>
        )}
      </CardContent>

      <CardActions>
        <IconButton
          onClick={toggleLike}
          color={liked ? 'error' : 'default'}
          aria-label={liked ? 'Unlike post' : 'Like post'}
          aria-pressed={liked}
        >
          {liked ? <FavoriteIcon /> : <FavoriteBorderIcon />}
        </IconButton>
        <Typography variant="body2">{likeCount}</Typography>

        <IconButton
          onClick={() => setShowComments((v) => !v)}
          aria-label={showComments ? 'Hide comments' : 'Show comments'}
          aria-expanded={showComments}
        >
          <ChatBubbleOutlineIcon />
        </IconButton>
        <Typography variant="body2">{commentCount}</Typography>

        {isOwner && (
          <Box sx={{ ml: 'auto' }}>
            {!editing && (
              <IconButton onClick={startEditing} aria-label="Edit post">
                <EditOutlinedIcon />
              </IconButton>
            )}
            <IconButton onClick={handleDelete} aria-label="Delete post">
              <DeleteOutlineIcon />
            </IconButton>
          </Box>
        )}
      </CardActions>

      <Collapse in={showComments} unmountOnExit>
        <Box sx={{ px: 2, pb: 2 }}>
          <CommentSection postId={post.id} onChange={() => onChange?.(post.id)} />
        </Box>
      </Collapse>
    </Card>
  );
}