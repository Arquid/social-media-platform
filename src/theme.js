import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#5b5bd6' },
        background: { default: '#f4f5fa' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#9c9cf2' },
        background: { default: '#12141c', paper: '#1b1e2a' },
      },
    },
  },
  shape: { borderRadius: 12 },
});