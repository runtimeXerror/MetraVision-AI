import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation/RootNavigator';

/**
 * Application root.
 *
 * Deliberately thin: the navigator owns session restoration and the store
 * wiring, so this file stays a place to add providers rather than logic.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      {/* Light content, because every screen behind the bar is either the navy
          hero or a light surface. */}
      <StatusBar style="light" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}
