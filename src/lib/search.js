import { supabase } from './supabaseClient';

export const MIN_SEARCH_LENGTH = 2;
export const SEARCH_PAGE_SIZE = 20;

// One page of people. `offset` is how many have been shown already
export async function searchProfiles(text, offset = 0) {
  const { data, error } = await supabase.rpc('search_profiles', {
    search_text: text,
    result_limit: SEARCH_PAGE_SIZE,
    result_offset: offset,
  });

  if (error) {
    console.error('Search failed:', error);
    return { users: [], error: error.message, hasMore: false };
  }
  return { users: data, error: '', hasMore: data.length === SEARCH_PAGE_SIZE };
}
