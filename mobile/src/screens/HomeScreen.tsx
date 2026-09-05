import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useCallback } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { GovHeader } from '../components/branding';
import { OfflineBar } from '../components/offline';
import { InspectionCard, StatTile, StatTileRowSkeleton } from '../components/domain';
import { Body, Notice, Screen } from '../components/layout';
import {
  Card,
  EmptyState,
  ErrorState,
  Pagination,
  Row,
  SectionHeader,
  Skeleton,
  Txt,
} from '../components/ui';
import { colors, radius, shadow, spacing } from '../constants/theme';
import { useAuthStore } from '../store/authStore';
import { useHistoryStore, type StatusFilter } from '../store/historyStore';
import { useAnalysisStore } from '../store/analysisStore';
import { useImageStore } from '../store/imageStore';
import { useInspectionStore } from '../store/inspectionStore';
import { formatDate, greetingFor, pluralize } from '../utils/format';

export function HomeScreen() {
  const navigation = useNavigation();
  const inspector = useAuthStore((state) => state.inspector);

  // The week-scoped Home list, not History's filtered one — see `historyStore`.
  const items = useHistoryStore((state) => state.recent);
  const page = useHistoryStore((state) => state.recentPage);
  const totalPages = useHistoryStore((state) => state.recentTotalPages);
  const setPage = useHistoryStore((state) => state.setRecentPage);
  const stats = useHistoryStore((state) => state.stats);
  const loading = useHistoryStore((state) => state.recentLoading);
  const refreshing = useHistoryStore((state) => state.refreshing);
  const error = useHistoryStore((state) => state.error);
  const refreshAll = useHistoryStore((state) => state.refreshAll);

  // Whether this screen is showing the server's register or the device's copy
  // of it, and how old that copy is. Home is the first screen after launch, so
  // it is where an officer with no signal finds out.
  const fromCache = useHistoryStore((state) => state.fromCache);
  const cachedAt = useHistoryStore((state) => state.cachedAt);
  const statsAreDerived = useHistoryStore((state) => state.statsAreDerived);

  const resetInspection = useInspectionStore((state) => state.reset);
  const resetImages = useImageStore((state) => state.reset);
  const resetAnalysis = useAnalysisStore((state) => state.reset);

  /**
   * Starting an inspection clears every per-inspection store, then hands over to
   * the Inspect tab. Clearing here rather than on the details screen means a
   * half-finished capture can never leak into the next inspection.
   *
   * There is no longer a draft to ask about: a capture interrupted by the app
   * closing is discarded at launch, so this always starts from an empty form.
   */
  const startInspection = useCallback(() => {
    resetInspection();
    resetImages();
    resetAnalysis();
    navigation.navigate('Tabs', { screen: 'Inspect' });
  }, [
    resetInspection,
    resetImages,
    resetAnalysis,
    navigation,
  ]);

  const setStatusFilter = useHistoryStore((state) => state.setStatusFilter);
  const clearFilters = useHistoryStore((state) => state.clearFilters);

  /**
   * A tile is a count of one verdict, so tapping it opens exactly the records
   * behind that number — four tiles that all land on the same unfiltered list
   * tell an inspector nothing about which figure they just tapped.
   *
   * Any search or date narrowing left over from a previous visit is cleared
   * first, or the list would arrive holding fewer records than the count that
   * was tapped to reach it.
   */
  const openHistory = useCallback(
    (status: StatusFilter) => {
      clearFilters();
      if (status !== 'all') setStatusFilter(status);
      navigation.navigate('Tabs', { screen: 'History' });
    },
    [clearFilters, setStatusFilter, navigation],
  );

  return (
    <Screen edges={[]}>
      <GovHeader
        officerName={inspector?.name}
        officerId={inspector?.employeeId}
        officerZone={inspector?.zone ?? 'Field Operations'}
      />

      <Body
        contentStyle={{ paddingTop: spacing.lg }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refreshAll()}
            tintColor={colors.text}
          />
        }
      >
        <OfflineBar
          savedAt={fromCache ? cachedAt : null}
          style={{ marginBottom: spacing.md }}
        />

        {/* Greeting. Sits on the page rather than in the masthead, so the
            masthead stays the department's and not the session's. */}
        <Row justify="space-between" align="flex-end">
          <View style={{ flex: 1 }}>
            <Txt variant="caption" color={colors.textMuted}>
              {greetingFor()},
            </Txt>
            {/* The full name, not just the first. An officer's record is filed
                under their full name and badge, and greeting them by half of it
                reads as a consumer app rather than a departmental one. Two
                lines are allowed so a long name wraps instead of truncating. */}
            <Txt variant="title" numberOfLines={2} style={{ marginTop: 2 }}>
              {inspector?.name ?? 'Inspector'}
            </Txt>
          </View>
          <Txt variant="caption" color={colors.textFaint}>
            {formatDate(new Date())}
          </Txt>
        </Row>

        {/* The primary action. Given the whole width and placed above
            everything else, because starting an inspection is the one thing an
            officer opens this app to do. It holds that position on geometry —
            full width, raised, first — rather than on a field of colour, which
            leaves the colour budget to the status tiles below, where it is
            carrying meaning.

            One line of text and nothing else. The explanatory second line was
            describing the next three screens to someone who has already decided
            to open them, and it made the tallest element on the page the one
            with the least to say. */}
        <Pressable
          onPress={startInspection}
          accessibilityRole="button"
          accessibilityLabel="Start a new inspection"
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <View style={styles.ctaIcon}>
            <Ionicons name="scan-outline" size={22} color={colors.text} />
          </View>

          <View style={{ flex: 1 }}>
            <Txt variant="heading">Start New Inspection</Txt>
          </View>

          {/* The arrow gets a ring rather than sitting loose against the edge.
              On an outlined button the right side is otherwise empty, and a
              bare glyph there reads as decoration; a ring makes it the second
              affordance the eye finds after the label. */}
          <View style={styles.ctaArrow}>
            <Ionicons name="arrow-forward" size={17} color={colors.text} />
          </View>
        </Pressable>

        {/* "Overview", not "Today's Overview", which is what stood here.
            These four counts come from `/inspections/stats`, which aggregates
            an officer's entire record set — and each tile opens the whole
            unfiltered history behind it. Nothing about them was ever today's,
            so the heading was quietly overstating a number an officer might
            repeat to a supervisor. Scoping them to today would need the
            aggregate endpoint to take a date range; renaming the section makes
            it true today. */}
        <SectionHeader
          title="Overview"
          /* Only when the counts were computed from the records the device
             happens to hold rather than returned by the aggregate endpoint. An
             officer may read these four numbers out to a supervisor, and a
             subtotal quoted as a total is the one failure this whole feature
             must not introduce. */
          subtitle={statsAreDerived ? 'Counted from the records saved on this device' : undefined}
          style={{ marginTop: spacing.xl }}
        />

        {loading && items.length === 0 ? (
          <>
            <StatTileRowSkeleton />
            <StatTileRowSkeleton style={{ marginTop: spacing.md }} />
          </>
        ) : (
          <>
            <Row gap={spacing.md} align="stretch">
              <StatTile
                label="Total Inspections"
                value={stats.totalInspections}
                icon="clipboard-outline"
                tone="info"
                onPress={() => openHistory('all')}
              />
              <StatTile
                label="Pending Reviews"
                value={stats.pendingReviews}
                icon="hourglass-outline"
                tone="warning"
                onPress={() => openHistory('review_required')}
              />
            </Row>

            <Row gap={spacing.md} align="stretch" style={{ marginTop: spacing.md }}>
              <StatTile
                label="Compliant"
                value={stats.compliant}
                icon="shield-checkmark-outline"
                tone="success"
                onPress={() => openHistory('compliant')}
              />
              <StatTile
                label="Violations"
                value={stats.violations}
                icon="alert-circle-outline"
                tone="danger"
                onPress={() => openHistory('violation')}
              />
            </Row>
          </>
        )}

        {/* No dashboard card here.
            
            What stood here was an "Average compliance score" headline — the
            mean of (checks passed / applicable checks) across records — and it
            was removed rather than restyled. The figure re-collapsed the rule
            engine's five states into one number, hid the finding that matters
            (one missing MRP out of twenty checks scores 95%, and rule 6(1)(e)
            is graded CRITICAL — there is no 95% compliant), and partly measured
            the camera rather than the trader, since only COMPLIANT counts as a
            pass and a lawful package shot from one face scored badly.

            Its replacement was a card whose only job was to link to the
            Reports tab, which the tab bar already does. The four tiles above
            carry the real counts; nothing further belongs between them and the
            inspection list. */}

        {/* The store already serves exactly one page of `PAGE_SIZE` (10) and
            owns `page` / `totalPages` / `setPage`, so this list shows the whole
            page and pages through the store's own pages. A second, client-side
            pager over an already-paged array would have claimed "page 2 of 1"
            the moment there were more than ten records on the server. */}
        <SectionHeader
          title="Recent Inspections"
          subtitle="Last 7 days"
          action={items.length > 0 ? 'View all' : undefined}
          // Clears History's filters on the way, so "View all" lands on all of
          // them rather than on whatever the inspector last narrowed it to.
          onAction={() => openHistory('all')}
          style={{ marginTop: spacing.xl }}
        />

        {error ? (
          <Card>
            <ErrorState
              message={error.message}
              onRetry={error.retryable ? () => void refreshAll() : undefined}
            />
          </Card>
        ) : loading && items.length === 0 ? (
          <>
            <Card style={{ marginBottom: spacing.md }}>
              <Skeleton height={14} width="40%" />
              <Skeleton height={18} width="70%" style={{ marginTop: spacing.sm }} />
              <Skeleton height={12} width="50%" style={{ marginTop: spacing.sm }} />
            </Card>
            <Card>
              <Skeleton height={14} width="40%" />
              <Skeleton height={18} width="70%" style={{ marginTop: spacing.sm }} />
              <Skeleton height={12} width="50%" style={{ marginTop: spacing.sm }} />
            </Card>
          </>
        ) : items.length === 0 ? (
          <Card>
            {/* Two different emptinesses, and telling an officer the wrong one
                is worse than saying nothing. With a seven-day window, a list
                can be empty because nothing has ever been filed *or* because
                nothing was filed this week — and an officer with two hundred
                records reading "No inspections yet" would reasonably conclude
                the app had lost them. */}
            {stats.totalInspections === 0 ? (
              <EmptyState
                icon="clipboard-outline"
                title="No inspections yet"
                message="Start your first inspection to see it recorded here."
                action="Start New Inspection"
                onAction={startInspection}
              />
            ) : (
              <EmptyState
                icon="calendar-outline"
                title="Nothing in the last 7 days"
                message={`${pluralize(stats.totalInspections, 'earlier inspection')} still on record.`}
                action="View all inspections"
                onAction={() => openHistory('all')}
              />
            )}
          </Card>
        ) : (
          <>
            {items.map((inspection) => (
              <InspectionCard
                key={inspection.id}
                inspection={inspection}
                compact
                onPress={() =>
                  navigation.navigate('InspectionDetail', { inspectionId: inspection.id })
                }
              />
            ))}

            {/* Only once there is somewhere to page to. A pager reading
                "1 of 1" is a control that cannot be used. */}
            {totalPages > 1 ? (
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={setPage}
                disabled={loading}
                style={{ marginTop: spacing.sm }}
              />
            ) : null}
          </>
        )}

        <Notice
          text="Inspections, uploads and history are saved to the departmental server. Label analysis is simulated for demonstration — the OCR pipeline arrives in Phase 4."
          style={{ marginTop: spacing.lg }}
        />
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  /**
   * The primary action.
   *
   * Outlined rather than filled. A filled block was tried in both the
   * institutional blue and in near-black, and on a page this light either one
   * lands as a slab: the heaviest thing on screen, competing with the four
   * status tiles below it that actually carry information.
   *
   * Outlined, it is still unmistakably the primary action — it is the only
   * bordered, full-width, raised element on the page — but it holds that
   * position on weight and geometry instead of on a field of colour. The border
   * is `text` and 1.5px: a hairline at this size reads as a disabled control,
   * and 2px reads as a text input.
   *
   * `xl` radius rather than `lg`, because a single-line bar needs a rounder
   * corner to keep the proportion the taller two-line version had.
   */
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    // Taller than a standard control. This is the one thing the screen exists
    // to launch, and height is what it has left to say so now that it carries
    // neither a fill nor a heavy border.
    paddingVertical: spacing.lg,
    paddingLeft: spacing.md,
    // Tighter on the right: the arrow's ring already carries its own inset, so
    // matching the left padding would leave it visibly adrift from the edge.
    paddingRight: spacing.base,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    // A hairline in the page's own border token, not black. The black edge
    // fenced the button off from everything around it; at this weight the
    // outline still gives the shape a boundary and lets the shadow do the
    // lifting.
    borderWidth: 1,
    borderColor: colors.border,
    ...(shadow.card as object),
  },
  /**
   * Fills on press rather than fading.
   *
   * An outlined control that loses opacity reads as becoming disabled. Tinting
   * toward the surface's own alternate is the gesture that says "held".
   */
  ctaPressed: {
    backgroundColor: colors.surfaceAlt,
    transform: [{ scale: 0.985 }],
  },
  ctaIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaArrow: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
