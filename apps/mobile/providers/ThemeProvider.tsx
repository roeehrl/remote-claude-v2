import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
  useMemo,
} from 'react';
import { useColorScheme, Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightTheme, darkTheme, Theme } from '../constants/Colors';

// ============================================================================
// Types
// ============================================================================

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  // Current theme colors
  theme: Theme;

  // Current mode (what user selected)
  themeMode: ThemeMode;

  // Whether dark mode is active (resolved from system if mode is 'system')
  isDarkMode: boolean;

  // Set the theme mode
  setThemeMode: (mode: ThemeMode) => void;
}

interface ThemeProviderProps {
  children: ReactNode;
}

// ============================================================================
// Constants
// ============================================================================

const THEME_STORAGE_KEY = '@remote-claude/theme-mode';

// ============================================================================
// Context
// ============================================================================

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function ThemeProvider({ children }: ThemeProviderProps) {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [isLoaded, setIsLoaded] = useState(false);

  // Load persisted theme mode on mount
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (saved && ['light', 'dark', 'system'].includes(saved)) {
          setThemeModeState(saved as ThemeMode);
        }
      } catch (error) {
        console.log('[THEME] Failed to load theme preference:', error);
      } finally {
        setIsLoaded(true);
      }
    })();
  }, []);

  // Persist theme mode changes
  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch(error => {
      console.log('[THEME] Failed to save theme preference:', error);
    });
  }, []);

  // Determine if dark mode is active
  const isDarkMode = useMemo(() => {
    if (themeMode === 'system') {
      return systemColorScheme === 'dark';
    }
    return themeMode === 'dark';
  }, [themeMode, systemColorScheme]);

  // Get current theme colors
  const theme = useMemo(() => {
    return isDarkMode ? darkTheme : lightTheme;
  }, [isDarkMode]);

  // Context value
  const value: ThemeContextValue = useMemo(() => ({
    theme,
    themeMode,
    isDarkMode,
    setThemeMode,
  }), [theme, themeMode, isDarkMode, setThemeMode]);

  // Don't render until we've loaded the persisted theme
  if (!isLoaded) {
    return null;
  }

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get the full theme context
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

/**
 * Get just the theme colors (for components that only need colors)
 */
export function useThemeColors(): Theme {
  const { theme } = useTheme();
  return theme;
}

/**
 * Get whether dark mode is active
 */
export function useIsDarkMode(): boolean {
  const { isDarkMode } = useTheme();
  return isDarkMode;
}
