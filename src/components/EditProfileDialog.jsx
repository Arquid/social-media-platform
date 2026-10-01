import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Stack, Box, Avatar, Button, TextField, Alert,
} from '@mui/material';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import {
  AVATAR_TYPES, getAvatarUrl, validateAvatarFile, uploadAvatar, deleteAvatar,
} from '../lib/avatars';

export default function EditProfileDialog({ profile, onClose, onSaved }) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [fileError, setFileError] = useState('');
  const [saving, setSaving] = useState(false);

  // Frees the temporary preview URL when it changes or the dialog closes
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleFileChange(e) {
    const chosen = e.target.files?.[0];
    e.target.value = ''; // lets the user pick the same file again later
    if (!chosen) return;

    const message = validateAvatarFile(chosen);
    setFileError(message);
    if (message) return;

    setFile(chosen);
    setPreviewUrl(URL.createObjectURL(chosen));
    setRemoveAvatar(false);
  }

  function handleRemovePhoto() {
    setFile(null);
    setPreviewUrl(null);
    setFileError('');
    setRemoveAvatar(true);
  }

  async function handleSave() {
    setSaving(true);

    // 1. Upload the new picture first (if there is one)
    let newPath = null;
    if (file) {
      const result = await uploadAvatar(user.id, file);
      if (result.error) {
        showToast(`Could not upload the image: ${result.error.message}`);
        setSaving(false);
        return;
      }
      newPath = result.path;
    }

    // 2. Save the profile
    let avatarPath = profile.avatar_path;
    if (file) avatarPath = newPath;
    else if (removeAvatar) avatarPath = null;

    const { data, error } = await supabase
      .from('profiles')
      .update({
        display_name: displayName.trim() || null,
        bio: bio.trim(),
        avatar_path: avatarPath,
      })
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      await deleteAvatar(newPath); // do not leave an unused upload behind
      showToast(`Could not save the profile: ${error.message}`);
      setSaving(false);
      return;
    }

    // 3. Remove the old picture now that nothing points to it
    if (profile.avatar_path && profile.avatar_path !== avatarPath) {
      await deleteAvatar(profile.avatar_path);
    }

    setSaving(false);
    onSaved(data);
  }

  const shownAvatar = previewUrl ?? (removeAvatar ? undefined : getAvatarUrl(profile.avatar_path));

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Edit profile</DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Avatar src={shownAvatar} alt="Profile picture preview" sx={{ width: 80, height: 80 }}>
              {profile.username[0].toUpperCase()}
            </Avatar>
            <Stack direction="row" spacing={1}>
              <Button component="label" variant="outlined" size="small" disabled={saving}>
                Change photo
                <input hidden type="file" accept={AVATAR_TYPES.join(',')} onChange={handleFileChange} />
              </Button>
              <Button size="small" onClick={handleRemovePhoto} disabled={saving || (!shownAvatar)}>
                Remove photo
              </Button>
            </Stack>
          </Box>

          {fileError && <Alert severity="error">{fileError}</Alert>}

          <TextField
            label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 50 } }}
          />
          <TextField
            label="Bio"
            multiline
            minRows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            helperText={`${bio.length}/160`}
            slotProps={{ htmlInput: { maxLength: 160 } }}
          />
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}