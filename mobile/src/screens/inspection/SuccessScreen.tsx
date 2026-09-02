import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { ComplianceBadge } from '../../components/domain';
import { Body, Screen } from '../../components/layout';
import { Button, Card, Row, Txt } from '../../components/ui';
import { complianceStatusLabels } from '../../constants/labels';
import { colors, radius, spacing } from '../../constants/theme';
import type { RootScreenProps } from '../../navigation/types';
import { formatDateTime } from '../../utils/format';

/** Confirmation after a successful finalize. */
export function SuccessScreen({ route, navigation }: RootScreenProps<'Success'>) {
  const { inspectionId, referenceId, status } = route.params;

  const scale = useRef(new Animated.Value(0.7)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity]);

  const goHome = () => {
    // Reset rather than goBack: the flow behind this screen is finished.
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <Body contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <Animated.View style={{ alignItems: 'center', opacity, transform: [{ scale }] }}>
          <View style={styles.tick}>
            <Ionicons name="checkmark" size={40} color={colors.textInverse} />
          </View>
        </Animated.View>

        <Txt variant="display" center style={{ marginTop: spacing.xl }}>
          Inspection Filed
        </Txt>
        <Txt variant="body" color={colors.textMuted} center style={{ marginTop: spacing.sm }}>
          The record has been saved and a report generated.
        </Txt>

        <Card style={styles.idCard}>
          <Txt variant="overline" color={colors.textFaint} center>
            Inspection ID
          </Txt>
          <Txt variant="title" color={colors.navy} center style={{ marginTop: 4 }}>
            {referenceId}
          </Txt>

          <View style={styles.hairline} />

          <Row justify="space-between">
            <Txt variant="caption" color={colors.textMuted}>
              Final status
            </Txt>
            <ComplianceBadge status={status} size="sm" />
          </Row>

          <Row justify="space-between" style={{ marginTop: spacing.md }}>
            <Txt variant="caption" color={colors.textMuted}>
              Filed at
            </Txt>
            <Txt variant="caption">{formatDateTime(new Date())}</Txt>
          </Row>
        </Card>

        <Txt variant="caption" color={colors.textFaint} center style={{ marginTop: spacing.lg }}>
          Recorded as {complianceStatusLabels[status]}. Open the report to review the full findings.
        </Txt>

        <View style={{ marginTop: spacing.xl }}>
          <Button
            title="View Report"
            icon="document-text-outline"
            size="lg"
            fullWidth
            onPress={() => {
              navigation.reset({
                index: 1,
                routes: [{ name: 'Tabs' }, { name: 'ReportDetail', params: { inspectionId } }],
              });
            }}
          />
          <Button
            title="Back to Home"
            variant="secondary"
            size="lg"
            fullWidth
            style={{ marginTop: spacing.md }}
            onPress={goHome}
          />
        </View>
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tick: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  idCard: {
    marginTop: spacing.xl,
    borderRadius: radius.lg,
  },
  hairline: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.base,
  },
});
