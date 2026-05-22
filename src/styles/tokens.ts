/**
 * Design tokens. Authoritative TS mirror of the values declared in
 * src/app/globals.css. Use these when token values need to be referenced
 * outside of Tailwind utilities (e.g. inline styles, charts, canvas).
 *
 * Source: design handoff. NetSuite/Odoo enterprise density.
 * Do not edit these in isolation - keep both files aligned.
 */

export const color = {
  navy: {
    50: "#F0F6FB",
    100: "#DCE9F4",
    200: "#B6CFE3",
    300: "#87AED0",
    400: "#5689BC",
    500: "#3A70A6",
    600: "#2A5D8F",
    700: "#1F4E79",
    800: "#17395B",
    900: "#102845",
  },
  ink: {
    50: "#F7F8FA",
    100: "#EEF0F3",
    200: "#DDE1E6",
    300: "#C5CCD3",
    400: "#9AA3AD",
    500: "#6B7480",
    600: "#4A525C",
    700: "#333A42",
    800: "#1F242A",
    900: "#11151A",
  },
  success: { 50: "#E8F4ED", 100: "#C9E4D3", 600: "#1F8A4D", 700: "#1F7544", 800: "#155E36" },
  warning: { 50: "#FBF1DD", 100: "#F5E0B0", 600: "#B97A0B", 700: "#A06700", 800: "#835300" },
  danger:  { 50: "#FBE9E6", 100: "#F4CCC5", 600: "#C5392D", 700: "#A92E23", 800: "#8A241B" },
  surface: {
    DEFAULT: "#FFFFFF",
    muted: "#F7F8FA",
    sunken: "#EEF0F3",
  },
  border: {
    subtle: "#EEF0F3",
    default: "#DDE1E6",
    strong: "#C5CCD3",
  },
} as const;

export const radius = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
} as const;

export const size = {
  control: 28,   // button + input height
  row: 30,       // table row height
  topbar: 44,
  sidebar: 212,
} as const;

export const spacingBasePx = 4;

export const type = {
  micro: { size: 10, lineHeight: 1.3 },
  thead: { size: 10.5, lineHeight: 1.2 },
  small: { size: 11, lineHeight: 1.35 },
  body: { size: 12.5, lineHeight: 1.4 },
  label: { size: 13, lineHeight: 1.35 },
  section: { size: 14, lineHeight: 1.35 },
  page: { size: 18, lineHeight: 1.3 },
  kpi: { size: 22, lineHeight: 1.15 },
} as const;

export type ColorScale = typeof color;
export type RadiusToken = keyof typeof radius;
export type SizeToken = keyof typeof size;
