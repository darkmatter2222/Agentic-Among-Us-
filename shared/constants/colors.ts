/**
 * Agent Color Constants
 * Maps hex color values to color names for agent identification
 */

// Standard Among Us colors (as hex values)
export const AGENT_COLORS = [
  0xC51111, // Red
  0x132ED2, // Blue
  0x117F2D, // Green
  0xED54BA, // Pink
  0xEF7D0E, // Orange
  0xF6F658, // Yellow
  0x3F474E, // Black
  0xD6E0F0, // White
  0x6B2FBB, // Purple
  0x71491E, // Brown
  0x38FEDB, // Cyan
  0x50EF39, // Lime
] as const;

// Color names in the same order as AGENT_COLORS
export const COLOR_NAMES = [
  'Red',
  'Blue',
  'Green',
  'Pink',
  'Orange',
  'Yellow',
  'Black',
  'White',
  'Purple',
  'Brown',
  'Cyan',
  'Lime',
] as const;

export type ColorName = typeof COLOR_NAMES[number];

// Map of hex color values to color names
export const COLOR_TO_NAME: Record<number, ColorName> = {
  0xC51111: 'Red',
  0x132ED2: 'Blue',
  0x117F2D: 'Green',
  0xED54BA: 'Pink',
  0xEF7D0E: 'Orange',
  0xF6F658: 'Yellow',
  0x3F474E: 'Black',
  0xD6E0F0: 'White',
  0x6B2FBB: 'Purple',
  0x71491E: 'Brown',
  0x38FEDB: 'Cyan',
  0x50EF39: 'Lime',
};

// Reverse lookup: color name to hex value
export const NAME_TO_COLOR: Record<ColorName, number> = {
  'Red': 0xC51111,
  'Blue': 0x132ED2,
  'Green': 0x117F2D,
  'Pink': 0xED54BA,
  'Orange': 0xEF7D0E,
  'Yellow': 0xF6F658,
  'Black': 0x3F474E,
  'White': 0xD6E0F0,
  'Purple': 0x6B2FBB,
  'Brown': 0x71491E,
  'Cyan': 0x38FEDB,
  'Lime': 0x50EF39,
};

/**
 * Get the color name for a given hex color value.
 * Returns 'Unknown' if the color is not in the standard set.
 */
export function getColorName(colorHex: number): string {
  return COLOR_TO_NAME[colorHex] ?? 'Unknown';
}

/**
 * Get the hex color value for a given color name.
 * Returns undefined if the color name is not recognized.
 */
export function getColorHex(name: string): number | undefined {
  return NAME_TO_COLOR[name as ColorName];
}
