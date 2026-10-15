import { IconButton } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';

export default function ThemeToggle() {
  const { mode, systemMode, setMode } = useColorScheme();

  if (!mode) return null;

  const dark = (mode === 'system' ? systemMode : mode) === 'dark';

  return (
    <IconButton
      onClick={() => setMode(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? <LightModeIcon /> : <DarkModeIcon />}
    </IconButton>
  );
}