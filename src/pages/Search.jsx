import { useEffect, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Paper, TextField, InputAdornment, List, ListItem, ListItemButton, ListItemAvatar, ListItemText,
  Typography, CircularProgress, Alert, Box,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import UserAvatar from '../components/UserAvatar';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { searchProfiles, MIN_SEARCH_LENGTH } from '../lib/search';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const [result, setResult] = useState({ query: '', users: [], error: '' });

  const trimmed = text.trim();
  const query = useDebouncedValue(trimmed, 300);
  const searchable = trimmed.length >= MIN_SEARCH_LENGTH;
  const loading = searchable && result.query !== trimmed;

  useEffect(() => {
    if (query.length < MIN_SEARCH_LENGTH) return;
    let active = true;

    searchProfiles(query).then((found) => {
      if (active) setResult({ query, ...found });
    });

    return () => {
      active = false;
    };
  }, [query]);

  function handleChange(e) {
    const value = e.target.value;
    setText(value);
    setParams(value.trim() ? { q: value.trim() } : {}, { replace: true });
  }

  return (
    <>
      <TextField
        autoFocus
        fullWidth
        type="search"
        label="Search users"
        placeholder="Name or username"
        value={text}
        onChange={handleChange}
        sx={{ mb: 2 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start"><SearchIcon /></InputAdornment>
            ),
          },
        }}
      />

      {!searchable && (
        <Typography color="text.secondary" align="center">
          Type at least {MIN_SEARCH_LENGTH} characters to find people.
        </Typography>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}><CircularProgress /></Box>
      )}

      {searchable && !loading && result.error && (
        <Alert severity="error">Could not search: {result.error}</Alert>
      )}

      {searchable && !loading && !result.error && result.users.length === 0 && (
        <Typography color="text.secondary" align="center">No users found for "{trimmed}".</Typography>
      )}

      {searchable && !loading && result.users.length > 0 && (
        <Paper>
          <List aria-label="Search results">
            {result.users.map((u) => (
              <ListItem key={u.id} disablePadding divider>
                <ListItemButton component={RouterLink} to={`/profile/${u.username}`}>
                  <ListItemAvatar>
                    <UserAvatar username={u.username} avatarPath={u.avatar_path} />
                  </ListItemAvatar>
                  <ListItemText
                    primary={u.display_name || `@${u.username}`}
                    secondary={[u.display_name && `@${u.username}`, u.bio].filter(Boolean).join(' · ')}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
    </>
  );
}