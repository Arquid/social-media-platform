import { supabase } from './supabaseClient';

// Everything the service holds about the logged-in person, as one object (see export_my_data in the database)
export async function fetchMyData() {
  const { data, error } = await supabase.rpc('export_my_data');
  return { data, error };
}

export function exportFileName(username, date = new Date()) {
  return `socialy-data-${username}-${date.toISOString().slice(0, 10)}.json`;
}

// Gives the browser a file to save: a link that is clicked once and removed
export function downloadJson(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // After a moment: the browser has to start reading the file first
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
