import { Link as RouterLink } from 'react-router-dom';
import { Stack, Typography, Button } from '@mui/material';

export default function NotFound() {
  return (
    <Stack spacing={2} sx={{ mt: 6, alignItems: 'center', textAlign: 'center' }}>
      <Typography variant="h2" component="p" color="primary" fontWeight={700}>404</Typography>
      <Typography variant="h5" component="h1">Page not found</Typography>
      <Typography color="text.secondary">The address you opened does not exist.</Typography>
      <Button component={RouterLink} to="/" variant="contained">Back to the feed</Button>
    </Stack>
  );
}