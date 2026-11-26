import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportDataButton from './ExportDataButton';
import { fetchMyData, downloadJson } from '../lib/dataExport';
import { renderWithProviders } from '../test/renderWithProviders';

vi.mock('../lib/dataExport', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchMyData: vi.fn(),
  downloadJson: vi.fn(),
}));
vi.mock('../lib/supabaseClient', () => ({ supabase: {} }));

const kindOf = (text) => screen.getByText(text).closest('[role="alert"]').className.match(/MuiAlert-\w*(Success|Error)/)?.[1];
const button = () => screen.getByRole('button', { name: /Download my data|Preparing/ });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ExportDataButton', () => {
  it('is a button that says what it does', () => {
    renderWithProviders(<ExportDataButton username="anna" />);

    expect(screen.getByRole('button', { name: 'Download my data' })).toBeEnabled();
  });

  it('fetches the data and saves it as a file named after the person and the day, and says so in green', async () => {
    fetchMyData.mockResolvedValue({ data: { posts: [{ id: 1 }] }, error: null });
    renderWithProviders(<ExportDataButton username="anna" />);

    await userEvent.click(button());

    await waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1));
    const [fileName, data] = downloadJson.mock.calls[0];
    expect(fileName).toMatch(/^socialy-data-anna-\d{4}-\d{2}-\d{2}\.json$/);
    expect(data).toEqual({ posts: [{ id: 1 }] });
    expect(await screen.findByText('Your data was downloaded.')).toBeInTheDocument();
    expect(kindOf('Your data was downloaded.')).toBe('Success');
  });

  it('saves nothing and says why, in red, when it fails (for example the limit of five an hour)', async () => {
    fetchMyData.mockResolvedValue({ data: null, error: { message: 'You can download your data 5 times an hour. Please try again later.' } });
    renderWithProviders(<ExportDataButton username="anna" />);

    await userEvent.click(button());

    const text = 'Could not download your data: You can download your data 5 times an hour. Please try again later.';
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(kindOf(text)).toBe('Error');
    expect(downloadJson).not.toHaveBeenCalled();
    expect(button()).toBeEnabled();
  });

  it('is locked while the data is being fetched: "Preparing...", and one click is one download', async () => {
    let finish;
    fetchMyData.mockReturnValue(new Promise((resolve) => { finish = () => resolve({ data: {}, error: null }); }));
    renderWithProviders(<ExportDataButton username="anna" />);

    await userEvent.click(button());

    expect(screen.getByRole('button', { name: 'Preparing...' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Preparing...' })); // a click on a locked button does nothing
    expect(fetchMyData).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(await screen.findByRole('button', { name: 'Download my data' })).toBeEnabled();
  });
});
