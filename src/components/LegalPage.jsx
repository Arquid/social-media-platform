import { Box, Link, Paper, Stack, Typography } from '@mui/material';
import { CONTACT_EMAIL, LEGAL_UPDATED } from '../lib/legal';

// The frame of the terms and of the privacy policy: a heading, the date of the texts, the sections and how to reach us
export function LegalPage({ title, children }) {
  return (
    <Paper sx={{ p: { xs: 2, sm: 4 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={700}>{title}</Typography>
          <Typography variant="body2" color="text.secondary">Last updated {LEGAL_UPDATED}</Typography>
        </Box>
        {children}
        <LegalSection title="Contact">
          <Typography>
            {CONTACT_EMAIL ? (
              <>
                Questions about these texts or about your data: <Link href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</Link>.
              </>
            ) : (
              'Questions about these texts or about your data go to the person who runs this site.'
            )}
          </Typography>
        </LegalSection>
      </Stack>
    </Paper>
  );
}

export function LegalSection({ title, children }) {
  const id = `legal-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <Box component="section" aria-labelledby={id}>
      <Typography variant="h6" component="h2" id={id} gutterBottom>{title}</Typography>
      <Stack spacing={1}>{children}</Stack>
    </Box>
  );
}

export function LegalList({ items }) {
  return (
    <Box component="ul" sx={{ m: 0, pl: 3, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {items.map((item) => <li key={item}><Typography component="span">{item}</Typography></li>)}
    </Box>
  );
}
