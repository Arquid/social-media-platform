import { supabase } from './supabaseClient';
import { deletePostImage } from './postImages';

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

export const REPORTS_PAGE_SIZE = 20;

// Is the logged-in user an administrator? Any failure counts as "no".
export async function fetchIsAdmin() {
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}

// status: 'open' or 'handled'. beforeId: the id of the last report that is shown (for the next page)
export async function fetchReports(status, beforeId) {
  const { data, error } = await supabase.rpc('admin_list_reports', {
    p_status: status,
    p_limit: REPORTS_PAGE_SIZE,
    p_before: beforeId ?? null,
  });
  return { data: data ?? [], error };
}

export async function fetchOpenReportCount() {
  const { data, error } = await supabase.rpc('admin_open_report_count');
  return { count: data ?? 0, error };
}

// resolution: 'dismissed', 'content_removed' or 'noted'. When a post with a picture is removed, the file goes too.
export async function resolveReport(reportId, resolution, note) {
  const { data: imagePath, error } = await supabase.rpc('admin_resolve_report', {
    p_report_id: reportId,
    p_resolution: resolution,
    p_note: note?.trim() || null,
  });
  if (error) return { error };
  await deletePostImage(imagePath);
  return { error: null };
}