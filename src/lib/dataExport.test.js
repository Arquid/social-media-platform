import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchMyData, exportFileName, downloadJson } from './dataExport';
import { supabase } from './supabaseClient';

vi.mock('./supabaseClient', () => ({
  supabase: { rpc: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchMyData', () => {
  it('asks the database for the data of the person who is logged in', async () => {
    supabase.rpc.mockResolvedValue({ data: { posts: [] }, error: null });

    const result = await fetchMyData();

    expect(supabase.rpc).toHaveBeenCalledWith('export_my_data');
    expect(result).toEqual({ data: { posts: [] }, error: null });
  });

  it('gives back the error, for example the limit of five an hour', async () => {
    const error = { code: 'PT429', message: 'You can download your data 5 times an hour. Please try again later.' };
    supabase.rpc.mockResolvedValue({ data: null, error });

    expect(await fetchMyData()).toEqual({ data: null, error });
  });
});

describe('exportFileName', () => {
  it('has the name of the service, the username and the day', () => {
    expect(exportFileName('anna', new Date('2026-11-26T23:30:00Z'))).toBe('socialy-data-anna-2026-11-26.json');
  });

  it('uses today when no day is given', () => {
    expect(exportFileName('anna')).toMatch(/^socialy-data-anna-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe('downloadJson', () => {
  let click;
  let blobs;
  let revoked;

  const readBlob = (blob) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });

  beforeEach(() => {
    blobs = [];
    revoked = [];
    URL.createObjectURL = vi.fn((blob) => { blobs.push(blob); return 'blob:the-file'; });
    URL.revokeObjectURL = vi.fn((url) => revoked.push(url));
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      // what the browser sees at the moment of the click
      click.seen = { href: this.href, download: this.download, inDocument: document.body.contains(this) };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('clicks a link that saves the file under the given name, and leaves no link behind', () => {
    downloadJson('data.json', { a: 1 });

    expect(click).toHaveBeenCalledTimes(1);
    expect(click.seen).toEqual({ href: 'blob:the-file', download: 'data.json', inDocument: true });
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('saves the data as readable JSON (indented), as a JSON file', async () => {
    downloadJson('data.json', { name: 'Anna', posts: [{ id: 1 }] });

    expect(blobs[0].type).toBe('application/json');
    const text = await readBlob(blobs[0]);
    expect(text).toBe(JSON.stringify({ name: 'Anna', posts: [{ id: 1 }] }, null, 2));
    expect(text).toContain('\n  "name": "Anna"');
  });

  it('keeps the text of the person as it is, also letters from other languages and emoji', async () => {
    downloadJson('data.json', { content: 'Hyvää päivää 🙂 日本語' });

    expect(JSON.parse(await readBlob(blobs[0])).content).toBe('Hyvää päivää 🙂 日本語');
  });

  it('lets go of the file after a moment, not at once (the browser has to start reading it)', () => {
    vi.useFakeTimers();
    downloadJson('data.json', {});

    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(revoked).toEqual(['blob:the-file']);
  });
});
