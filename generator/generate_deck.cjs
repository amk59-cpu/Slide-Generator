#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const PptxGenJS = require(path.join(__dirname, "..", "vendor", "node_modules", "pptxgenjs"));
const {
  warnIfSlideHasOverlaps,
  warnIfSlideElementsOutOfBounds,
} = require(path.join(__dirname, "..", "vendor", "pptxgenjs_helpers", "layout.js"));

const COLORS = {
  bg: "000000",
  white: "FFFFFF",
  body: "D9D9D9",
  axis: "A6A6A6",
  grid: "262626",
  separator: "404040",
  panel: "080808",
  panel2: "101010",
  panel3: "151515",
  gold: "C1A968",
  cyan: "00C2DE",
  blue: "5B8FF9",
  green: "3CCB8C",
  magenta: "D96AA7",
  orange: "FF6B2C",
  purple: "8F7CEC",
  red: "E45756",
};

const SERIES_COLORS = [
  COLORS.gold,
  COLORS.cyan,
  COLORS.blue,
  COLORS.green,
  COLORS.magenta,
  COLORS.orange,
  COLORS.purple,
  "7BC8A4",
  "F4A261",
  "B8A1E3",
];

const MAX_CHART_SERIES = 10;
const MAX_TABLE_SERIES = 3;
const MAX_TABLE_ROWS = 8;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function cleanString(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseLabelRules(text) {
  return cleanString(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const delimiter = line.includes("=>") ? "=>" : (line.includes("=") ? "=" : null);
    if (!delimiter) return { from: line, to: "" };
    const [from, ...rest] = line.split(delimiter);
    return { from: cleanString(from), to: cleanString(rest.join(delimiter)) };
  }).filter((rule) => rule.from);
}

function simplifyLabelText(value) {
  let text = cleanString(value);
  text = text
    .replace(/\b\d{4}[-_/]\d{1,2}[-_/]\d{1,2}\b/g, "")
    .replace(/\b\d{1,2}[-_/]\d{1,2}[-_/]\d{2,4}\b/g, "")
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-_\s]*\d{1,4}\b/gi, "")
    .replace(/\b\d{1,2}[-_\s]*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-_\s]*\d{0,4}\b/gi, "")
    .replace(/\b(?:latest|final|attempt\s*\d+|run\s*\d+)\b/gi, "")
    .replace(/[()\[\]{}]/g, " ")
    .replace(/\s*[-_·|:]+\s*/g, " - ")
    .replace(/(?:\s+-\s+){2,}/g, " - ")
    .replace(/^[-_·|:\s]+|[-_·|:\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || cleanString(value);
}

function displayLabel(value, request, fallbackLength = 40) {
  let text = cleanString(value);
  const rules = parseLabelRules(request.label_replacements || "");
  rules.forEach((rule) => {
    try {
      text = text.replace(new RegExp(escapeRegExp(rule.from), "gi"), rule.to);
    } catch (_) {
      text = text.split(rule.from).join(rule.to);
    }
  });
  if (request.label_simplify) text = simplifyLabelText(text);
  const maximum = Math.max(12, Math.min(90, Number(request.label_max_length || fallbackLength)));
  if (text.length > maximum) text = `${text.slice(0, Math.max(1, maximum - 1))}…`;
  return cleanString(text) || cleanString(value);
}

function numberValue(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/,/g, "").trim();
  if (!text) return null;
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;
  const exact = text.match(/^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(?:%|(?:[kmgtp]?(?:i?b|b))(?:\/s|ps)?|gb\/s|gbps|mb\/s|mbps|kb\/s|kbps|ns|us|µs|ms|s|fps|msg\/s|messages\/s)?(?:\s*\([^)]*\))?\s*$/i);
  if (exact) {
    const parsed = Number(exact[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const matches = [...text.matchAll(/([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(gb\/s|gbps|mb\/s|mbps|kb\/s|kbps|ns|us|µs|ms|fps|msg\/s|messages\/s|%)/gi)];
  if (!matches.length) return null;
  const parsed = Number(matches[matches.length - 1][1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function categoryNumber(value) {
  const direct = numberValue(value);
  const text = cleanString(value).toLowerCase().replace(/bytes?/g, "b");
  const sizeMatch = text.match(/^\s*([+-]?\d+(?:\.\d+)?)\s*([kmgtp]?)(?:i?b|b)?\s*$/i);
  if (sizeMatch) {
    const scale = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4, p: 1024 ** 5 };
    return Number(sizeMatch[1]) * scale[sizeMatch[2].toLowerCase()];
  }
  return direct;
}

function formatValue(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  const numeric = Number(value);
  const magnitude = Math.abs(numeric);
  if (magnitude >= 1_000_000) return numeric.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (magnitude >= 1000) return numeric.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (magnitude >= 100) return numeric.toFixed(1).replace(/\.0$/, "");
  if (magnitude >= 1) return numeric.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  if (numeric === 0) return "0";
  return numeric.toPrecision(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  const numeric = Number(value) * 100;
  const digits = Math.abs(numeric) >= 10 ? 1 : 2;
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits).replace(/\.0+$/, "")}%`;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function aggregate(values, mode) {
  const present = values.filter((value) => value !== null && Number.isFinite(value));
  if (!present.length) return null;
  switch (mode) {
    case "sum": return present.reduce((sum, value) => sum + value, 0);
    case "max": return Math.max(...present);
    case "min": return Math.min(...present);
    case "median": return median(present);
    case "mean": return present.reduce((sum, value) => sum + value, 0) / present.length;
    case "none": return present[present.length - 1];
    case "auto":
    default: return present.length > 1 ? median(present) : present[0];
  }
}

function selectedFilters(request) {
  const result = new Map();
  Object.entries(request.filters || {}).forEach(([index, values]) => {
    if (Array.isArray(values) && values.length) result.set(Number(index), new Set(values.map(cleanString)));
  });
  return result;
}

function rowPassesFilters(row, filters) {
  for (const [index, allowed] of filters.entries()) {
    if (!allowed.has(cleanString(row[index]))) return false;
  }
  return true;
}

function extract(table, request) {
  const width = table.headers.length;
  if (request.category_index < 0 || request.category_index >= width) {
    throw new Error(`Invalid category column for ${table.display_name}.`);
  }
  const metricIndexes = [...new Set(request.series_indexes || [])].filter(
    (index) => index >= 0 && index < width && index !== request.category_index,
  );
  if (request.slide_type !== "data_matrix" && metricIndexes.length === 0) {
    throw new Error(`Select at least one metric for ${table.display_name}.`);
  }
  const groupIndexes = [...new Set(request.group_by_indexes || [])].filter(
    (index) => index >= 0 && index < width && index !== request.category_index && !metricIndexes.includes(index),
  );
  const filters = selectedFilters(request);
  const categoryOrder = [];
  const categoryRaw = new Map();
  const buckets = new Map();
  const seriesOrder = [];

  function ensureSeries(name) {
    if (!buckets.has(name)) {
      buckets.set(name, new Map());
      seriesOrder.push(name);
    }
  }

  table.rows.forEach((row, rowIndex) => {
    if (!rowPassesFilters(row, filters)) return;
    const rawCategory = row[request.category_index];
    const category = cleanString(rawCategory) || `Row ${rowIndex + 1}`;
    if (!categoryRaw.has(category)) {
      categoryRaw.set(category, rawCategory);
      categoryOrder.push(category);
    }
    const groupValues = groupIndexes.map((index) => cleanString(row[index]) || "(blank)");
    const groupLabel = groupValues.join(" / ");
    metricIndexes.forEach((metricIndex) => {
      const numeric = numberValue(row[metricIndex]);
      if (numeric === null) return;
      const metricName = table.headers[metricIndex];
      let seriesName = metricName;
      if (groupIndexes.length) seriesName = metricIndexes.length === 1 ? groupLabel : `${metricName} · ${groupLabel}`;
      ensureSeries(seriesName);
      const categoryMap = buckets.get(seriesName);
      if (!categoryMap.has(category)) categoryMap.set(category, []);
      categoryMap.get(category).push(numeric);
    });
  });

  let categories = categoryOrder;
  if (request.sort_categories !== false && categories.length > 1) {
    const sortable = categories.map((category, index) => ({
      category,
      index,
      numeric: categoryNumber(categoryRaw.get(category)),
    }));
    const numericCount = sortable.filter((item) => item.numeric !== null && Number.isFinite(item.numeric)).length;
    if (numericCount / sortable.length >= 0.8) {
      categories = sortable.sort((left, right) => {
        if (left.numeric === null) return 1;
        if (right.numeric === null) return -1;
        return left.numeric - right.numeric || left.index - right.index;
      }).map((item) => item.category);
    }
  }

  const totalSeries = seriesOrder.length;
  const shownSeries = seriesOrder.slice(0, MAX_CHART_SERIES);
  const values = shownSeries.map((name) => {
    const categoryMap = buckets.get(name);
    return categories.map((category) => aggregate(categoryMap.get(category) || [], request.aggregation || "auto"));
  });
  if (!categories.length || !shownSeries.length) {
    throw new Error(`No graphable rows remained for ${table.display_name}. Review filters and column mapping.`);
  }
  return {
    rawCategories: categories,
    categories: categories.map((category) => displayLabel(category, request, 40)),
    categoryHeader: displayLabel(table.headers[request.category_index] || "Input", request, 26),
    numericCategories: categories.map((category, index) => categoryNumber(categoryRaw.get(category)) ?? index + 1),
    names: shownSeries.map((name) => displayLabel(name, request, 36)),
    values,
    totalSeries,
    note: totalSeries > MAX_CHART_SERIES
      ? `Showing the first ${MAX_CHART_SERIES} of ${totalSeries} series. Refine filters for a cleaner chart.`
      : "",
  };
}

function addText(slide, text, x, y, w, h, fontSize, options = {}) {
  slide.addText(String(text ?? ""), {
    x, y, w, h,
    fontFace: "Arial",
    fontSize,
    color: options.color || COLORS.white,
    bold: Boolean(options.bold),
    align: options.align || "left",
    valign: options.valign || "mid",
    margin: options.margin ?? 0,
    fit: "shrink",
    isTextBox: true,
    ...options,
  });
}

function addBaseSlide(pptx, request, table) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.bg };
  const title = cleanString(request.title);
  const titleSize = title.length > 95 ? 17 : (title.length > 65 ? 19 : 22.5);
  addText(slide, title, 0.55, 0.29, 11.85, 0.55, titleSize, { bold: true });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.55, y: 0.98, w: 12.05, h: 0,
    line: { color: COLORS.separator, pt: 0.65 },
  });
  if (typeof slide.addNotes === "function") {
    const range = `${columnLetter(table.start_col)}${table.header_row}:${columnLetter(table.end_col)}${table.data_end_row}`;
    slide.addNotes(`Source worksheet: ${table.sheet_name}\nSource range: ${range}\nGenerated by Slide Generator.`);
  }
  return slide;
}

function columnLetter(index1Based) {
  let value = Number(index1Based) || 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function chartGeometry(showDataTable) {
  return showDataTable
    ? { x: 0.70, y: 1.26, w: 8.15, h: 5.46 }
    : { x: 0.78, y: 1.24, w: 11.78, h: 5.68 };
}

function chartOptions(request, categoryCount, seriesCount, showDataTable = false) {
  const dense = categoryCount > 18;
  const geometry = chartGeometry(showDataTable);
  return {
    ...geometry,
    chartColors: SERIES_COLORS.slice(0, Math.max(1, seriesCount)),
    showLegend: seriesCount > 0,
    legendPos: "b",
    legendColor: COLORS.body,
    legendFontFace: "Arial",
    legendFontSize: seriesCount > 6 ? 7.4 : 8.2,
    showTitle: false,
    showValue: false,
    showLabel: false,
    showCatName: false,
    showSerName: false,
    showPercent: false,
    displayBlanksAs: "gap",
    chartArea: { fill: { color: COLORS.bg }, border: { color: COLORS.bg, pt: 0 } },
    plotArea: { fill: { color: COLORS.bg }, border: { color: COLORS.bg, pt: 0 } },
    catAxisLabelColor: COLORS.body,
    catAxisLabelFontFace: "Arial",
    catAxisLabelFontSize: showDataTable ? 7.2 : (dense ? 7.4 : 8.2),
    catAxisLabelRotate: dense ? -45 : 0,
    catAxisLineColor: COLORS.separator,
    catAxisLineShow: true,
    catAxisLineSize: 1,
    catAxisTitle: request.x_axis_title || "",
    showCatAxisTitle: Boolean(request.x_axis_title),
    catAxisTitleColor: COLORS.body,
    catAxisTitleFontFace: "Arial",
    catAxisTitleFontSize: showDataTable ? 8.4 : 9.2,
    valAxisLabelColor: COLORS.axis,
    valAxisLabelFontFace: "Arial",
    valAxisLabelFontSize: showDataTable ? 7.4 : 8.2,
    valAxisLineColor: COLORS.separator,
    valAxisLineShow: true,
    valAxisLineSize: 1,
    valAxisTitle: request.y_axis_title || "Value",
    showValAxisTitle: true,
    valAxisTitleColor: COLORS.body,
    valAxisTitleFontFace: "Arial",
    valAxisTitleFontSize: showDataTable ? 8.4 : 9.2,
    valGridLine: { color: COLORS.grid, size: 0.7, style: "solid" },
    showDataTable: false,
    valLabelFormatCode: "0.###",
    lang: "en-US",
  };
}

function categoryChartData(names, categories, values) {
  return names.map((name, seriesIndex) => ({
    name,
    labels: categories,
    values: values[seriesIndex].map((value) => (value === null ? 0 : value)),
  }));
}

function sampledIndexes(length, maximum) {
  if (length <= maximum) return Array.from({ length }, (_, index) => index);
  const indexes = [];
  for (let index = 0; index < maximum; index += 1) {
    indexes.push(Math.round((index * (length - 1)) / (maximum - 1)));
  }
  return [...new Set(indexes)];
}

function sampleExtracted(extracted, maximum, label) {
  if (extracted.categories.length <= maximum) return extracted;
  const indexes = sampledIndexes(extracted.categories.length, maximum);
  const samplingNote = `${label} samples ${indexes.length} of ${extracted.categories.length} categories. Use a line chart or filters to show the full sweep.`;
  return {
    ...extracted,
    categories: indexes.map((index) => extracted.categories[index]),
    numericCategories: Array.isArray(extracted.numericCategories)
      ? indexes.map((index) => extracted.numericCategories[index])
      : extracted.numericCategories,
    values: extracted.values.map((series) => indexes.map((index) => series[index])),
    note: [extracted.note, samplingNote].filter(Boolean).join(" "),
  };
}

function shortLabel(value, maximum = 32) {
  const text = cleanString(value);
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function addVisibleDataTable(pptx, slide, extracted) {
  const { categories, names, values } = extracted;
  const categoryHeader = shortLabel(extracted.categoryHeader || "Input", 20);
  const categoryIndexes = sampledIndexes(categories.length, MAX_TABLE_ROWS);
  const shownNames = names.slice(0, MAX_TABLE_SERIES);
  const shownValues = values.slice(0, MAX_TABLE_SERIES);
  const rows = [
    [
      { text: categoryHeader, options: { bold: true, color: COLORS.gold, fill: { color: COLORS.panel3 }, align: "center" } },
      ...shownNames.map((name) => ({
        text: shortLabel(name, shownNames.length >= 3 ? 18 : 22),
        options: { bold: true, color: COLORS.gold, fill: { color: COLORS.panel3 }, align: "center" },
      })),
    ],
  ];
  categoryIndexes.forEach((categoryIndex, rowNumber) => {
    const fillColor = rowNumber % 2 === 0 ? COLORS.bg : COLORS.panel;
    rows.push([
      { text: shortLabel(categories[categoryIndex], 22), options: { color: COLORS.body, fill: { color: fillColor }, align: "center" } },
      ...shownNames.map((_, seriesIndex) => ({
        text: extracted.valueFormat === "percent"
          ? formatPercent(shownValues[seriesIndex][categoryIndex])
          : formatValue(shownValues[seriesIndex][categoryIndex]),
        options: { color: COLORS.body, fill: { color: fillColor }, align: "center" },
      })),
    ]);
  });
  const tableX = 9.18;
  const tableY = 1.34;
  const tableW = 3.48;
  const tableH = 5.12;
  const firstColumn = shownNames.length >= 3 ? 0.88 : 1.08;
  const remaining = (tableW - firstColumn) / Math.max(1, shownNames.length);
  slide.addTable(rows, {
    x: tableX,
    y: tableY,
    w: tableW,
    h: tableH,
    rowH: tableH / rows.length,
    colW: [firstColumn, ...shownNames.map(() => remaining)],
    fontFace: "Arial",
    fontSize: shownNames.length >= 3 ? 6.8 : 7.3,
    color: COLORS.body,
    border: { type: "solid", color: "1F1F1F", pt: 0.35 },
    margin: 0.035,
    valign: "mid",
    align: "center",
    autoPage: false,
  });
}

function addSeriesNote(slide, text, showDataTable) {
  if (!text) return;
  addText(slide, text, showDataTable ? 0.72 : 7.10, 6.98, showDataTable ? 8.10 : 5.40, 0.16, 5.8, {
    color: "8C8C8C",
    align: showDataTable ? "left" : "right",
  });
}

function renderGroupedOrLine(pptx, slide, request, extracted) {
  const showTable = Boolean(request.show_data_table);
  const display = request.slide_type === "grouped_bar"
    ? sampleExtracted(extracted, showTable ? 30 : 36, "Grouped bar chart")
    : extracted;
  const { categories, names, values } = display;
  const options = chartOptions(request, categories.length, names.length, showTable);
  if (request.slide_type === "grouped_bar") {
    Object.assign(options, {
      barDir: "col",
      barGrouping: "clustered",
      barGapWidthPct: categories.length <= 12 ? 65 : 35,
      barOverlapPct: 0,
    });
    slide.addChart(pptx.ChartType.bar, categoryChartData(names, categories, values), options);
  } else {
    Object.assign(options, {
      lineSize: 2.25,
      lineDataSymbol: "circle",
      lineDataSymbolSize: categories.length > 35 ? 3.2 : 4.8,
      lineDataSymbolLineSize: 0.8,
      lineSmooth: false,
    });
    slide.addChart(pptx.ChartType.line, categoryChartData(names, categories, values), options);
  }
  if (showTable) addVisibleDataTable(pptx, slide, display);
  addSeriesNote(slide, display.note, showTable);
}


function renderDifference(pptx, slide, request, extracted) {
  const { names, values } = extracted;
  let deltaNames;
  let deltaValues;
  const computedRelative = values.length >= 2;
  if (computedRelative) {
    const baseline = values[0];
    deltaNames = names.slice(1).map((name) => `${name} vs ${names[0]}`);
    deltaValues = values.slice(1).map((comparison) => comparison.map((value, index) => {
      const base = baseline[index];
      return value === null || base === null || base === 0 ? null : (value - base) / Math.abs(base);
    }));
  } else {
    deltaNames = names;
    deltaValues = values;
  }
  const sourceLooksPercent = names.some((name) => /%|percent/i.test(name));
  const percentValues = computedRelative || sourceLooksPercent;
  const showTable = Boolean(request.show_data_table);
  const differenceData = sampleExtracted({
    ...extracted,
    names: deltaNames,
    values: deltaValues,
    valueFormat: percentValues ? "percent" : "number",
  }, showTable ? 30 : 36, "Difference chart");
  const { categories, names: shownNames, values: shownValues } = differenceData;

  let chartData;
  let colors = SERIES_COLORS;
  if (shownValues.length === 1) {
    const source = shownValues[0];
    chartData = [
      { name: "Positive", labels: categories, values: source.map((value) => (value !== null && value >= 0 ? value : 0)) },
      { name: "Negative", labels: categories, values: source.map((value) => (value !== null && value < 0 ? value : 0)) },
    ];
    colors = [COLORS.cyan, COLORS.orange];
  } else {
    chartData = categoryChartData(shownNames, categories, shownValues);
  }
  const options = chartOptions(request, categories.length, chartData.length, showTable);
  Object.assign(options, {
    chartColors: colors,
    barDir: "col",
    barGrouping: "clustered",
    barGapWidthPct: 45,
    valAxisCrossesAt: 0,
    valAxisTitle: percentValues ? "Relative difference" : (request.y_axis_title || "Difference"),
    valLabelFormatCode: percentValues ? "0%" : "0.###",
  });
  slide.addChart(pptx.ChartType.bar, chartData, options);
  if (showTable) addVisibleDataTable(pptx, slide, differenceData);
  addSeriesNote(slide, differenceData.note, showTable);
}

function renderMatrix(pptx, slide, table, request) {
  const maxColumns = Math.min(table.headers.length, 12);
  const maxRows = Math.min(table.rows.length, table.headers.length > 9 ? 20 : 24);
  const headers = table.headers.slice(0, maxColumns).map((header) => shortLabel(displayLabel(header, request, maxColumns > 8 ? 22 : 28), maxColumns > 8 ? 22 : 28));
  const dataRows = table.rows.slice(0, maxRows).map((row) => row.slice(0, maxColumns));
  const rows = [headers.map((value) => ({
    text: cleanString(value),
    options: { bold: true, color: COLORS.gold, fill: { color: COLORS.panel3 }, align: "center" },
  }))];
  dataRows.forEach((row, rowIndex) => {
    const fillColor = rowIndex % 2 === 0 ? COLORS.bg : COLORS.panel;
    rows.push(headers.map((_, columnIndex) => ({
      text: row[columnIndex] === null || row[columnIndex] === undefined ? "" : shortLabel(displayLabel(row[columnIndex], request, maxColumns > 8 ? 18 : 24), maxColumns > 8 ? 18 : 24),
      options: { color: COLORS.body, fill: { color: fillColor }, align: "center" },
    })));
  });
  const x = 0.72;
  const y = 1.24;
  const w = 11.85;
  const h = 5.54;
  slide.addTable(rows, {
    x, y, w, h,
    rowH: h / rows.length,
    colW: Array.from({ length: maxColumns }, () => w / maxColumns),
    fontFace: "Arial",
    fontSize: maxColumns <= 8 ? 7.1 : 6.2,
    color: COLORS.body,
    border: { type: "solid", color: "1F1F1F", pt: 0.35 },
    margin: 0.025,
    autoPage: false,
  });
  if (table.rows.length > maxRows || table.headers.length > maxColumns) {
    addText(slide, `Showing ${maxRows} of ${table.rows.length} rows and ${maxColumns} of ${table.headers.length} columns.`, 0.72, 6.96, 11.85, 0.16, 5.8, { color: "8C8C8C" });
  }
}


function validateSlide(slide, pptx) {
  const diagnosticSlide = Object.create(slide);
  diagnosticSlide._slideObjects = slide._slideObjects.filter((object) => object._type !== "table");
  warnIfSlideHasOverlaps(diagnosticSlide, pptx, {
    muteContainment: true,
    ignoreLines: true,
    ignoreDecorativeShapes: true,
  });
  warnIfSlideElementsOutOfBounds(diagnosticSlide, pptx);
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error("Usage: node generate_deck.cjs <input.json> <output.pptx>");
  const payload = readJson(inputPath);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Slide Generator";
  pptx.company = "AMD";
  pptx.subject = "Editable benchmark presentation";
  pptx.title = payload.deck_title || "Benchmark Performance";
  pptx.lang = "en-US";
  pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial", lang: "en-US" };

  payload.slides.forEach((request) => {
    const table = payload.tables[request.table_id];
    if (!table) throw new Error(`The source table '${request.table_id}' is no longer available.`);
    const slide = addBaseSlide(pptx, request, table);
    if (request.slide_type === "data_matrix") {
      renderMatrix(pptx, slide, table, request);
    } else {
      const extracted = extract(table, request);
      if (request.slide_type === "grouped_bar" || request.slide_type === "line") {
        renderGroupedOrLine(pptx, slide, request, extracted);
      } else if (request.slide_type === "difference") {
        renderDifference(pptx, slide, request, extracted);
      } else {
        throw new Error(`Unsupported slide type: ${request.slide_type}`);
      }
    }
    validateSlide(slide, pptx);
  });
  await pptx.writeFile({ fileName: outputPath });
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
