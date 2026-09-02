import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Input } from '../../components/forms';
import { ScreenHeader } from '../../components/layout';
import { Button, Card, Txt } from '../../components/ui';
import { colors, radius, spacing } from '../../constants/theme';
import { toApiError } from '../../services/api';
import { requestPasswordReset } from '../../services/authService';
import type { AuthScreenProps } from '../../navigation/types';
import { email as validateEmail } from '../../utils/validation';

export function ForgotPasswordScreen({ navigation }: AuthScreenProps<'ForgotPassword'>) {
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  const onSubmit = async () => {
    const validationError = validateEmail(value);
    setFieldError(validationError);
    if (validationError) return;

    setSubmitting(true);
    setError(undefined);
    try {
      await requestPasswordReset(value);
      setSent(true);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScreenHeader title="Reset password" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.base }}
          keyboardShouldPersistTaps="handled"
        >
          {sent ? (
            <Card style={{ alignItems: 'center', paddingVertical: spacing.xl }}>
              <View style={styles.successIcon}>
                <Ionicons name="mail-open-outline" size={26} color={colors.success} />
              </View>

              <Txt variant="heading" center style={{ marginTop: spacing.md }}>
                Check your inbox
              </Txt>
              <Txt variant="body" color={colors.textMuted} center style={{ marginTop: spacing.sm }}>
                If an account exists for {value.trim()}, a reset link has been sent to that address.
                Contact your zonal supervisor if it does not arrive.
              </Txt>

              <Button
                title="Back to sign in"
                variant="secondary"
                fullWidth
                onPress={() => navigation.goBack()}
                style={{ marginTop: spacing.lg }}
              />
            </Card>
          ) : (
            <Card>
              <Txt variant="heading">Forgot your password?</Txt>
              <Txt
                variant="body"
                color={colors.textMuted}
                style={{ marginTop: spacing.xs, marginBottom: spacing.lg }}
              >
                Enter the departmental email address linked to your inspector account and we will
                send a reset link.
              </Txt>

              <Input
                label="Departmental email"
                placeholder="name@legalmetrology.gov.in"
                icon="mail-outline"
                value={value}
                onChangeText={(text) => {
                  setValue(text);
                  setFieldError(undefined);
                }}
                error={fieldError}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={() => void onSubmit()}
                required
              />

              {error ? (
                <Txt variant="caption" color={colors.danger} style={{ marginBottom: spacing.md }}>
                  {error}
                </Txt>
              ) : null}

              <Button
                title="Send reset link"
                size="lg"
                fullWidth
                loading={submitting}
                onPress={() => void onSubmit()}
              />
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
