import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, StyleSheet, Switch, View } from 'react-native';

import { Avatar } from '../components/domain';
import { Input } from '../components/forms';
import { Body, HeroHeader, Notice, Screen } from '../components/layout';
import { Button, Card, ErrorState, Row, SectionHeader, Skeleton, Txt } from '../components/ui';
import { APP_META, userRoleLabels } from '../constants/labels';
import { colors, radius, spacing } from '../constants/theme';
import { useAsync } from '../hooks/useAsync';
import { apiInfo, checkHealth, toApiError } from '../services/api';
import { changePassword } from '../services/authService';
import { offlineQueue } from '../services/storage';
import { useAuthStore } from '../store/authStore';
import { useHistoryStore } from '../store/historyStore';
import { formatDateTime } from '../utils/format';
import { hasErrors, password as validatePassword } from '../utils/validation';

export function ProfileScreen() {
  const inspector = useAuthStore((state) => state.inspector);
  const logout = useAuthStore((state) => state.logout);
  const refreshProfile = useAuthStore((state) => state.refreshProfile);
  const refreshingProfile = useAuthStore((state) => state.refreshingProfile);
  const profileError = useAuthStore((state) => state.profileError);
  const stats = useHistoryStore((state) => state.stats);

  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // The record cached at sign-in can be stale — a supervisor may have changed a
  // jurisdiction since. Re-read it whenever the tab is opened.
  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const confirmLogout = () => {
    Alert.alert('Sign out?', 'You will need your credentials to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  const notImplemented = (feature: string) => {
    Alert.alert(feature, 'This setting is not part of the current release.');
  };

  if (!inspector) {
    return (
      <Screen>
        <Body>
          <Card>
            <Txt variant="body" color={colors.textMuted}>
              No inspector is signed in.
            </Txt>
          </Card>
        </Body>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <HeroHeader>
        <Row gap={spacing.base}>
          <Avatar name={inspector.name} color={colors.navySoft} size={58} />
          <View style={{ flex: 1 }}>
            <Txt variant="title" color={colors.textInverse} numberOfLines={1}>
              {inspector.name}
            </Txt>
            <Txt variant="caption" color={colors.navyTint} style={{ marginTop: 3 }}>
              {userRoleLabels[inspector.role]}
            </Txt>
          </View>
          <Pressable
            onPress={() => setEditing(true)}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            hitSlop={10}
          >
            <Ionicons name="create-outline" size={22} color={colors.textInverse} />
          </Pressable>
        </Row>
      </HeroHeader>

      <Body
        contentStyle={{ paddingTop: spacing.lg }}
        refreshControl={
          <RefreshControl
            refreshing={refreshingProfile}
            onRefresh={() => void refreshProfile()}
            tintColor={colors.navy}
          />
        }
      >
        {/* A stale profile is shown with a warning rather than replaced by an
            error screen — the badge number below is still usable offline. */}
        {profileError ? (
          <Card style={{ marginBottom: spacing.md }}>
            <ErrorState
              message={profileError.message}
              onRetry={profileError.retryable ? () => void refreshProfile() : undefined}
            />
          </Card>
        ) : null}

        <SectionHeader title="Inspector Details" />
        <Card>
          <InfoRow icon="id-card-outline" label="Inspector ID" value={inspector.employeeId} />
          <View style={styles.hairline} />
          <InfoRow icon="briefcase-outline" label="Role" value={userRoleLabels[inspector.role]} />
          <View style={styles.hairline} />
          <InfoRow icon="business-outline" label="Department" value={inspector.department} />
          <View style={styles.hairline} />
          <InfoRow
            icon="map-outline"
            label="Jurisdiction"
            value={[inspector.zone, inspector.district, inspector.state].filter(Boolean).join(' · ')}
          />
          <View style={styles.hairline} />
          <InfoRow icon="mail-outline" label="Email" value={inspector.email} />
          {inspector.phone ? (
            <>
              <View style={styles.hairline} />
              <InfoRow icon="call-outline" label="Phone" value={inspector.phone} />
            </>
          ) : null}
          {inspector.lastLoginAt ? (
            <>
              <View style={styles.hairline} />
              <InfoRow
                icon="time-outline"
                label="Last sign-in"
                value={formatDateTime(inspector.lastLoginAt)}
              />
            </>
          ) : null}
        </Card>

        <Button
          title="Edit Profile"
          icon="create-outline"
          variant="secondary"
          fullWidth
          onPress={() => setEditing(true)}
          style={{ marginTop: spacing.md }}
        />

        <SectionHeader title="Activity" style={{ marginTop: spacing.xl }} />
        <Card>
          <Row justify="space-around">
            <SummaryStat label="Inspections" value={stats.totalInspections} />
            <View style={styles.vDivider} />
            <SummaryStat label="Compliant" value={stats.compliant} tone={colors.success} />
            <View style={styles.vDivider} />
            <SummaryStat label="Violations" value={stats.violations} tone={colors.danger} />
          </Row>
        </Card>

        <SectionHeader title="Account Settings" style={{ marginTop: spacing.xl }} />
        <Card padded={false}>
          <SettingRow
            icon="notifications-outline"
            label="Push notifications"
            trailing={
              <Switch
                value={false}
                onValueChange={() => notImplemented('Push notifications')}
                trackColor={{ true: colors.accent, false: colors.border }}
              />
            }
          />
          <View style={styles.hairline} />
          <SettingRow
            icon="cloud-offline-outline"
            label="Offline queue"
            value={`${offlineQueue.size()} pending`}
            onPress={() =>
              Alert.alert(
                'Offline queue',
                'Inspections are submitted to the server as you work, so nothing is held here. Offline capture with deferred sync is a later addition.',
              )
            }
          />
          <View style={styles.hairline} />
          <SettingRow
            icon="lock-closed-outline"
            label="Change password"
            onPress={() => setChangingPassword(true)}
          />
          <View style={styles.hairline} />
          <SettingRow
            icon="language-outline"
            label="Language"
            value="English"
            onPress={() => notImplemented('Language')}
          />
          <View style={styles.hairline} />
          <SettingRow
            icon="help-circle-outline"
            label="Help & support"
            onPress={() => notImplemented('Help & support')}
          />
        </Card>

        <SectionHeader title="About" style={{ marginTop: spacing.xl }} />
        <Card>
          <InfoRow icon="apps-outline" label="Application" value={APP_META.name} />
          <View style={styles.hairline} />
          <InfoRow icon="pricetag-outline" label="Version" value={APP_META.version} />
          <View style={styles.hairline} />
          <InfoRow icon="flask-outline" label="Build" value={APP_META.phase} />
          <View style={styles.hairline} />
          <InfoRow
            icon="server-outline"
            label="API endpoint"
            value={apiInfo.mockMode ? 'Local mock services' : apiInfo.baseUrl}
          />
          <View style={styles.hairline} />
          <ConnectivityRow />
        </Card>

        <Notice
          icon="information-circle-outline"
          text="Sign-in, inspections, image upload and history run against the departmental server. Label analysis is simulated in this release — the OCR pipeline arrives in Phase 4."
          style={{ marginTop: spacing.md }}
        />

        <Button
          title="Sign Out"
          icon="log-out-outline"
          variant="danger"
          size="lg"
          fullWidth
          onPress={confirmLogout}
          style={{ marginTop: spacing.xl }}
        />
      </Body>

      <EditProfileSheet visible={editing} onClose={() => setEditing(false)} />
      <ChangePasswordSheet
        visible={changingPassword}
        onClose={() => setChangingPassword(false)}
      />
    </Screen>
  );
}

/**
 * Live backend probe.
 *
 * The API URL above says where the app *intends* to talk; this says whether it
 * can. On a demo the difference between the two is almost always the answer.
 */
function ConnectivityRow() {
  const { state, run } = useAsync(checkHealth);

  if (state.status === 'loading') {
    return (
      <Row gap={spacing.md} align="flex-start" style={{ paddingVertical: spacing.md }}>
        <Ionicons name="pulse-outline" size={17} color={colors.textFaint} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Txt variant="caption" color={colors.textMuted}>
            Connection
          </Txt>
          <Skeleton height={14} width="45%" style={{ marginTop: 6 }} />
        </View>
      </Row>
    );
  }

  const reachable = state.status === 'success';

  return (
    <Pressable
      onPress={() => void run()}
      accessibilityRole="button"
      accessibilityLabel="Recheck connection"
    >
      <Row gap={spacing.md} align="flex-start" style={{ paddingVertical: spacing.md }}>
        <Ionicons
          name={reachable ? 'checkmark-circle-outline' : 'alert-circle-outline'}
          size={17}
          color={reachable ? colors.success : colors.danger}
          style={{ marginTop: 2 }}
        />
        <View style={{ flex: 1 }}>
          <Txt variant="caption" color={colors.textMuted}>
            Connection
          </Txt>
          <Txt variant="bodyStrong" style={{ marginTop: 2 }}>
            {reachable ? 'Connected' : 'Unreachable — tap to retry'}
          </Txt>
          {state.status === 'success' ? (
            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
              {state.data.database} · analysis: {state.data.analysisProvider}
            </Txt>
          ) : null}
        </View>
      </Row>
    </Pressable>
  );
}

/** Bottom sheet shared by both profile dialogs. */
function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        {/* Stops a tap inside the sheet from dismissing it. */}
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.grabber} />
          <Txt variant="heading" style={{ marginBottom: spacing.md }}>
            {title}
          </Txt>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** `PATCH /api/users/me`. Inspector ID, email and role are department-set. */
function EditProfileSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const inspector = useAuthStore((state) => state.inspector);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const submitting = useAuthStore((state) => state.submitting);

  const [form, setForm] = useState({ name: '', phone: '', zone: '', district: '', state: '' });
  const [error, setError] = useState<string>();

  // Re-seed from the current record each time the sheet opens, so a cancelled
  // edit is not carried into the next one.
  useEffect(() => {
    if (!visible || !inspector) return;
    setError(undefined);
    setForm({
      name: inspector.name,
      phone: inspector.phone ?? '',
      zone: inspector.zone ?? '',
      district: inspector.district ?? '',
      state: inspector.state ?? '',
    });
  }, [visible, inspector]);

  const submit = async () => {
    if (form.name.trim().length < 2) {
      setError('Enter your full name.');
      return;
    }

    setError(undefined);
    const saved = await updateProfile({
      name: form.name.trim(),
      phone: form.phone.trim(),
      zone: form.zone.trim(),
      district: form.district.trim(),
      state: form.state.trim(),
    });

    if (saved) {
      onClose();
      return;
    }

    setError(useAuthStore.getState().profileError?.message ?? 'Could not save your profile.');
  };

  return (
    <Sheet visible={visible} title="Edit Profile" onClose={onClose}>
      <Input
        label="Full name"
        required
        value={form.name}
        onChangeText={(name) => setForm((prev) => ({ ...prev, name }))}
        autoCapitalize="words"
      />
      <Input
        label="Phone"
        value={form.phone}
        onChangeText={(phone) => setForm((prev) => ({ ...prev, phone }))}
        keyboardType="phone-pad"
      />
      <Input
        label="Zone"
        value={form.zone}
        onChangeText={(zone) => setForm((prev) => ({ ...prev, zone }))}
      />
      <Input
        label="District"
        value={form.district}
        onChangeText={(district) => setForm((prev) => ({ ...prev, district }))}
      />
      <Input
        label="State"
        value={form.state}
        onChangeText={(value) => setForm((prev) => ({ ...prev, state: value }))}
        hint="Inspector ID, email and role are set by your department and cannot be changed here."
      />

      {error ? (
        <Txt variant="caption" color={colors.danger} style={{ marginBottom: spacing.sm }}>
          {error}
        </Txt>
      ) : null}

      <Row gap={spacing.sm}>
        <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
        <Button title="Save" onPress={() => void submit()} loading={submitting} style={{ flex: 1 }} />
      </Row>
    </Sheet>
  );
}

/**
 * `POST /api/users/me/password`.
 *
 * The server revokes every refresh token on success, so the inspector is signed
 * out here deliberately rather than being left holding a session the server has
 * already invalidated.
 */
function ChangePasswordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const logout = useAuthStore((state) => state.logout);

  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setForm({ current: '', next: '', confirm: '' });
    setErrors({});
    setFormError(undefined);
  }, [visible]);

  const submit = async () => {
    const nextErrors = {
      current: form.current ? undefined : 'Enter your current password.',
      next: validatePassword(form.next),
      confirm: form.next === form.confirm ? undefined : 'The passwords do not match.',
    };
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) return;

    setBusy(true);
    setFormError(undefined);
    try {
      await changePassword(form.current, form.next);
      onClose();
      Alert.alert('Password changed', 'Sign in again with your new password.', [
        { text: 'OK', onPress: () => void logout() },
      ]);
    } catch (error) {
      setFormError(toApiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} title="Change Password" onClose={onClose}>
      <Input
        label="Current password"
        required
        secure
        value={form.current}
        onChangeText={(current) => setForm((prev) => ({ ...prev, current }))}
        error={errors.current}
      />
      <Input
        label="New password"
        required
        secure
        value={form.next}
        onChangeText={(next) => setForm((prev) => ({ ...prev, next }))}
        error={errors.next}
        hint="At least 8 characters."
      />
      <Input
        label="Confirm new password"
        required
        secure
        value={form.confirm}
        onChangeText={(confirm) => setForm((prev) => ({ ...prev, confirm }))}
        error={errors.confirm}
      />

      {formError ? (
        <Txt variant="caption" color={colors.danger} style={{ marginBottom: spacing.sm }}>
          {formError}
        </Txt>
      ) : null}

      <Row gap={spacing.sm}>
        <Button title="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
        <Button title="Update" onPress={() => void submit()} loading={busy} style={{ flex: 1 }} />
      </Row>
    </Sheet>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <Row gap={spacing.md} align="flex-start" style={{ paddingVertical: spacing.md }}>
      <Ionicons name={icon} size={17} color={colors.textFaint} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Txt variant="caption" color={colors.textMuted}>
          {label}
        </Txt>
        <Txt variant="bodyStrong" style={{ marginTop: 2 }}>
          {value || '—'}
        </Txt>
      </View>
    </Row>
  );
}

function SettingRow({
  icon,
  label,
  value,
  trailing,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
}) {
  const content = (
    <Row gap={spacing.md} style={styles.settingRow}>
      <Ionicons name={icon} size={19} color={colors.navy} />
      <Txt variant="body" style={{ flex: 1 }}>
        {label}
      </Txt>
      {value ? (
        <Txt variant="caption" color={colors.textMuted}>
          {value}
        </Txt>
      ) : null}
      {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={17} color={colors.textFaint} /> : null)}
    </Row>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => pressed && { backgroundColor: colors.surfaceAlt }}
    >
      {content}
    </Pressable>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Txt variant="title" color={tone ?? colors.text}>
        {value}
      </Txt>
      <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  hairline: { height: 1, backgroundColor: colors.border },
  vDivider: { width: 1, backgroundColor: colors.border, alignSelf: 'stretch' },
  settingRow: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
    minHeight: 54,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.base,
  },
});
