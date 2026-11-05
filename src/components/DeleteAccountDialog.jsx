import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, TextField, Button, Alert,
} from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { deleteAllAvatars } from '../lib/avatars';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

export default function DeleteAccountDialog({ username, onClose }) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { showToast } = useToast();
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function handleDelete() {
    setError('');
    setDeleting(true);

    // 1. The picture is a file in Storage, which the database cannot remove: do it while we still can
    const pictures = await deleteAllAvatars(user.id);
    if (pictures.error) {
      setError(`Could not remove your profile picture: ${pictures.error.message}`);
      setDeleting(false);
      return;
    }

    // 2. Delete the account. The database removes everything that belongs to it
    const { error: deleteError } = await supabase.rpc('delete_my_account');
    if (deleteError) {
      setError(`Could not delete the account: ${deleteError.message}`);
      setDeleting(false);
      return;
    }

    // 3. Go to the login page and log out (the protected pages would send a logged out user there anyway)
    showToast('Your account has been deleted.', 'success');
    navigate('/login', { replace: true });
    await signOut();
  }

  return (
    <Dialog open onClose={deleting ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Delete your account?</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          This permanently deletes your profile, posts, comments, likes, follows, notifications and
          profile picture. It cannot be undone.
        </DialogContentText>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <TextField
          autoFocus
          fullWidth
          label={`Type ${username} to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={deleting}
          autoComplete="off"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          onClick={handleDelete}
          disabled={deleting || typed.trim() !== username}
        >
          Delete account
        </Button>
      </DialogActions>
    </Dialog>
  );
}