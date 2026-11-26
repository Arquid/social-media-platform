import { useState } from 'react';
import { Button } from '@mui/material';
import { downloadJson, exportFileName, fetchMyData } from '../lib/dataExport';
import { useToast } from '../hooks/useToast';

export default function ExportDataButton({ username }) {
  const { showToast } = useToast();
  const [working, setWorking] = useState(false);

  async function handleClick() {
    setWorking(true);
    const { data, error } = await fetchMyData();
    setWorking(false);

    if (error) {
      showToast(`Could not download your data: ${error.message}`);
      return;
    }
    downloadJson(exportFileName(username), data);
    showToast('Your data was downloaded.', 'success');
  }

  return (
    <Button size="small" onClick={handleClick} disabled={working}>
      {working ? 'Preparing...' : 'Download my data'}
    </Button>
  );
}
