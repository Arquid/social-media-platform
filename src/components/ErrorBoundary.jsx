import { Component } from 'react';
import { Box, Typography, Button, Stack } from '@mui/material';

function isOutdatedAppError(error) {
  return /dynamically imported module|Loading chunk|Importing a module script failed/i.test(
    error?.message ?? ''
  );
}

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled error in the interface:', error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const outdated = isOutdatedAppError(error);

    return (
      <Box role="alert" sx={{ textAlign: 'center', mt: 8, px: 2 }}>
        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <Typography variant="h5" component="h1">Something went wrong</Typography>
          <Typography color="text.secondary">
            {outdated
              ? 'A new version of the app may have been published. Reload the page to continue.'
              : 'This page could not be shown. You can try again or go back to the feed.'}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              onClick={outdated ? () => window.location.reload() : this.reset}
            >
              {outdated ? 'Reload page' : 'Try again'}
            </Button>
            <Button href="/">Go to the feed</Button>
          </Stack>
        </Stack>
      </Box>
    );
  }
}