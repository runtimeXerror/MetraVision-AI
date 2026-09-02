import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import { Alert, Linking } from 'react-native';

import type { ImageSide, ImageSource } from '../types';
import { useImageStore } from '../store/imageStore';

/**
 * Camera and gallery capture.
 *
 * Wraps `expo-image-picker` so the screens never touch permission objects or
 * picker result shapes. Permission denial is handled here too — a screen that
 * has to reason about `status === 'denied'` versus `canAskAgain` ends up
 * duplicating this logic four times over.
 */

interface CaptureResult {
  uri: string;
  width?: number;
  height?: number;
  fileSize?: number;
}

function explainPermission(kind: 'camera' | 'gallery'): void {
  const subject = kind === 'camera' ? 'Camera access' : 'Photo library access';
  Alert.alert(
    `${subject} is required`,
    `Enable ${kind === 'camera' ? 'the camera' : 'photo access'} for LM Compliance Scanner in Settings to attach label photographs.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => void Linking.openSettings() },
    ],
  );
}

/**
 * Asks where a replacement photograph should come from.
 *
 * Retake used to go straight to the camera, which is wrong in the field more
 * often than it is right: an inspector who has already photographed the label
 * on their own phone, or been sent it by a colleague, had no way to attach it
 * and had to re-shoot the packet. The initial capture step has offered both
 * sources all along — this makes the replace path match it.
 *
 * Lives here rather than in the two screens that need it so the wording and
 * the cancel handling stay in one place; that is the same reason
 * `explainPermission` is here.
 */
function askSource(): Promise<ImageSource | null> {
  return new Promise((resolve) => {
    Alert.alert(
      'Replace this photograph',
      'Take a new photograph, or upload one already on this device.',
      [
        { text: 'Take photo', onPress: () => resolve('camera') },
        { text: 'Upload from gallery', onPress: () => resolve('gallery') },
        // `onDismiss` covers an Android back-press, where no button fires and
        // the promise would otherwise never settle and leave the button stuck.
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

export function useImageCapture() {
  const addImage = useImageStore((state) => state.add);
  const replaceImage = useImageStore((state) => state.replace);
  const [busy, setBusy] = useState(false);

  const pick = useCallback(async (source: ImageSource): Promise<CaptureResult | null> => {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        explainPermission('camera');
        return null;
      }
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        explainPermission('gallery');
        return null;
      }
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.85,
      // Labels are read edge to edge — cropping risks losing a declaration.
      allowsEditing: false,
      exif: false,
    };

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true });

    if (result.canceled || result.assets.length === 0) return null;

    const asset = result.assets[0];
    if (!asset) return null;

    return {
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize,
    };
  }, []);

  /** Captures one image and files it under the given package face. */
  const capture = useCallback(
    async (source: ImageSource, side: ImageSide) => {
      setBusy(true);
      try {
        // The gallery path can return several assets; add them all.
        if (source === 'gallery') {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) {
            explainPermission('gallery');
            return;
          }

          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 0.85,
            allowsMultipleSelection: true,
            selectionLimit: 6,
            exif: false,
          });

          if (result.canceled) return;

          for (const asset of result.assets) {
            addImage({
              uri: asset.uri,
              side,
              source: 'gallery',
              width: asset.width,
              height: asset.height,
              fileSize: asset.fileSize,
            });
          }
          return;
        }

        const captured = await pick('camera');
        if (!captured) return;

        addImage({ ...captured, side, source: 'camera' });
      } finally {
        setBusy(false);
      }
    },
    [addImage, pick],
  );

  /** Retakes an existing image, keeping its position and package face. */
  const retake = useCallback(
    async (imageId: string, source: ImageSource = 'camera') => {
      setBusy(true);
      try {
        const captured = await pick(source);
        if (!captured) return;

        replaceImage(imageId, {
          ...captured,
          side: 'front', // Ignored by `replace`, which preserves the original side.
          source,
        });
      } finally {
        setBusy(false);
      }
    },
    [pick, replaceImage],
  );

  /**
   * Retakes an image, asking first whether to shoot it or upload one.
   *
   * The source is chosen before `retake` runs, so `busy` covers only the
   * picker and not the time the inspector spends reading the prompt.
   */
  const retakeFrom = useCallback(
    async (imageId: string) => {
      const source = await askSource();
      if (!source) return;
      await retake(imageId, source);
    },
    [retake],
  );

  return { capture, retake, retakeFrom, busy };
}
