import { Ionicons } from '@expo/vector-icons';
import { StackActions, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';

import { Body, Notice, Screen, ScreenHeader, StepIndicator } from '../../components/layout';
import { Button, Card, ErrorState, Row, Txt } from '../../components/ui';
import { colors, radius, spacing } from '../../constants/theme';
import { ANALYSIS_STAGES, type AnalysisStageKey } from '../../services/aiService';
import { useAnalysisStore } from '../../store/analysisStore';
import { useDraftStore } from '../../store/draftStore';
import { useImageStore } from '../../store/imageStore';
import { useInspectionStore } from '../../store/inspectionStore';
import { pluralize } from '../../utils/format';

import { INSPECTION_STEPS } from './InspectionDetailsScreen';

/**
 * Step 4 — the processing screen.
 *
 * The stage list is driven by `ANALYSIS_STAGES` in the AI service rather than
 * hardcoded here, so when the real pipeline reports different stages this
 * screen follows without edits.
 */
export function AnalysisScreen() {
  // Recorded for the autosave, so an interrupted capture resumes on this
  // screen instead of sending the inspector back through steps they had
  // already completed.
  const setDraftStep = useDraftStore((state) => state.setStep);
  useEffect(() => setDraftStep('Analysis'), [setDraftStep]);

  const navigation = useNavigation();

  const images = useImageStore((state) => state.images);
  const inspectionId = useInspectionStore((state) => state.id);

  const status = useAnalysisStore((state) => state.status);
  const completedStages = useAnalysisStore((state) => state.completedStages);
  const error = useAnalysisStore((state) => state.error);
  const run = useAnalysisStore((state) => state.run);

  // A ref guards against React 18 double-invoking the effect in dev, which
  // would otherwise start the run twice.
  const started = useRef(false);

  const start = useCallback(async () => {
    // A missing id is handed to the store rather than returned on, so it comes
    // back as a failed run the inspector can see and act on.
    const ok = await run(inspectionId, images);
    if (ok) {
      // Replace, so the back gesture from Result does not re-enter processing.
      navigation.dispatch(StackActions.replace('Result'));
    }
  }, [run, images, inspectionId, navigation]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, [start]);

  return (
    <Screen>
      <ScreenHeader
        title="Analysing"
        subtitle="Step 4 of 5 · Reading declarations"
        // A way off this screen whenever there is no scan actually in flight.
        // Swipe-back is disabled here on purpose, so this button is the only
        // exit — offering it for the error case alone meant any other resting
        // state, an unstartable run above all, was a screen with no way out.
        onBack={status === 'running' ? undefined : () => navigation.goBack()}
      />
      <StepIndicator steps={INSPECTION_STEPS} current={3} />

      <Body>
        {status === 'error' && error ? (
          <Card>
            <ErrorState
              title="Analysis could not be completed"
              message={error.message}
              onRetry={error.retryable ? () => void start() : undefined}
            />
            <Button
              title="Back to images"
              variant="secondary"
              fullWidth
              onPress={() => navigation.goBack()}
              style={{ marginTop: spacing.sm }}
            />
          </Card>
        ) : (
          <>
            <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
              <PulsingScanner />
              <Txt variant="heading" center style={{ marginTop: spacing.lg }}>
                Processing {pluralize(images.length, 'image')}
              </Txt>
              <Txt variant="caption" color={colors.textMuted} center style={{ marginTop: spacing.xs }}>
                Extracting declarations and validating them against the applicable rules.
              </Txt>
            </Card>

            <Card style={{ marginTop: spacing.md }}>
              {ANALYSIS_STAGES.map((stage, index) => (
                <StageRow
                  key={stage.key}
                  label={stage.label}
                  stage={stage.key}
                  completed={completedStages.includes(stage.key)}
                  active={completedStages.length === index}
                  isLast={index === ANALYSIS_STAGES.length - 1}
                />
              ))}
            </Card>

            <Notice
              icon="information-circle-outline"
              // Was: "Text recognition, field extraction and the Legal
              // Metrology rule checks all run on the departmental server.
              // Nothing is decided on this device." True, and a fact about the
              // deployment topology — which is not something an officer
              // watching a progress bar has any use for.
              text="Reading the photographs and applying the rules. This takes a few seconds for each face."
              style={{ marginTop: spacing.md }}
            />
          </>
        )}
      </Body>
    </Screen>
  );
}

/** One line of the stage checklist. */
function StageRow({
  label,
  completed,
  active,
  isLast,
}: {
  label: string;
  stage: AnalysisStageKey;
  completed: boolean;
  active: boolean;
  isLast: boolean;
}) {
  return (
    <Row align="flex-start" gap={spacing.md} style={{ paddingVertical: spacing.sm }}>
      <View style={{ alignItems: 'center' }}>
        <View
          style={[
            styles.stageDot,
            completed && { backgroundColor: colors.success, borderColor: colors.success },
            active && !completed && { borderColor: colors.accent },
          ]}
        >
          {completed ? (
            <Ionicons name="checkmark" size={13} color={colors.textInverse} />
          ) : active ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : null}
        </View>
        {!isLast ? (
          <View style={[styles.stageLine, completed && { backgroundColor: colors.success }]} />
        ) : null}
      </View>

      <View style={{ flex: 1, paddingBottom: isLast ? 0 : spacing.sm }}>
        <Txt
          variant={active || completed ? 'bodyStrong' : 'body'}
          color={completed ? colors.text : active ? colors.navy : colors.textFaint}
        >
          {label}
        </Txt>
        <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
          {completed ? 'Done' : active ? 'In progress…' : 'Waiting'}
        </Txt>
      </View>
    </Row>
  );
}

/** Slow pulse on the scanner mark — the one place motion earns its keep. */
function PulsingScanner() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.08] });

  return (
    <View style={styles.scannerWrap}>
      <Animated.View style={[styles.scannerHalo, { transform: [{ scale }], opacity }]} />
      <View style={styles.scannerCore}>
        <Ionicons name="scan" size={30} color={colors.textInverse} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stageDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageLine: {
    width: 2,
    flex: 1,
    minHeight: 18,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  scannerWrap: { alignItems: 'center', justifyContent: 'center', width: 96, height: 96 },
  scannerHalo: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.accent,
  },
  scannerCore: {
    width: 64,
    height: 64,
    borderRadius: radius.xl,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
