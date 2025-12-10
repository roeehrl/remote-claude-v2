/**
 * Responsive Layout Tests
 *
 * Tests for the responsive layout system breakpoints and layout decisions.
 */

import { getLayoutForWidth, getBreakpoints } from '../responsive';

describe('Responsive Layout', () => {
  describe('Breakpoints', () => {
    const breakpoints = getBreakpoints();

    test('should have correct breakpoint values', () => {
      expect(breakpoints.phone).toBe(0);
      expect(breakpoints.tablet).toBe(768);
      expect(breakpoints.desktop).toBe(1024);
      expect(breakpoints.wide).toBe(1440);
    });
  });

  describe('Device Type Detection', () => {
    test('should detect phone for width < 768', () => {
      const layout = getLayoutForWidth(375); // iPhone
      expect(layout.deviceType).toBe('phone');
      expect(layout.isPhone).toBe(true);
      expect(layout.isTablet).toBe(false);
      expect(layout.isDesktop).toBe(false);
      expect(layout.isWide).toBe(false);
    });

    test('should detect tablet for width 768-1023', () => {
      const layout = getLayoutForWidth(768); // iPad portrait
      expect(layout.deviceType).toBe('tablet');
      expect(layout.isPhone).toBe(false);
      expect(layout.isTablet).toBe(true);
      expect(layout.isDesktop).toBe(false);
      expect(layout.isWide).toBe(false);
    });

    test('should detect desktop for width 1024-1439', () => {
      const layout = getLayoutForWidth(1024); // iPad landscape / small laptop
      expect(layout.deviceType).toBe('desktop');
      expect(layout.isPhone).toBe(false);
      expect(layout.isTablet).toBe(false);
      expect(layout.isDesktop).toBe(true);
      expect(layout.isWide).toBe(false);
    });

    test('should detect wide for width >= 1440', () => {
      const layout = getLayoutForWidth(1920); // Desktop monitor
      expect(layout.deviceType).toBe('wide');
      expect(layout.isPhone).toBe(false);
      expect(layout.isTablet).toBe(false);
      expect(layout.isDesktop).toBe(false);
      expect(layout.isWide).toBe(true);
    });
  });

  describe('Layout Decisions - Phone', () => {
    const layout = getLayoutForWidth(375, 812); // iPhone X

    test('should show bottom tabs', () => {
      expect(layout.showBottomTabs).toBe(true);
    });

    test('should not show sidebar', () => {
      expect(layout.showSidebar).toBe(false);
    });

    test('should not show context panel', () => {
      expect(layout.showContextPanel).toBe(false);
    });

    test('should have zero sidebar width', () => {
      expect(layout.sidebarWidth).toBe(0);
    });

    test('should have zero context panel width', () => {
      expect(layout.contextPanelWidth).toBe(0);
    });
  });

  describe('Layout Decisions - Tablet Portrait', () => {
    const layout = getLayoutForWidth(768, 1024); // iPad portrait

    test('should show bottom tabs in portrait', () => {
      expect(layout.showBottomTabs).toBe(true);
    });

    test('should show sidebar', () => {
      expect(layout.showSidebar).toBe(true);
    });

    test('should not show context panel', () => {
      expect(layout.showContextPanel).toBe(false);
    });

    test('should have tablet sidebar width', () => {
      expect(layout.sidebarWidth).toBe(280);
    });
  });

  describe('Layout Decisions - Tablet Landscape', () => {
    const layout = getLayoutForWidth(1024, 768); // iPad landscape

    test('should not show bottom tabs in landscape', () => {
      expect(layout.showBottomTabs).toBe(false);
    });

    test('should show sidebar', () => {
      expect(layout.showSidebar).toBe(true);
    });

    test('should show context panel', () => {
      expect(layout.showContextPanel).toBe(true);
    });
  });

  describe('Layout Decisions - Desktop', () => {
    const layout = getLayoutForWidth(1280, 800);

    test('should not show bottom tabs', () => {
      expect(layout.showBottomTabs).toBe(false);
    });

    test('should show sidebar', () => {
      expect(layout.showSidebar).toBe(true);
    });

    test('should show context panel', () => {
      expect(layout.showContextPanel).toBe(true);
    });

    test('should have desktop sidebar width', () => {
      expect(layout.sidebarWidth).toBe(300);
    });

    test('should have desktop context panel width', () => {
      expect(layout.contextPanelWidth).toBe(320);
    });
  });

  describe('Layout Decisions - Wide', () => {
    const layout = getLayoutForWidth(1920, 1080);

    test('should not show bottom tabs', () => {
      expect(layout.showBottomTabs).toBe(false);
    });

    test('should show sidebar', () => {
      expect(layout.showSidebar).toBe(true);
    });

    test('should show context panel', () => {
      expect(layout.showContextPanel).toBe(true);
    });

    test('should have wide sidebar width', () => {
      expect(layout.sidebarWidth).toBe(320);
    });

    test('should have wide context panel width', () => {
      expect(layout.contextPanelWidth).toBe(380);
    });
  });

  describe('Orientation Detection', () => {
    test('should detect landscape when width > height', () => {
      const layout = getLayoutForWidth(1024, 768);
      expect(layout.isLandscape).toBe(true);
      expect(layout.isPortrait).toBe(false);
    });

    test('should detect portrait when height > width', () => {
      const layout = getLayoutForWidth(768, 1024);
      expect(layout.isLandscape).toBe(false);
      expect(layout.isPortrait).toBe(true);
    });
  });

  describe('Screen Dimensions', () => {
    test('should include screen dimensions in layout', () => {
      const layout = getLayoutForWidth(1920, 1080);
      expect(layout.screenWidth).toBe(1920);
      expect(layout.screenHeight).toBe(1080);
    });
  });

  describe('Edge Cases', () => {
    test('should handle exact breakpoint values', () => {
      expect(getLayoutForWidth(768).deviceType).toBe('tablet');
      expect(getLayoutForWidth(1024).deviceType).toBe('desktop');
      expect(getLayoutForWidth(1440).deviceType).toBe('wide');
    });

    test('should handle values just below breakpoints', () => {
      expect(getLayoutForWidth(767).deviceType).toBe('phone');
      expect(getLayoutForWidth(1023).deviceType).toBe('tablet');
      expect(getLayoutForWidth(1439).deviceType).toBe('desktop');
    });

    test('should handle very small widths', () => {
      const layout = getLayoutForWidth(320, 480); // Small phone
      expect(layout.deviceType).toBe('phone');
      expect(layout.showBottomTabs).toBe(true);
    });

    test('should handle very large widths', () => {
      const layout = getLayoutForWidth(3840, 2160); // 4K monitor
      expect(layout.deviceType).toBe('wide');
      expect(layout.showSidebar).toBe(true);
      expect(layout.showContextPanel).toBe(true);
    });
  });
});
