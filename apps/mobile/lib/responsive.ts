/**
 * Responsive Layout Logic
 *
 * Pure functions for calculating responsive layouts based on screen dimensions.
 * This file has no React Native dependencies and can be tested in Node.
 */

// ============================================================================
// Types
// ============================================================================

export type DeviceType = 'phone' | 'tablet' | 'desktop' | 'wide';

export interface ResponsiveLayout {
  // Device classification
  deviceType: DeviceType;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isWide: boolean;

  // Layout decisions
  showBottomTabs: boolean;
  showSidebar: boolean;
  showContextPanel: boolean;

  // Dimensions
  sidebarWidth: number;
  contextPanelWidth: number;
  screenWidth: number;
  screenHeight: number;

  // Orientation
  isLandscape: boolean;
  isPortrait: boolean;
}

// ============================================================================
// Breakpoints
// ============================================================================

export const BREAKPOINTS = {
  phone: 0,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
} as const;

// ============================================================================
// Layout Configuration
// ============================================================================

export const SIDEBAR_WIDTH = {
  tablet: 280,
  desktop: 300,
  wide: 320,
} as const;

export const CONTEXT_PANEL_WIDTH = {
  desktop: 320,
  wide: 380,
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

export function getDeviceType(width: number): DeviceType {
  if (width >= BREAKPOINTS.wide) return 'wide';
  if (width >= BREAKPOINTS.desktop) return 'desktop';
  if (width >= BREAKPOINTS.tablet) return 'tablet';
  return 'phone';
}

export function calculateLayout(width: number, height: number): ResponsiveLayout {
  const deviceType = getDeviceType(width);
  const isLandscape = width > height;

  const isPhone = deviceType === 'phone';
  const isTablet = deviceType === 'tablet';
  const isDesktop = deviceType === 'desktop';
  const isWide = deviceType === 'wide';

  // Layout decisions based on device type
  const showBottomTabs = isPhone || (isTablet && !isLandscape);
  const showSidebar = isTablet || isDesktop || isWide;
  const showContextPanel = isDesktop || isWide;

  // Calculate widths
  let sidebarWidth = 0;
  if (isTablet) sidebarWidth = SIDEBAR_WIDTH.tablet;
  else if (isDesktop) sidebarWidth = SIDEBAR_WIDTH.desktop;
  else if (isWide) sidebarWidth = SIDEBAR_WIDTH.wide;

  let contextPanelWidth = 0;
  if (isDesktop) contextPanelWidth = CONTEXT_PANEL_WIDTH.desktop;
  else if (isWide) contextPanelWidth = CONTEXT_PANEL_WIDTH.wide;

  return {
    deviceType,
    isPhone,
    isTablet,
    isDesktop,
    isWide,
    showBottomTabs,
    showSidebar,
    showContextPanel,
    sidebarWidth,
    contextPanelWidth,
    screenWidth: width,
    screenHeight: height,
    isLandscape,
    isPortrait: !isLandscape,
  };
}

/**
 * Get layout for a specific width (useful for SSR or testing)
 */
export function getLayoutForWidth(width: number, height: number = 800): ResponsiveLayout {
  return calculateLayout(width, height);
}

/**
 * Get breakpoint values
 */
export function getBreakpoints() {
  return { ...BREAKPOINTS };
}
