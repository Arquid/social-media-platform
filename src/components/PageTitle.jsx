import { Box } from '@mui/material';

// A heading for screen readers: it names the page but is not drawn on the screen
export default function PageTitle({ children }) {
  return (
    <Box
      component="h1"
      sx={{
        position: 'absolute',
        // Strings: in sx a plain 1 would mean 100 %, not one pixel
        width: '1px',
        height: '1px',
        m: '-1px',
        p: 0,
        border: 0,
        overflow: 'hidden',
        clipPath: 'inset(50%)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}