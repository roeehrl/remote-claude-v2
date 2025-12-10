/**
 * ANSI Parser Unit Tests
 *
 * Tests for the ANSI escape code parser used in the terminal.
 */

import { AnsiParser, stripAnsi, hasAnsi } from '../ansi';

describe('ANSI Parser', () => {
  let parser: AnsiParser;

  beforeEach(() => {
    parser = new AnsiParser(true); // dark mode
  });

  describe('Basic parsing', () => {
    test('should parse plain text without escape codes', () => {
      const result = parser.parseLine('Hello, World!');

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].text).toBe('Hello, World!');
      expect(result.segments[0].style.bold).toBe(false);
      expect(result.segments[0].style.fgColor).toBeNull();
    });

    test('should return empty segment for empty string', () => {
      const result = parser.parseLine('');

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].text).toBe('');
    });
  });

  describe('SGR (Select Graphic Rendition) codes', () => {
    test('should parse bold text', () => {
      const result = parser.parseLine('\x1b[1mBold Text\x1b[0m');

      expect(result.segments.length).toBeGreaterThan(0);
      const boldSegment = result.segments.find(s => s.text === 'Bold Text');
      expect(boldSegment?.style.bold).toBe(true);
    });

    test('should parse italic text', () => {
      const result = parser.parseLine('\x1b[3mItalic Text\x1b[0m');

      const italicSegment = result.segments.find(s => s.text === 'Italic Text');
      expect(italicSegment?.style.italic).toBe(true);
    });

    test('should parse underlined text', () => {
      const result = parser.parseLine('\x1b[4mUnderlined\x1b[0m');

      const underlinedSegment = result.segments.find(s => s.text === 'Underlined');
      expect(underlinedSegment?.style.underline).toBe(true);
    });

    test('should parse strikethrough text', () => {
      const result = parser.parseLine('\x1b[9mStrikethrough\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Strikethrough');
      expect(segment?.style.strikethrough).toBe(true);
    });

    test('should parse dim text', () => {
      const result = parser.parseLine('\x1b[2mDim Text\x1b[0m');

      const dimSegment = result.segments.find(s => s.text === 'Dim Text');
      expect(dimSegment?.style.dim).toBe(true);
    });

    test('should parse inverse text', () => {
      const result = parser.parseLine('\x1b[7mInverse\x1b[0m');

      const inverseSegment = result.segments.find(s => s.text === 'Inverse');
      expect(inverseSegment?.style.inverse).toBe(true);
    });

    test('should reset styles with code 0', () => {
      const result = parser.parseLine('\x1b[1;3mBoldItalic\x1b[0mNormal');

      const normalSegment = result.segments.find(s => s.text === 'Normal');
      expect(normalSegment?.style.bold).toBe(false);
      expect(normalSegment?.style.italic).toBe(false);
    });

    test('should handle ESC[m as reset', () => {
      const result = parser.parseLine('\x1b[1mBold\x1b[mNormal');

      const normalSegment = result.segments.find(s => s.text === 'Normal');
      expect(normalSegment?.style.bold).toBe(false);
    });
  });

  describe('Standard 16 colors (0-15)', () => {
    test('should parse foreground colors 30-37', () => {
      const result = parser.parseLine('\x1b[31mRed Text\x1b[0m');

      const redSegment = result.segments.find(s => s.text === 'Red Text');
      expect(redSegment?.style.fgColor).not.toBeNull();
      expect(redSegment?.style.fgColor).toContain('#'); // Should be a hex color
    });

    test('should parse background colors 40-47', () => {
      const result = parser.parseLine('\x1b[42mGreen BG\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Green BG');
      expect(segment?.style.bgColor).not.toBeNull();
    });

    test('should parse bright foreground colors 90-97', () => {
      const result = parser.parseLine('\x1b[91mBright Red\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Bright Red');
      expect(segment?.style.fgColor).not.toBeNull();
    });

    test('should parse bright background colors 100-107', () => {
      const result = parser.parseLine('\x1b[101mBright Red BG\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Bright Red BG');
      expect(segment?.style.bgColor).not.toBeNull();
    });
  });

  describe('256 colors', () => {
    test('should parse 256 foreground color', () => {
      const result = parser.parseLine('\x1b[38;5;196mRed 196\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Red 196');
      expect(segment?.style.fgColor).not.toBeNull();
    });

    test('should parse 256 background color', () => {
      const result = parser.parseLine('\x1b[48;5;21mBlue BG\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Blue BG');
      expect(segment?.style.bgColor).not.toBeNull();
    });
  });

  describe('24-bit RGB colors', () => {
    test('should parse 24-bit foreground color', () => {
      const result = parser.parseLine('\x1b[38;2;255;0;128mCustom Color\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Custom Color');
      expect(segment?.style.fgColor).toBe('rgb(255, 0, 128)');
    });

    test('should parse 24-bit background color', () => {
      const result = parser.parseLine('\x1b[48;2;0;128;255mCustom BG\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Custom BG');
      expect(segment?.style.bgColor).toBe('rgb(0, 128, 255)');
    });
  });

  describe('Mixed styles', () => {
    test('should parse multiple styles in one sequence', () => {
      const result = parser.parseLine('\x1b[1;31;44mBold Red on Blue\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Bold Red on Blue');
      expect(segment?.style.bold).toBe(true);
      expect(segment?.style.fgColor).not.toBeNull();
      expect(segment?.style.bgColor).not.toBeNull();
    });

    test('should handle multiple segments with different styles', () => {
      const result = parser.parseLine('Normal \x1b[1mBold\x1b[0m Normal');

      expect(result.segments.length).toBe(3);
      expect(result.segments[0].text).toBe('Normal ');
      expect(result.segments[0].style.bold).toBe(false);
      expect(result.segments[1].text).toBe('Bold');
      expect(result.segments[1].style.bold).toBe(true);
      expect(result.segments[2].text).toBe(' Normal');
      expect(result.segments[2].style.bold).toBe(false);
    });
  });

  describe('Style reset codes', () => {
    test('should reset bold with code 22', () => {
      const result = parser.parseLine('\x1b[1mBold\x1b[22mNormal');

      const normalSegment = result.segments.find(s => s.text === 'Normal');
      expect(normalSegment?.style.bold).toBe(false);
    });

    test('should reset italic with code 23', () => {
      const result = parser.parseLine('\x1b[3mItalic\x1b[23mNormal');

      const normalSegment = result.segments.find(s => s.text === 'Normal');
      expect(normalSegment?.style.italic).toBe(false);
    });

    test('should reset default foreground with code 39', () => {
      const result = parser.parseLine('\x1b[31mRed\x1b[39mDefault');

      const defaultSegment = result.segments.find(s => s.text === 'Default');
      expect(defaultSegment?.style.fgColor).toBeNull();
    });

    test('should reset default background with code 49', () => {
      const result = parser.parseLine('\x1b[41mRed BG\x1b[49mDefault');

      const defaultSegment = result.segments.find(s => s.text === 'Default');
      expect(defaultSegment?.style.bgColor).toBeNull();
    });
  });

  describe('Dark/Light mode', () => {
    test('should use dark mode colors when isDarkMode is true', () => {
      const darkParser = new AnsiParser(true);
      const result = darkParser.parseLine('\x1b[32mGreen\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Green');
      expect(segment?.style.fgColor).toBe('#34d399'); // Dark mode green
    });

    test('should use light mode colors when isDarkMode is false', () => {
      const lightParser = new AnsiParser(false);
      const result = lightParser.parseLine('\x1b[32mGreen\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Green');
      expect(segment?.style.fgColor).toBe('#16a34a'); // Light mode green
    });

    test('should switch mode with setDarkMode', () => {
      parser.setDarkMode(false);
      const result = parser.parseLine('\x1b[32mGreen\x1b[0m');

      const segment = result.segments.find(s => s.text === 'Green');
      expect(segment?.style.fgColor).toBe('#16a34a'); // Light mode green
    });
  });

  describe('Parser state', () => {
    test('should maintain style across lines by default', () => {
      parser.parseLine('\x1b[1m'); // Start bold
      const result = parser.parseLine('Still Bold');

      expect(result.segments[0].style.bold).toBe(true);
    });

    test('should reset with reset()', () => {
      parser.parseLine('\x1b[1m'); // Start bold
      parser.reset();
      const result = parser.parseLine('Not Bold');

      expect(result.segments[0].style.bold).toBe(false);
    });
  });

  describe('parseLines', () => {
    test('should parse multiple lines', () => {
      const results = parser.parseLines(['Line 1', '\x1b[1mBold Line\x1b[0m', 'Line 3']);

      expect(results).toHaveLength(3);
      expect(results[0].segments[0].text).toBe('Line 1');
      expect(results[1].segments.find(s => s.text === 'Bold Line')?.style.bold).toBe(true);
      expect(results[2].segments[0].text).toBe('Line 3');
    });
  });

  describe('Non-SGR sequences', () => {
    test('should strip cursor movement sequences', () => {
      const result = parser.parseLine('\x1b[2AUp\x1b[3BDown\x1b[4CRight\x1b[5DLeft');

      // Should strip escape sequences but keep text
      const fullText = result.segments.map(s => s.text).join('');
      expect(fullText).toBe('UpDownRightLeft');
    });

    test('should strip OSC sequences (title setting)', () => {
      const result = parser.parseLine('\x1b]0;Window Title\x07Regular Text');

      const fullText = result.segments.map(s => s.text).join('');
      expect(fullText).toBe('Regular Text');
    });
  });
});

describe('Utility functions', () => {
  describe('stripAnsi', () => {
    test('should strip all escape codes from text', () => {
      const text = '\x1b[1;31mBold Red\x1b[0m Normal \x1b[32mGreen\x1b[0m';
      expect(stripAnsi(text)).toBe('Bold Red Normal Green');
    });

    test('should return unchanged text if no escape codes', () => {
      const text = 'Plain text';
      expect(stripAnsi(text)).toBe('Plain text');
    });

    test('should strip OSC sequences', () => {
      const text = '\x1b]0;Title\x07Content';
      expect(stripAnsi(text)).toBe('Content');
    });
  });

  describe('hasAnsi', () => {
    test('should return true if text contains escape codes', () => {
      expect(hasAnsi('\x1b[1mBold\x1b[0m')).toBe(true);
    });

    test('should return false if text has no escape codes', () => {
      expect(hasAnsi('Plain text')).toBe(false);
    });
  });
});
