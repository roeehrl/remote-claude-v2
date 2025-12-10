import React, { memo } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { ParsedLine, StyledSegment, AnsiStyle } from '@/lib/ansi';
import { useThemeColors } from '@/providers/ThemeProvider';
import { useSettingsStore, selectFontSize } from '@/stores';

// ============================================================================
// Types
// ============================================================================

interface TerminalLineProps {
  line: ParsedLine;
  lineNumber: number;
}

interface StyledTextProps {
  segment: StyledSegment;
  defaultFgColor: string;
  defaultBgColor: string;
  fontSize: number;
}

// ============================================================================
// Styled Text Component
// ============================================================================

const StyledText = memo(function StyledText({
  segment,
  defaultFgColor,
  defaultBgColor,
  fontSize,
}: StyledTextProps) {
  const { text, style } = segment;

  // Handle inverse colors
  let fgColor = style.fgColor || defaultFgColor;
  let bgColor = style.bgColor || null;

  if (style.inverse) {
    const temp = fgColor;
    fgColor = bgColor || defaultBgColor;
    bgColor = temp;
  }

  // Apply dim effect
  if (style.dim) {
    // Dim is typically 50% opacity - we'll darken the color
    // For simplicity, just reduce opacity
  }

  const textStyle = {
    color: fgColor,
    backgroundColor: bgColor ?? undefined,
    fontWeight: style.bold ? ('bold' as const) : ('normal' as const),
    fontStyle: style.italic ? ('italic' as const) : ('normal' as const),
    textDecorationLine: getTextDecoration(style),
    fontSize,
    fontFamily: 'SpaceMono',
    opacity: style.dim ? 0.6 : 1,
  };

  return <RNText style={textStyle}>{text}</RNText>;
});

function getTextDecoration(style: AnsiStyle): 'none' | 'underline' | 'line-through' | 'underline line-through' {
  if (style.underline && style.strikethrough) {
    return 'underline line-through';
  }
  if (style.underline) {
    return 'underline';
  }
  if (style.strikethrough) {
    return 'line-through';
  }
  return 'none';
}

// ============================================================================
// Terminal Line Component
// ============================================================================

export const TerminalLine = memo(function TerminalLine({
  line,
  lineNumber,
}: TerminalLineProps) {
  const colors = useThemeColors();
  const fontSize = useSettingsStore(selectFontSize);

  const defaultFgColor = colors.terminalText;
  const defaultBgColor = colors.terminalBg;

  // Empty line placeholder
  if (line.segments.length === 0 || (line.segments.length === 1 && line.segments[0].text === '')) {
    return (
      <View style={styles.line}>
        <RNText style={[styles.emptyLine, { fontSize, color: defaultFgColor }]}>{' '}</RNText>
      </View>
    );
  }

  return (
    <View style={styles.line}>
      {line.segments.map((segment, index) => (
        <StyledText
          key={index}
          segment={segment}
          defaultFgColor={defaultFgColor}
          defaultBgColor={defaultBgColor}
          fontSize={fontSize}
        />
      ))}
    </View>
  );
});

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    minHeight: 18,
  },
  emptyLine: {
    fontFamily: 'SpaceMono',
  },
});
