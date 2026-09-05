import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View, type ImageProps } from 'react-native';

import { colors, radius, spacing } from '../constants/theme';
import { cachedImageUri, ensureImageCached } from '../services/offlineCache';
import { useConnectivityStore, useIsOnline } from '../store/connectivityStore';
import { formatRelative } from '../utils/format';

import { Txt } from './ui';

/**
 * ── SAYING WHICH COPY THIS IS ───────────────────────────────────────────────
 *
 * The whole offline feature turns on one piece of honesty: an officer must
 * always be able to tell a live record from a saved one.
 *
 * It matters more here than in an ordinary app because of what the records are.
 * These screens are read out to dealers and quoted to supervisors. A figure
 * that was true this morning and is presented this afternoon with no indication
 * of its age is not a cached view — it is a wrong answer delivered
 * confidently. So every screen that can serve from the device carries this
 * strip, and the strip always says *when*.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The strip that says where the data on this screen came from.
 *
 * Three states, and the distinction between the first two is the point:
 *
 *   - **Offline, showing a saved copy.** The honest, useful case. Amber, dated,
 *     and not phrased as a failure — nothing has gone wrong; the officer is
 *     looking at their own register with no signal, which is what this was all
 *     built for.
 *   - **Offline, nothing saved.** Still amber, but it says so plainly rather
 *     than implying there is something to read.
 *   - **Online.** Renders nothing at all. A permanent connection indicator is
 *     chrome that stops being read within a day, and it would be occupying the
 *     space that makes the amber one noticeable.
 */
export function OfflineBar({
  savedAt,
  style,
}: {
  /** When the copy on screen was saved. Omitted while the data is live. */
  savedAt?: string | null;
  style?: React.ComponentProps<typeof View>['style'];
}) {
  const online = useIsOnline();
  const probing = useConnectivityStore((state) => state.probing);
  const probe = useConnectivityStore((state) => state.probe);

  // Online and live: nothing to declare.
  if (online && !savedAt) return null;

  /**
   * Online, but this screen is still showing a saved copy.
   *
   * The window between the connection returning and the refresh landing. Said
   * quietly in neutral rather than amber — the officer is about to get live
   * data and does not need a warning about it — but still said, because until
   * the refresh lands the figures are the old ones.
   */
  const reconnected = online && savedAt;

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: reconnected ? colors.neutralSoft : colors.warningSoft },
        style,
      ]}
    >
      <Ionicons
        name={reconnected ? 'sync-outline' : 'cloud-offline-outline'}
        size={16}
        color={reconnected ? colors.neutral : colors.warning}
        style={{ marginTop: 1 }}
      />

      <View style={{ flex: 1 }}>
        <Txt variant="caption" color={colors.text}>
          {reconnected
            ? `Back online — refreshing. Showing the copy saved ${formatRelative(savedAt)}.`
            : savedAt
              ? `Offline — showing your saved records from ${formatRelative(savedAt)}. Pull down to refresh once you have signal.`
              : 'Offline — this has not been saved to the device yet. Connect once to keep it available here.'}
        </Txt>
      </View>

      {/* A way to ask again without leaving the screen. Only offered while
          offline: online, a refresh is already on its way and a second button
          for it would just race the first. */}
      {!online ? (
        <Pressable
          onPress={() => void probe()}
          disabled={probing}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Check for a connection"
          style={styles.retry}
        >
          {probing ? (
            <ActivityIndicator size="small" color={colors.warning} />
          ) : (
            <Ionicons name="refresh" size={15} color={colors.warning} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A note that one action needs a connection.
 *
 * Used where a button has had to be disabled rather than where data is merely
 * stale — filing an inspection, running a scan. Kept deliberately separate from
 * `OfflineBar`: "what you are reading is old" and "what you are about to do
 * cannot happen yet" are different messages, and merging them into one strip
 * would leave the officer unsure which applied.
 */
export function NeedsConnection({ action }: { action: string }) {
  const online = useIsOnline();
  if (online) return null;

  return (
    <View style={[styles.bar, { backgroundColor: colors.warningSoft }]}>
      <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} style={{ marginTop: 1 }} />
      <Txt variant="caption" color={colors.text} style={{ flex: 1 }}>
        {action} needs a connection to the departmental server. Your saved records are still
        readable here.
      </Txt>
    </View>
  );
}

/**
 * An image that survives losing the connection.
 *
 * Label photographs are served by the backend, so every one of them is a URL
 * that fails with no signal — and a report is not a report when its evidence is
 * four grey boxes. This resolves the local copy when there is one, falls back
 * to the network when there is not, and quietly saves what it fetches so the
 * next read works offline.
 *
 * Everything else about it is a plain `<Image>`, so it drops into the existing
 * call sites without changing their layout.
 */
export function RemoteImage({ uri, ...rest }: { uri: string } & Omit<ImageProps, 'source'>) {
  return <Image {...rest} source={{ uri: useCachedUri(uri) }} />;
}

/**
 * The best URI available for a photograph right now.
 *
 * Exists as a hook as well as a component because the zoomable viewer renders
 * an `Animated.Image`, which `RemoteImage` cannot wrap — and the full-screen
 * viewer is precisely where an officer is examining a label they cannot read at
 * thumbnail size, so it is the last place that should break offline.
 *
 * Resolves synchronously on the first render when the file is already on disk,
 * which is the common case for a record being re-opened. A local `file://` URI
 * from a capture in progress passes straight through untouched.
 */
export function useCachedUri(uri: string): string {
  const [resolved, setResolved] = useState<string>(() => cachedImageUri(uri) ?? uri);

  useEffect(() => {
    let active = true;

    const local = cachedImageUri(uri);
    if (local) {
      setResolved(local);
      return () => {
        active = false;
      };
    }

    setResolved(uri);

    // Not on the device yet. Fetched in the background so the *next* time this
    // record is opened — plausibly with no signal — the photograph is there.
    void ensureImageCached(uri).then((cached) => {
      if (active && cached) setResolved(cached);
    });

    return () => {
      active = false;
    };
  }, [uri]);

  return resolved;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  retry: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
