import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { InspectionCard } from '../components/domain';
import { FilterDropdown } from '../components/forms';
import { Body, Screen, ScreenHeader } from '../components/layout';
import {
  Card,
  ChipBar,
  EmptyState,
  ErrorState,
  Pagination,
  Row,
  Skeleton,
  Txt,
} from '../components/ui';
import { complianceStatusLabels } from '../constants/labels';
import { colors, radius, spacing, typography } from '../constants/theme';
import {
  useHistoryStore,
  type DateFilter,
  type StatusFilter,
} from '../store/historyStore';
import { COMPLIANCE_STATUSES } from '../types';

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  ...COMPLIANCE_STATUSES.map((value) => ({ value, label: complianceStatusLabels[value] })),
];

/**
 * The period filter.
 *
 * A dropdown rather than a chip row: unlike the verdict filter beside it, only
 * one period can apply, the options are mutually exclusive, and the row of
 * chips it replaces cost a whole line of a phone screen to say something the
 * pill now says in a third of the width.
 */
const DATE_OPTIONS: Array<{ value: DateFilter; label: string; description: string }> = [
  { value: 'all', label: 'All time', description: 'Every record on file' },
  { value: 'today', label: 'Today', description: 'Filed since midnight' },
  { value: 'week', label: 'Last 7 days', description: 'The past week' },
  { value: 'month', label: 'Last 30 days', description: 'The past month' },
];

/**
 * The heading, per active status filter.
 *
 * A list reached by tapping "Violations" on the dashboard has to *say*
 * Violations. Arriving at a screen headed "Inspection History" showing twelve
 * of forty records gives an officer no way to tell a filtered list from a
 * broken one — and the filter chips are below the fold on a short handset.
 *
 * The subtitle already carries the count, so between them the header states
 * both what is being shown and how much of it.
 */
const HEADINGS: Record<StatusFilter, string> = {
  all: 'Inspection History',
  compliant: 'Compliant',
  violation: 'Violations',
  review_required: 'Pending Reviews',
};

export function HistoryScreen() {
  const navigation = useNavigation();

  const items = useHistoryStore((state) => state.items);
  const loading = useHistoryStore((state) => state.loading);
  const refreshing = useHistoryStore((state) => state.refreshing);
  const error = useHistoryStore((state) => state.error);
  const search = useHistoryStore((state) => state.search);
  const statusFilter = useHistoryStore((state) => state.statusFilter);
  const dateFilter = useHistoryStore((state) => state.dateFilter);
  const total = useHistoryStore((state) => state.total);
  const page = useHistoryStore((state) => state.page);
  const totalPages = useHistoryStore((state) => state.totalPages);
  const setPage = useHistoryStore((state) => state.setPage);
  const setSearch = useHistoryStore((state) => state.setSearch);
  const setStatusFilter = useHistoryStore((state) => state.setStatusFilter);
  const setDateFilter = useHistoryStore((state) => state.setDateFilter);
  const clearFilters = useHistoryStore((state) => state.clearFilters);
  const load = useHistoryStore((state) => state.load);
  const refreshAll = useHistoryStore((state) => state.refreshAll);

  // Local mirror so typing stays responsive; the store is the source of truth.
  const [query, setQuery] = useState(search);
  const [focused, setFocused] = useState(false);

  const filtersActive = statusFilter !== 'all' || dateFilter !== 'all' || search !== '';

  return (
    <Screen>
      {/* The count is of the whole result set, not the page: "10 records" on
          every page of a 40-record list is not a count of anything. */}
      <ScreenHeader
        title={HEADINGS[statusFilter]}
        subtitle={
          totalPages > 1
            ? `${total} record${total === 1 ? '' : 's'} · page ${page} of ${totalPages}`
            : `${total} record${total === 1 ? '' : 's'}`
        }
      />

      {/* Search */}
      <View style={{ paddingHorizontal: spacing.base, paddingBottom: spacing.md }}>
        <Row
          gap={spacing.sm}
          style={[styles.searchBar, focused && { borderColor: colors.accent }]}
        >
          <Ionicons name="search" size={18} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setSearch(text);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search reference, business or product"
            placeholderTextColor={colors.textFaint}
            style={[typography.body, styles.searchInput]}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel="Search inspections"
          />
          {query.length > 0 ? (
            <Pressable
              onPress={() => {
                setQuery('');
                setSearch('');
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={17} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </Row>
      </View>

      {/* Filters */}
      <View style={{ paddingBottom: spacing.sm }}>
        <ChipBar<StatusFilter>
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={setStatusFilter}
        />
      </View>

      <Row
        justify="space-between"
        gap={spacing.sm}
        style={{ paddingHorizontal: spacing.base, paddingBottom: spacing.md }}
      >
        <FilterDropdown<DateFilter>
          label="Period"
          value={dateFilter}
          options={DATE_OPTIONS}
          onChange={setDateFilter}
        />

        {filtersActive ? (
          <Pressable
            onPress={() => {
              setQuery('');
              clearFilters();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
          >
            <Row gap={5}>
              <Ionicons name="close-circle-outline" size={14} color={colors.accent} />
              <Txt variant="label" color={colors.accent}>
                Clear filters
              </Txt>
            </Row>
          </Pressable>
        ) : null}
      </Row>

      <Body
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refreshAll()}
            tintColor={colors.navy}
          />
        }
      >
        {error ? (
          <Card>
            <ErrorState message={error.message} onRetry={error.retryable ? () => void load() : undefined} />
          </Card>
        ) : loading && items.length === 0 ? (
          [0, 1, 2].map((key) => (
            <Card key={key} style={{ marginBottom: spacing.md }}>
              <Skeleton height={14} width="40%" />
              <Skeleton height={18} width="70%" style={{ marginTop: spacing.sm }} />
              <Skeleton height={12} width="50%" style={{ marginTop: spacing.sm }} />
            </Card>
          ))
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              icon="search-outline"
              title={filtersActive ? 'No matching inspections' : 'No inspections yet'}
              message={
                filtersActive
                  ? 'Try a different search term or widen the filters.'
                  : 'Completed inspections appear here with their compliance verdict.'
              }
              action={filtersActive ? 'Clear filters' : undefined}
              onAction={
                filtersActive
                  ? () => {
                      setQuery('');
                      clearFilters();
                    }
                  : undefined
              }
            />
          </Card>
        ) : (
          <>
            {items.map((inspection) => (
              <InspectionCard
                key={inspection.id}
                inspection={inspection}
                onPress={() =>
                  navigation.navigate('InspectionDetail', { inspectionId: inspection.id })
                }
              />
            ))}

            <Pagination
              page={page}
              totalPages={totalPages}
              onChange={setPage}
              disabled={loading}
            />
          </>
        )}
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    minHeight: 46,
    paddingHorizontal: spacing.base,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, color: colors.text, paddingVertical: spacing.sm },
});
