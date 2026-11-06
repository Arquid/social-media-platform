import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from './ToastContext';
import { useToast } from '../hooks/useToast';

function Buttons() {
  const { showToast } = useToast();
  return (
    <>
      <button onClick={() => showToast('Something failed')}>fail</button>
      <button onClick={() => showToast('Saved', 'success')}>succeed</button>
      <button onClick={() => showToast('Careful', 'warning')}>warn</button>
    </>
  );
}

function renderToasts() {
  return render(<ToastProvider><Buttons /></ToastProvider>);
}

// MUI puts the severity in the class name of the alert
const severityOf = (alert) => alert.className.match(/MuiAlert-\w*(Error|Success|Warning)/)?.[1];

describe('ToastProvider', () => {
  it('shows nothing until somebody asks for a message', () => {
    renderToasts();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error message by default', async () => {
    renderToasts();

    await userEvent.click(screen.getByRole('button', { name: 'fail' }));

    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Something failed');
    expect(severityOf(toast)).toBe('Error');
  });

  it.each([
    ['succeed', 'Saved', 'Success'],
    ['warn', 'Careful', 'Warning'],
  ])('shows the message of "%s" in its own color', async (button, message, severity) => {
    renderToasts();

    await userEvent.click(screen.getByRole('button', { name: button }));

    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent(message);
    expect(severityOf(toast)).toBe(severity);
  });

  it('closes with its close button', async () => {
    renderToasts();
    await userEvent.click(screen.getByRole('button', { name: 'fail' }));
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: /close/i }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('stays open when the user clicks somewhere else on the page', async () => {
    renderToasts();
    await userEvent.click(screen.getByRole('button', { name: 'fail' }));
    await screen.findByRole('alert');

    await userEvent.click(document.body);

    expect(screen.getByRole('alert')).toHaveTextContent('Something failed');
  });

  it('replaces the message when a new one comes', async () => {
    renderToasts();
    await userEvent.click(screen.getByRole('button', { name: 'fail' }));
    await screen.findByText('Something failed');

    await userEvent.click(screen.getByRole('button', { name: 'succeed' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });
});
