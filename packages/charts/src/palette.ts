// Palette + shared theme fragments. Kept consistent with the app's Tailwind
// brand tokens so charts don't look like a third-party embed.

export const PALETTE = [
  "#4f46e5", // brand-600 indigo
  "#059669", // emerald-600
  "#d97706", // amber-600
  "#dc2626", // red-600
  "#0891b2", // cyan-600
  "#7c3aed", // violet-600
  "#db2777", // pink-600
  "#65a30d", // lime-600
  "#0284c7", // sky-600
  "#c026d3", // fuchsia-600
  "#0d9488", // teal-600
  "#ea580c", // orange-600
];

export const GRID = {
  left: 48,
  right: 24,
  top: 32,
  bottom: 40,
  containLabel: true,
};

export const TOOLTIP = {
  trigger: "axis" as const,
  backgroundColor: "rgba(17,24,39,0.95)",
  borderWidth: 0,
  textStyle: { color: "#f9fafb", fontSize: 12 },
};

export const AXIS_LABEL = {
  color: "#6b7280",
  fontSize: 11,
};

export const AXIS_LINE = {
  lineStyle: { color: "#e5e7eb" },
};
