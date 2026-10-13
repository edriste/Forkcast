import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import type { EventImage } from './types';
export async function eventImages(eventId: string) {
  const images: EventImage[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase
      .from('event_images')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at')
      .order('id')
      .range(offset, offset + 99);
    if (error) throw error;
    images.push(...(data as EventImage[]));
    if (data.length < 100) break;
  }
  for (let offset = 0; offset < images.length; offset += 100) {
    const batch = images.slice(offset, offset + 100);
    const { data, error } = await supabase.storage.from('lunch-images').createSignedUrls(
      batch.map((image) => image.storage_path),
      600,
    );
    if (error) throw error;
    batch.forEach((image, index) => {
      image.url = data[index]?.signedUrl ?? undefined;
    });
  }
  return images;
}
export async function uploadEventImage(eventId: string, userId: string, kind: 'receipt' | 'meal') {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted)
    throw new Error('Allow photo-library access in your device settings to upload an image.');
  const selection = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (selection.canceled) return;
  const asset = selection.assets[0];
  const resized = await manipulateAsync(
    asset.uri,
    [
      {
        resize:
          asset.width >= asset.height
            ? { width: Math.min(asset.width, 1600) }
            : { height: Math.min(asset.height, 1600) },
      },
    ],
    { compress: 0.75, format: SaveFormat.JPEG },
  );
  const file = Platform.OS === 'web' ? null : new File(resized.uri);
  try {
    const bytes = file ? await file.arrayBuffer() : await (await fetch(resized.uri)).arrayBuffer();
    if (bytes.byteLength > 5 * 1024 * 1024)
      throw new Error('This image is too large. Choose a smaller image.');
    const path = `${eventId}/${Crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('lunch-images')
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    if (uploadError) throw uploadError;
    const { error } = await supabase
      .from('event_images')
      .insert({ event_id: eventId, kind, storage_path: path, uploaded_by: userId });
    if (error) {
      const cleanup = await supabase.storage.from('lunch-images').remove([path]);
      if (cleanup.error)
        throw new Error(
          `${error.message} The uploaded file could not be cleaned up; contact your operator.`,
        );
      throw error;
    }
  } finally {
    if (file?.exists) file.delete();
  }
}
