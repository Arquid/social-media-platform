import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Paper, Typography, TextField, Button, Alert, Stack, Link, Box, CircularProgress } from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';

export default function ResetPassword() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }
    showToast('Your password has been changed.', 'success');
    navigate('/');
  }

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}><CircularProgress aria-label="Loading" /></Box>;
  }

  // The link signs the user in. Without a session the link was already used, has expired or was never opened
  if (!user) {
    return (
      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" component="h1" gutterBottom>Link not valid</Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This link is invalid or has expired. Links work once and for a limited time.
        </Alert>
        <Link component={RouterLink} to="/forgot-password">Request a new link</Link>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 4 }}>
      <Typography variant="h5" component="h1" gutterBottom>Choose a new password</Typography>
      <form onSubmit={handleSubmit}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="New password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            slotProps={{ htmlInput: { minLength: 6 } }}
          />
          <TextField
            label="Repeat new password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
          <Button type="submit" variant="contained" disabled={submitting}>Change password</Button>
        </Stack>
      </form>
    </Paper>
  );
}