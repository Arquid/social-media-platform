import { supabase } from './supabaseClient';

export const MIN_SEARCH_LENGTH = 2;

export async function searchProfiles(text) {
  const { data, error } = await supabase.rpc('search_profiles', { search_text: text });

  if (error) {
    console.error('Search failed:', error);
    return { users: [], error: error.message };
  }
  return { users: data, error: '' };
}