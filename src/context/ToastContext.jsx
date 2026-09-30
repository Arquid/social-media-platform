import { useState, useCallback, useMemo } from 'react';
import { Snackbar, Alert } from '@mui/material';
import { ToastContext } from './toastContextObject';

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({ open: false, message: '', severity: 'error' });

  const showToast = useCallback((message, severity = 'error') => {
    setToast({ open: true, message, severity });
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  function handleClose(_event, reason) {
    if (reason === 'clickaway') return;
    setToast((prev) => ({ ...prev, open: false }));
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        open={toast.open}
        autoHideDuration={4000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleClose} severity={toast.severity} variant="filled" sx={{ width: '100%' }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}
