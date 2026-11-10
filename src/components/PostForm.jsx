import { useEffect, useState } from 'react';
import { Paper, TextField, Button, Box, Alert, IconButton } from '@mui/material';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { supabase } from '../lib/supabaseClient';
import { isRateLimited } from '../lib/errors';
import {
  POST_IMAGE_TYPES, validatePostImage, uploadPostImage, deletePostImage,
} from '../lib/postImages';
import { useAuth } from '../hooks/useAuth';

export default function PostForm({ onPosted }) {
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [image, setImage] = useState(null); // { file, previewUrl } for the chosen picture
  const [imageError, setImageError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [rateLimited, setRateLimited] = useState(false);

  // Frees the temporary address of the preview when the picture is replaced, removed or posted
  useEffect(() => {
    return () => {
      if (image) URL.revokeObjectURL(image.previewUrl);
    };
  }, [image]);

  function handleFileChange(e) {
    const chosen = e.target.files?.[0];
    e.target.value = ''; // lets the user pick the same file again later
    if (!chosen) return;

    const message = validatePostImage(chosen);
    setImageError(message);
    if (message) return;

    setImage({ file: chosen, previewUrl: URL.createObjectURL(chosen) });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!content.trim()) return;

    setSubmitting(true);

    // The picture goes first: the post has to know where it is
    let imagePath = null;
    if (image) {
      const uploaded = await uploadPostImage(user.id, image.file);
      if (uploaded.error) {
        setSubmitting(false);
        setRateLimited(false);
        setError(`Could not upload the picture: ${uploaded.error.message}`);
        return;
      }
      imagePath = uploaded.path;
    }

    const { data, error } = await supabase
      .from('posts')
      .insert({ user_id: user.id, content: content.trim(), image_path: imagePath })
      .select('id')
      .single();
    setSubmitting(false);

    if (error) {
      await deletePostImage(imagePath); // do not leave a file behind that no post uses
      if (!isRateLimited(error)) console.error('Post insert failed:', error);
      setRateLimited(isRateLimited(error));
      setError(error.message);
      return;
    }

    setRateLimited(false);
    setError('');
    setImageError('');
    setContent('');
    setImage(null);
    onPosted?.(data.id);
  }

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <form onSubmit={handleSubmit}>
        {error && <Alert severity={rateLimited ? 'warning' : 'error'} sx={{ mb: 1 }}>{error}</Alert>}
        {imageError && <Alert severity="error" sx={{ mb: 1 }}>{imageError}</Alert>}
        <TextField
          fullWidth
          multiline
          minRows={2}
          placeholder="What's on your mind?"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />

        {image && (
          <Box sx={{ position: 'relative', display: 'inline-block', mt: 1 }}>
            <Box
              component="img"
              src={image.previewUrl}
              alt="Picture to be posted"
              sx={{ display: 'block', maxWidth: '100%', maxHeight: 240, borderRadius: 1 }}
            />
            <IconButton
              size="small"
              aria-label="Remove picture"
              onClick={() => setImage(null)}
              disabled={submitting}
              sx={{ position: 'absolute', top: 4, right: 4, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}>
          <Button component="label" role={undefined} size="small" startIcon={<ImageOutlinedIcon />} disabled={submitting}>
            Add picture
            <input hidden type="file" accept={POST_IMAGE_TYPES.join(',')} onChange={handleFileChange} />
          </Button>
          <Button type="submit" variant="contained" disabled={submitting || !content.trim()}>
            Post
          </Button>
        </Box>
      </form>
    </Paper>
  );
}