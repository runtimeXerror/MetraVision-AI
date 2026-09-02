import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Input } from '../../components/forms';
import { Button, Card, Row, Txt } from '../../components/ui';
import { APP_META, DEMO_CREDENTIALS } from '../../constants/labels';
import { colors, radius, spacing } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import type { AuthScreenProps } from '../../navigation/types';
import { hasErrors, identifier as validateIdentifier, password as validatePassword } from '../../utils/validation';

export function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const login = useAuthStore((state) => state.login);
  const submitting = useAuthStore((state) => state.submitting);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const [values, setValues] = useState({ identifier: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});

  const setValue = (key: 'identifier' | 'password') => (text: string) => {
    setValues((current) => ({ ...current, [key]: text }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    if (error) clearError();
  };

  const onSubmit = async () => {
    const nextErrors = {
      identifier: validateIdentifier(values.identifier),
      password: validatePassword(values.password),
    };
    setFieldErrors(nextErrors);
    if (hasErrors(nextErrors)) return;

    await login(values.identifier, values.password);
    // On success the root navigator swaps to the signed-in stack; nothing to do here.
  };

  /** Fills the form so a demo can proceed without typing credentials. */
  const fillDemo = () => {
    setValues({ identifier: DEMO_CREDENTIALS.identifier, password: DEMO_CREDENTIALS.password });
    setFieldErrors({});
    clearError();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandMark}>
            <Ionicons name="shield-checkmark" size={30} color={colors.textInverse} />
          </View>

          <Txt variant="display" color={colors.textInverse} center style={{ marginTop: spacing.lg }}>
            {APP_META.name}
          </Txt>
          <Txt variant="body" color={colors.navyTint} center style={{ marginTop: spacing.xs }}>
            {APP_META.department}
          </Txt>

          <Card style={styles.card}>
            <Txt variant="heading">Inspector sign in</Txt>
            <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 4, marginBottom: spacing.lg }}>
              Use your departmental credentials to continue.
            </Txt>

            <Input
              label="Email or Inspector ID"
              placeholder="LM-INS-4471"
              icon="person-outline"
              value={values.identifier}
              onChangeText={setValue('identifier')}
              error={fieldErrors.identifier}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="next"
              required
            />

            <Input
              label="Password"
              placeholder="Enter your password"
              icon="lock-closed-outline"
              value={values.password}
              onChangeText={setValue('password')}
              error={fieldErrors.password}
              secure
              autoCapitalize="none"
              autoComplete="password"
              returnKeyType="go"
              onSubmitEditing={() => void onSubmit()}
              required
            />

            {error ? (
              <Row align="flex-start" gap={spacing.sm} style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color={colors.danger} style={{ marginTop: 1 }} />
                <Txt variant="caption" color={colors.danger} style={{ flex: 1 }}>
                  {error.message}
                </Txt>
              </Row>
            ) : null}

            <Button
              title="Sign In"
              size="lg"
              fullWidth
              loading={submitting}
              onPress={() => void onSubmit()}
              style={{ marginTop: spacing.sm }}
            />

            <Pressable
              onPress={() => navigation.navigate('ForgotPassword')}
              hitSlop={10}
              accessibilityRole="button"
              style={{ alignSelf: 'center', marginTop: spacing.base }}
            >
              <Txt variant="label" color={colors.accent}>
                Forgot password?
              </Txt>
            </Pressable>
          </Card>

          <Pressable onPress={fillDemo} accessibilityRole="button" style={styles.demoHint}>
            <Row gap={spacing.sm}>
              <Ionicons name="flask-outline" size={15} color={colors.navyTint} />
              <Txt variant="caption" color={colors.navyTint}>
                Demo access · tap to fill {DEMO_CREDENTIALS.identifier}
              </Txt>
            </Row>
          </Pressable>

          <Txt variant="caption" color={colors.navySoft} center style={{ marginTop: spacing.lg }}>
            {APP_META.phase} · v{APP_META.version}
          </Txt>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.navy },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  brandMark: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.navySoft,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { marginTop: spacing.xxl },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  demoHint: {
    alignSelf: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.navySoft,
  },
});
