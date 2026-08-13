"use strict";

import {
  escapeHtml,
  formatBytes,
  formatSeconds,
  roleLabel,
  safeFilename,
  shortText,
  slideTypeDefinitions,
} from "./components.js";

const $ = (id) => document.getElementById(id);
const MAX_DECK_SLIDES = 300;
const MAX_NATIVE_CHART_SERIES = 10;

const state = {
  file: null,
  analysis: null,
  selectedTableId: null,
  selectedSlideType: null,
  slides: [],
  generatedOutput: null,
  generationStartedAt: null,
  editingSlideIndex: null,
  setupMode: null,
};

function show(element, visible) {
  if (element) element.classList.toggle("hidden", !visible);
}

function setMessage(element, message = "", kind = "error") {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("error", "success");
  if (message) element.classList.add(kind);
  show(element, Boolean(message));
}

function scrollToElement(element) {
  element?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function currentTable() {
  return state.analysis?.tables?.find((table) => table.id === state.selectedTableId) || null;
}

function profileFor(table, index) {
  return table?.column_profiles?.find((profile) => profile.index === Number(index)) || null;
}

function selectedIndexes(containerId) {
  return [...$(containerId).querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => Number(input.value));
}

function currentFilters() {
  const filters = {};
  $("filtersList").querySelectorAll("select[data-column-index]").forEach((select) => {
    if (select.value !== "") filters[String(select.dataset.columnIndex)] = [select.value];
  });
  return filters;
}

function cleanLabelValue(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function simplifyLabelTextClient(value) {
  const original = cleanLabelValue(value);
  const simplified = original
    .replace(/\b\d{4}[-_/]\d{1,2}[-_/]\d{1,2}\b/g, "")
    .replace(/\b\d{1,2}[-_/]\d{1,2}[-_/]\d{2,4}\b/g, "")
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-_\s]*\d{1,4}\b/gi, "")
    .replace(/\b(?:latest|final|attempt\s*\d+|run\s*\d+)\b/gi, "")
    .replace(/[()\[\]{}]/g, " ")
    .replace(/\s*[-_·|:]+\s*/g, " - ")
    .replace(/(?:\s+-\s+){2,}/g, " - ")
    .replace(/^[-_·|:\s]+|[-_·|:\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return simplified || original;
}

function parseLabelRulesClient(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const delimiter = line.includes("=>") ? "=>" : (line.includes("=") ? "=" : null);
    if (!delimiter) return { from: line, to: "" };
    const [from, ...rest] = line.split(delimiter);
    return { from: cleanLabelValue(from), to: cleanLabelValue(rest.join(delimiter)) };
  }).filter((rule) => rule.from);
}

function applyLabelRulesClient(value, rulesText) {
  let output = cleanLabelValue(value);
  parseLabelRulesClient(rulesText).forEach((rule) => {
    output = output.split(rule.from).join(rule.to);
  });
  if ($("simplifyLabels")?.checked) output = simplifyLabelTextClient(output);
  const maximum = Number($("labelMaxLength")?.value || 60);
  if (output.length > maximum) output = `${output.slice(0, Math.max(1, maximum - 1))}…`;
  return cleanLabelValue(output) || cleanLabelValue(value);
}

function hasRepeatedCategoryLabels(table) {
  if (!table || $("categoryColumn").value === "") return false;
  const profile = profileFor(table, Number($("categoryColumn").value));
  return Boolean(profile && profile.unique_count < table.row_count);
}

function updateRepeatedResultsControl() {
  const table = currentTable();
  const chartNeedsValues = state.selectedSlideType !== "data_matrix";
  const repeated = chartNeedsValues && hasRepeatedCategoryLabels(table);
  show($("repeatedResultsGroup"), repeated);
  if (!repeated) {
    $("aggregation").value = "none";
    $("aggregation").dataset.hiddenDefault = "true";
  } else if ($("aggregation").dataset.hiddenDefault === "true") {
    $("aggregation").value = "";
    delete $("aggregation").dataset.hiddenDefault;
  }
  return repeated;
}

function labelEditorCandidates(table) {
  if (!table) return [];
  const labels = [];
  const seen = new Set();
  const add = (value) => {
    const text = cleanLabelValue(value);
    if (!text || seen.has(text) || /^[-+]?\d+(?:\.\d+)?$/.test(text)) return;
    seen.add(text);
    labels.push(text);
  };

  if (state.selectedSlideType === "data_matrix") {
    (table.headers || []).forEach(add);
    (table.column_profiles || []).forEach((profile) => {
      if (profile.role === "dimension" && profile.unique_count <= 24) {
        (profile.distinct_values || []).forEach(add);
      }
    });
    return labels.slice(0, 80);
  }

  const categoryIndex = $("categoryColumn").value === "" ? null : Number($("categoryColumn").value);
  if (categoryIndex !== null) {
    const profile = profileFor(table, categoryIndex);
    add(profile?.header);
    if (profile && ["text", "mixed", "date"].includes(profile.data_type) && profile.unique_count <= 30) {
      (profile.distinct_values || []).forEach(add);
    }
  }

  selectedIndexes("seriesList").forEach((index) => add(profileFor(table, index)?.header));
  selectedIndexes("groupList").forEach((index) => {
    const profile = profileFor(table, index);
    add(profile?.header);
    if (profile?.unique_count <= 30) (profile.distinct_values || []).forEach(add);
  });
  return labels.slice(0, 80);
}

function syncLabelReplacementRules() {
  const rows = [...$("labelEditorRows").querySelectorAll(".label-edit-row")];
  const rules = rows.map((row) => {
    const original = cleanLabelValue(row.dataset.original);
    const edited = cleanLabelValue(row.querySelector("input")?.value);
    if (!original || edited === original) return null;
    return `${original} => ${edited}`;
  }).filter(Boolean);
  rules.sort((a, b) => b.split("=>")[0].length - a.split("=>")[0].length);
  $("labelReplacements").value = rules.join("\n");
}

function renderFriendlyLabelEditor(rulesText = null) {
  const table = currentTable();
  const candidates = labelEditorCandidates(table);
  const rules = rulesText === null ? $("labelReplacements").value : rulesText;
  show($("labelEditorEmpty"), candidates.length === 0);
  $("labelEditorRows").innerHTML = candidates.map((original) => {
    const shown = applyLabelRulesClient(original, rules);
    return `
      <label class="label-edit-row" data-original="${escapeHtml(original)}">
        <span title="${escapeHtml(original)}">${escapeHtml(shortText(original, 42))}</span>
        <input type="text" value="${escapeHtml(shown)}" aria-label="Name shown on slide for ${escapeHtml(original)}">
      </label>
    `;
  }).join("");
  $("labelEditorRows").querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      syncLabelReplacementRules();
      updateSlideSetupSummary();
    });
  });
}

function resetLabelNames() {
  $("labelReplacements").value = "";
  $("simplifyLabels").checked = false;
  renderFriendlyLabelEditor("");
  updateSlideSetupSummary();
}

function updateSlideSetupSummary() {
  const table = currentTable();
  if (!table || !state.setupMode) return;
  const title = $("slideTitle").value.trim();
  const type = state.selectedSlideType ? slideTypeLabel(state.selectedSlideType) : "no chart style yet";
  if (state.selectedSlideType === "data_matrix") {
    $("slideSetupSummary").textContent = title
      ? `“${title}” will be created as a table using the selected Excel data.`
      : "Add a slide title to finish this table slide.";
    return;
  }
  const category = $("categoryColumn").value === "" ? null : profileFor(table, Number($("categoryColumn").value))?.header;
  const values = selectedIndexes("seriesList").map((index) => profileFor(table, index)?.header).filter(Boolean);
  if (!title || !category || !values.length || !state.selectedSlideType) {
    $("slideSetupSummary").textContent = "Choose the slide title, bottom labels, values, and chart style.";
    return;
  }
  $("slideSetupSummary").textContent = `“${title}” will show ${values.join(", ")} by ${category} as a ${type.toLowerCase()}.`;
}

function setStageState(stageNumber, mode, label) {
  const section = document.querySelector(`[data-stage="${stageNumber}"]`);
  const stateLabel = section?.querySelector(".stage-state");
  if (!section) return;
  section.classList.remove("locked", "active", "complete");
  section.classList.add(mode);
  if (stateLabel) stateLabel.textContent = label;
}

function deckDetailsValid() {
  return Boolean(
    state.slides.length
    && $("deckTitle").value.trim()
    && safeFilename($("outputFilename").value.trim()),
  );
}

function activeStep() {
  if (!state.file) return 1;
  if (!state.analysis) return 2;
  if (!state.selectedTableId) return 3;
  if (!state.slides.length) return 4;
  if (!state.generatedOutput) return 5;
  return 6;
}

function updateStages() {
  const step = activeStep();
  const unlocked = {
    1: true,
    2: Boolean(state.file),
    3: Boolean(state.analysis),
    4: Boolean(state.selectedTableId),
    5: state.slides.length > 0,
    6: Boolean(state.generatedOutput),
  };

  for (let index = 1; index <= 6; index += 1) {
    if (!unlocked[index]) setStageState(index, "locked", "Locked");
    else if (index < step) setStageState(index, "complete", "Complete");
    else if (index === step) setStageState(index, "active", index === 6 ? "Ready" : "Active");
    else setStageState(index, "complete", "Available");
  }


  show($("analysisLocked"), !state.file);
  show($("analysisControls"), Boolean(state.file && !state.analysis));
  show($("analysisSummary"), Boolean(state.analysis));
  show($("reviewLocked"), !state.analysis);
  show($("reviewContent"), Boolean(state.analysis));
  show($("configureLocked"), !state.selectedTableId);
  show($("configurationForm"), Boolean(state.selectedTableId));
  show($("generateLocked"), state.slides.length === 0);
  show($("deckBuilder"), state.slides.length > 0);
  show($("downloadLocked"), !state.generatedOutput);
  show($("completionPanel"), Boolean(state.generatedOutput));

  updateGenerationReadiness();
}

function clearGeneratedOutput() {
  state.generatedOutput = null;
  state.generationStartedAt = null;
  $("downloadPowerPointButton").disabled = true;
  if ($("openPowerPointButton")) $("openPowerPointButton").disabled = true;
  if ($("showOutputFolderButton")) $("showOutputFolderButton").disabled = true;
  setMessage($("downloadError"));
  setMessage($("downloadStatus"));
}

function resetConfigurationFields({ keepEditing = false } = {}) {
  state.selectedSlideType = null;
  state.setupMode = null;
  if (!keepEditing) state.editingSlideIndex = null;
  $("slideTitle").value = "";
  $("categoryColumn").innerHTML = '<option value="" selected disabled>Choose a label column</option>';
  $("seriesList").innerHTML = "";
  $("groupList").innerHTML = "";
  $("filtersList").innerHTML = "";
  $("aggregation").value = "";
  delete $("aggregation").dataset.hiddenDefault;
  $("xAxisTitle").value = "";
  $("yAxisTitle").value = "";
  $("showDataTable").checked = false;
  $("simplifyLabels").checked = false;
  $("labelReplacements").value = "";
  $("labelMaxLength").value = "60";
  $("labelEditorRows").innerHTML = "";
  show($("labelEditorEmpty"), true);
  show($("repeatedResultsGroup"), false);
  show($("chartMappingFields"), true);
  show($("tableModeNote"), false);
  show($("setupChoicePanel"), true);
  show($("configurationWorkspace"), false);
  $("showDataTable").disabled = true;
  $("dataTableToggle").classList.add("disabled");
  $("sortCategories").checked = false;
  $("slideTypeChoices").innerHTML = "";
  $("visualCompatibilityNote").textContent = "Choose the bottom labels and at least one value to see chart options.";
  $("seriesEstimate").textContent = "";
  $("slideSetupSummary").textContent = "Choose the slide title, labels, values, and chart style.";
  if ($("advancedOptions")) $("advancedOptions").open = false;
  setMessage($("configurationError"));
  $("addSlideButton").disabled = true;
  $("addSlideButton").textContent = "Add slide to presentation";
}

function showConfigurationWorkspace(mode) {
  state.setupMode = mode;
  show($("setupChoicePanel"), false);
  show($("configurationWorkspace"), true);
  updateRepeatedResultsControl();
  renderFriendlyLabelEditor();
  updateSlideSetupSummary();
  updateConfigurationValidity();
}

function startManualSetup() {
  showConfigurationWorkspace("manual");
  scrollToElement($("configurationWorkspace"));
}

function resetProject({ keepFilePickerClosed = true } = {}) {
  state.file = null;
  state.analysis = null;
  state.selectedTableId = null;
  state.selectedSlideType = null;
  state.slides = [];
  state.editingSlideIndex = null;
  state.setupMode = null;
  clearGeneratedOutput();
  $("fileInput").value = "";
  $("deckTitle").value = "";
  $("outputFilename").value = "";
  $("tableSearch").value = "";
  $("sheetFilter").innerHTML = '<option value="__all__">All worksheets</option>';
  $("recommendedOnly").checked = false;
  $("tableList").innerHTML = "";
  $("tableCount").textContent = "0";
  show($("selectedFilePanel"), false);
  $("dropTitle").textContent = "Drop an Excel workbook here";
  $("dropSubtitle").textContent = "or select a local .xlsx file";
  setMessage($("fileError"));
  setMessage($("analysisError"));
  setMessage($("generationError"));
  show($("datasetEmpty"), true);
  show($("datasetDetail"), false);
  resetConfigurationFields();
  renderDeck();
  updateStages();
  if (!keepFilePickerClosed) $("fileInput").click();
  scrollToElement($("top"));
}

function resetWorkbookDependentState() {
  state.analysis = null;
  state.selectedTableId = null;
  state.selectedSlideType = null;
  state.slides = [];
  state.editingSlideIndex = null;
  state.setupMode = null;
  clearGeneratedOutput();
  $("deckTitle").value = "";
  $("outputFilename").value = "";
  $("tableSearch").value = "";
  $("sheetFilter").innerHTML = '<option value="__all__">All worksheets</option>';
  $("recommendedOnly").checked = false;
  $("tableList").innerHTML = "";
  $("tableCount").textContent = "0";
  show($("datasetEmpty"), true);
  show($("datasetDetail"), false);
  resetConfigurationFields();
  renderDeck();
}

function acceptFile(file) {
  setMessage($("fileError"));
  if (!file || !file.name.toLowerCase().endsWith(".xlsx")) {
    setMessage($("fileError"), "Select a valid .xlsx workbook.");
    return;
  }
  resetWorkbookDependentState();
  state.file = file;
  $("selectedFileName").textContent = file.name;
  $("selectedFileMeta").textContent = `${formatBytes(file.size)} · selected, not analyzed`;
  $("dropTitle").textContent = "Workbook selected";
  $("dropSubtitle").textContent = "Review the file below, then analyze when ready.";
  show($("selectedFilePanel"), true);
  updateStages();
}

async function responseError(response) {
  try {
    const body = await response.json();
    return body.detail || JSON.stringify(body);
  } catch (_) {
    return `${response.status} ${response.statusText}`;
  }
}

function renderAnalysisSummary() {
  const workbook = state.analysis.workbook;
  $("analysisSummaryLine").textContent = `${workbook.filename} · ${formatBytes(workbook.size_bytes)}`;
  $("summaryWorksheets").textContent = workbook.worksheet_count || 0;
  $("summaryTables").textContent = workbook.detected_table_count || 0;
  $("summaryRecommended").textContent = workbook.recommended_table_count || 0;
  $("summaryKinds").textContent = Object.keys(workbook.kinds || {}).length;

  const kindEntries = Object.entries(workbook.kinds || {});
  $("kindBadges").innerHTML = kindEntries.length
    ? kindEntries.map(([kind, count]) => `<span class="tag">${escapeHtml(kind)} · ${count}</span>`).join("")
    : '<span class="tag">General data</span>';

  $("worksheetDetails").innerHTML = (workbook.worksheets || []).map((sheet) => `
    <article class="worksheet-row">
      <div><strong>${escapeHtml(sheet.name)}</strong><span>${escapeHtml(sheet.state || "visible")} worksheet</span></div>
      <b>${sheet.recommended_count || 0}/${sheet.table_count || 0} recommended sections</b>
    </article>
  `).join("");
}

function populateSheetFilter() {
  const workbook = state.analysis.workbook;
  $("sheetFilter").innerHTML = '<option value="__all__">All worksheets</option>'
    + (workbook.worksheets || []).map((sheet) => `<option value="${escapeHtml(sheet.name)}">${escapeHtml(sheet.name)} (${sheet.table_count || 0})</option>`).join("");
  $("sheetFilter").value = "__all__";
}

function filteredTables() {
  if (!state.analysis) return [];
  const query = $("tableSearch").value.trim().toLowerCase();
  const sheet = $("sheetFilter").value;
  const recommendedOnly = $("recommendedOnly").checked;
  return state.analysis.tables.filter((table) => {
    if (sheet !== "__all__" && table.sheet_name !== sheet) return false;
    if (recommendedOnly && !table.recommended) return false;
    if (query && !`${table.title} ${table.display_name} ${table.sheet_name} ${table.kind} ${table.range}`.toLowerCase().includes(query)) return false;
    return true;
  }).sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)) || (b.confidence || 0) - (a.confidence || 0));
}

function renderTableList() {
  const tables = filteredTables();
  $("tableCount").textContent = String(tables.length);
  const list = $("tableList");
  if (!tables.length) {
    list.innerHTML = '<div class="locked-message">No data sections match the current filters.</div>';
    return;
  }
  list.innerHTML = "";
  tables.slice(0, 300).forEach((table) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `table-card${table.id === state.selectedTableId ? " active" : ""}`;
    button.setAttribute("aria-pressed", table.id === state.selectedTableId ? "true" : "false");
    button.innerHTML = `
      <div class="table-card-top"><span>${escapeHtml(table.kind)}</span><b>${table.recommended ? "Recommended" : "Available"}</b></div>
      <strong>${escapeHtml(shortText(table.display_name || table.title, 90))}</strong>
      <small>${escapeHtml(table.sheet_name)} · ${table.row_count} rows × ${table.column_count} columns</small>
    `;
    button.addEventListener("click", () => selectTable(table.id));
    list.appendChild(button);
  });
}

function renderPreviewTable(table) {
  const headers = table.headers || [];
  const rows = table.preview_rows || [];
  $("previewTable").innerHTML = `
    <thead><tr>${headers.map((header) => `<th title="${escapeHtml(header)}">${escapeHtml(shortText(header, 32))}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${headers.map((_, index) => `<td title="${escapeHtml(row[index] ?? "")}">${escapeHtml(shortText(row[index] ?? "", 40))}</td>`).join("")}</tr>`).join("")}</tbody>
  `;
}

function userFriendlyWarning(value) {
  return String(value || "")
    .replace(/grouped bar chart/gi, "bar chart")
    .replace(/data matrix/gi, "table")
    .replace(/metric column/gi, "value column")
    .replace(/category/gi, "label");
}

function renderDatasetDetail() {
  const table = currentTable();
  show($("datasetEmpty"), !table);
  show($("datasetDetail"), Boolean(table));
  if (!table) return;

  $("detailKind").textContent = table.kind;
  $("detailConfidence").textContent = table.recommended ? "Recommended" : "Available";
  show($("detailRecommended"), Boolean(table.recommended));
  $("detailTitle").textContent = table.display_name || table.title;
  $("detailSource").textContent = `${table.sheet_name} · ${table.range} · ${table.row_count} rows × ${table.column_count} columns`;
  $("detailWarnings").innerHTML = (table.warnings || []).map((warning) => `<div class="warning-item">${escapeHtml(userFriendlyWarning(warning))}</div>`).join("");
  $("columnProfiles").innerHTML = (table.headers || []).slice(0, 12).map((header) => `
    <span class="profile-chip"><i></i>${escapeHtml(shortText(header, 38))}</span>
  `).join("");
  renderPreviewTable(table);
}

function metricCandidateProfiles(table) {
  const selectedCategory = $("categoryColumn").value === "" ? null : Number($("categoryColumn").value);
  return (table.column_profiles || []).filter((profile) => (
    profile.index !== selectedCategory
    && profile.role !== "annotation"
    && (profile.role === "metric" || profile.role === "delta" || profile.numeric_ratio >= .5)
  ));
}

function groupCandidateProfiles(table) {
  const selectedCategory = $("categoryColumn").value === "" ? null : Number($("categoryColumn").value);
  return (table.column_profiles || []).filter((profile) => (
    profile.index !== selectedCategory
    && profile.role === "dimension"
    && profile.unique_count > 1
    && profile.unique_count <= 40
  ));
}

function populateConfigurationControls(table) {
  $("configurationSourceTitle").textContent = table.display_name || table.title;
  $("configurationSourceMeta").textContent = `${table.sheet_name} · ${table.row_count} rows · ${table.kind}`;

  const categoryProfiles = (table.column_profiles || []).filter((profile) => profile.role !== "annotation");
  $("categoryColumn").innerHTML = '<option value="" selected disabled>Choose a label column</option>'
    + categoryProfiles.map((profile) => {
      const suggested = profile.index === table.suggested_category_index ? " · Recommended" : "";
      return `<option value="${profile.index}">${escapeHtml(profile.header)}${suggested}</option>`;
    }).join("");

  renderMetricOptions(table);
  renderGroupOptions(table);
  renderFilters(table);
  renderVisualChoices();
  updateRepeatedResultsControl();
  updateSeriesEstimate();
  renderFriendlyLabelEditor();
  updateSlideSetupSummary();
  updateConfigurationValidity();
}

function renderMetricOptions(table) {
  const previouslySelected = new Set(selectedIndexes("seriesList"));
  const profiles = metricCandidateProfiles(table);
  if (!profiles.length) {
    $("seriesList").innerHTML = '<div class="locked-message">No numeric columns were found. Use a table or choose another data section.</div>';
    return;
  }
  $("seriesList").innerHTML = profiles.map((profile) => {
    const recommended = (table.suggested_series_indexes || []).includes(profile.index);
    return `
      <label class="selection-option">
        <input type="checkbox" value="${profile.index}" ${previouslySelected.has(profile.index) ? "checked" : ""}>
        <span><strong>${escapeHtml(profile.header)}</strong><small>${recommended ? '<span class="recommended-label">Recommended</span>' : "Available value"}</small></span>
      </label>
    `;
  }).join("");
  $("seriesList").querySelectorAll("input").forEach((input) => input.addEventListener("change", handleMappingChange));
}

function renderGroupOptions(table) {
  const previouslySelected = new Set(selectedIndexes("groupList"));
  const profiles = groupCandidateProfiles(table);
  $("groupList").innerHTML = profiles.length ? profiles.map((profile) => {
    const recommended = (table.suggested_group_by_indexes || []).includes(profile.index);
    return `
      <label class="selection-option">
        <input type="checkbox" value="${profile.index}" ${previouslySelected.has(profile.index) ? "checked" : ""}>
        <span><strong>${escapeHtml(profile.header)}</strong><small>${profile.unique_count} choices${recommended ? ' · <span class="recommended-label">Recommended</span>' : ""}</small></span>
      </label>
    `;
  }).join("") : '<div class="mapping-note">No additional comparison columns were found.</div>';
  $("groupList").querySelectorAll("input").forEach((input) => input.addEventListener("change", handleMappingChange));
}

function renderFilters(table) {
  const profiles = (table.column_profiles || []).filter((profile) => profile.filterable && profile.distinct_values?.length);
  show($("filtersGroup"), profiles.length > 0);
  $("filtersList").innerHTML = profiles.map((profile) => `
    <label class="field-label">${escapeHtml(profile.header)}
      <select data-column-index="${profile.index}">
        <option value="">All values</option>
        ${profile.distinct_values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(shortText(value, 60))}</option>`).join("")}
      </select>
    </label>
  `).join("");
  $("filtersList").querySelectorAll("select").forEach((select) => select.addEventListener("change", handleMappingChange));
}

function estimatedSeriesCount(table) {
  const metricCount = selectedIndexes("seriesList").length;
  if (!metricCount) return 0;
  const filters = currentFilters();
  const groups = selectedIndexes("groupList");
  let combinations = 1;
  groups.forEach((index) => {
    const profile = profileFor(table, index);
    combinations *= filters[String(index)] ? 1 : Math.max(1, profile?.unique_count || 1);
  });
  return metricCount * combinations;
}

function compatibilityFor(table) {
  const categoryValue = $("categoryColumn").value;
  const categoryIndex = categoryValue === "" ? null : Number(categoryValue);
  const categoryProfile = categoryIndex === null ? null : profileFor(table, categoryIndex);
  const metrics = selectedIndexes("seriesList");
  const metricProfiles = metrics.map((index) => profileFor(table, index)).filter(Boolean);
  const seriesCount = estimatedSeriesCount(table);
  const categoryCount = categoryProfile?.unique_count || table.row_count || 0;
  const categoryHeader = String(categoryProfile?.header || "").toLowerCase();
  const orderedCategory = Boolean(categoryProfile && (
    ["size", "number", "date"].includes(categoryProfile.data_type)
    || /size|message|input|packet|frame|date|time|step|iteration/.test(categoryHeader)
  ));
  const selectedDeltasOnly = metricProfiles.length > 0 && metricProfiles.every((profile) => profile.role === "delta");
  const unitFamilies = [...new Set(metricProfiles.filter((profile) => profile.role !== "delta").map((profile) => profile.unit_family || "generic"))];
  const comparableMetrics = unitFamilies.length <= 1 || unitFamilies.every((family) => family === "generic");
  const basicMapping = categoryIndex !== null && metrics.length > 0;
  const seriesSafe = seriesCount > 0 && seriesCount <= MAX_NATIVE_CHART_SERIES;

  return {
    grouped_bar: {
      enabled: basicMapping && categoryCount <= 36 && seriesSafe,
      reason: !basicMapping ? "Choose labels and at least one value" : categoryCount > 36 ? "Too many labels for a readable grouped bar chart" : !seriesSafe ? `This creates ${seriesCount} lines or bar groups; reduce it to ${MAX_NATIVE_CHART_SERIES} or fewer` : "Compatible",
    },
    line: {
      enabled: basicMapping && orderedCategory && categoryCount >= 3 && categoryCount <= 250 && seriesSafe,
      reason: !basicMapping ? "Choose labels and at least one value" : !orderedCategory ? "The selected labels do not have a clear order" : categoryCount < 3 ? "A line chart needs at least three labels" : categoryCount > 250 ? "Too many labels for a readable line chart" : !seriesSafe ? `This creates ${seriesCount} lines or bar groups; reduce it to ${MAX_NATIVE_CHART_SERIES} or fewer` : "Compatible",
    },
    difference: {
      enabled: basicMapping && categoryCount <= 36 && seriesSafe && (selectedDeltasOnly || (metrics.length >= 2 && comparableMetrics)),
      reason: !basicMapping ? "Choose labels and at least one value" : categoryCount > 36 ? "Too many labels for a readable difference chart" : !seriesSafe ? `This creates ${seriesCount} lines or bar groups; reduce it to ${MAX_NATIVE_CHART_SERIES} or fewer` : !(selectedDeltasOnly || (metrics.length >= 2 && comparableMetrics)) ? "Select two comparable values or a difference column" : "Compatible",
    },
    data_matrix: { enabled: true, reason: "Available for this data" },
  };
}

function renderVisualChoices() {
  const table = currentTable();
  if (!table) return;
  const compatibility = compatibilityFor(table);
  const suggestedType = slideTypeDefinitions.some((definition) => definition.value === table.suggested_chart_type)
    ? table.suggested_chart_type
    : null;

  if (state.selectedSlideType && !compatibility[state.selectedSlideType]?.enabled) {
    state.selectedSlideType = null;
  }

  $("slideTypeChoices").innerHTML = slideTypeDefinitions.map((definition) => {
    const status = compatibility[definition.value];
    const selected = state.selectedSlideType === definition.value;
    const recommended = suggestedType === definition.value;
    return `
      <button class="visual-choice${selected ? " selected" : ""}" type="button" role="radio" aria-checked="${selected}" data-slide-type="${definition.value}" ${status.enabled ? "" : "disabled"} title="${escapeHtml(status.reason)}">
        <span class="visual-icon">${definition.icon}</span>
        <span class="visual-choice-copy"><strong>${escapeHtml(definition.label)}</strong><small>${escapeHtml(definition.description)}</small></span>
        <span class="visual-status${recommended ? " recommended" : ""}">${recommended ? "Recommended" : status.enabled ? "Available" : "Unavailable"}</span>
      </button>
    `;
  }).join("");

  $("slideTypeChoices").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSlideType = button.dataset.slideType;
      renderVisualChoices();
      updateDataTableAvailability();
      updateRepeatedResultsControl();
      renderFriendlyLabelEditor();
      updateSlideSetupSummary();
      updateConfigurationValidity();
    });
  });

  const available = Object.entries(compatibility).filter(([, value]) => value.enabled).map(([key]) => key);
  if (available.length === 1 && available[0] === "data_matrix") {
    $("visualCompatibilityNote").textContent = "This data currently works best as a table. Choose different labels or values to enable chart options.";
  } else {
    const seriesCount = estimatedSeriesCount(table);
    $("visualCompatibilityNote").textContent = seriesCount
      ? `${seriesCount} lines or bar groups will be shown. Use a filter if the slide becomes crowded.`
      : "Choose the bottom labels and at least one value to see chart options. A table is always available.";
  }
}

function updateDataTableAvailability() {
  const isTableSlide = state.selectedSlideType === "data_matrix";
  const enabled = ["grouped_bar", "line", "difference"].includes(state.selectedSlideType);
  $("showDataTable").disabled = !enabled;
  $("dataTableToggle").classList.toggle("disabled", !enabled);
  show($("chartMappingFields"), !isTableSlide);
  show($("tableModeNote"), isTableSlide);
  if (!enabled) $("showDataTable").checked = false;
}

function updateSeriesEstimate() {
  const table = currentTable();
  if (!table) return;
  const metrics = selectedIndexes("seriesList").length;
  const groups = selectedIndexes("groupList").length;
  const estimate = estimatedSeriesCount(table);
  if (!metrics) {
    $("seriesEstimate").textContent = "Choose at least one value to plot.";
  } else if (estimate > MAX_NATIVE_CHART_SERIES) {
    $("seriesEstimate").textContent = `This would create ${estimate} lines or bar groups. Use a filter or remove a comparison field to keep the slide readable.`;
  } else if (groups) {
    $("seriesEstimate").textContent = `${estimate} line or bar group${estimate === 1 ? "" : "s"} will be shown.`;
  } else {
    $("seriesEstimate").textContent = `${metrics} value${metrics === 1 ? "" : "s"} selected.`;
  }
}

function handleMappingChange(event) {
  const table = currentTable();
  if (!table) return;
  syncLabelReplacementRules();
  if (event?.target?.id === "categoryColumn") {
    const categoryIndex = Number($("categoryColumn").value);
    $("seriesList").querySelectorAll("input").forEach((input) => {
      if (Number(input.value) === categoryIndex) input.checked = false;
    });
    $("groupList").querySelectorAll("input").forEach((input) => {
      if (Number(input.value) === categoryIndex) input.checked = false;
    });
    renderMetricOptions(table);
    renderGroupOptions(table);
  }
  renderVisualChoices();
  updateDataTableAvailability();
  updateRepeatedResultsControl();
  updateSeriesEstimate();
  renderFriendlyLabelEditor();
  updateSlideSetupSummary();
  updateConfigurationValidity();
}

function updateConfigurationValidity() {
  const title = $("slideTitle").value.trim();
  const table = currentTable();
  const type = state.selectedSlideType;
  let valid = Boolean(table && state.setupMode && title && type);
  if (valid && type !== "data_matrix") {
    const category = $("categoryColumn").value;
    const metrics = selectedIndexes("seriesList");
    const repeated = hasRepeatedCategoryLabels(table);
    const aggregation = $("aggregation").value;
    const compatible = compatibilityFor(table)[type]?.enabled;
    valid = Boolean(category !== "" && metrics.length && (!repeated || aggregation) && compatible);
  }
  $("addSlideButton").disabled = !valid || state.slides.length >= MAX_DECK_SLIDES;
}

function applyRecommendedSetup() {
  const table = currentTable();
  if (!table) return;
  showConfigurationWorkspace("recommended");
  $("slideTitle").value = table.title || table.display_name || "Performance results";
  $("categoryColumn").value = String(table.suggested_category_index ?? "");
  renderMetricOptions(table);
  renderGroupOptions(table);
  const metricSet = new Set(table.suggested_series_indexes || []);
  $("seriesList").querySelectorAll("input").forEach((input) => { input.checked = metricSet.has(Number(input.value)); });
  const groupSet = new Set(table.suggested_group_by_indexes || []);
  $("groupList").querySelectorAll("input").forEach((input) => { input.checked = groupSet.has(Number(input.value)); });
  $("xAxisTitle").value = table.suggested_x_axis_title || "";
  $("yAxisTitle").value = table.suggested_y_axis_title || "";
  $("sortCategories").checked = true;

  renderVisualChoices();
  const compatibility = compatibilityFor(table);
  state.selectedSlideType = compatibility[table.suggested_chart_type]?.enabled
    ? table.suggested_chart_type
    : slideTypeDefinitions.find((definition) => compatibility[definition.value]?.enabled)?.value || "data_matrix";
  updateRepeatedResultsControl();
  const recommendedRepeatHandling = ["none", "mean", "median", "max", "min"].includes(table.suggested_aggregation)
    ? table.suggested_aggregation
    : "none";
  $("aggregation").value = recommendedRepeatHandling;
  delete $("aggregation").dataset.hiddenDefault;
  $("showDataTable").checked = Boolean(table.suggested_show_data_table && ["grouped_bar", "line", "difference"].includes(state.selectedSlideType));
  renderVisualChoices();
  updateDataTableAvailability();
  updateRepeatedResultsControl();
  if (hasRepeatedCategoryLabels(table)) $("aggregation").value = recommendedRepeatHandling;
  updateSeriesEstimate();
  renderFriendlyLabelEditor("");
  updateSlideSetupSummary();
  updateConfigurationValidity();
  setMessage($("configurationError"));
  scrollToElement($("configurationWorkspace"));
}

function selectTable(tableId) {
  state.editingSlideIndex = null;
  state.selectedTableId = tableId;
  resetConfigurationFields();
  renderTableList();
  renderDatasetDetail();
  populateConfigurationControls(currentTable());
  clearGeneratedOutput();
  updateStages();
}

async function analyzeWorkbook() {
  if (!state.file) return;
  $("analyzeButton").disabled = true;
  $("reanalyzeButton").disabled = true;
  show($("analysisProgress"), true);
  setMessage($("analysisError"));
  const form = new FormData();
  form.append("file", state.file);
  try {
    const response = await fetch("/api/inspect", { method: "POST", body: form });
    if (!response.ok) throw new Error(await responseError(response));
    state.analysis = await response.json();
    state.selectedTableId = null;
    state.selectedSlideType = null;
    state.slides = [];
    state.editingSlideIndex = null;
    clearGeneratedOutput();
    renderAnalysisSummary();
    populateSheetFilter();
    renderTableList();
    renderDatasetDetail();
    renderDeck();
    updateStages();
    scrollToElement($("stageReview"));
  } catch (error) {
    setMessage($("analysisError"), error.message || "The workbook could not be analyzed.");
  } finally {
    show($("analysisProgress"), false);
    $("analyzeButton").disabled = false;
    $("reanalyzeButton").disabled = false;
  }
}

function slideTypeLabel(value) {
  return slideTypeDefinitions.find((definition) => definition.value === value)?.label || value;
}

function repeatedMeasurementLabel(value) {
  const labels = {
    none: "Show each repeated result separately",
    mean: "Use the average result",
    median: "Use the middle result",
    max: "Use the highest result",
    min: "Use the lowest result",
  };
  return labels[value] || "";
}

function labelCleanupSummary(slide) {
  const parts = [];
  if (slide.label_simplify) parts.push("dates and run details removed");
  if ((slide.label_replacements || "").trim()) parts.push("names edited");
  return parts.length ? parts.join(" · ") : null;
}

function collectLabelOptions() {
  syncLabelReplacementRules();
  return {
    label_simplify: $("simplifyLabels").checked,
    label_replacements: $("labelReplacements").value.trim(),
    label_max_length: Number($("labelMaxLength").value || 60),
  };
}

function addConfiguredSlide(event) {
  event.preventDefault();
  const table = currentTable();
  if (!table) return;
  setMessage($("configurationError"));
  updateConfigurationValidity();
  if ($("addSlideButton").disabled) {
    setMessage($("configurationError"), "Finish the highlighted slide choices before adding the slide.");
    return;
  }
  if (state.editingSlideIndex === null && state.slides.length >= MAX_DECK_SLIDES) {
    setMessage($("configurationError"), `The presentation limit is ${MAX_DECK_SLIDES} slides.`);
    return;
  }
  const type = state.selectedSlideType;
  const categoryValue = $("categoryColumn").value;
  const categoryIndex = categoryValue === "" ? (table.suggested_category_index ?? 0) : Number(categoryValue);
  const slide = {
    id: state.editingSlideIndex !== null && state.slides[state.editingSlideIndex]?.id
      ? state.slides[state.editingSlideIndex].id
      : (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
    table_id: table.id,
    source_name: table.display_name,
    source_kind: table.kind,
    slide_type: type,
    title: $("slideTitle").value.trim(),
    category_index: categoryIndex,
    series_indexes: type === "data_matrix" ? [] : selectedIndexes("seriesList"),
    group_by_indexes: type === "data_matrix" ? [] : selectedIndexes("groupList"),
    filters: type === "data_matrix" ? {} : currentFilters(),
    aggregation: type === "data_matrix" ? "auto" : ($("aggregation").value || "none"),
    sort_categories: type === "data_matrix" ? false : $("sortCategories").checked,
    x_axis_title: type === "data_matrix" ? "" : $("xAxisTitle").value.trim(),
    y_axis_title: type === "data_matrix" ? "Value" : ($("yAxisTitle").value.trim() || "Value"),
    show_data_table: type === "data_matrix" ? false : $("showDataTable").checked,
    ...collectLabelOptions(),
  };
  if (state.editingSlideIndex !== null && state.slides[state.editingSlideIndex]) {
    state.slides[state.editingSlideIndex] = slide;
    state.editingSlideIndex = null;
    $("addSlideButton").textContent = "Add slide to presentation";
  } else {
    state.slides.push(slide);
    $("addSlideButton").textContent = "Add another slide";
  }
  clearGeneratedOutput();
  renderDeck();
  updateStages();
  scrollToElement($("stageGenerate"));
}

function moveSlide(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= state.slides.length) return;
  [state.slides[index], state.slides[target]] = [state.slides[target], state.slides[index]];
  clearGeneratedOutput();
  renderDeck();
  updateStages();
}

function removeSlide(index) {
  state.slides.splice(index, 1);
  if (state.editingSlideIndex === index) state.editingSlideIndex = null;
  else if (state.editingSlideIndex !== null && state.editingSlideIndex > index) state.editingSlideIndex -= 1;
  clearGeneratedOutput();
  renderDeck();
  updateStages();
}

function editSlide(index) {
  const slide = state.slides[index];
  if (!slide || !state.analysis) return;
  const table = state.analysis.tables.find((entry) => entry.id === slide.table_id);
  if (!table) return;

  state.selectedTableId = slide.table_id;
  state.selectedSlideType = slide.slide_type;
  state.editingSlideIndex = index;
  resetConfigurationFields({ keepEditing: true });
  state.selectedSlideType = slide.slide_type;
  state.setupMode = "edit";
  renderTableList();
  renderDatasetDetail();
  populateConfigurationControls(table);
  show($("setupChoicePanel"), false);
  show($("configurationWorkspace"), true);

  $("slideTitle").value = slide.title || "";
  $("categoryColumn").value = String(slide.category_index ?? "");
  renderMetricOptions(table);
  renderGroupOptions(table);
  $("seriesList").querySelectorAll("input").forEach((input) => { input.checked = (slide.series_indexes || []).includes(Number(input.value)); });
  $("groupList").querySelectorAll("input").forEach((input) => { input.checked = (slide.group_by_indexes || []).includes(Number(input.value)); });
  $("filtersList").querySelectorAll("select[data-column-index]").forEach((select) => {
    const values = slide.filters?.[String(select.dataset.columnIndex)] || [];
    select.value = values[0] || "";
  });
  $("aggregation").value = slide.aggregation === "auto" ? "" : (slide.aggregation || "");
  $("xAxisTitle").value = slide.x_axis_title || "";
  $("yAxisTitle").value = slide.y_axis_title || "";
  $("showDataTable").checked = Boolean(slide.show_data_table);
  $("sortCategories").checked = Boolean(slide.sort_categories);
  $("simplifyLabels").checked = Boolean(slide.label_simplify);
  $("labelReplacements").value = slide.label_replacements || "";
  $("labelMaxLength").value = String(slide.label_max_length || 60);
  $("addSlideButton").textContent = "Update slide";

  renderVisualChoices();
  updateDataTableAvailability();
  updateRepeatedResultsControl();
  if (slide.aggregation && slide.aggregation !== "auto") $("aggregation").value = slide.aggregation;
  updateSeriesEstimate();
  renderFriendlyLabelEditor(slide.label_replacements || "");
  updateSlideSetupSummary();
  updateConfigurationValidity();
  updateStages();
  scrollToElement($("stageConfigure"));
}

function renderDeck() {
  $("slideCount").textContent = String(state.slides.length);
  const list = $("deckList");
  list.innerHTML = "";
  state.slides.forEach((slide, index) => {
    const article = document.createElement("article");
    article.className = "deck-item";
    const detail = [
      slideTypeLabel(slide.slide_type),
      slide.show_data_table ? "Table included" : null,
      slide.group_by_indexes.length ? "Compared by group" : null,
      labelCleanupSummary(slide),
    ].filter(Boolean).join(" · ");
    article.innerHTML = `
      <div class="deck-index">${index + 1}</div>
      <div class="deck-item-copy"><strong>${escapeHtml(slide.title)}</strong><span>${escapeHtml(detail)}</span></div>
      <div class="deck-actions">
        <button class="edit-slide" type="button" aria-label="Edit slide ${index + 1}" title="Edit slide">Edit</button>
        <button class="move-up" type="button" aria-label="Move slide ${index + 1} up" title="Move up">↑</button>
        <button class="move-down" type="button" aria-label="Move slide ${index + 1} down" title="Move down">↓</button>
        <button class="remove-slide" type="button" aria-label="Remove slide ${index + 1}" title="Remove">×</button>
      </div>
    `;
    article.querySelector(".edit-slide").addEventListener("click", () => editSlide(index));
    article.querySelector(".move-up").disabled = index === 0;
    article.querySelector(".move-down").disabled = index === state.slides.length - 1;
    article.querySelector(".move-up").addEventListener("click", () => moveSlide(index, -1));
    article.querySelector(".move-down").addEventListener("click", () => moveSlide(index, 1));
    article.querySelector(".remove-slide").addEventListener("click", () => removeSlide(index));
    list.appendChild(article);
  });
  $("reviewPresentationButton").disabled = state.slides.length === 0;
  updateGenerationReadiness();
}

function updateGenerationReadiness() {
  const hasSlides = state.slides.length > 0;
  const title = $("deckTitle").value.trim();
  const filename = safeFilename($("outputFilename").value.trim());
  const valid = Boolean(hasSlides && title && filename);
  $("generateButton").disabled = !valid;
  if (!hasSlides) {
    $("generationReadinessTitle").textContent = "Add at least one slide";
    $("generationReadinessText").textContent = "The Generate Presentation button remains disabled until the deck contains slides.";
  } else if (!title || !filename) {
    const missing = [!title ? "presentation title" : null, !filename ? "output filename" : null].filter(Boolean).join(" and ");
    $("generationReadinessTitle").textContent = `Complete the ${missing}`;
    $("generationReadinessText").textContent = "Enter both fields to continue.";
  } else {
    $("generationReadinessTitle").textContent = "Presentation is ready to generate";
    $("generationReadinessText").textContent = `${state.slides.length} slide${state.slides.length === 1 ? "" : "s"} will be generated as ${filename}.`;
  }
}

function renderReviewDialog() {
  const title = $("deckTitle").value.trim() || "Untitled presentation";
  const filename = safeFilename($("outputFilename").value.trim()) || "Output filename not set";
  $("reviewDialogTitle").textContent = title;
  $("reviewDialogSubtitle").textContent = `${state.slides.length} slide${state.slides.length === 1 ? "" : "s"} · ${filename}`;
  $("reviewSlides").innerHTML = state.slides.map((slide, index) => {
    const detail = [
      slideTypeLabel(slide.slide_type),
      slide.source_name,
      slide.show_data_table ? "Table included" : null,
      slide.slide_type !== "data_matrix" && slide.aggregation !== "none" ? repeatedMeasurementLabel(slide.aggregation) : null,
      labelCleanupSummary(slide),
    ].filter(Boolean).join(" · ");
    return `
      <article class="review-card">
        <div class="slide-number">${index + 1}</div>
        <div><strong>${escapeHtml(slide.title)}</strong><span>${escapeHtml(detail)}</span></div>
        <span class="tag">${escapeHtml(slide.source_kind)}</span>
      </article>
    `;
  }).join("");
  $("reviewDialog").showModal();
}

async function generatePresentation() {
  if (!deckDetailsValid()) return;
  const button = $("generateButton");
  button.disabled = true;
  button.textContent = "Generating…";
  show($("generationProgress"), true);
  setMessage($("generationError"));
  clearGeneratedOutput();
  state.generationStartedAt = performance.now();

  const payload = {
    deck_title: $("deckTitle").value.trim(),
    output_filename: safeFilename($("outputFilename").value.trim()),
    slides: state.slides.map((slide) => ({
      table_id: slide.table_id,
      slide_type: slide.slide_type,
      title: slide.title,
      category_index: slide.category_index,
      series_indexes: slide.series_indexes,
      group_by_indexes: slide.group_by_indexes,
      filters: slide.filters,
      aggregation: slide.aggregation,
      sort_categories: slide.sort_categories,
      x_axis_title: slide.x_axis_title,
      y_axis_title: slide.y_axis_title,
      show_data_table: slide.show_data_table,
      label_simplify: Boolean(slide.label_simplify),
      label_replacements: slide.label_replacements || "",
      label_max_length: Number(slide.label_max_length || 60),
    })),
  };
  const form = new FormData();
  form.append("file", state.file);
  form.append("plan", JSON.stringify(payload));

  try {
    const response = await fetch("/api/generate-local", { method: "POST", body: form });
    if (!response.ok) throw new Error(await responseError(response));
    state.generatedOutput = await response.json();
    renderCompletion();
    updateStages();
    scrollToElement($("stageDownload"));
  } catch (error) {
    setMessage($("generationError"), error.message || "The PowerPoint could not be generated.");
  } finally {
    show($("generationProgress"), false);
    button.textContent = "Generate presentation";
    updateGenerationReadiness();
  }
}

function renderCompletion() {
  const output = state.generatedOutput;
  if (!output) return;
  $("generatedFilename").textContent = output.filename;
  $("generatedSlideCount").textContent = String(output.slide_count ?? state.slides.length);
  $("generatedFileSize").textContent = formatBytes(output.size_bytes);
  const localElapsed = state.generationStartedAt ? (performance.now() - state.generationStartedAt) / 1000 : null;
  $("generatedTime").textContent = formatSeconds(output.generation_seconds ?? localElapsed);
  $("generatedSavedPath").textContent = output.saved_path || "Local output path unavailable";
  $("downloadPowerPointButton").disabled = !output.download_url;
  if ($("openPowerPointButton")) $("openPowerPointButton").disabled = !output.filename;
  if ($("showOutputFolderButton")) $("showOutputFolderButton").disabled = !output.filename;
  setMessage($("downloadError"));
  setMessage($("downloadStatus"));
}

async function downloadGeneratedPowerPoint(event) {
  event.preventDefault();
  const output = state.generatedOutput;
  if (!output?.download_url || !output?.filename) return;

  const button = $("downloadPowerPointButton");
  button.disabled = true;
  button.textContent = "Starting download…";
  setMessage($("downloadError"));

  try {
    // Direct browser navigation to the validated saved PPTX. This avoids
    // JavaScript Blob rewriting, which was the cause of blank/invalid
    // PowerPoint opens on some Windows setups.
    window.location.href = `${output.download_url}${output.download_url.includes("?") ? "&" : "?"}t=${Date.now()}`;
    setMessage($("downloadStatus"), "Download started. If the downloaded copy still opens blank, use Open in PowerPoint to open the saved local file directly.", "success");
  } catch (error) {
    setMessage($("downloadError"), error.message || "The generated PowerPoint could not be downloaded.");
    setMessage($("downloadStatus"));
  } finally {
    window.setTimeout(() => {
      button.disabled = !state.generatedOutput?.download_url;
      button.textContent = "Download copy";
    }, 600);
  }
}

async function postOutputAction(endpoint, statusText) {
  const output = state.generatedOutput;
  if (!output?.filename) return;
  const form = new FormData();
  form.append("filename", output.filename);
  const response = await fetch(endpoint, { method: "POST", body: form });
  if (!response.ok) throw new Error(await responseError(response));
  setMessage($("downloadStatus"), statusText, "success");
}

async function openGeneratedPowerPoint(event) {
  event.preventDefault();
  const button = $("openPowerPointButton");
  if (!state.generatedOutput?.filename) return;
  button.disabled = true;
  button.textContent = "Opening…";
  setMessage($("downloadError"));
  try {
    await postOutputAction("/api/open-output", "Opening the saved PowerPoint from the local outputs folder.");
  } catch (error) {
    setMessage($("downloadError"), error.message || "The saved PowerPoint could not be opened.");
    setMessage($("downloadStatus"));
  } finally {
    button.disabled = !state.generatedOutput?.filename;
    button.textContent = "Open in PowerPoint";
  }
}

async function showOutputFolder(event) {
  event.preventDefault();
  const button = $("showOutputFolderButton");
  if (!state.generatedOutput?.filename) return;
  button.disabled = true;
  button.textContent = "Opening folder…";
  setMessage($("downloadError"));
  try {
    await postOutputAction("/api/show-output-folder", "Opening the output folder.");
  } catch (error) {
    setMessage($("downloadError"), error.message || "The output folder could not be opened.");
    setMessage($("downloadStatus"));
  } finally {
    button.disabled = !state.generatedOutput?.filename;
    button.textContent = "Show in folder";
  }
}


function copyOutputPath() {
  const path = state.generatedOutput?.saved_path;
  if (!path) return;
  navigator.clipboard?.writeText(path).then(() => {
    $("copyOutputPathButton").textContent = "Copied";
    window.setTimeout(() => { $("copyOutputPathButton").textContent = "Copy path"; }, 1500);
  }).catch(() => {
    $("copyOutputPathButton").textContent = "Copy unavailable";
  });
}

function confirmNewPresentation() {
  const hasWork = Boolean(state.file || state.analysis || state.slides.length || state.generatedOutput);
  if (!hasWork || window.confirm("Start a new presentation? Current workbook selections and slide configuration will be cleared.")) {
    resetProject();
  }
}

function bindEvents() {
  $("browseButton").addEventListener("click", (event) => { event.stopPropagation(); $("fileInput").click(); });
  $("fileInput").addEventListener("change", () => acceptFile($("fileInput").files[0]));
  $("dropZone").addEventListener("click", (event) => { if (event.target.id !== "browseButton") $("fileInput").click(); });
  $("dropZone").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      $("fileInput").click();
    }
  });
  ["dragenter", "dragover"].forEach((name) => $("dropZone").addEventListener(name, (event) => {
    event.preventDefault();
    $("dropZone").classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((name) => $("dropZone").addEventListener(name, (event) => {
    event.preventDefault();
    $("dropZone").classList.remove("dragging");
  }));
  $("dropZone").addEventListener("drop", (event) => acceptFile(event.dataTransfer.files[0]));
  $("changeWorkbookButton").addEventListener("click", () => $("fileInput").click());
  $("removeWorkbookButton").addEventListener("click", () => resetProject());
  $("analyzeButton").addEventListener("click", analyzeWorkbook);
  $("reanalyzeButton").addEventListener("click", analyzeWorkbook);

  $("tableSearch").addEventListener("input", renderTableList);
  $("sheetFilter").addEventListener("change", renderTableList);
  $("recommendedOnly").addEventListener("change", renderTableList);
  $("configureDatasetButton").addEventListener("click", () => scrollToElement($("stageConfigure")));
  $("chooseDifferentDatasetButton").addEventListener("click", () => scrollToElement($("stageReview")));
  $("quickSetupButton").addEventListener("click", applyRecommendedSetup);
  $("manualSetupButton").addEventListener("click", startManualSetup);
  $("useRecommendedButton").addEventListener("click", applyRecommendedSetup);
  $("resetLabelNamesButton").addEventListener("click", resetLabelNames);
  $("categoryColumn").addEventListener("change", handleMappingChange);
  $("aggregation").addEventListener("change", () => { updateSlideSetupSummary(); updateConfigurationValidity(); });
  $("simplifyLabels").addEventListener("change", () => { renderFriendlyLabelEditor(); updateSlideSetupSummary(); updateConfigurationValidity(); });
  $("slideTitle").addEventListener("input", () => { updateSlideSetupSummary(); updateConfigurationValidity(); });
  $("configurationForm").addEventListener("submit", addConfiguredSlide);

  $("deckTitle").addEventListener("input", () => { clearGeneratedOutput(); updateStages(); });
  $("outputFilename").addEventListener("input", () => { clearGeneratedOutput(); updateStages(); });
  $("reviewPresentationButton").addEventListener("click", renderReviewDialog);
  $("reviewGeneratedButton").addEventListener("click", renderReviewDialog);
  $("generateButton").addEventListener("click", generatePresentation);
  $("clearPresentationButton").addEventListener("click", () => $("clearDialog").showModal());
  $("cancelClearButton").addEventListener("click", () => $("clearDialog").close());
  $("confirmClearButton").addEventListener("click", () => {
    state.slides = [];
    state.editingSlideIndex = null;
    clearGeneratedOutput();
    $("clearDialog").close();
    renderDeck();
    updateStages();
    scrollToElement($("stageConfigure"));
  });

  $("downloadPowerPointButton").addEventListener("click", downloadGeneratedPowerPoint);
  $("openPowerPointButton").addEventListener("click", openGeneratedPowerPoint);
  $("showOutputFolderButton").addEventListener("click", showOutputFolder);
  $("copyOutputPathButton").addEventListener("click", copyOutputPath);
  $("generateAnotherButton").addEventListener("click", confirmNewPresentation);
  $("newPresentationButton").addEventListener("click", confirmNewPresentation);

  $("helpButton").addEventListener("click", () => $("helpDialog").showModal());
  $("closeReviewDialogButton").addEventListener("click", () => $("reviewDialog").close());
  $("closeReviewDialogFooterButton").addEventListener("click", () => $("reviewDialog").close());
}

bindEvents();
resetProject();
