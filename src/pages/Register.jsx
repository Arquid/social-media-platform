import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { Paper, Typography, TextField, Button, Alert, Stack, Link } from '@mui/material';
import { supabase } from '../lib/supabaseClient';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

function getUsernameError(username) {
  if (!USERNAME_PATTERN.test(username)) {
    return 'Username must be 3-20 characters and contain only letters, numbers and underscores.';
  }
  return '';
}

function friendlySignUpError(message) {
  if (/database error saving new user/i.test(message)) {
    return 'That username is already taken. Please choose another one.';
  }
  return message;
}

export default function Register() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const normalizedUsername = username.trim().toLowerCase();
  const usernameError = username ? getUsernameError(normalizedUsername) : '';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (getUsernameError(normalizedUsername)) return;

    setSubmitting(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username: normalizedUsername } },
    });

    setSubmitting(false);
    if (error) setError(friendlySignUpError(error.message));
    else navigate('/');
  }

  return (
    <Paper sx={{ p: 4 }}>
      <Typography variant="h5" gutterBottom>Create account</Typography>
      <form onSubmit={handleSubmit}>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            error={!!usernameError}
            helperText={usernameError || '3-20 characters: letters, numbers and underscores'}
          />
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            slotProps={{ htmlInput: { minLength: 6 } }}
          />
          <Button type="submit" variant="contained" disabled={submitting}>Sign up</Button>
          <Typography variant="body2">
            Already have an account? <Link component={RouterLink} to="/login">Log in</Link>
          </Typography>
        </Stack>
      </form>
    </Paper>
  );
}
