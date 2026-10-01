import { supabase } from './supabaseClient';

export const AVATAR_BUCKET = 'avatars';
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'};

export function validateAvatarFile(file) {
  if (!AVATAR_TYPES.includes(file.type)) return 'Please choose a JPEG, PNG or WebP image.';
  if (file.size > MAX_AVATAR_BYTES) return 'The image must be smaller than 2 MB.';
  return '';
}

export function getAvatarUrl(path) {
  if (!path) return undefined;
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadAvatar(userId, file) {
  const path = `${userId}/${Date.now()}.${EXTENSIONS[file.type]}`;
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { contentType: file.type });

  if (error) return { error };
  return { path };
}

export async function deleteAvatar(path) {
  if (!path) return;
  await supabase.storage.from(AVATAR_BUCKET).remove([path]);
}