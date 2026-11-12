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
        // "dark" is the color under the mouse. MUI would make it darker (contrast 4.0 with the dark
        // text of the button, below the 4.5 that is required), so in the dark theme it is lighter instead
        primary: { main: '#9c9cf2', dark: '#b4b4f7' },
        // The same for red buttons ("Block"): white text on the default red is 3.7, below 4.5
        error: { main: '#f44336', dark: '#f6685e', contrastText: '#000000' },
        background: { default: '#12141c', paper: '#1b1e2a' },
      },
    },
  },
  shape: { borderRadius: 12 },
});