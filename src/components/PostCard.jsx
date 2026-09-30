import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Card, CardContent, CardActions, Typography, IconButton, Link, Collapse, Box } from '@mui/material';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import CommentSection from './CommentSection';

export default function PostCard({ post, onChange }) {
  const { user } = useAuth();
  const [showComments, setShowComments] = useState(false);

  const liked = post.likes.some((l) => l.user_id === user.id);
  const likeCount = post.likes.length;
  const commentCount = post.comments?.[0]?.count ?? 0;
  const isOwner = post.user_id === user.id;

  async function toggleLike() {
    if (liked) {
      await supabase.from('likes').delete().match({ post_id: post.id, user_id: user.id });
    } else {
      await supabase.from('likes').insert({ post_id: post.id, user_id: user.id });
    }
    onChange?.();
  }

  async function handleDelete() {
    await supabase.from('posts').delete().eq('id', post.id);
    onChange?.();
  }

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Link component={RouterLink} to={`/profile/${post.profiles.username}`} underline="hover" fontWeight={700}>
            @{post.profiles.username}
          </Link>
          <Typography variant="caption" color="text.secondary">
            {new Date(post.created_at).toLocaleString()}
          </Typography>
        </Box>
        <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{post.content}</Typography>
      </CardContent>

      <CardActions>
        <IconButton onClick={toggleLike} color={liked ? 'error' : 'default'}>
          {liked ? <FavoriteIcon /> : <FavoriteBorderIcon />}
        </IconButton>
        <Typography variant="body2">{likeCount}</Typography>

        <IconButton onClick={() => setShowComments((v) => !v)}>
          <ChatBubbleOutlineIcon />
        </IconButton>
        <Typography variant="body2">{commentCount}</Typography>

        {isOwner && (
          <IconButton onClick={handleDelete} sx={{ ml: 'auto' }}>
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
