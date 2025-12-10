import { useState, useEffect, useMemo } from 'react';
import { Dimensions, ScaledSize } from 'react-native';
import {
  calculateLayout,
  getLayoutForWidth,
  getBreakpoints,
  type DeviceType,
  type ResponsiveLayout,
} from '@/lib/responsive';

// Re-export types and utilities from the pure logic module
export { getLayoutForWidth, getBreakpoints };
export type { DeviceType, ResponsiveLayout };

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook that provides responsive layout information based on screen dimensions.
 * Updates automatically when the screen size changes.
 */
export function useResponsiveLayout(): ResponsiveLayout {
  const [dimensions, setDimensions] = useState(() => Dimensions.get('window'));

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }: { window: ScaledSize }) => {
      setDimensions(window);
    });

    return () => subscription.remove();
  }, []);

  const layout = useMemo(
    () => calculateLayout(dimensions.width, dimensions.height),
    [dimensions.width, dimensions.height]
  );

  return layout;
}
