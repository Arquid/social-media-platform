import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Card, CardContent, CardActions, Typography, IconButton, Link, Collapse, Box } from '@mui/material';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import CommentSection from './CommentSection';

export default function PostCard({ post, onChange }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [showComments, setShowComments] = useState(false);

  const liked = post.liked_by_me;
  const likeCount = post.like_count;
  const commentCount = post.comment_count;
  const isOwner = post.user_id === user.id;

  async function toggleLike() {
    const { error } = liked
      ? await supabase.from('likes').delete().match({ post_id: post.id, user_id: user.id })
      : await supabase.from('likes').insert({ post_id: post.id, user_id: user.id });

    if (error) {
      showToast(`Could not update like: ${error.message}`);
      return;
    }
    onChange?.();
  }

  async function handleDelete() {
    const { error } = await supabase.from('posts').delete().eq('id', post.id);

    if (error) {
      showToast(`Could not delete post: ${error.message}`);
      return;
    }
    onChange?.();
  }

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Link component={RouterLink} to={`/profile/${post.username}`} underline="hover" fontWeight={700}>
            @{post.username}
          </Link>
          <Typography variant="caption" color="text.secondary">
            {new Date(post.created_at).toLocaleString()}
          </Typography>
        </Box>
        <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{post.content}</Typography>
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
          <IconButton onClick={handleDelete} sx={{ ml: 'auto' }} aria-label="Delete post">
            <DeleteOutlineIcon />
          </IconButton>
        )}
      </CardActions>

      <Collapse in={showComments} unmountOnExit>
        <Box sx={{ px: 2, pb: 2 }}>
          <CommentSection postId={post.id} />
        </Box>
      </Collapse>
    </Card>
  );
}
