import { NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { colors } from '../constants/theme';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { InspectionDetailScreen } from '../screens/InspectionDetailScreen';
import { ReportDetailScreen } from '../screens/ReportDetailScreen';
import { ReportEditScreen } from '../screens/ReportEditScreen';
import { AnalysisScreen } from '../screens/inspection/AnalysisScreen';
import { CaptureScreen } from '../screens/inspection/CaptureScreen';
import { FinalizeScreen } from '../screens/inspection/FinalizeScreen';
import { QualityScreen } from '../screens/inspection/QualityScreen';
import { ResultScreen } from '../screens/inspection/ResultScreen';
import { ReviewScreen } from '../screens/inspection/ReviewScreen';
import { SuccessScreen } from '../screens/inspection/SuccessScreen';
import { useAuthStore } from '../store/authStore';
import { DialogHost } from '../components/Dialog';
import { onReconnect, startConnectivityWatch } from '../store/connectivityStore';
import { useDashboardStore } from '../store/dashboardStore';
import { useDraftStore, startDraftAutosave } from '../store/draftStore';
import { useHistoryStore } from '../store/historyStore';

import { TabNavigator } from './TabNavigator';
import type { AuthStackParamList, RootStackParamList } from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();

/** Navigation theme, so the background behind a transition matches the app. */
const navigationTheme: Theme = {
  dark: false,
  colors: {
    primary: colors.navy,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.danger,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '700' },
    heavy: { fontFamily: 'System', fontWeight: '800' },
  },
};

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  );
}

function SignedInNavigator() {
  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      <RootStack.Screen name="Tabs" component={TabNavigator} />

      {/* Capture flow — full screen, no tab bar. */}
      <RootStack.Screen name="Capture" component={CaptureScreen} />
      <RootStack.Screen name="Quality" component={QualityScreen} />
      <RootStack.Screen
        name="Analysis"
        component={AnalysisScreen}
        // Swiping back out of a running analysis would strand the draft.
        options={{ gestureEnabled: false }}
      />
      <RootStack.Screen name="Result" component={ResultScreen} />
      <RootStack.Screen name="Review" component={ReviewScreen} />
      <RootStack.Screen name="Finalize" component={FinalizeScreen} />
      <RootStack.Screen
        name="Success"
        component={SuccessScreen}
        options={{ gestureEnabled: false }}
      />

      <RootStack.Screen name="InspectionDetail" component={InspectionDetailScreen} />
      <RootStack.Screen name="ReportDetail" component={ReportDetailScreen} />
      <RootStack.Screen name="ReportEdit" component={ReportEditScreen} />
    </RootStack.Navigator>
  );
}

/** Full-bleed splash shown only while the stored session is being read. */
function RestoringSplash() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.textInverse} size="large" />
    </View>
  );
}

export function RootNavigator() {
  const restoring = useAuthStore((state) => state.restoring);
  const session = useAuthStore((state) => state.session);
  const inspector = useAuthStore((state) => state.inspector);
  const restore = useAuthStore((state) => state.restore);

  const refreshHistory = useHistoryStore((state) => state.refreshAll);
  const resetHistory = useHistoryStore((state) => state.reset);
  const resetDashboard = useDashboardStore((state) => state.reset);

  const discardStaleDraft = useDraftStore((state) => state.discardStale);
  const resetDraft = useDraftStore((state) => state.reset);

  useEffect(() => {
    void restore();
  }, [restore]);

  // Load the inspector's records once they are signed in; clear them on
  // sign-out so a second inspector never sees the first one's history.
  useEffect(() => {
    if (inspector) {
      void refreshHistory();
      return;
    }

    resetHistory();
    // The dashboard is cleared with it. Its figures are cached per officer, and
    // leaving the previous one's KPIs on screen through a sign-out would show
    // one inspector another's enforcement record.
    resetDashboard();
  }, [inspector, refreshHistory, resetHistory, resetDashboard]);

  /**
   * ── STAYING HONEST ABOUT THE CONNECTION ────────────────────────────────
   *
   * One watcher for the whole app, mounted here because every screen's
   * "showing a saved copy" strip reads from it and none of them owns it.
   *
   * The reconnect handler is the other half of the offline story. Without it,
   * an officer who walks out of a basement is left holding cached figures with
   * a banner telling them so, and nothing happens until they think to pull the
   * list down. With it, coverage returning refreshes the register by itself —
   * which is the behaviour anybody would assume the app already had.
   */
  useEffect(() => {
    const stopWatching = startConnectivityWatch();

    const stopListening = onReconnect(() => {
      if (!useAuthStore.getState().inspector) return;
      void useHistoryStore.getState().refreshAll();
      void useDashboardStore.getState().load({ refresh: true });
    });

    return () => {
      stopWatching();
      stopListening();
    };
  }, []);

  /**
   * Look for an unfinished capture, and start recording one.
   *
   * Both are keyed to the signed-in officer. The autosave subscription is torn
   * down on sign-out, or it would go on writing the next officer's typing under
   * the previous one's id — and the draft check would then offer it to them.
   */
  useEffect(() => {
    if (!inspector) {
      resetDraft();
      return;
    }

    // Anything left by a previous session is thrown away rather than offered:
    // an inspection interrupted by the app closing is started again from
    // scratch. See the note at the top of `draftStore`.
    void discardStaleDraft();
    return startDraftAutosave(inspector.id);
  }, [inspector, discardStaleDraft, resetDraft]);

  return (
    <NavigationContainer theme={navigationTheme}>
      {restoring ? <RestoringSplash /> : session ? <SignedInNavigator /> : <AuthNavigator />}
      {/* One host for every dialog in the app. Mounted outside the navigator so
          a confirmation survives the screen that raised it navigating away. */}
      <DialogHost />
    </NavigationContainer>
  );
}
