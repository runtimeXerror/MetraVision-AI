import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '../constants/theme';

import { Input } from './forms';
import { Badge, Row, Txt } from './ui';

/**
 * Where the inspection is taking place.
 *
 * An inspector standing in a shop should not be typing an address into a phone
 * one-handed, so the field fills itself from the device's GPS and the address
 * the fix reverse-geocodes to.
 *
 * What it fills stays editable, deliberately. A reverse-geocode returns the
 * nearest thing the map knows about, which in a market row is routinely the
 * wrong shop — so the address, district and state are all ordinary inputs
 * afterwards, and correcting them does not discard the fix. The coordinates are
 * the evidence of where the officer actually stood; the address is a label for
 * it, and the two are allowed to disagree.
 */

export interface LocationValue {
  address: string;
  district?: string;
  state?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
}

/**
 * Builds the street address from a reverse-geocode.
 *
 * Expo's `LocationGeocodedAddress` is not as tidy as its field names suggest,
 * and the naive join produced addresses like
 * "Kaveri Complex, Kaveri Complex, Jayanagar, Bengaluru, Bengaluru":
 *
 *   · `name` is frequently the street number, the building name, *or* a
 *     repeat of `street` — so it is only worth keeping when it adds something.
 *   · `district` here is the sub-locality (Jayanagar), not the administrative
 *     district. The administrative one is `subregion`, which is what the
 *     District field below wants. Two different meanings, one word.
 *   · `city` and `subregion` are routinely identical in metros.
 *
 * So parts are de-duplicated case-insensitively, and any part already
 * contained in one already kept is dropped. The PIN is deliberately excluded —
 * it has a field of its own, and repeating it in the street line is how a
 * report ends up with two of them.
 */
function composeAddress(place: Location.LocationGeocodedAddress): string {
  const parts = [
    place.name,
    place.streetNumber,
    place.street,
    place.district,
    place.subregion && place.subregion !== place.city ? undefined : undefined,
    place.city,
  ];

  const kept: string[] = [];

  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;

    const lower = value.toLowerCase();
    const redundant = kept.some(
      (existing) =>
        existing.toLowerCase() === lower ||
        existing.toLowerCase().includes(lower) ||
        lower.includes(existing.toLowerCase()),
    );

    if (!redundant) kept.push(value);
  }

  return kept.join(', ');
}

/** Six digits, the only shape an Indian PIN takes. */
const PINCODE = /^[1-9][0-9]{5}$/;

type Status =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'located'; at: number }
  | { kind: 'denied' }
  | { kind: 'failed'; message: string };

export function LocationField({
  value,
  onChange,
  error,
}: {
  value: LocationValue;
  onChange: (patch: Partial<LocationValue>) => void;
  error?: string;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [showParts, setShowParts] = useState(false);

  const locate = useCallback(async () => {
    setStatus({ kind: 'locating' });

    try {
      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (permission !== 'granted') {
        setStatus({ kind: 'denied' });
        return;
      }

      // Balanced rather than highest: a shopfront does not need sub-metre
      // precision, and the high-accuracy fix can take half a minute indoors.
      const fix = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const { latitude, longitude, accuracy } = fix.coords;

      // The fix is the fact worth keeping; the address is a convenience on top
      // of it, so it is written first and separately. If the reverse-geocode
      // fails or the device has no geocoder, the inspector still has a located
      // inspection and an address they can type.
      onChange({
        latitude,
        longitude,
        accuracyM: accuracy ?? undefined,
      });

      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });

        if (place) {
          const address = composeAddress(place);
          const pincode = place.postalCode?.trim();

          onChange({
            address: address || value.address,
            // `subregion` is the administrative district; `city` is the
            // fallback for a metro where the two collapse into one name.
            district: place.subregion ?? place.city ?? undefined,
            state: place.region ?? undefined,
            // Only when it is a real PIN. Some geocoders return a partial or
            // foreign-format postcode, and a bad value here is worse than an
            // empty one: the field is what district reports reconcile against.
            pincode: pincode && PINCODE.test(pincode) ? pincode : value.pincode,
          });
          setShowParts(true);
        }
      } catch {
        // Geocoding is the optional half — the coordinates are already saved.
      }

      setStatus({ kind: 'located', at: Date.now() });
    } catch (caught) {
      setStatus({
        kind: 'failed',
        message: caught instanceof Error ? caught.message : 'Could not read the location.',
      });
    }
  }, [onChange, value.address, value.pincode]);

  const pincodeError =
    value.pincode && value.pincode.length > 0 && !PINCODE.test(value.pincode)
      ? 'Six digits, e.g. 560058.'
      : undefined;

  const locating = status.kind === 'locating';
  const hasFix = value.latitude !== undefined && value.longitude !== undefined;

  return (
    <View>
      {/* The group heading carries the action; the input below keeps a label of
          its own, because an unlabelled control is an accessibility defect
          however well the surrounding text reads. */}
      <Row justify="space-between" align="center" style={{ marginBottom: spacing.xs }}>
        <Txt variant="label" color={colors.text}>
          Location of inspection
        </Txt>

        <Pressable
          onPress={() => void locate()}
          disabled={locating}
          accessibilityRole="button"
          accessibilityLabel="Use my current location"
          accessibilityState={{ busy: locating }}
          style={({ pressed }) => [
            styles.locateButton,
            pressed && !locating && { opacity: 0.8 },
            locating && { opacity: 0.6 },
          ]}
        >
          {locating ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="locate" size={15} color={colors.accent} />
          )}
          <Txt variant="label" color={colors.accent}>
            {locating ? 'Locating…' : hasFix ? 'Update' : 'Use my location'}
          </Txt>
        </Pressable>
      </Row>

      <Input
        label="Street address"
        placeholder="Street, area, city"
        icon="location-outline"
        value={value.address}
        onChangeText={(text) => onChange({ address: text })}
        error={error}
        autoCapitalize="words"
        required
        containerStyle={{ marginBottom: spacing.sm }}
      />

      {status.kind === 'denied' ? (
        <Pressable onPress={() => void Linking.openSettings()}>
          <Row align="flex-start" gap={spacing.sm} style={[styles.strip, styles.stripWarning]}>
            <Ionicons name="alert-circle-outline" size={15} color={colors.warning} />
            <Txt variant="caption" color={colors.text} style={{ flex: 1 }}>
              Location permission is off. Tap to open settings, or type the address below.
            </Txt>
          </Row>
        </Pressable>
      ) : null}

      {status.kind === 'failed' ? (
        <Row align="flex-start" gap={spacing.sm} style={[styles.strip, styles.stripWarning]}>
          <Ionicons name="cloud-offline-outline" size={15} color={colors.warning} />
          <Txt variant="caption" color={colors.text} style={{ flex: 1 }}>
            {status.message} You can type the address instead.
          </Txt>
        </Row>
      ) : null}

      {hasFix ? (
        <Row justify="space-between" align="center" gap={spacing.sm} style={styles.fixRow}>
          <Row gap={spacing.sm} align="center" style={{ flex: 1 }}>
            <Badge label="GPS" tone="success" icon="navigate" size="sm" />
            <Txt variant="caption" color={colors.textMuted} numberOfLines={1} style={{ flex: 1 }}>
              {value.latitude?.toFixed(5)}, {value.longitude?.toFixed(5)}
              {value.accuracyM ? ` · ±${Math.round(value.accuracyM)} m` : ''}
            </Txt>
          </Row>

          <Pressable
            onPress={() => setShowParts((open) => !open)}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Txt variant="label" color={colors.accent}>
              {showParts ? 'Hide' : 'Edit'}
            </Txt>
          </Pressable>
        </Row>
      ) : null}

      {showParts || value.district || value.state || value.pincode ? (
        <View style={{ marginTop: spacing.sm }}>
          <Txt variant="caption" color={colors.textFaint} style={{ marginBottom: spacing.sm }}>
            Read from the location. Correct any of them if wrong — the reading is a guess, and
            these are what the district and state reports are grouped by.
          </Txt>

          <Row gap={spacing.md} align="flex-start" style={{ marginBottom: spacing.md }}>
            <Input
              label="District"
              placeholder="District"
              value={value.district ?? ''}
              onChangeText={(text) => onChange({ district: text })}
              autoCapitalize="words"
              containerStyle={{ flex: 1, marginBottom: 0 }}
            />
            <Input
              label="State"
              placeholder="State"
              value={value.state ?? ''}
              onChangeText={(text) => onChange({ state: text })}
              autoCapitalize="words"
              containerStyle={{ flex: 1, marginBottom: 0 }}
            />
          </Row>

          <Input
            label="PIN code"
            placeholder="560058"
            icon="mail-outline"
            value={value.pincode ?? ''}
            // Digits only: the keyboard is numeric, but a paste is not.
            onChangeText={(text) => onChange({ pincode: text.replace(/[^0-9]/g, '').slice(0, 6) })}
            keyboardType="number-pad"
            maxLength={6}
            error={pincodeError}
            containerStyle={{ marginBottom: 0 }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  locateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  strip: {
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  stripWarning: { backgroundColor: colors.warningSoft },
  fixRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
