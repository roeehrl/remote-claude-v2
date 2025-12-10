/**
 * ANSI Escape Code Parser
 *
 * Parses ANSI escape sequences and converts them to styled segments
 * for rendering in React Native FlatList.
 */

// ============================================================================
// Types
// ============================================================================

export interface AnsiStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  fgColor: string | null;
  bgColor: string | null;
  inverse: boolean;
  dim: boolean;
}

export interface StyledSegment {
  text: string;
  style: AnsiStyle;
}

export interface ParsedLine {
  segments: StyledSegment[];
}

// ============================================================================
// Color Palettes
// ============================================================================

// Standard 16 ANSI colors (dark mode)
const ANSI_COLORS_DARK: Record<number, string> = {
  0: '#1f2937',   // black
  1: '#f87171',   // red
  2: '#34d399',   // green
  3: '#fbbf24',   // yellow
  4: '#60a5fa',   // blue
  5: '#a78bfa',   // magenta
  6: '#22d3ee',   // cyan
  7: '#f9fafb',   // white
  // Bright colors
  8: '#6b7280',   // bright black
  9: '#fca5a5',   // bright red
  10: '#6ee7b7',  // bright green
  11: '#fcd34d',  // bright yellow
  12: '#93c5fd',  // bright blue
  13: '#c4b5fd',  // bright magenta
  14: '#67e8f9',  // bright cyan
  15: '#ffffff',  // bright white
};

// Standard 16 ANSI colors (light mode)
const ANSI_COLORS_LIGHT: Record<number, string> = {
  0: '#1f2937',   // black
  1: '#dc2626',   // red
  2: '#16a34a',   // green
  3: '#ca8a04',   // yellow
  4: '#2563eb',   // blue
  5: '#9333ea',   // magenta
  6: '#0891b2',   // cyan
  7: '#f3f4f6',   // white
  // Bright colors
  8: '#4b5563',   // bright black
  9: '#ef4444',   // bright red
  10: '#22c55e',  // bright green
  11: '#eab308',  // bright yellow
  12: '#3b82f6',  // bright blue
  13: '#a855f7',  // bright magenta
  14: '#06b6d4',  // bright cyan
  15: '#ffffff',  // bright white
};

// ============================================================================
// 256 Color Palette Generation
// ============================================================================

function generate256ColorPalette(): string[] {
  const palette: string[] = [];

  // Colors 0-15: Standard colors (will be replaced by theme-aware colors)
  for (let i = 0; i < 16; i++) {
    palette.push(ANSI_COLORS_DARK[i]);
  }

  // Colors 16-231: 6x6x6 color cube
  const levels = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        palette.push(`rgb(${levels[r]}, ${levels[g]}, ${levels[b]})`);
      }
    }
  }

  // Colors 232-255: Grayscale ramp
  for (let i = 0; i < 24; i++) {
    const gray = 8 + i * 10;
    palette.push(`rgb(${gray}, ${gray}, ${gray})`);
  }

  return palette;
}

const COLOR_256_PALETTE = generate256ColorPalette();

// ============================================================================
// Default Style
// ============================================================================

function getDefaultStyle(): AnsiStyle {
  return {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    fgColor: null,
    bgColor: null,
    inverse: false,
    dim: false,
  };
}

// ============================================================================
// ANSI Parser Class
// ============================================================================

export class AnsiParser {
  private isDarkMode: boolean;
  private currentStyle: AnsiStyle;

  constructor(isDarkMode: boolean = true) {
    this.isDarkMode = isDarkMode;
    this.currentStyle = getDefaultStyle();
  }

  setDarkMode(isDark: boolean): void {
    this.isDarkMode = isDark;
  }

  private getColorPalette(): Record<number, string> {
    return this.isDarkMode ? ANSI_COLORS_DARK : ANSI_COLORS_LIGHT;
  }

  private get256Color(code: number): string {
    if (code < 16) {
      return this.getColorPalette()[code];
    }
    return COLOR_256_PALETTE[code] || '#ffffff';
  }

  private parseRgbColor(r: number, g: number, b: number): string {
    return `rgb(${r}, ${g}, ${b})`;
  }

  private applySGR(params: number[]): void {
    let i = 0;
    while (i < params.length) {
      const code = params[i];

      switch (code) {
        case 0: // Reset
          this.currentStyle = getDefaultStyle();
          break;
        case 1: // Bold
          this.currentStyle.bold = true;
          break;
        case 2: // Dim
          this.currentStyle.dim = true;
          break;
        case 3: // Italic
          this.currentStyle.italic = true;
          break;
        case 4: // Underline
          this.currentStyle.underline = true;
          break;
        case 7: // Inverse
          this.currentStyle.inverse = true;
          break;
        case 9: // Strikethrough
          this.currentStyle.strikethrough = true;
          break;
        case 22: // Normal intensity
          this.currentStyle.bold = false;
          this.currentStyle.dim = false;
          break;
        case 23: // Not italic
          this.currentStyle.italic = false;
          break;
        case 24: // Not underline
          this.currentStyle.underline = false;
          break;
        case 27: // Not inverse
          this.currentStyle.inverse = false;
          break;
        case 29: // Not strikethrough
          this.currentStyle.strikethrough = false;
          break;
        case 30: case 31: case 32: case 33:
        case 34: case 35: case 36: case 37:
          // Standard foreground colors
          this.currentStyle.fgColor = this.getColorPalette()[code - 30];
          break;
        case 38: // Extended foreground color
          if (params[i + 1] === 5 && params[i + 2] !== undefined) {
            // 256 color
            this.currentStyle.fgColor = this.get256Color(params[i + 2]);
            i += 2;
          } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
            // 24-bit RGB
            this.currentStyle.fgColor = this.parseRgbColor(
              params[i + 2],
              params[i + 3],
              params[i + 4]
            );
            i += 4;
          }
          break;
        case 39: // Default foreground
          this.currentStyle.fgColor = null;
          break;
        case 40: case 41: case 42: case 43:
        case 44: case 45: case 46: case 47:
          // Standard background colors
          this.currentStyle.bgColor = this.getColorPalette()[code - 40];
          break;
        case 48: // Extended background color
          if (params[i + 1] === 5 && params[i + 2] !== undefined) {
            // 256 color
            this.currentStyle.bgColor = this.get256Color(params[i + 2]);
            i += 2;
          } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
            // 24-bit RGB
            this.currentStyle.bgColor = this.parseRgbColor(
              params[i + 2],
              params[i + 3],
              params[i + 4]
            );
            i += 4;
          }
          break;
        case 49: // Default background
          this.currentStyle.bgColor = null;
          break;
        case 90: case 91: case 92: case 93:
        case 94: case 95: case 96: case 97:
          // Bright foreground colors
          this.currentStyle.fgColor = this.getColorPalette()[code - 90 + 8];
          break;
        case 100: case 101: case 102: case 103:
        case 104: case 105: case 106: case 107:
          // Bright background colors
          this.currentStyle.bgColor = this.getColorPalette()[code - 100 + 8];
          break;
      }
      i++;
    }
  }

  /**
   * Parse a single line of text containing ANSI escape codes
   */
  parseLine(line: string): ParsedLine {
    const segments: StyledSegment[] = [];

    // Reset style for each line (optional - can be removed for persistent style)
    // this.currentStyle = getDefaultStyle();

    // Regex to match ANSI escape sequences
    // Matches:
    // 1. SGR sequences: ESC [ <params> m
    // 2. CSI sequences with private markers: ESC [ ? <params> <letter> (cursor visibility, modes, etc.)
    // 3. Other CSI sequences: ESC [ <params> <letter>
    // 4. OSC sequences: ESC ] ... BEL
    // 5. Character set sequences: ESC ( <letter> or ESC ) <letter>
    // 6. Other single-character escape sequences: ESC <letter>
    const ansiRegex = /\x1b\[([0-9;]*)m|\x1b\[\?[0-9;]*[A-Za-z]|\x1b\[[0-9;]*[A-Za-z]|\x1b][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\x1b[A-Za-z]/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = ansiRegex.exec(line)) !== null) {
      // Add text before this escape sequence
      if (match.index > lastIndex) {
        const text = line.slice(lastIndex, match.index);
        if (text) {
          segments.push({
            text,
            style: { ...this.currentStyle },
          });
        }
      }

      // Process SGR sequence (Select Graphic Rendition)
      if (match[1] !== undefined) {
        const params = match[1]
          .split(';')
          .map(p => (p === '' ? 0 : parseInt(p, 10)))
          .filter(p => !isNaN(p));

        if (params.length === 0) {
          params.push(0); // ESC[m is same as ESC[0m (reset)
        }

        this.applySGR(params);
      }
      // Other escape sequences are stripped (cursor movement, etc.)

      lastIndex = ansiRegex.lastIndex;
    }

    // Add remaining text after last escape sequence
    if (lastIndex < line.length) {
      const text = line.slice(lastIndex);
      if (text) {
        segments.push({
          text,
          style: { ...this.currentStyle },
        });
      }
    }

    // If no segments, add empty segment
    if (segments.length === 0) {
      segments.push({
        text: '',
        style: { ...this.currentStyle },
      });
    }

    return { segments };
  }

  /**
   * Parse multiple lines
   */
  parseLines(lines: string[]): ParsedLine[] {
    return lines.map(line => this.parseLine(line));
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.currentStyle = getDefaultStyle();
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Strip all ANSI escape codes from a string
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[\?[0-9;]*[A-Za-z]|\x1b\[[0-9;]*[A-Za-z]|\x1b][^\x07]*\x07|\x1b[()][A-Za-z0-9]|\x1b[A-Za-z]/g, '');
}

/**
 * Check if text contains ANSI escape codes
 */
export function hasAnsi(text: string): boolean {
  return /\x1b\[/.test(text);
}
