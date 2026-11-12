import { useState } from 'react';
import { Button, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { blockUser, unblockUser } from '../lib/moderation';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

export default function BlockButton({ targetId, username, blocked, onChange }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  async function handleBlock() {
    setWorking(true);
    const { error } = await blockUser(user.id, targetId);
    setWorking(false);
    setConfirming(false);

    if (error) {
      showToast(`Could not block user: ${error.message}`);
      return;
    }
    showToast(`Blocked @${username}.`, 'success');
    onChange?.();
  }

  async function handleUnblock() {
    setWorking(true);
    const { error } = await unblockUser(user.id, targetId);
    setWorking(false);

    if (error) {
      showToast(`Could not unblock user: ${error.message}`);
      return;
    }
    showToast(`Unblocked @${username}.`, 'success');
    onChange?.();
  }

  if (blocked) {
    return <Button variant="outlined" onClick={handleUnblock} disabled={working}>Unblock</Button>;
  }

  return (
    <>
      <Button size="small" color="error" onClick={() => setConfirming(true)}>Block</Button>
      {confirming && (
        <Dialog open onClose={working ? undefined : () => setConfirming(false)} aria-labelledby="block-title">
          <DialogTitle id="block-title">Block @{username}?</DialogTitle>
          <DialogContent>
            <DialogContentText>
              You will no longer see their posts, comments or notifications. They can no longer like, comment
              on or follow you, and you stop following each other. You can unblock them any time from their profile.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirming(false)} disabled={working}>Cancel</Button>
            <Button onClick={handleBlock} color="error" variant="contained" disabled={working}>Block</Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}