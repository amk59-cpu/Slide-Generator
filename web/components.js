export const slideTypeDefinitions = [
  {
    value: "grouped_bar",
    label: "Bar chart",
    description: "Compare values side by side.",
    icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 27V6M5 27h23M9 23v-7h4v7M16 23V9h4v14M23 23V13h4v10"/></svg>',
  },
  {
    value: "line",
    label: "Line",
    description: "Show how values change across size, time, or another ordered sequence.",
    icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 27V6M5 27h23M8 22l6-7 5 3 8-10M8 22h.01M14 15h.01M19 18h.01M27 8h.01"/></svg>',
  },
  {
    value: "difference",
    label: "Difference chart",
    description: "Show gains and losses compared with the first selected value.",
    icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 16h23M7 27V6M10 16v7h4v-7M17 16V9h4v7M24 16v4h4v-4"/></svg>',
  },
  {
    value: "data_matrix",
    label: "Table",
    description: "Show the data in rows and columns instead of a chart.",
    icon: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 7h20v19H6zM6 13h20M6 19h20M13 7v19M20 7v19"/></svg>',
  },
];

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[character]));
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value;
  let unitIndex = -1;
  do {
    amount /= 1024;
    unitIndex += 1;
  } while (amount >= 1024 && unitIndex < units.length - 1);
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatSeconds(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return "—";
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  if (value < 60) return `${value.toFixed(value >= 10 ? 1 : 2)} s`;
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
}

export function safeFilename(value) {
  const cleaned = String(value || "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+|\.+$/g, "");
  if (!cleaned) return "";
  return cleaned.toLowerCase().endsWith(".pptx") ? cleaned : `${cleaned}.pptx`;
}

export function roleLabel(role) {
  return ({ metric: "Value", dimension: "Label / group", delta: "Difference", annotation: "Note" }[role] || role || "Field");
}

export function shortText(value, maximum = 80) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}
