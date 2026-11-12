import { supabase } from './supabaseClient';

export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech' },
  { value: 'violence', label: 'Violence or threats' },
  { value: 'other', label: 'Something else' },
];
export const MAX_REPORT_DETAILS = 300;

export async function fetchIsBlocked(blockerId, blockedId) {
  const { data } = await supabase
    .from('blocks')
    .select('blocked_id')
    .match({ blocker_id: blockerId, blocked_id: blockedId })
    .maybeSingle();
  return !!data;
}

export function blockUser(blockerId, blockedId) {
  return supabase.from('blocks').insert({ blocker_id: blockerId, blocked_id: blockedId });
}

export function unblockUser(blockerId, blockedId) {
  return supabase.from('blocks').delete().match({ blocker_id: blockerId, blocked_id: blockedId });
}

// target: { postId } or { commentId } or { userId }.
// For a post or a comment the database finds out who wrote it, so only the id is sent.
export async function sendReport(reporterId, target, reason, details) {
  const row = { reporter_id: reporterId, reason, details: details.trim() || null };
  if (target.postId) row.post_id = target.postId;
  else if (target.commentId) row.comment_id = target.commentId;
  else row.reported_user_id = target.userId;

  const { error } = await supabase.from('reports').insert(row);
  // Reporting the same thing twice: nothing is wrong, the report is already there
  if (error?.code === '23505') return { error: null, alreadyReported: true };
  return { error, alreadyReported: false };
}