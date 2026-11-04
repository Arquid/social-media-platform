import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Paper, Typography, TextField, Button, Alert, Stack, Link } from '@mui/material';
import { supabase } from '../lib/supabaseClient';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setSubmitting(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  if (sent) {
    return (
      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" component="h1" gutterBottom>Check your email</Typography>
        <Alert severity="success" sx={{ mb: 2 }}>
          If an account exists for {email}, we have sent a link to choose a new password.
        </Alert>
        <Link component={RouterLink} to="/login">Back to log in</Link>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 4 }}>
      <Typography variant="h5" component="h1" gutterBottom>Forgot your password?</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Enter your email and we will send you a link to choose a new one.
      </Typography>
      <form onSubmit={handleSubmit}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Button type="submit" variant="contained" disabled={submitting}>Send link</Button>
          <Link component={RouterLink} to="/login" variant="body2">Back to log in</Link>
        </Stack>
      </form>
    </Paper>
  );
}