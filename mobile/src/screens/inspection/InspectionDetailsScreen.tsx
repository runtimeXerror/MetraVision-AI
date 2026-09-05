import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { LocationField } from '../../components/LocationField';
import { Input, Select } from '../../components/forms';
import { ActionBar, Body, Notice, Screen, ScreenHeader, StepIndicator } from '../../components/layout';
import { NeedsConnection } from '../../components/offline';
import { useIsOnline } from '../../store/connectivityStore';
import { Button, Card, Row, Txt } from '../../components/ui';
import { productCategoryLabels } from '../../constants/labels';
import { colors, radius, spacing } from '../../constants/theme';
import { PRODUCT_CATEGORIES, type ProductCategory } from '../../types';
import { useImageStore } from '../../store/imageStore';
import { useAnalysisStore } from '../../store/analysisStore';
import { useInspectionStore } from '../../store/inspectionStore';
import { formatDate, formatTime12 } from '../../utils/format';
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

  // Step 1 of the capture flow is the one step that cannot be done offline —
  // the reference number is the server's to issue. See the note by the footer.
  const online = useIsOnline();

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

  /**
   * Ticking minutes, not seconds.
   *
   * A seconds hand re-rendered this whole form once a second — under the
   * officer's fingers, while they typed — to animate a figure that is not the
   * recorded time and that nobody reads to the second. The stamp on the record
   * is the server's. This is context, and context does not need a running
   * clock; it needs to be right when they glance at it.
   */
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      const id = setInterval(() => setNow(new Date()), 15_000);
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
                  {formatTime12(now)}
                </Txt>
              </View>
            </Row>
          </Card>

          {/*
            Three cards rather than one.

            Everything below used to sit in a single container: the shop, where
            it is, what was bought there and what the officer thought of it,
            stacked as one undifferentiated column of eight inputs. They are
            answers to three different questions — *which premises*, *which
            product*, *anything else* — and only the first two are required, so
            the grouping is also what tells an inspector how much of this they
            have to fill in before they can photograph anything.
          */}
          <Card style={{ marginTop: spacing.md }}>
            {/* Symmetrical with the Product card below. Two groups where one
                says "Optional" and the other says nothing leaves the officer
                inferring the difference; saying both costs a word. */}
            <Row justify="space-between" align="center" style={styles.group}>
              <Txt variant="overline" color={colors.textFaint}>
                Premises
              </Txt>
              <Txt variant="caption" color={colors.textFaint}>
                Required
              </Txt>
            </Row>

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
          </Card>

          <Card style={{ marginTop: spacing.md }}>
            <Row justify="space-between" align="center" style={styles.group}>
              <Txt variant="overline" color={colors.textFaint}>
                Product
              </Txt>
              <Txt variant="caption" color={colors.textFaint}>
                Optional
              </Txt>
            </Row>

            <Input
              label="Product name"
              placeholder="e.g. Packaged wheat flour 5 kg"
              icon="cube-outline"
              value={details.productName ?? ''}
              onChangeText={(text) => setDetail('productName', text)}
              hint="Read from the label too, if left blank."
            />

            <Select<ProductCategory>
              label="Product category"
              placeholder="Select a category"
              value={details.productCategory}
              options={CATEGORY_OPTIONS}
              onChange={setCategory}
              // The consequence, not the mechanism. Which declarations are
              // required follows from this — but an officer choosing from a
              // list needs to know it matters, not how it is resolved.
              hint="Sets which declarations are required. Left blank, the scan decides."
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

          {/* ── WHAT THIS SCREEN NO LONGER SAYS ────────────────────────
              A notice stood here explaining that continuing files the record
              and assigns a reference number. Both halves were already on the
              screen — the button says Continue, and the identity card at the
              top says "Assigned on continue" in the space the number will
              occupy. It was a paragraph restating a form to somebody who fills
              this one in twenty times a day. */}

          {/* Said before the officer fills the form in, not after they tap
              Continue and watch it fail.

              A new inspection genuinely cannot be started offline, and that is
              a deliberate limit rather than a gap: the reference number is
              issued by the server, the photographs are read by the OCR service,
              and the finding is made by the rule engine — none of which is on
              the phone. Queueing the intake locally would hand the officer a
              record with no reference and no verdict, and file it hours later
              from a car park. Reading what has already been filed is what works
              with no signal; making a new enforcement record is not. */}
          <View style={{ marginTop: spacing.md }}>
            <NeedsConnection action="Filing a new inspection" />
          </View>
        </Body>
      </KeyboardAvoidingView>

      <ActionBar>
        <Button
          title={online ? 'Continue to Images' : 'Waiting for a connection'}
          iconRight={online ? 'arrow-forward' : undefined}
          icon={online ? undefined : 'cloud-offline-outline'}
          size="lg"
          fullWidth
          loading={saving}
          // Disabled rather than left to fail. Tapping through to a timeout
          // loses whatever was typed into the form to a spinner, and tells the
          // officer nothing they could not have been told beforehand.
          disabled={!online}
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
  /** The heading over a group of inputs. */
  group: { marginBottom: spacing.md },
  /**
   * The clock is set at the body size rather than the mono default, so it
   * carries the same weight as the date beside it — a running number set two
   * points smaller reads as a footnote to the date rather than as its peer.
   */
  clock: { fontSize: 15, lineHeight: 22, color: colors.text },
});
