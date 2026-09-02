import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { LocationField } from '../../components/LocationField';
import { Input, Select } from '../../components/forms';
import { ActionBar, Body, Notice, Screen, ScreenHeader, StepIndicator } from '../../components/layout';
import { Button, Card, Row, Txt } from '../../components/ui';
import { productCategoryLabels } from '../../constants/labels';
import { colors, radius, spacing } from '../../constants/theme';
import { PRODUCT_CATEGORIES, type ProductCategory } from '../../types';
import { useImageStore } from '../../store/imageStore';
import { useAnalysisStore } from '../../store/analysisStore';
import { useInspectionStore } from '../../store/inspectionStore';
import { formatClock, formatDate } from '../../utils/format';
import { hasErrors, required, validate } from '../../utils/validation';

export const INSPECTION_STEPS = ['Details', 'Images', 'Quality', 'Analysis', 'Result'];

const CATEGORY_OPTIONS = PRODUCT_CATEGORIES.map((value) => ({
  value,
  label: productCategoryLabels[value],
}));

/**
 * Step 1 of the capture flow, and the root of the Inspect tab.
 *
 * The inspection id and reference are minted on entry so the header can show
 * them before anything is submitted — an inspector reads the reference aloud
 * when they announce an inspection at the premises.
 */
export function InspectionDetailsScreen() {
  const navigation = useNavigation();

  const id = useInspectionStore((state) => state.id);
  const referenceId = useInspectionStore((state) => state.referenceId);
  const createdAt = useInspectionStore((state) => state.createdAt);
  const details = useInspectionStore((state) => state.details);
  const errors = useInspectionStore((state) => state.errors);
  const saving = useInspectionStore((state) => state.saving);
  const saveError = useInspectionStore((state) => state.error);
  const setDetail = useInspectionStore((state) => state.setDetail);
  const setCategory = useInspectionStore((state) => state.setCategory);
  const setErrors = useInspectionStore((state) => state.setErrors);
  const persist = useInspectionStore((state) => state.persist);

  const resetImages = useImageStore((state) => state.reset);
  const resetAnalysis = useAnalysisStore((state) => state.reset);

  // Entering the tab directly (rather than via "Start New Inspection") must not
  // inherit images or an analysis from the previous inspection.
  useEffect(() => {
    if (!id) {
      resetImages();
      resetAnalysis();
    }
  }, [id, resetImages, resetAnalysis]);

  /**
   * Creates the record on the backend, then advances.
   *
   * The reference number is the server's, so it is only known after this call —
   * which is why the header shows a placeholder until then.
   */
  const onContinue = async () => {
    const nextErrors = validate(
      { businessName: details.businessName, location: details.location },
      {
        businessName: required('Business or shop name'),
        location: required('Location'),
      },
    );

    setErrors(nextErrors);
    if (hasErrors(nextErrors)) return;

    const inspectionId = await persist();
    if (inspectionId) navigation.navigate('Capture');
  };

  /**
   * A clock that runs while the form is open.
   *
   * This is the current time, not the draft's `createdAt`. An inspector filling
   * this in is standing in the shop, and the inspection is happening now — a
   * frozen stamp from the moment the tab was opened would be the time they
   * started typing, which is not what anyone means by the time of inspection.
   * The recorded time is still the server's; this is the officer's own clock.
   *
   * `useFocusEffect`, not `useEffect`: this screen is a tab root and stays
   * mounted behind History and Reports. Without it, a timer would go on firing
   * a re-render every second on a screen nobody is looking at, for as long as
   * the app is open.
   */
  const [now, setNow] = useState(() => new Date());

  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      const id = setInterval(() => setNow(new Date()), 1000);
      return () => clearInterval(id);
    }, []),
  );

  return (
    <Screen>
      <ScreenHeader title="New Inspection" subtitle="Step 1 of 5 · Inspection details" />
      <StepIndicator steps={INSPECTION_STEPS} current={0} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <Body>
          {/* Auto-generated identity for this inspection. */}
          <Card style={styles.identity}>
            <Row justify="space-between" wrap gap={spacing.md}>
              <View>
                <Txt variant="overline" color={colors.textFaint}>
                  Inspection ID
                </Txt>
                <Txt
                  variant="mono"
                  color={referenceId ? colors.navy : colors.textFaint}
                  style={{ marginTop: 3 }}
                >
                  {referenceId ?? 'Assigned on continue'}
                </Txt>
              </View>

              <View style={styles.stamp}>
                <Txt variant="overline" color={colors.textFaint}>
                  Date
                </Txt>
                <Txt variant="bodyStrong" style={{ marginTop: 3 }}>
                  {formatDate(now)}
                </Txt>
              </View>

              <View style={styles.stamp}>
                <Txt variant="overline" color={colors.textFaint}>
                  Time
                </Txt>
                {/* Monospaced, or the digits change width as they tick and the
                    whole clock jitters sideways once a second. */}
                <Txt variant="mono" style={[styles.clock, { marginTop: 3 }]}>
                  {formatClock(now)}
                </Txt>
              </View>
            </Row>
          </Card>

          <Card style={{ marginTop: spacing.md }}>
            <Input
              label="Business / shop name"
              placeholder="e.g. Sai Provision Stores"
              icon="storefront-outline"
              value={details.businessName}
              onChangeText={(text) => setDetail('businessName', text)}
              error={errors.businessName}
              autoCapitalize="words"
              required
            />

            <LocationField
              value={{
                address: details.location,
                district: details.district,
                state: details.state,
                pincode: details.pincode,
                latitude: details.latitude,
                longitude: details.longitude,
                accuracyM: details.accuracyM,
              }}
              onChange={(patch) => {
                if (patch.address !== undefined) setDetail('location', patch.address);
                if (patch.district !== undefined) setDetail('district', patch.district);
                if (patch.state !== undefined) setDetail('state', patch.state);
                if (patch.pincode !== undefined) setDetail('pincode', patch.pincode);
                if (patch.latitude !== undefined) setDetail('latitude', patch.latitude);
                if (patch.longitude !== undefined) setDetail('longitude', patch.longitude);
                if (patch.accuracyM !== undefined) setDetail('accuracyM', patch.accuracyM);
              }}
              error={errors.location}
            />

            <Input
              label="Product name"
              placeholder="e.g. Packaged wheat flour 5 kg"
              icon="cube-outline"
              value={details.productName ?? ''}
              onChangeText={(text) => setDetail('productName', text)}
              hint="Optional — the analysis also infers this from the label."
            />

            <Select<ProductCategory>
              label="Product category"
              placeholder="Select a category"
              value={details.productCategory}
              options={CATEGORY_OPTIONS}
              onChange={setCategory}
              hint="Which declarations the package must carry follows from this. Pick Other if none fit."
            />

            <Input
              label="Inspector notes"
              placeholder="Observations at the premises, complaint reference, stock condition…"
              value={details.inspectorNotes ?? ''}
              onChangeText={(text) => setDetail('inspectorNotes', text)}
              multiline
              containerStyle={{ marginBottom: 0 }}
            />
          </Card>

          {saveError ? (
            <Notice
              tone="warning"
              icon="cloud-offline-outline"
              text={saveError.message}
              style={{ marginTop: spacing.md }}
            />
          ) : null}

          <Notice
            icon="lock-closed-outline"
            text="The inspection is filed to the departmental server the moment you continue, and is assigned an official reference number."
            style={{ marginTop: spacing.md }}
          />
        </Body>
      </KeyboardAvoidingView>

      <ActionBar>
        <Button
          title="Continue to Images"
          iconRight="arrow-forward"
          size="lg"
          fullWidth
          loading={saving}
          onPress={() => void onContinue()}
        />
      </ActionBar>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: {
    backgroundColor: colors.navyTint,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
  },
  /** Label over value, both centred on the column. */
  stamp: { alignItems: 'center' },
  /**
   * The clock is set at the body size rather than the mono default, so it
   * carries the same weight as the date beside it — a running number set two
   * points smaller reads as a footnote to the date rather than as its peer.
   */
  clock: { fontSize: 15, lineHeight: 22, color: colors.text },
});
