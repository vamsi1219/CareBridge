import React from 'react';
import { StatusBar } from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { AuthProvider } from './hooks/useAuth';
import AppNavigator from './navigation/AppNavigator';
import { colors } from './theme/colors';

const fallbackMetrics = initialWindowMetrics ?? {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={fallbackMetrics}>
      <AuthProvider>
        <StatusBar barStyle="dark-content" />
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
          <AppNavigator />
        </SafeAreaView>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
