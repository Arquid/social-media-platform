import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, FormControl, FormLabel,
  RadioGroup, FormControlLabel, Radio, TextField, Button, Alert,
} from '@mui/material';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { REPORT_REASONS, MAX_REPORT_DETAILS, sendReport } from '../lib/moderation';

export default function ReportDialog({ title, target, onClose }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function handleSend() {
    setSending(true);
    setError('');
    const { error: failed, alreadyReported } = await sendReport(user.id, target, reason, details);
    setSending(false);

    if (failed) {
      setError(failed.message);
      return;
    }
    showToast(alreadyReported ? 'You have already reported this.' : 'Thank you. Your report was sent.', 'success');
    onClose();
  }

  return (
    <Dialog open onClose={sending ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="report-title">
      <DialogTitle id="report-title">{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>Why are you reporting this? Your report is private.</DialogContentText>
        <FormControl>
          <FormLabel id="report-reason-label">Reason</FormLabel>
          <RadioGroup
            aria-labelledby="report-reason-label"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            {REPORT_REASONS.map(({ value, label }) => (
              <FormControlLabel key={value} value={value} control={<Radio />} label={label} />
            ))}
          </RadioGroup>
        </FormControl>
        <TextField
          label="Details (optional)"
          multiline
          minRows={2}
          fullWidth
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          slotProps={{ htmlInput: { maxLength: MAX_REPORT_DETAILS } }}
          sx={{ mt: 2 }}
        />
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>Cancel</Button>
        <Button onClick={handleSend} variant="contained" disabled={!reason || sending}>Send report</Button>
      </DialogActions>
    </Dialog>
  );
}