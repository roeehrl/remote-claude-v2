import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { View, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { BridgeProvider } from '@/providers/BridgeProvider';
import { ToastContainer } from '@/components/common';
import { useToastStore, useSettingsStore, selectBridgeUrl } from '@/stores';
import { useConnectionToasts, usePtyOutputHandler } from '@/hooks';
import { useShallow } from 'zustand/react/shallow';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Get bridge URL from settings store
  const bridgeUrl = useSettingsStore(selectBridgeUrl);

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <BridgeProvider autoConnect defaultUrl={bridgeUrl}>
          <RootLayoutNav />
        </BridgeProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ToastOverlay() {
  const toasts = useToastStore(useShallow(state => state.toasts));
  const removeToast = useToastStore((state) => state.removeToast);

  // Show toasts for connection state changes
  useConnectionToasts();

  // Global PTY output handler - only used on web to capture output when terminal tab is not active
  // On native, TerminalView handles its own PTY output to avoid double-appending
  usePtyOutputHandler({ enabled: Platform.OS === 'web' });

  return <ToastContainer toasts={toasts} onDismiss={removeToast} />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <NavigationThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <View style={{ flex: 1 }}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack>
        <ToastOverlay />
      </View>
    </NavigationThemeProvider>
  );
}
