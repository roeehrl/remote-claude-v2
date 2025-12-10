import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useResponsiveLayout } from '@/hooks';
import { useThemeColors } from '@/providers/ThemeProvider';

// ============================================================================
// Types
// ============================================================================

interface ResponsiveContainerProps {
  sidebar?: React.ReactNode;
  contextPanel?: React.ReactNode;
  children: React.ReactNode;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A container component that automatically adjusts layout based on screen size.
 * - Phone: Full-width content only
 * - Tablet: Sidebar + content
 * - Desktop/Wide: Sidebar + content + context panel
 */
export function ResponsiveContainer({
  sidebar,
  contextPanel,
  children,
}: ResponsiveContainerProps) {
  const layout = useResponsiveLayout();
  const colors = useThemeColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Sidebar (tablet and up) */}
      {layout.showSidebar && sidebar && (
        <View style={{ width: layout.sidebarWidth }}>
          {sidebar}
        </View>
      )}

      {/* Main Content */}
      <View style={styles.content}>
        {children}
      </View>

      {/* Context Panel (desktop and up) */}
      {layout.showContextPanel && contextPanel && (
        <View style={{ width: layout.contextPanelWidth }}>
          {contextPanel}
        </View>
      )}
    </View>
  );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
  },
  content: {
    flex: 1,
  },
});
