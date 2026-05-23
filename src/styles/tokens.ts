/**
 * Design tokens. TS mirror of src/app/globals.css; both are reconciled against
 * design_handoff_enviable_io/tokens.css (the design source of truth, per
 * CLAUDE.md section 4). Use these when token values need to be referenced
 * outside of Tailwind utilities (inline styles, charts, canvas).
 * Keep both files aligned when changing a value.
 */

export const color = {
  navy: {
    50: "#F2F6FA",
    100: "#E6EEF6",
    200: "#B6CFE3",
    300: "#87AED0",
    400: "#5689BC",
    500: "#5A82A8",
    600: "#2C5E8E",
    700: "#1F4E79",
    800: "#163C61",
    900: "#0F2A44",
  },
  ink: {
    50: "#F7F8FA",
    100: "#F2F3F5",
    200: "#E6E8EC",
    300: "#D2D5DB",
    400: "#AEB1B8",
    500: "#7B7F87",
    600: "#4A525C",
    700: "#43474F",
    800: "#1F242A",
    900: "#1A1A1A",
  },
  success: { 50: "#E8F2E9", 100: "#C9E4D3", 600: "#1F8A4D", 700: "#2E7D32", 800: "#155E36" },
  warning: { 50: "#FBEFE0", 100: "#F5E0B0", 600: "#B97A0B", 700: "#B45F06", 800: "#835300" },
  danger:  { 50: "#FAE3E3", 100: "#F4CCC5", 600: "#C5392D", 700: "#C00000", 800: "#8A241B" },
  surface: {
    DEFAULT: "#FFFFFF",
    muted: "#F6F7F9",
    sunken: "#F2F3F5",
  },
  border: {
    subtle: "#F2F3F5",
    default: "#E6E8EC",
    strong: "#D2D5DB",
  },
  sidebar: {
    bg: "#163C61",
    fg: "#CFDCEC",
    muted: "#8AA6C4",
    label: "#6F8AA6",
    hover: "#B6CAE0",
    activeBar: "#5A9FE8",
  },
} as const;

export const radius = {
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
} as const;

export const size = {
  control: 28,
  row: 30,
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
