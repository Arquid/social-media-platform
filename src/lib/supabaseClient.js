import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export const POST_SELECT =
  '*, profiles!posts_user_id_fkey(username, display_name), likes(user_id), comments(count)';
