import { useEffect, useRef, useState } from 'react';
import { Box, Button } from '@mui/material';

// The button that loads the next page. It also loads by itself when it comes near the screen (infinite
// scroll), and the button stays there for those who prefer it. onLoad must give back false when loading
// failed: after an error nothing is loaded by itself until the button is pressed (otherwise a broken
// connection would be asked again and again).
export default function LoadMore({ onLoad, loading, label = 'Load more', size, align = 'center', sx }) {
  const boxRef = useRef(null);
  const onLoadRef = useRef(onLoad);
  const [stopped, setStopped] = useState(false);
  const [round, setRound] = useState(0); // counts the pages that have come, so the button looks again after each

  useEffect(() => {
    onLoadRef.current = onLoad;
  });

  useEffect(() => {
    if (loading || stopped || !('IntersectionObserver' in window)) return undefined;

    const observer = new IntersectionObserver(
      async ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const ok = await onLoadRef.current();
        if (ok === false) setStopped(true);
        else if (ok === true) setRound((n) => n + 1);
      },
      { rootMargin: '400px' }
    );
    observer.observe(boxRef.current);
    // After a page has been added, `loading` goes back to false and a new observer looks again:
    // if the button is still near the screen, the next page follows
    return () => observer.disconnect();
  }, [loading, stopped, round]);

  async function handleClick() {
    setStopped(false);
    const ok = await onLoad();
    if (ok === false) setStopped(true);
    else if (ok === true) setRound((n) => n + 1);
  }

  return (
    <Box ref={boxRef} sx={{ display: 'flex', justifyContent: align === 'start' ? 'flex-start' : 'center', ...sx }}>
      <Button size={size} onClick={handleClick} disabled={loading}>
        {loading ? 'Loading...' : label}
      </Button>
    </Box>
  );
}