import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

import type { ComplianceStatus } from '../types';

/**
 * Navigation contract.
 *
 * Every screen's props are derived from these maps, so a renamed route or a
 * changed parameter is a compile error rather than an `undefined` at runtime.
 */

export type AuthStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
};

export type TabParamList = {
  Home: undefined;
  Inspect: undefined;
  History: undefined;
  Reports: undefined;
  Profile: undefined;
};

/**
 * The capture flow lives on the root stack rather than inside the Inspect tab
 * so that steps 2 onward are full-screen — a tab bar during image capture
 * invites a mis-tap that would discard the draft.
 */
export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  Capture: undefined;
  Quality: undefined;
  Analysis: undefined;
  Result: undefined;
  Review: undefined;
  Finalize: undefined;
  Success: {
    inspectionId: string;
    referenceId: string;
    status: ComplianceStatus;
  };
  InspectionDetail: { inspectionId: string };
  ReportDetail: { inspectionId: string };
  /** In-app amendments to a report, applied to the PDF at issue. */
  ReportEdit: { inspectionId: string };
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
  AuthStackParamList,
  T
>;

export type TabScreenProps<T extends keyof TabParamList> = BottomTabScreenProps<TabParamList, T>;

/** Makes `useNavigation()` typed everywhere without a per-call generic. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
