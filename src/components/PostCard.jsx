import { useState, useOptimistic, useTransition } from 'react';
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
import UserAvatar from './UserAvatar';
import TimeAgo from './TimeAgo';

export default function PostCard({ post, onChange, onDelete, defaultShowComments = false }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [showComments, setShowComments] = useState(defaultShowComments);
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
