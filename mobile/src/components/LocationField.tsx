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
 * `subregion` is left out of the street line entirely — it is the
 * administrative district and it has a field of its own below, for the same
 * reason the PIN does.
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

/**
 * ── THE DISTRICT, AND WHY IT WAS WRONG ──────────────────────────────────────
 *
 * `district` was being filled as `subregion ?? city`, and the fallback is the
 * bug. They are not two names for one thing:
 *
 *   · `subregion` is `subAdministrativeArea` — the administrative district.
 *     Pune. Thane. Bengaluru Urban. This is what the field wants.
 *   · `city` is `locality` — the town. Pimpri-Chinchwad. Kalyan. Whitefield.
 *
 * On Android `subregion` is frequently null, so the fallback fired constantly
 * and quietly wrote a town name into a district field. An officer standing in
 * Pimpri got "Pimpri-Chinchwad" where the record needed "Pune" — and it looked
 * filled in and correct, which is why nobody caught it at the time rather than
 * at reconciliation.
 *
 * Two changes. The fallback to `city` is gone: this field is what district
 * reports reconcile against, and a wrong value in it is worse than an empty
 * one — exactly the reasoning already applied to the PIN a few lines below.
 * And rather than reading only the first result, every result the geocoder
 * returned is scanned, because the first is often the most *specific* rather
 * than the most complete and a later one routinely carries the district the
 * first one omitted.
 *
 * When none of them knows it, the field is left alone and the inspector is
 * told — a question they can answer in two seconds while standing there beats
 * a plausible wrong answer nobody questions.
 */
/**
 * ── AND WHY IT WAS STILL WRONG IN BIHAR ─────────────────────────────────────
 *
 * An inspection in Begusarai, PIN 851117, was filed against "Munger Division".
 *
 * That is not a mis-read. Begusarai district sits inside Munger Division, one
 * of the nine revenue divisions Bihar groups its districts into — the geocoder
 * answered a level too coarse, and the value it gave was true at that level.
 *
 * It happens because Google's administrative hierarchy is not the same depth
 * everywhere in India. In most states level 2 — what Android hands over as
 * `subAdministrativeArea`, and what Expo calls `subregion` — is the district.
 * In Bihar (and it is not alone) level 2 is the *division* and the district
 * sits a level below, where Android's `Address` has no field for it at all.
 *
 * So a division must never reach the District field. It is not merely
 * imprecise: enforcement is reported and reconciled by district, and one
 * record filed against a division silently merges six districts' worth of
 * inspections into a group that does not exist on any return.
 *
 * When the division shows up, the hierarchy has an extra rung — which means
 * the town underneath it, `city`, is one rung closer to the district than it
 * would be in Pune or Thane, and in Bihar it is very often the district's own
 * name. So it is offered as a candidate rather than discarded, and the field
 * says where it came from: the officer confirms it with a glance, which is the
 * one check nobody else downstream is in a position to make.
 */
const DIVISION = /\b(division|divn\.?|commissionerate)\b/i;

interface DistrictGuess {
  name: string;
  /** True when this came from the town, not from the administrative level. */
  fromTown: boolean;
}

function pickDistrict(places: Location.LocationGeocodedAddress[]): DistrictGuess | undefined {
  let sawDivision = false;

  for (const place of places) {
    const value = place.subregion?.trim();
    if (!value) continue;

    if (DIVISION.test(value)) {
      sawDivision = true;
      continue;
    }

    // "Pune District" and "Pune" have to be one value, or two inspections in
    // the same district group as two.
    return { name: value.replace(/\s+district$/i, '').trim(), fromTown: false };
  }

  // Only where the geocoder proved it is answering at division level. Without
  // that proof `city` is a town — Pimpri-Chinchwad, not Pune — and the old bug
  // this function was written to fix.
  if (sawDivision) {
    for (const place of places) {
      const town = place.city?.trim();
      if (town && !DIVISION.test(town)) {
        return { name: town.replace(/\s+district$/i, '').trim(), fromTown: true };
      }
    }
  }

  return undefined;
}

function pickState(places: Location.LocationGeocodedAddress[]): string | undefined {
  for (const place of places) {
    const value = place.region?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Six digits, the only shape an Indian PIN takes. */
const PINCODE = /^[1-9][0-9]{5}$/;

/**
 * The PIN, from whichever result carries a real one.
 *
 * Only a well-formed Indian PIN is accepted. Some geocoders answer with a
 * partial or foreign-format postcode, and a bad value here is worse than an
 * empty one for the same reason the district is.
 */
function pickPincode(places: Location.LocationGeocodedAddress[]): string | undefined {
  for (const place of places) {
    const value = place.postalCode?.trim();
    if (value && PINCODE.test(value)) return value;
  }
  return undefined;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'located'; at: number }
  /** Resolved from an address the inspector typed, not from the receiver. */
  | { kind: 'searched' }
  | { kind: 'denied' }
  /** Granted, but only to the nearest few kilometres. */
  | { kind: 'coarse' }
  | { kind: 'failed'; message: string };

/**
 * ── HOW EXACT THE FIX HAS TO BE ─────────────────────────────────────────────
 *
 * `Accuracy.Balanced` is documented as "accurate to within one hundred
 * metres", and it was chosen here on the reasoning that a shopfront does not
 * need sub-metre precision. That is true and it is the wrong conclusion: a
 * hundred metres is an entire market row. The coordinate on this record is the
 * evidence of which premises were inspected, and a fix that cannot separate
 * one shop from its neighbours does not establish that.
 *
 * `High` is ten metres, which does separate them. It costs a few seconds more,
 * and the seconds are bounded below rather than left to the device: indoors,
 * behind a shutter, a high-accuracy request can sit on the satellites for a
 * minute and the button just spins.
 */
const FIX_ACCURACY = Location.Accuracy.High;

/**
 * Good enough to stop looking.
 *
 * `getCurrentPositionAsync` waits for the accuracy it was asked for and hands
 * back one answer at the end, which on a High request is several seconds of
 * spinner even when a perfectly usable fix arrived in the first one. The
 * receiver does not work that way — it produces a stream that tightens, 60 m
 * then 25 m then 9 m — so this reads the stream and stops at the first fix that
 * can tell one shopfront from the next. Outdoors that is usually the second or
 * third reading, about a second in.
 */
/**
 * ── HOW LONG TO KEEP WAITING, AND FOR WHAT ──────────────────────────────────
 *
 * A single threshold of 20 m was the whole reason this took so long.
 *
 * Twenty metres is the right target and it is not a condition an inspector
 * indoors can meet. Standing inside a shop, behind a shutter, under a
 * concrete slab, the receiver settles at 30-60 m and stays there — so the
 * threshold was never satisfied, the watch ran to its full eight-second
 * deadline every single time, and the officer waited eight seconds to be
 * handed a fix that had stopped improving after two.
 *
 * The threshold is now a function of how long the officer has already been
 * waiting. Precision is still preferred and still stops the clock the instant
 * it arrives; what changes is that a fix which is merely good is accepted
 * rather than being made to wait out a target it is never going to reach.
 *
 * The rungs are not arbitrary. 20 m separates one shopfront from the next,
 * which is what the coordinate has to do. 60 m is a market row — worth having
 * as a record of roughly where the officer stood, and `fixQuality` already
 * labels it "Approximate" and tells them to step into the doorway and update.
 * 200 m is a network fix, still better than nothing and labelled "Poor".
 */
const FIX_LADDER: Array<{ afterMs: number; acceptM: number }> = [
  { afterMs: 0, acceptM: 20 },
  { afterMs: 2_000, acceptM: 60 },
  { afterMs: 4_000, acceptM: 200 },
];

/** How long to keep tightening before settling for the best so far. */
const FIX_DEADLINE_MS = 6_000;

/** The tightest radius still worth waiting for, this far into the wait. */
function acceptableAt(elapsedMs: number): number {
  let accept = FIX_LADDER[0]!.acceptM;
  for (const rung of FIX_LADDER) {
    if (elapsedMs >= rung.afterMs) accept = rung.acceptM;
  }
  return accept;
}

/**
 * A fix the operating system already had, shown while the real one resolves.
 *
 * Bounded hard on both age and radius. A stale or vague cached position is
 * worse than an empty field on a record that says where an inspection
 * happened, so two minutes and a hundred metres is the most it may be — and
 * the streaming fix overwrites it within seconds regardless.
 */
const LAST_KNOWN_MAX_AGE_MS = 120_000;
const LAST_KNOWN_MAX_RADIUS_M = 100;

/**
 * Watches the receiver and resolves with the best fix it produced.
 *
 * Resolves early the moment one is accurate enough, and at the deadline
 * otherwise. `undefined` means nothing arrived at all, which is the caller's
 * cue to fall back to a coarse single reading.
 */
function bestFixWithin(
  deadlineMs: number,
  onProgress: (fix: Location.LocationObject) => void,
): Promise<Location.LocationObject | undefined> {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    let best: Location.LocationObject | undefined;
    let subscription: Location.LocationSubscription | undefined;
    let settled = false;

    const timers: Array<ReturnType<typeof setTimeout>> = [];

    const finish = (): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      subscription?.remove();
      resolve(best);
    };

    /** Settles if what we already hold now clears the current rung. */
    const reconsider = (): void => {
      const radius = best?.coords.accuracy ?? Number.POSITIVE_INFINITY;
      if (radius <= acceptableAt(Date.now() - startedAt)) finish();
    };

    timers.push(setTimeout(finish, deadlineMs));

    /**
     * Each rung gets its own wake-up.
     *
     * Without them, a receiver that produces a steady 40 m fix and then goes
     * quiet would sit until the deadline: the reading that would have cleared
     * the second rung arrived before that rung opened, and nothing later comes
     * along to re-test it. This re-tests what is already in hand the moment
     * the bar drops.
     */
    for (const rung of FIX_LADDER) {
      if (rung.afterMs > 0) timers.push(setTimeout(reconsider, rung.afterMs));
    }

    Location.watchPositionAsync(
      { accuracy: FIX_ACCURACY, timeInterval: 500, distanceInterval: 0 },
      (fix) => {
        const radius = fix.coords.accuracy ?? Number.POSITIVE_INFINITY;
        const bestRadius = best?.coords.accuracy ?? Number.POSITIVE_INFINITY;

        // Only ever tighten. A later, vaguer reading is not news.
        if (radius < bestRadius) {
          best = fix;
          onProgress(fix);
        }

        reconsider();
      },
    )
      .then((active) => {
        // The stream can satisfy the threshold before the subscription handle
        // comes back, and an unremoved watch runs the receiver until the app
        // is killed.
        if (settled) active.remove();
        else subscription = active;
      })
      .catch(finish);
  });
}

/**
 * What a given accuracy radius is good enough for.
 *
 * Shown to the inspector rather than kept in the record alone, because they
 * are the only person who can do anything about it — stepping into the doorway
 * turns a 300 m cell-tower fix into a 8 m satellite one, and nobody does that
 * unless told the first one was poor. A fix reading ±2000 m looks exactly like
 * one reading ±8 m if the number is printed without a verdict beside it.
 */
function fixQuality(accuracyM?: number): {
  tone: 'success' | 'warning';
  label: string;
  advice?: string;
} {
  if (accuracyM === undefined) return { tone: 'warning', label: 'Unknown accuracy' };
  if (accuracyM <= 20) return { tone: 'success', label: 'Precise' };

  if (accuracyM <= 75) {
    return {
      tone: 'warning',
      label: 'Approximate',
      advice: 'This can be the wrong shop in a market row. Step into the doorway and update.',
    };
  }

  return {
    tone: 'warning',
    label: 'Poor',
    advice:
      'This is a network fix, not a satellite one, and it does not identify a premises. Go outside and update before continuing.',
  };
}

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
  /** The address lookup, which outlives the fix and must not hold the spinner. */
  const [geocoding, setGeocoding] = useState(false);
  /**
   * What the lookup was able to say about the district. See `pickDistrict`.
   *
   * `unconfirmed` is not a lesser `missing`: the field is filled, and what is
   * being asked is whether the town it was filled from is the district — a
   * question only the officer standing there can answer.
   */
  const [districtNote, setDistrictNote] = useState<'none' | 'missing' | 'unconfirmed'>('none');
  /** The typed-address lookup is running. */
  const [searching, setSearching] = useState(false);

  const locate = useCallback(async () => {
    setStatus({ kind: 'locating' });
    setDistrictNote('none');

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setStatus({ kind: 'denied' });
        return;
      }

      /**
       * Android 12 lets the user grant "Approximate" instead of "Precise", and
       * it is the default on the permission sheet. That caps every fix at
       * kilometres however the request is made, and nothing in the reading
       * afterwards says why — so it is read here, where it can be explained,
       * rather than left to surface as a mysteriously bad accuracy.
       */
      const coarseOnly = permission.android?.accuracy === 'coarse';

      const applyFix = (fix: Location.LocationObject): void => {
        onChange({
          latitude: fix.coords.latitude,
          longitude: fix.coords.longitude,
          accuracyM: fix.coords.accuracy ?? undefined,
        });
      };

      /**
       * Something on screen immediately, where the OS already has one.
       *
       * The inspector is standing in the shop and the map app they used to get
       * there fixed this position a minute ago. Showing that at once, and
       * replacing it as the receiver tightens, is the difference between a
       * field that fills instantly and one that spins for five seconds — for
       * the same final coordinate.
       */
      const cached = await Location.getLastKnownPositionAsync({
        maxAge: LAST_KNOWN_MAX_AGE_MS,
        requiredAccuracy: LAST_KNOWN_MAX_RADIUS_M,
      });

      if (cached) applyFix(cached);

      // Each tightening lands on screen as it arrives, so the accuracy figure
      // counts down rather than appearing at the end.
      const streamed = await bestFixWithin(FIX_DEADLINE_MS, applyFix);

      /**
       * Nothing from the receiver at all — indoors, or no satellite lock. A
       * network fix is worth having, and `fixQuality` will say what it is.
       *
       * Bounded, because `getCurrentPositionAsync` has no timeout of its own
       * and this is the one path left that could leave the button spinning
       * indefinitely. Reached only when eight seconds of watching produced
       * nothing, which already says the receiver is in trouble.
       */
      // `getLastKnownPositionAsync` answers with null, the watch with undefined.
      let fix: Location.LocationObject | undefined = streamed ?? cached ?? undefined;

      if (!fix) {
        fix = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 6_000)),
        ]);
      }

      if (!fix) {
        setStatus({
          kind: 'failed',
          message: 'No location fix — the receiver returned nothing.',
        });
        return;
      }

      applyFix(fix);

      /**
       * The spinner stops here, before the address.
       *
       * Reverse geocoding is a separate lookup that on Android goes to the
       * network, and it was being awaited inside the same spinner — so a fix
       * that had been in hand for two seconds still read as "Locating…" while
       * a street name was fetched. The coordinate is the record; the address
       * is a convenience on top of it, and it can arrive on its own.
       */
      setStatus(coarseOnly ? { kind: 'coarse' } : { kind: 'located', at: Date.now() });

      const { latitude, longitude } = fix.coords;
      setGeocoding(true);

      try {
        const places = await Location.reverseGeocodeAsync({ latitude, longitude });
        const [place] = places;

        if (place) {
          const address = composeAddress(place);
          const district = pickDistrict(places);

          /**
           * Every part falls back to what is already there.
           *
           * A geocoder that knows the street but not the district would
           * otherwise blank a district the inspector had typed, which is the
           * one thing a convenience feature must never do to a field somebody
           * filled in by hand.
           */
          onChange({
            address: address || value.address,
            district: district?.name ?? value.district,
            state: pickState(places) ?? value.state,
            pincode: pickPincode(places) ?? value.pincode,
          });
          setShowParts(true);

          // Nothing in any result knew the district and nothing was typed. Say
          // so, rather than leaving a required field silently blank on a form
          // the officer is about to submit.
          setDistrictNote(
            district?.fromTown
              ? 'unconfirmed'
              : !district && !value.district?.trim()
                ? 'missing'
                : 'none',
          );
        }
      } catch {
        // Geocoding is the optional half — the coordinates are already saved.
      } finally {
        setGeocoding(false);
      }
    } catch (caught) {
      setGeocoding(false);
      setStatus({
        kind: 'failed',
        message: caught instanceof Error ? caught.message : 'Could not read the location.',
      });
    }
  }, [onChange, value.address, value.district, value.state, value.pincode]);
  /**
   * ── WHEN THE RECEIVER IS WRONG ──────────────────────────────────────────
   *
   * The remedy a delivery app gives you: stop arguing with the satellites and
   * say where you actually are.
   *
   * A GPS fix taken inside a concrete building can land on the wrong side of
   * the street, and no amount of waiting corrects it — the receiver is
   * confidently wrong, not slow. The officer, standing there, knows the
   * address. Typing it and resolving *that* is both faster and more accurate
   * than another thirty seconds of hoping.
   *
   * The result is marked as what it is. A typed address carries no measured
   * accuracy, so the badge reads "From address" rather than borrowing the
   * language of a satellite fix — a coordinate on an enforcement record has to
   * say how it was arrived at.
   */
  const searchTypedAddress = useCallback(async () => {
    const query = value.address.trim();
    if (query.length < 6) return;

    setSearching(true);
    setDistrictNote('none');

    try {
      const [hit] = await Location.geocodeAsync(query);

      if (!hit) {
        setStatus({ kind: 'failed', message: 'No place matched that address.' });
        return;
      }

      // No `accuracyM`: nothing measured this, and an invented radius would be
      // the one number on this record nobody could defend.
      onChange({ latitude: hit.latitude, longitude: hit.longitude, accuracyM: undefined });

      const places = await Location.reverseGeocodeAsync({
        latitude: hit.latitude,
        longitude: hit.longitude,
      });
      const district = pickDistrict(places);

      onChange({
        district: district?.name ?? value.district,
        state: pickState(places) ?? value.state,
        pincode: pickPincode(places) ?? value.pincode,
      });

      setStatus({ kind: 'searched' });
      setShowParts(true);
      setDistrictNote(
        district?.fromTown
          ? 'unconfirmed'
          : !district && !value.district?.trim()
            ? 'missing'
            : 'none',
      );
    } catch {
      setStatus({ kind: 'failed', message: 'Address lookup failed.' });
    } finally {
      setSearching(false);
    }
  }, [onChange, value.address, value.district, value.state, value.pincode]);

  const pincodeError =
    value.pincode && value.pincode.length > 0 && !PINCODE.test(value.pincode)
      ? 'Six digits, e.g. 560058.'
      : undefined;

  const locating = status.kind === 'locating';
  const hasFix = value.latitude !== undefined && value.longitude !== undefined;
  const fromAddress = status.kind === 'searched';
  const quality = fixQuality(value.accuracyM);
  const canSearch = value.address.trim().length >= 6 && !searching && !locating;

  /**
   * ── HOW MUCH THIS FIELD IS ALLOWED TO SAY ───────────────────────────────
   *
   * Once a fix landed, this component printed five things beneath itself: the
   * coordinate, a spinner caption, a two-sentence verdict on the accuracy, a
   * two-line explanation of what the district and state inputs were for, and
   * then the inputs. All of it was true, and most of it was read once — by
   * whoever wrote it.
   *
   * A form an officer fills in twenty times a day cannot narrate itself. What
   * survives is what changes a decision:
   *
   *   · the coordinate and its radius — the evidence, and the thing they may
   *     be asked to account for;
   *   · one short line, only when the fix is too poor to identify a premises,
   *     because that is the only case where there is something to do about it;
   *   · the corrections, as ordinary inputs with no preamble.
   *
   * The rest moved behind "Fix", where somebody who has decided the location
   * is wrong will go looking for it.
   */
  return (
    <View>
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

      {/* Permission problems keep a strip of their own: they are the one class
          of failure the officer cannot work around from inside this form. */}
      {status.kind === 'denied' ? (
        <Pressable onPress={() => void Linking.openSettings()}>
          <Row align="center" gap={spacing.sm} style={[styles.strip, styles.stripWarning]}>
            <Ionicons name="alert-circle-outline" size={15} color={colors.warning} />
            <Txt variant="caption" color={colors.text} style={{ flex: 1 }}>
              Location is off. Tap to allow it, or type the address.
            </Txt>
          </Row>
        </Pressable>
      ) : null}

      {status.kind === 'coarse' ? (
        <Pressable onPress={() => void Linking.openSettings()}>
          <Row align="center" gap={spacing.sm} style={[styles.strip, styles.stripWarning]}>
            <Ionicons name="warning-outline" size={15} color={colors.warning} />
            <Txt variant="caption" color={colors.text} style={{ flex: 1 }}>
              Only approximate location is allowed. Tap to grant precise.
            </Txt>
          </Row>
        </Pressable>
      ) : null}

      {status.kind === 'failed' ? (
        <Row align="center" gap={spacing.sm} style={[styles.strip, styles.stripWarning]}>
          <Ionicons name="cloud-offline-outline" size={15} color={colors.warning} />
          <Txt variant="caption" color={colors.text} style={{ flex: 1 }}>
            {status.message}
          </Txt>
        </Row>
      ) : null}

      {hasFix ? (
        <View style={styles.fixRow}>
          <Row justify="space-between" align="center" gap={spacing.sm}>
            <Row gap={spacing.sm} align="center" style={{ flex: 1 }}>
              <Badge
                label={fromAddress ? 'From address' : quality.label}
                tone={fromAddress ? 'neutral' : quality.tone}
                icon={fromAddress ? 'create-outline' : 'navigate'}
                size="sm"
              />
              <Txt variant="caption" color={colors.textMuted} numberOfLines={1} style={{ flex: 1 }}>
                {value.latitude?.toFixed(5)}, {value.longitude?.toFixed(5)}
                {value.accuracyM ? ` · ±${Math.round(value.accuracyM)} m` : ''}
              </Txt>
            </Row>

            <Pressable
              onPress={() => setShowParts((open) => !open)}
              accessibilityRole="button"
              accessibilityLabel={showParts ? 'Hide location details' : 'Fix the location'}
              hitSlop={8}
            >
              <Txt variant="label" color={colors.accent}>
                {showParts ? 'Hide' : 'Fix'}
              </Txt>
            </Pressable>
          </Row>

          {geocoding ? (
            <Row gap={spacing.sm} align="center" style={{ marginTop: spacing.sm }}>
              <ActivityIndicator size="small" color={colors.textFaint} />
              <Txt variant="caption" color={colors.textFaint}>
                Reading the address…
              </Txt>
            </Row>
          ) : null}

          {/* Only for a fix too vague to identify a premises. "Approximate" is
              already said by the badge and needs no paragraph under it. */}
          {!fromAddress && quality.label === 'Poor' ? (
            <Txt variant="caption" color={colors.warning} style={{ marginTop: spacing.xs }}>
              Network fix — step outside and update.
            </Txt>
          ) : null}
        </View>
      ) : null}

      {showParts || value.district || value.state || value.pincode ? (
        <View style={{ marginTop: spacing.sm }}>
          {/* The remedy, where somebody who has decided the pin is wrong will
              look for it. Resolving what they typed beats waiting on a
              receiver that is confidently pointing at the wrong building. */}
          {showParts ? (
            <Pressable
              onPress={() => void searchTypedAddress()}
              disabled={!canSearch}
              accessibilityRole="button"
              accessibilityLabel="Find the coordinates for the address above"
              style={({ pressed }) => [
                styles.searchButton,
                pressed && canSearch && { opacity: 0.8 },
                !canSearch && { opacity: 0.45 },
              ]}
            >
              {searching ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="search" size={14} color={colors.accent} />
              )}
              <Txt variant="label" color={colors.accent}>
                {searching ? 'Searching…' : 'Locate the address above instead'}
              </Txt>
            </Pressable>
          ) : null}

          <Row gap={spacing.md} align="flex-start" style={{ marginBottom: spacing.md }}>
            <Input
              label="District"
              placeholder="District"
              value={value.district ?? ''}
              onChangeText={(text) => {
                setDistrictNote('none');
                onChange({ district: text });
              }}
              autoCapitalize="words"
              // Not an error — nothing is wrong with what the officer did. It
              // is the one thing the lookup could not answer, said once, on
              // the field that has to carry it.
              hint={
                districtNote === 'missing'
                  ? 'Not found — please enter'
                  : districtNote === 'unconfirmed'
                    ? 'From the town — check it is the district'
                    : undefined
              }
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
  /**
   * The address-search action.
   *
   * Outlined and full width rather than a pill like the locate button: this
   * one sits inside the corrections block where it is the only action, and a
   * second small pill beside nothing reads as an afterthought.
   */
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  fixRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
