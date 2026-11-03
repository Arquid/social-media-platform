import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Paper, Typography, TextField, Button, Alert, Stack, Link } from '@mui/material';
import { supabase } from '../lib/supabaseClient';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setSubmitting(false);
    if (error) setError(error.message);
    else navigate('/');
  }

  return (
    <Paper sx={{ p: 4 }}>
      <Typography variant="h5" gutterBottom>Log in</Typography>
      <form onSubmit={handleSubmit}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          <Button type="submit" variant="contained" disabled={submitting}>Log in</Button>
          <Link component={RouterLink} to="/forgot-password" variant="body2">Forgot your password?</Link>
          <Typography variant="body2">
            No account yet? <Link component={RouterLink} to="/register">Sign up</Link>
          </Typography>
        </Stack>
      </form>
    </Paper>
  );
}
