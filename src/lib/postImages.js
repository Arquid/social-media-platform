import { supabase } from './supabaseClient';

export const POST_IMAGE_BUCKET = 'post-images';
export const MAX_POST_IMAGE_BYTES = 5 * 1024 * 1024;
export const POST_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function validatePostImage(file) {
  if (!POST_IMAGE_TYPES.includes(file.type)) return 'Please choose a JPEG, PNG or WebP picture.';
  if (file.size > MAX_POST_IMAGE_BYTES) return 'The picture must be smaller than 5 MB.';
  return '';
}

export function getPostImageUrl(path) {
  if (!path) return undefined;
  return supabase.storage.from(POST_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

// The file goes to the folder of the user: "<user id>/<time>.<type>"
export async function uploadPostImage(userId, file) {
  const path = `${userId}/${Date.now()}.${EXTENSIONS[file.type]}`;
  const { error } = await supabase.storage
    .from(POST_IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type });

  if (error) return { error };
  return { path };
}

export async function deletePostImage(path) {
  if (!path) return;
  await supabase.storage.from(POST_IMAGE_BUCKET).remove([path]);
}

// Removes every picture in the user's own folder (used when the account is deleted)
export async function deleteAllPostImages(userId) {
  const bucket = supabase.storage.from(POST_IMAGE_BUCKET);

  const { data: files, error } = await bucket.list(userId);
  if (error) return { error };
  if (files.length === 0) return {};

  const { error: removeError } = await bucket.remove(files.map((file) => `${userId}/${file.name}`));
  return removeError ? { error: removeError } : {};
}