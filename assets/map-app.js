(() => {
  const config = window.RTS_MAP_CONFIG || {};
  const geojsonBasePath = config.geojsonBasePath || "./gis";
  const fallbackCenter = Array.isArray(config.initialCenter) ? config.initialCenter : [39.5, -98.35];
  const fallbackZoom = Number.isFinite(config.initialZoom) ? config.initialZoom : 6;

  const map = L.map("map", {
    zoomControl: true,
    zoomDelta: 0.5,
    zoomSnap: 0.5
  }).setView(fallbackCenter, fallbackZoom);

  const lightTiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  });

  const darkTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
  });

  let activeBaseLayer = null;
  let activeTileErrorCount = 0;
  let linesLayer = null;
  let busesLayer = null;
  let genConnLayer = null;
  let areasLayer = null;
  let contingencyControlContainer = null;
  let selectedContingencyUid = "";
  let selectedContingencySeason = "";
  let activeContingencyConverged = false;
  let activeLineMetric = "loading";
  let isBusVoltageMetricActive = false;
  let currentViewMode = "default";
  let loadingMetricButton = null;
  let lineFlowMetricButton = null;
  let busVoltageMetricButton = null;
  let genActiveMetricButton = null;
  let genReactiveMetricButton = null;
  let activeGeneratorMetric = null;
  let lineColorLegendElement = null;
  const contingencySeasonByUid = {};
  const caRowsCacheBySeason = new Map();
  const caBusRowsCacheBySeason = new Map();
  const caGenRowsCacheBySeason = new Map();
  let activeFlowRowsByUid = {};
  let activeBusRowsByBusId = {};
  let activeGenRowsByBusId = {};
  let activeGenRowsByBusAndMachine = {};
  let activeGenRowsListByBus = {};

  // Base case state
  let baseCaseControlContainer = null;
  let selectedBaseCaseSeason = "summer";
  let activeBaseCaseLineMetric = "loading";
  let isBaseCaseBusVoltageMetricActive = false;
  let activeBaseCaseGeneratorMetric = null;
  let bcLoadingMetricButton = null;
  let bcLineFlowMetricButton = null;
  let bcBusVoltageMetricButton = null;
  let bcGenActiveMetricButton = null;
  let bcGenReactiveMetricButton = null;
  const baseCaseLineRowsCacheBySeason = new Map();
  const baseCaseBusRowsCacheBySeason = new Map();
  const baseCaseGenRowsCacheBySeason = new Map();
  let baseCaseFlowRowsByUid = {};
  let baseCaseBusRowsByBusId = {};
  let baseCaseGenRowsByBusAndMachine = {};
  let baseCaseGenRowsListByBus = {};
  let baseCaseDataPanelRef = null;
  let contingencyDataPanelRef = null;
  const popupLayers = [];
  const warning = document.getElementById("map-warning");

  const defaultLineStyle = {
    color: "#4f81bd",
    weight: 2,
    opacity: 0.75,
    dashArray: ""
  };

  const contingencyLineStyle = {
    color: "#fffb00",
    weight: 4,
    opacity: 1,
    dashArray: "8 6"
  };

  const setBaseLayer = (layer) => {
    if (activeBaseLayer && map.hasLayer(activeBaseLayer)) {
      map.removeLayer(activeBaseLayer);
    }
    activeBaseLayer = layer;
    activeTileErrorCount = 0;
    if (warning) {
      warning.style.display = "none";
    }
    if (!map.hasLayer(layer)) {
      layer.addTo(map);
    }
  };

  const bindTileWarnings = (layer) => {
    layer.on("tileerror", () => {
      if (activeBaseLayer !== layer) {
        return;
      }
      activeTileErrorCount += 1;
      if (activeTileErrorCount >= 3 && warning) {
        warning.style.display = "block";
      }
    });

    layer.on("load", () => {
      if (activeBaseLayer === layer && warning) {
        warning.style.display = "none";
      }
    });
  };

  bindTileWarnings(lightTiles);
  bindTileWarnings(darkTiles);

  const areaLightFillColor = {
    "1": "#fbbf24",
    "2": "#60a5fa",
    "3": "#34d399"
  };

  const areaLightStrokeColor = {
    "1": "#92400e",
    "2": "#1d4ed8",
    "3": "#047857"
  };

  const areaDarkFillColor = {
    "1": "#fde68a",
    "2": "#bfdbfe",
    "3": "#bbf7d0"
  };

  const areaStyleForTheme = (area, dark) => {
    if (dark) {
      const c = areaDarkFillColor[area] || "#d1d5db";
      return {
        color: c,
        weight: 1,
        opacity: 0.65,
        fillColor: c,
        fillOpacity: 0.2,
        interactive: false
      };
    }

    return {
      color: areaLightStrokeColor[area] || "#4b5563",
      weight: 1.6,
      opacity: 0.9,
      fillColor: areaLightFillColor[area] || "#9ca3af",
      fillOpacity: 0.32,
      interactive: false
    };
  };

  const setTheme = (mode) => {
    const dark = mode === "dark";
    document.body.classList.toggle("dark-mode", dark);
    setBaseLayer(dark ? darkTiles : lightTiles);

    if (genConnLayer) {
      genConnLayer.setStyle({ color: dark ? "#ffffff" : "#000000" });
    }

    if (areasLayer) {
      areasLayer.eachLayer((layer) => {
        const area = String(layer.options && layer.options.areaId ? layer.options.areaId : "");
        layer.setStyle(areaStyleForTheme(area, dark));
      });
    }

    const button = document.getElementById("theme-toggle-btn");
    if (button) {
      button.textContent = "☀";
    }

    try {
      localStorage.setItem("mapTheme", dark ? "dark" : "light");
    } catch (_error) {
      // Ignore localStorage errors in restrictive environments.
    }
  };

  const ThemeToggleControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const container = L.DomUtil.create("div", "leaflet-bar");
      const btn = L.DomUtil.create("button", "theme-toggle-btn", container);
      btn.id = "theme-toggle-btn";
      btn.type = "button";
      btn.title = "Toggle dark/light mode";
      btn.textContent = "☀";

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(btn, "click", () => {
        const isDark = document.body.classList.contains("dark-mode");
        setTheme(isDark ? "light" : "dark");
      });

      return container;
    }
  });

  map.addControl(new ThemeToggleControl());
  setTheme("light");

  const esc = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  const formatFloatValue = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return value ?? "N/A";
    }
    if (Number.isInteger(numeric)) {
      return String(Math.trunc(numeric));
    }
    return numeric.toFixed(2);
  };

  const propertiesToPopupHtml = (props, title) => {
    const entries = Object.entries(props || {});
    if (!entries.length) {
      return `<b>${esc(title)}</b><br>No properties`;
    }

    const rows = entries
      .map(([key, value]) => `<b>${esc(key)}:</b> ${esc(formatFloatValue(value))}`)
      .join("<br>");

    return `<b>${esc(title)}</b><br>${rows}`;
  };

  const generatorPopupFields = [
    "GEN UID",
    "Bus ID",
    "Gen ID",
    "Unit Group",
    "Unit Type",
    "Category",
    "Fuel",
    "MW Inj",
    "MVAR Inj",
    "V Setpoint p.u.",
    "PMax MW",
    "PMin MW",
    "QMax MVAR",
    "QMin MVAR",
    "Damping Ratio",
    "Inertia MJ/MW",
    "Base MVA",
    "Transformer X p.u.",
    "Unit X p.u."
  ];

  const generatorPropertiesToPopupHtml = (props) => {
    const p = props || {};
    const rows = generatorPopupFields
      .map((key) => `<b>${esc(key)}:</b> ${esc(formatFloatValue(p[key]))}`)
      .join("<br>");
    return `<b>Generator</b><br>${rows}`;
  };

  const generatorContingencyPopupHtml = (row) => {
    if (!row) {
      return "<b>Generator</b><br>No contingency generator data found.";
    }

    const formatGenPowerValue = (value) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return "N/A";
      }
      const fixed = numeric.toFixed(2);
      return fixed.endsWith(".00") ? fixed.replace(".00", ".0") : fixed;
    };

    const lines = [
      `<b>MachineID:</b> ${esc(formatFloatValue(row.MachineID))}`,
      `<b>Active Power:</b> ${esc(`${formatGenPowerValue(row["Pg(MW)"])} MW`)}`,
      `<b>Reactive Power:</b> ${esc(`${formatGenPowerValue(row["Qg(MVAr)"])} MVAr`)}`,
      `<b>Max Active Power:</b> ${esc(`${formatGenPowerValue(row["PgMax(MW)"])} MW`)}`,
      `<b>Min Active Power:</b> ${esc(`${formatGenPowerValue(row["PgMin(MW)"])} MW`)}`,
      `<b>Max Reactive Power:</b> ${esc(`${formatGenPowerValue(row["QgMax(MVAr)"])} MVAr`)}`,
      `<b>Min Reactive Power:</b> ${esc(`${formatGenPowerValue(row["QgMin(MVAr)"])} MVAr`)}`,
      `<b>Violation:</b> ${esc(formatFloatValue(row.Violation))}`
    ];
    return `<b>Generator</b><br>${lines.join("<br>")}`;
  };

  const closeAllPinnedPopups = () => {
    popupLayers.forEach((layer) => {
      layer._popupPinned = false;
      layer.closePopup();
    });
  };

  map.on("click", () => {
    closeAllPinnedPopups();
  });

  const bindHoverPopup = (layer, htmlOrResolver) => {
    layer._popupPinned = false;
    layer.bindPopup("", {
      closeButton: true,
      autoClose: false,
      closeOnClick: false,
      autoPan: false
    });

    const getHtml = () => {
      if (typeof htmlOrResolver === "function") {
        return htmlOrResolver(layer);
      }
      return htmlOrResolver;
    };

    const updatePopupContent = () => {
      const popup = layer.getPopup && layer.getPopup();
      if (!popup || !popup.setContent) {
        return;
      }
      popup.setContent(getHtml());
    };

    popupLayers.push(layer);

    layer.on("mouseover", function onOver() {
      if (!this._popupPinned) {
        updatePopupContent();
        this.openPopup();
      }
    });

    layer.on("mouseout", function onOut() {
      if (!this._popupPinned) {
        this.closePopup();
      }
    });

    layer.on("click", function onClick(event) {
      if (event && event.originalEvent) {
        L.DomEvent.stopPropagation(event.originalEvent);
      }
      this._popupPinned = true;
      updatePopupContent();
      this.openPopup(event ? event.latlng : undefined);
    });

    layer.on("popupclose", function onClose() {
      this._popupPinned = false;
    });
  };

  const lineStyleForFeature = (feature) => {
    const uid = String((feature && feature.properties && feature.properties.UID) || "");
    if (currentViewMode === "contingency" && activeContingencyConverged && (activeLineMetric === "loading" || activeLineMetric === "lineFlow")) {
      const value = getMetricValueForUid(uid, activeLineMetric);
      if (Number.isFinite(value)) {
        const { min, max } = getMetricRange(activeLineMetric);
        return {
          color: colorForMetricValue(value, min, max, activeLineMetric),
          weight: 3.2,
          opacity: 0.95,
          dashArray: ""
        };
      }
    }

    if (currentViewMode === "baseCase" && (activeBaseCaseLineMetric === "loading" || activeBaseCaseLineMetric === "lineFlow")) {
      const row = baseCaseFlowRowsByUid[uid];
      const value = getMetricValueForRow(row, activeBaseCaseLineMetric);
      if (Number.isFinite(value)) {
        let min;
        let max;
        if (activeBaseCaseLineMetric === "loading") {
          min = 0;
          max = 150;
        } else {
          const sourceRows = Object.values(baseCaseFlowRowsByUid);
          const values = sourceRows.map((r) => getMetricValueForRow(r, activeBaseCaseLineMetric)).filter((v) => Number.isFinite(v));
          min = values.length ? Math.floor(Math.min(...values)) : 0;
          max = values.length ? Math.ceil(Math.max(...values)) : 1;
        }
        return {
          color: colorForMetricValue(value, min, max, activeBaseCaseLineMetric),
          weight: 3.2,
          opacity: 0.95,
          dashArray: ""
        };
      }
    }

    if (selectedContingencyUid && uid === selectedContingencyUid) {
      return contingencyLineStyle;
    }

    return defaultLineStyle;
  };

  const refreshLineHighlight = () => {
    if (!linesLayer) {
      return;
    }

    linesLayer.eachLayer((layer) => {
      if (!layer || !layer.setStyle) {
        return;
      }
      layer.setStyle(lineStyleForFeature(layer.feature));
    });
  };

  const busIconHtml = (color) => `<div style="width:12px;height:12px;background:${color};border:1px solid ${color};box-sizing:border-box;position:relative;overflow:hidden;"><span style="position:absolute;left:-2px;top:5px;width:16px;height:1.4px;background:#111;transform:rotate(45deg);transform-origin:center;"></span></div>`;

  const busIdFromFeature = (feature) => normalizeBusValue(((feature && feature.properties) || {})["Bus ID"]);

  const refreshBusColors = () => {
    if (!busesLayer) {
      return;
    }

    const voltageRange = getMetricRange("busVoltage");

    busesLayer.eachLayer((layer) => {
      const feature = layer && layer.feature;
      const busId = busIdFromFeature(feature);
      const baseColor = layer.options && layer.options.baseBusColor ? layer.options.baseBusColor : "#000000";

      let color = baseColor;
      if (currentViewMode === "contingency" && activeContingencyConverged && isBusVoltageMetricActive) {
        const value = getMetricValueForBusId(busId, "busVoltage");
        if (Number.isFinite(value)) {
          color = colorForMetricValue(value, voltageRange.min, voltageRange.max, "busVoltage");
        }
      }

      if (currentViewMode === "baseCase" && isBaseCaseBusVoltageMetricActive) {
        const row = baseCaseBusRowsByBusId[busId];
        const value = row ? Number(row["Volt(pu)"]) : Number.NaN;
        if (Number.isFinite(value)) {
          const bcValues = Object.values(baseCaseBusRowsByBusId).map((r) => Number(r["Volt(pu)"])).filter((v) => Number.isFinite(v));
          const bcMin = bcValues.length ? Math.min(...bcValues) : 0;
          const bcMax = bcValues.length ? Math.max(...bcValues) : 1;
          color = colorForMetricValue(value, bcMin, bcMax, "busVoltage");
        }
      }

      if (layer && layer.setIcon) {
        layer.setIcon(L.divIcon({
          className: "bus-square-icon",
          html: busIconHtml(color),
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        }));
      }
    });
  };

  const getMetricValueForRow = (row, metric) => {
    if (!row) {
      return Number.NaN;
    }

    if (metric === "loading") {
      return Number(row["Loading_%"]);
    }

    if (metric === "lineFlow") {
      return Math.abs(Number(row["Pij(MW)"]));
    }

    if (metric === "busVoltage") {
      return Number(row["Volt(pu)"]);
    }

    if (metric === "genActive") {
      return Math.abs(Number(row["Pg(MW)"]));
    }

    if (metric === "genReactive") {
      return Math.abs(Number(row["Qg(MVAr)"]));
    }

    return Number.NaN;
  };

  const getMetricValueForUid = (uid, metric) => getMetricValueForRow(activeFlowRowsByUid[uid], metric);

  const getMetricValueForBusId = (busId, metric) => getMetricValueForRow(activeBusRowsByBusId[busId], metric);

  const getMetricRange = (metric) => {
    // Loading always uses a fixed 0–150% scale
    if (metric === "loading") {
      return { min: 0, max: 150 };
    }

    let sourceRows = Object.values(activeFlowRowsByUid);
    if (metric === "busVoltage") {
      sourceRows = Object.values(activeBusRowsByBusId);
    }
    if (metric === "genActive" || metric === "genReactive") {
      sourceRows = Object.values(activeGenRowsByBusAndMachine);
    }
    const values = sourceRows
      .map((row) => getMetricValueForRow(row, metric))
      .filter((value) => Number.isFinite(value));

    if (!values.length) {
      return { min: 0, max: 1 };
    }

    if (metric === "busVoltage") {
      const minRaw = Math.min(...values);
      const maxRaw = Math.max(...values);
      return {
        min: minRaw,
        max: maxRaw
      };
    }

    const minRaw = Math.min(...values);
    const maxRaw = Math.max(...values);
    const minRounded = Math.floor(minRaw);
    const maxRounded = Math.ceil(maxRaw);

    if (minRounded === maxRounded) {
      return {
        min: minRounded,
        max: maxRounded + 1
      };
    }

    return {
      min: minRounded,
      max: maxRounded
    };
  };

  const colorForMetricValue = (value, min, max, metric) => {
    let t = 0;
    if (Number.isFinite(value) && Number.isFinite(min) && Number.isFinite(max) && max !== min) {
      t = (value - min) / (max - min);
      t = Math.max(0, Math.min(1, t));
    }

    if (metric === "busVoltage") {
      if (Number.isFinite(value) && value > 1.1) {
        return "#14532d";
      }

      // Continuous 3-stop ramp: red (min) -> yellow (mid) -> green (max)
      const low = [239, 68, 68];
      const mid = [250, 204, 21];
      const high = [22, 163, 74];

      let r;
      let g;
      let b;
      if (t <= 0.5) {
        const tt = t / 0.5;
        r = Math.round(low[0] + (mid[0] - low[0]) * tt);
        g = Math.round(low[1] + (mid[1] - low[1]) * tt);
        b = Math.round(low[2] + (mid[2] - low[2]) * tt);
      } else {
        const tt = (t - 0.5) / 0.5;
        r = Math.round(mid[0] + (high[0] - mid[0]) * tt);
        g = Math.round(mid[1] + (high[1] - mid[1]) * tt);
        b = Math.round(mid[2] + (high[2] - mid[2]) * tt);
      }
      return `rgb(${r}, ${g}, ${b})`;
    }

    if (metric === "loading" || metric === "lineFlow") {
      // 4-stop ramp: blue (0) → green (1/3) → yellow (2/3) → red (1)
      const stops = [
        [59, 130, 246],   // blue   #3b82f6
        [34, 197, 94],    // green  #22c255
        [250, 204, 21],   // yellow #facc15
        [239, 68, 68]     // red    #ef4444
      ];
      const seg = t * (stops.length - 1);
      const idx = Math.min(Math.floor(seg), stops.length - 2);
      const tt = seg - idx;
      const s0 = stops[idx];
      const s1 = stops[idx + 1];
      const r = Math.round(s0[0] + (s1[0] - s0[0]) * tt);
      const g = Math.round(s0[1] + (s1[1] - s0[1]) * tt);
      const b = Math.round(s0[2] + (s1[2] - s0[2]) * tt);
      return `rgb(${r}, ${g}, ${b})`;
    }

    const low = [173, 216, 230];
    const high = [239, 68, 68];

    const r = Math.round(low[0] + (high[0] - low[0]) * t);
    const g = Math.round(low[1] + (high[1] - low[1]) * t);
    const b = Math.round(low[2] + (high[2] - low[2]) * t);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const normalizeBusValue = (value) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return String(Math.trunc(numeric));
    }
    return String(value ?? "").trim();
  };

  const normalizeMachineValue = (value) => String(value ?? "").trim().toUpperCase();

  const normalizeMachineLoose = (value) => normalizeMachineValue(value).replace(/^0+/, "");

  const machineNumeric = (value) => {
    const text = normalizeMachineValue(value);
    const match = text.match(/\d+/);
    if (!match) {
      return Number.NaN;
    }
    return Number(match[0]);
  };

  const genBusMachineKey = (busId, machineId) => `${normalizeBusValue(busId)}|${normalizeMachineValue(machineId)}`;

  const normalizeCktValue = (value) => String(value ?? "").trim().toUpperCase();

  const cktCandidatesFromUid = (uid) => {
    const raw = String(uid ?? "").trim();
    const candidates = [];

    if (raw) {
      candidates.push(raw);

      if (raw.includes("-")) {
        candidates.push(raw.split("-").pop() || "");
      }

      candidates.push(raw.replace(/^[A-Za-z]+/, ""));
    }

    return Array.from(new Set(candidates.map((value) => normalizeCktValue(value)).filter((value) => value.length > 0)));
  };

  const parseCsvLine = (line) => {
    const fields = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }

    fields.push(current);
    return fields;
  };

  const readLineNamesCsv = async () => {
    try {
      const response = await fetch(`${geojsonBasePath}/line_names.csv`, { cache: "no-cache" });
      if (!response.ok) {
        return [];
      }

      const text = await response.text();
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (!lines.length) {
        return [];
      }

      const header = parseCsvLine(lines[0]);
      const colIndex = {
        contingency: header.indexOf("Contingency"),
        fromBus: header.indexOf("FromBus"),
        toBus: header.indexOf("ToBus"),
        ckt: header.indexOf("CKT")
      };

      if (colIndex.contingency < 0 || colIndex.fromBus < 0 || colIndex.toBus < 0 || colIndex.ckt < 0) {
        return [];
      }

      return lines.slice(1).map((line) => {
        const cols = parseCsvLine(line);
        return {
          contingency: String(cols[colIndex.contingency] || "").trim(),
          fromBus: normalizeBusValue(cols[colIndex.fromBus]),
          toBus: normalizeBusValue(cols[colIndex.toBus]),
          ckt: normalizeCktValue(cols[colIndex.ckt])
        };
      }).filter((row) => row.contingency.length > 0 && row.fromBus.length > 0 && row.toBus.length > 0);
    } catch (_error) {
      return [];
    }
  };

  const buildLineNameByUid = (branchGeo, lineNameRows) => {
    const byPair = new Map();
    const byPairAndCkt = new Map();

    lineNameRows.forEach((row) => {
      const pairForward = `${row.fromBus}|${row.toBus}`;
      const pairReverse = `${row.toBus}|${row.fromBus}`;
      const ckt = normalizeCktValue(row.ckt);

      if (!byPair.has(pairForward)) {
        byPair.set(pairForward, row.contingency);
      }
      if (!byPair.has(pairReverse)) {
        byPair.set(pairReverse, row.contingency);
      }

      if (ckt) {
        byPairAndCkt.set(`${pairForward}|${ckt}`, row.contingency);
        byPairAndCkt.set(`${pairReverse}|${ckt}`, row.contingency);
      }
    });

    const out = {};
    (branchGeo.features || []).forEach((feature) => {
      const props = (feature && feature.properties) || {};
      const uid = String(props.UID || "").trim();
      if (!uid) {
        return;
      }

      const fromBus = normalizeBusValue(props["From Bus"]);
      const toBus = normalizeBusValue(props["To Bus"]);
      const pair = `${fromBus}|${toBus}`;

      let label = "";
      const cktCandidates = cktCandidatesFromUid(uid);
      for (const ckt of cktCandidates) {
        const candidate = byPairAndCkt.get(`${pair}|${ckt}`);
        if (candidate) {
          label = candidate;
          break;
        }
      }

      if (!label) {
        label = byPair.get(pair) || uid;
      }

      out[uid] = label;
    });

    return out;
  };

  const buildBranchMetaByUid = (branchGeo) => {
    const out = {};
    (branchGeo.features || []).forEach((feature) => {
      const props = (feature && feature.properties) || {};
      const uid = String(props.UID || "").trim();
      if (!uid) {
        return;
      }

      out[uid] = {
        fromBus: normalizeBusValue(props["From Bus"]),
        toBus: normalizeBusValue(props["To Bus"]),
        cktCandidates: cktCandidatesFromUid(uid)
      };
    });
    return out;
  };

  const getSeasonLineCsvPathCandidates = (season) => {
    if (season === "summer") {
      return [
        "./ca_results/summer/rts_gmlc_export_13_40_summer_v35_N1_lines.csv"
      ];
    }

    return [
      "./ca_results/winter/rts_gmlc_export_10_43_winter_v35_N1_lines.csv",
      "./ca_results/summer/rts_gmlc_export_13_40_winter_v35_N1_lines.csv"
    ];
  };

  const readSeasonLineFlowsCsv = async (season) => {
    if (!season) {
      return [];
    }

    if (caRowsCacheBySeason.has(season)) {
      return caRowsCacheBySeason.get(season);
    }

    const candidates = getSeasonLineCsvPathCandidates(season);
    let text = "";

    for (const path of candidates) {
      try {
        const response = await fetch(path, { cache: "no-cache" });
        if (response.ok) {
          text = await response.text();
          break;
        }
      } catch (_error) {
        // Try next candidate path.
      }
    }

    if (!text) {
      caRowsCacheBySeason.set(season, []);
      return [];
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (!lines.length) {
      caRowsCacheBySeason.set(season, []);
      return [];
    }

    const header = parseCsvLine(lines[0]);
    const contingencyIndex = header.indexOf("Contingency");
    const fromBusIndex = header.indexOf("FromBus#");
    const toBusIndex = header.indexOf("ToBus#");
    const cktIndex = header.indexOf("CKT");

    if (contingencyIndex < 0 || fromBusIndex < 0 || toBusIndex < 0 || cktIndex < 0) {
      caRowsCacheBySeason.set(season, []);
      return [];
    }

    const rows = lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      const row = {};
      header.forEach((name, idx) => {
        row[name] = String(cols[idx] || "").trim();
      });

      row.__contingency = String(cols[contingencyIndex] || "").trim();
      row.__fromBus = normalizeBusValue(cols[fromBusIndex]);
      row.__toBus = normalizeBusValue(cols[toBusIndex]);
      row.__ckt = normalizeCktValue(cols[cktIndex]);
      return row;
    });

    caRowsCacheBySeason.set(season, rows);
    return rows;
  };

  const getSeasonBusCsvPathCandidates = (season) => {
    if (season === "summer") {
      return [
        "./ca_results/summer/rts_gmlc_export_13_40_summer_v35_N1_buses.csv"
      ];
    }

    return [
      "./ca_results/winter/rts_gmlc_export_10_43_winter_v35_N1_buses.csv",
      "./ca_results/summer/rts_gmlc_export_13_40_winter_v35_N1_buses.csv"
    ];
  };

  const readSeasonBusCsv = async (season) => {
    if (!season) {
      return [];
    }

    if (caBusRowsCacheBySeason.has(season)) {
      return caBusRowsCacheBySeason.get(season);
    }

    const candidates = getSeasonBusCsvPathCandidates(season);
    let text = "";

    for (const path of candidates) {
      try {
        const response = await fetch(path, { cache: "no-cache" });
        if (response.ok) {
          text = await response.text();
          break;
        }
      } catch (_error) {
        // Try next candidate path.
      }
    }

    if (!text) {
      caBusRowsCacheBySeason.set(season, []);
      return [];
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (!lines.length) {
      caBusRowsCacheBySeason.set(season, []);
      return [];
    }

    const header = parseCsvLine(lines[0]);
    const contingencyIndex = header.indexOf("Contingency");
    const busIndex = header.indexOf("Bus#");
    const convergedIndex = header.indexOf("Converged");

    if (contingencyIndex < 0 || busIndex < 0 || convergedIndex < 0) {
      caBusRowsCacheBySeason.set(season, []);
      return [];
    }

    const rows = lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      const row = {};
      header.forEach((name, idx) => {
        row[name] = String(cols[idx] || "").trim();
      });

      row.__contingency = String(cols[contingencyIndex] || "").trim();
      row.__busId = normalizeBusValue(cols[busIndex]);
      row.__converged = String(cols[convergedIndex] || "").trim();
      return row;
    });

    caBusRowsCacheBySeason.set(season, rows);
    return rows;
  };

  const buildActiveBusRowsByBusId = (rows, contingencyName) => {
    const out = {};
    rows
      .filter((row) => row.__contingency === contingencyName)
      .forEach((row) => {
        const busId = row.__busId;
        if (busId) {
          out[busId] = row;
        }
      });
    return out;
  };

  const getSeasonGenCsvPathCandidates = (season) => {
    if (season === "summer") {
      return [
        "./ca_results/summer/rts_gmlc_export_13_40_summer_v35_N1_gens.csv",
        "./ca_results/winter/rts_gmlc_export_10_43_summer_v35_N1_gens.csv"
      ];
    }

    return [
      "./ca_results/summer/rts_gmlc_export_13_40_winter_v35_N1_gens.csv",
      "./ca_results/winter/rts_gmlc_export_10_43_winter_v35_N1_gens.csv",
      "./ca_results/summer/rts_gmlc_export_13_40_winter_v35_N1_gens.csv"
    ];
  };

  const readSeasonGenCsv = async (season) => {
    if (!season) {
      return [];
    }

    if (caGenRowsCacheBySeason.has(season)) {
      return caGenRowsCacheBySeason.get(season);
    }

    const candidates = getSeasonGenCsvPathCandidates(season);
    let text = "";

    for (const path of candidates) {
      try {
        const response = await fetch(path, { cache: "no-cache" });
        if (response.ok) {
          text = await response.text();
          break;
        }
      } catch (_error) {
        // Try next path.
      }
    }

    if (!text) {
      caGenRowsCacheBySeason.set(season, []);
      return [];
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (!lines.length) {
      caGenRowsCacheBySeason.set(season, []);
      return [];
    }

    const header = parseCsvLine(lines[0]);
    const contingencyIndex = header.indexOf("Contingency");
    const busIndex = header.indexOf("BusNumber");
    const machineIndex = header.indexOf("MachineID");
    const pgIndex = header.indexOf("Pg(MW)");
    const qgIndex = header.indexOf("Qg(MVAr)");
    const pgMaxIndex = header.indexOf("PgMax(MW)");
    const pgMinIndex = header.indexOf("PgMin(MW)");
    const qgMaxIndex = header.indexOf("QgMax(MVAr)");
    const qgMinIndex = header.indexOf("QgMin(MVAr)");
    const violationIndex = header.indexOf("Violation");

    if (
      contingencyIndex < 0
      || busIndex < 0
      || machineIndex < 0
      || pgIndex < 0
      || qgIndex < 0
      || pgMaxIndex < 0
      || pgMinIndex < 0
      || qgMaxIndex < 0
      || qgMinIndex < 0
      || violationIndex < 0
    ) {
      caGenRowsCacheBySeason.set(season, []);
      return [];
    }

    const rows = lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      const row = {
        MachineID: String(cols[machineIndex] || "").trim(),
        "Pg(MW)": String(cols[pgIndex] || "").trim(),
        "Qg(MVAr)": String(cols[qgIndex] || "").trim(),
        "PgMax(MW)": String(cols[pgMaxIndex] || "").trim(),
        "PgMin(MW)": String(cols[pgMinIndex] || "").trim(),
        "QgMax(MVAr)": String(cols[qgMaxIndex] || "").trim(),
        "QgMin(MVAr)": String(cols[qgMinIndex] || "").trim(),
        Violation: String(cols[violationIndex] || "").trim(),
        __contingency: String(cols[contingencyIndex] || "").trim(),
        __busId: normalizeBusValue(cols[busIndex]),
        __machineId: normalizeMachineValue(cols[machineIndex])
      };
      return row;
    });

    caGenRowsCacheBySeason.set(season, rows);
    return rows;
  };

  const buildActiveGenRowsByBusId = (rows, contingencyName) => {
    const byBus = {};

    rows
      .filter((row) => row.__contingency === contingencyName)
      .forEach((row) => {
        const busId = row.__busId;
        if (!busId) {
          return;
        }

        if (!byBus[busId]) {
          byBus[busId] = {
            "Pg(MW)": 0,
            "Qg(MVAr)": 0
          };
        }

        const pg = Number(row["Pg(MW)"]);
        const qg = Number(row["Qg(MVAr)"]);

        if (Number.isFinite(pg)) {
          byBus[busId]["Pg(MW)"] += pg;
        }
        if (Number.isFinite(qg)) {
          byBus[busId]["Qg(MVAr)"] += qg;
        }
      });

    return byBus;
  };

  const buildActiveGenRowsByBusAndMachine = (rows, contingencyName) => {
    const out = {};

    rows
      .filter((row) => row.__contingency === contingencyName)
      .forEach((row) => {
        const busId = row.__busId;
        const machineId = row.__machineId || normalizeMachineValue(row.MachineID);
        if (!busId || !machineId) {
          return;
        }

        out[genBusMachineKey(busId, machineId)] = row;
      });

    return out;
  };

  const buildActiveGenRowsListByBus = (rows, contingencyName) => {
    const out = {};

    rows
      .filter((row) => row.__contingency === contingencyName)
      .forEach((row) => {
        const busId = row.__busId;
        if (!busId) {
          return;
        }

        if (!out[busId]) {
          out[busId] = [];
        }
        out[busId].push(row);
      });

    return out;
  };

  const buildActiveFlowRowsByUid = (rows, contingencyName, branchMetaByUid) => {
    const filtered = rows.filter((row) => row.__contingency === contingencyName);

    const byPair = new Map();
    const byPairAndCkt = new Map();

    filtered.forEach((row) => {
      const pairForward = `${row.__fromBus}|${row.__toBus}`;
      const pairReverse = `${row.__toBus}|${row.__fromBus}`;

      if (!byPair.has(pairForward)) {
        byPair.set(pairForward, row);
      }
      if (!byPair.has(pairReverse)) {
        byPair.set(pairReverse, row);
      }

      if (row.__ckt) {
        byPairAndCkt.set(`${pairForward}|${row.__ckt}`, row);
        byPairAndCkt.set(`${pairReverse}|${row.__ckt}`, row);
      }
    });

    const out = {};
    Object.entries(branchMetaByUid).forEach(([uid, meta]) => {
      const pair = `${meta.fromBus}|${meta.toBus}`;

      let row = null;
      for (const ckt of (meta.cktCandidates || [])) {
        const match = byPairAndCkt.get(`${pair}|${ckt}`);
        if (match) {
          row = match;
          break;
        }
      }

      if (!row) {
        row = byPair.get(pair) || null;
      }

      if (row) {
        out[uid] = row;
      }
    });

    return out;
  };

  // ---- Base Case CSV readers ----

  const getBaseCaseLineCsvPath = (season) => {
    if (season === "summer") {
      return "./ca_results/summer/rts_gmlc_export_13_40_summer_v35_base_acpf_lines.csv";
    }
    return "./ca_results/winter/rts_gmlc_export_10_43_winter_v35_base_acpf_lines.csv";
  };

  const readBaseCaseLinesCsv = async (season) => {
    if (!season) {
      return [];
    }

    if (baseCaseLineRowsCacheBySeason.has(season)) {
      return baseCaseLineRowsCacheBySeason.get(season);
    }

    let text = "";
    try {
      const response = await fetch(getBaseCaseLineCsvPath(season), { cache: "no-cache" });
      if (response.ok) {
        text = await response.text();
      }
    } catch (_error) {
      // ignore
    }

    if (!text) {
      baseCaseLineRowsCacheBySeason.set(season, []);
      return [];
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (!lines.length) {
      baseCaseLineRowsCacheBySeason.set(season, []);
      return [];
    }

    const header = parseCsvLine(lines[0]);
    const fromBusIndex = header.indexOf("FromBus#");
    const toBusIndex = header.indexOf("ToBus#");
    const cktIndex = header.indexOf("CKT");
    const pijIndex = header.indexOf("Pij(MW)");
    const qijIndex = header.indexOf("Qij(MVAr)");
    const sijIndex = header.indexOf("Sij(MVA)");
    const rateAIndex = header.indexOf("RateA");
    const plossIndex = header.indexOf("Ploss(MW)");
    const qlossIndex = header.indexOf("Qloss(MVAr)");

    if (fromBusIndex < 0 || toBusIndex < 0 || cktIndex < 0) {
      baseCaseLineRowsCacheBySeason.set(season, []);
      return [];
    }

    const rows = lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      const pij = String(cols[pijIndex] || "").trim();
      const rateA = String(cols[rateAIndex] || "").trim();
      const sijVal = String(cols[sijIndex] || "").trim();
      const loadingPct = (Number.isFinite(Number(sijVal)) && Number.isFinite(Number(rateA)) && Number(rateA) !== 0)
        ? String(Math.abs(Number(sijVal)) / Number(rateA) * 100)
        : "";
      return {
        "FromBus#": String(cols[fromBusIndex] || "").trim(),
        "ToBus#": String(cols[toBusIndex] || "").trim(),
        CKT: String(cols[cktIndex] || "").trim(),
        "Pij(MW)": pij,
        "Qij(MVAr)": String(cols[qijIndex] || "").trim(),
        "Sij(MVA)": sijVal,
        RateA: rateA,
        "Ploss(MW)": String(cols[plossIndex] || "").trim(),
        "Qloss(MVAr)": String(cols[qlossIndex] || "").trim(),
        "Loading_%": loadingPct,
        __fromBus: normalizeBusValue(cols[fromBusIndex]),
        __toBus: normalizeBusValue(cols[toBusIndex]),
        __ckt: normalizeCktValue(cols[cktIndex])
      };
    });

    baseCaseLineRowsCacheBySeason.set(season, rows);
    return rows;
  };

  const getBaseCaseBusCsvPath = (season) => {
    if (season === "summer") {
      return "./ca_results/summer/rts_gmlc_export_13_40_summer_v35_base_acpf_buses.csv";
    }
    return "./ca_results/winter/rts_gmlc_export_10_43_winter_v35_base_acpf_buses.csv";
  };

  const readBaseCaseBusCsv = async (season) => {
    if (!season) {
      return [];
    }

    if (baseCaseBusRowsCacheBySeason.has(season)) {
      return baseCaseBusRowsCacheBySeason.get(season);
    }

    let text = "";
    try {
      const response = await fetch(getBaseCaseBusCsvPath(season), { cache: "no-cache" });
      if (response.ok) {
        text = await response.text();
      }
    } catch (_error) {
      // ignore
    }

    if (!text) {
      baseCaseBusRowsCacheBySeason.set(season, []);
      return [];
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (!lines.length) {
      baseCaseBusRowsCacheBySeason.set(season, []);
      return [];
    }

    const header = parseCsvLine(lines[0]);
    const busIndex = header.indexOf("Bus#");
    const nameIndex = header.indexOf("Name");
    const voltPuIndex = header.indexOf("Volt(pu)");
    const angleIndex = header.indexOf("Angle(deg)");

    if (busIndex < 0 || voltPuIndex < 0) {
      baseCaseBusRowsCacheBySeason.set(season, []);
      return [];
    }

    const rows = lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      return {
        "Bus#": String(cols[busIndex] || "").trim(),
        Name: nameIndex >= 0 ? String(cols[nameIndex] || "").trim() : "",
        "Volt(pu)": String(cols[voltPuIndex] || "").trim(),
        "Angle(deg)": angleIndex >= 0 ? String(cols[angleIndex] || "").trim() : "",
        __busId: normalizeBusValue(cols[busIndex])
      };
    });

    baseCaseBusRowsCacheBySeason.set(season, rows);
    return rows;
  };

  const getBaseCaseGenCsvPath = (season) => {
    if (season === "summer") {
      return "./ca_results/summer/rts_gmlc_export_13_40_summer_v35_base_acpf_gens.csv";
    }
    return "./ca_results/winter/rts_gmlc_export_10_43_winter_v35_base_acpf_gens.csv";
  };

  const readBaseCaseGenCsv = async (season) => {
    if (!season) {
      return [];
    }

    if (baseCaseGenRowsCacheBySeason.has(season)) {
      return baseCaseGenRowsCacheBySeason.get(season);
    }

    let text = "";
    try {
      const response = await fetch(getBaseCaseGenCsvPath(season), { cache: "no-cache" });
      if (response.ok) {
        text = await response.text();
      }
    } catch (_error) {
      // ignore
    }

    if (!text) {
      baseCaseGenRowsCacheBySeason.set(season, []);
      return [];
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (!lines.length) {
      baseCaseGenRowsCacheBySeason.set(season, []);
      return [];
    }

    const header = parseCsvLine(lines[0]);
    const busIndex = header.indexOf("BusNumber");
    const machineIndex = header.indexOf("MachineID");
    const pgIndex = header.indexOf("Pg(MW)");
    const qgIndex = header.indexOf("Qg(MVAr)");
    const pgMaxIndex = header.indexOf("PgMax(MW)");
    const pgMinIndex = header.indexOf("PgMin(MW)");
    const qgMaxIndex = header.indexOf("QgMax(MVAr)");
    const qgMinIndex = header.indexOf("QgMin(MVAr)");

    if (busIndex < 0 || machineIndex < 0 || pgIndex < 0 || qgIndex < 0) {
      baseCaseGenRowsCacheBySeason.set(season, []);
      return [];
    }

    const rows = lines.slice(1).map((line) => {
      const cols = parseCsvLine(line);
      return {
        MachineID: String(cols[machineIndex] || "").trim(),
        "Pg(MW)": String(cols[pgIndex] || "").trim(),
        "Qg(MVAr)": String(cols[qgIndex] || "").trim(),
        "PgMax(MW)": pgMaxIndex >= 0 ? String(cols[pgMaxIndex] || "").trim() : "",
        "PgMin(MW)": pgMinIndex >= 0 ? String(cols[pgMinIndex] || "").trim() : "",
        "QgMax(MVAr)": qgMaxIndex >= 0 ? String(cols[qgMaxIndex] || "").trim() : "",
        "QgMin(MVAr)": qgMinIndex >= 0 ? String(cols[qgMinIndex] || "").trim() : "",
        Violation: "",
        __busId: normalizeBusValue(cols[busIndex]),
        __machineId: normalizeMachineValue(cols[machineIndex])
      };
    });

    baseCaseGenRowsCacheBySeason.set(season, rows);
    return rows;
  };

  const buildBaseCaseFlowRowsByUid = (rows, branchMeta) => {
    const byPair = new Map();
    const byPairAndCkt = new Map();

    rows.forEach((row) => {
      const pairForward = `${row.__fromBus}|${row.__toBus}`;
      const pairReverse = `${row.__toBus}|${row.__fromBus}`;

      if (!byPair.has(pairForward)) {
        byPair.set(pairForward, row);
      }
      if (!byPair.has(pairReverse)) {
        byPair.set(pairReverse, row);
      }

      if (row.__ckt) {
        byPairAndCkt.set(`${pairForward}|${row.__ckt}`, row);
        byPairAndCkt.set(`${pairReverse}|${row.__ckt}`, row);
      }
    });

    const out = {};
    Object.entries(branchMeta).forEach(([uid, meta]) => {
      const pair = `${meta.fromBus}|${meta.toBus}`;
      let row = null;

      for (const ckt of (meta.cktCandidates || [])) {
        const match = byPairAndCkt.get(`${pair}|${ckt}`);
        if (match) {
          row = match;
          break;
        }
      }

      if (!row) {
        row = byPair.get(pair) || null;
      }

      if (row) {
        out[uid] = row;
      }
    });

    return out;
  };

  const buildBaseCaseBusRowsByBusId = (rows) => {
    const out = {};
    rows.forEach((row) => {
      if (row.__busId) {
        out[row.__busId] = row;
      }
    });
    return out;
  };

  const buildBaseCaseGenRowsByBusAndMachine = (rows) => {
    const out = {};
    rows.forEach((row) => {
      const busId = row.__busId;
      const machineId = row.__machineId;
      if (busId && machineId) {
        out[genBusMachineKey(busId, machineId)] = row;
      }
    });
    return out;
  };

  const buildBaseCaseGenRowsListByBus = (rows) => {
    const out = {};
    rows.forEach((row) => {
      const busId = row.__busId;
      if (!busId) {
        return;
      }
      if (!out[busId]) {
        out[busId] = [];
      }
      out[busId].push(row);
    });
    return out;
  };

  const isTrueValue = (value) => {
    const text = String(value ?? "").trim().toLowerCase();
    return text === "true" || text === "1" || text === "yes";
  };

  const truncateTo3 = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "N/A";
    }
    const truncated = Math.trunc(numeric * 100) / 100;
    return truncated.toFixed(2);
  };

  const formatMetric = (value, unit) => {
    const truncated = truncateTo3(value);
    if (truncated === "N/A") {
      return truncated;
    }
    return `${truncated} ${unit}`;
  };

  const formatIntegerMetric = (value, unit) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "N/A";
    }
    return `${Math.trunc(numeric)} ${unit}`;
  };

  const formatLegendLimit = (value, metric) => {
    if (metric === "loading" || metric === "lineFlow") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return "N/A";
      }
      return String(Math.trunc(numeric));
    }
    if (metric === "busVoltage") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return "N/A";
      }
      return numeric === 0 || numeric === 1 ? String(Math.trunc(numeric)) : truncateTo3(numeric);
    }
    return truncateTo3(value);
  };

  const metricLabel = (metric) => {
    if (metric === "lineFlow") {
      return "Active Flow ij (MW)";
    }
    if (metric === "busVoltage") {
      return "Voltage (p.u.)";
    }
    if (metric === "genActive") {
      return "Generator Active P (MW)";
    }
    if (metric === "genReactive") {
      return "Generator Reactive Q (MVAr)";
    }
    return "Loading (%)";
  };

  const metricGradient = (metric, max) => {
    if (metric === "busVoltage") {
      return max > 1.1
        ? "linear-gradient(to top, #ef4444 0%, #facc15 55%, #16a34a 80%, #14532d 100%)"
        : "linear-gradient(to top, #ef4444 0%, #facc15 50%, #16a34a 100%)";
    }
    if (metric === "loading" || metric === "lineFlow") {
      return "linear-gradient(to top, #3b82f6 0%, #22c55e 33%, #facc15 67%, #ef4444 100%)";
    }
    if (metric === "genActive") {
      return "linear-gradient(to top, #add8e6 0%, #ef4444 100%)";
    }
    if (metric === "genReactive") {
      return "linear-gradient(to top, #add8e6 0%, #ef4444 100%)";
    }
    return "linear-gradient(to top, #add8e6 0%, #ef4444 100%)";
  };

  const legendSectionHtml = (metric) => {
    const { min, max } = getMetricRange(metric);
    const gradient = metricGradient(metric, max);
    return `
      <div class="line-color-legend-section">
        <div class="line-color-legend-title">${esc(metricLabel(metric))}</div>
        <div class="line-color-legend-scale-wrap">
          <div class="line-color-legend-max">${esc(formatLegendLimit(max, metric))}</div>
          <div class="line-color-legend-gradient" style="background:${gradient};"></div>
          <div class="line-color-legend-min">${esc(formatLegendLimit(min, metric))}</div>
        </div>
      </div>
    `;
  };

  const legendSectionHtmlForRows = (metric, rows) => {
    // Loading uses a fixed 0–150 scale regardless of actual data values
    if (metric === "loading") {
      const gradient = metricGradient(metric, 150);
      return `
      <div class="line-color-legend-section">
        <div class="line-color-legend-title">${esc(metricLabel(metric))}</div>
        <div class="line-color-legend-scale-wrap">
          <div class="line-color-legend-max">150</div>
          <div class="line-color-legend-gradient" style="background:${gradient};"></div>
          <div class="line-color-legend-min">0</div>
        </div>
      </div>
    `;
    }
    const values = rows
      .map((row) => getMetricValueForRow(row, metric))
      .filter((v) => Number.isFinite(v));
    const min = values.length ? (metric === "busVoltage" ? Math.min(...values) : Math.floor(Math.min(...values))) : 0;
    const max = values.length ? (metric === "busVoltage" ? Math.max(...values) : Math.ceil(Math.max(...values))) : 1;
    const gradient = metricGradient(metric, max);
    return `
      <div class="line-color-legend-section">
        <div class="line-color-legend-title">${esc(metricLabel(metric))}</div>
        <div class="line-color-legend-scale-wrap">
          <div class="line-color-legend-max">${esc(formatLegendLimit(max, metric))}</div>
          <div class="line-color-legend-gradient" style="background:${gradient};"></div>
          <div class="line-color-legend-min">${esc(formatLegendLimit(min, metric))}</div>
        </div>
      </div>
    `;
  };

  const refreshLineColorLegend = () => {
    if (!lineColorLegendElement) {
      return;
    }

    const hasLineMetric = !!activeLineMetric;
    const hasBusMetric = !!isBusVoltageMetricActive;
    const hasGenMetric = !!activeGeneratorMetric;
    const shouldShowContingency = currentViewMode === "contingency" && activeContingencyConverged && (hasLineMetric || hasBusMetric || hasGenMetric);

    const hasBcLineMetric = !!activeBaseCaseLineMetric;
    const hasBcBusMetric = !!isBaseCaseBusVoltageMetricActive;
    const hasBcGenMetric = !!activeBaseCaseGeneratorMetric;
    const shouldShowBaseCase = currentViewMode === "baseCase" && (hasBcLineMetric || hasBcBusMetric || hasBcGenMetric);

    const shouldShow = shouldShowContingency || shouldShowBaseCase;
    lineColorLegendElement.style.display = shouldShow ? "block" : "none";

    if (!shouldShow) {
      return;
    }

    if (shouldShowBaseCase) {
      const sections = [];
      if (hasBcLineMetric) {
        sections.push(legendSectionHtmlForRows(activeBaseCaseLineMetric, Object.values(baseCaseFlowRowsByUid)));
      }
      if (hasBcBusMetric) {
        sections.push(legendSectionHtmlForRows("busVoltage", Object.values(baseCaseBusRowsByBusId)));
      }
      if (hasBcGenMetric) {
        sections.push(legendSectionHtmlForRows(activeBaseCaseGeneratorMetric, Object.values(baseCaseGenRowsByBusAndMachine)));
      }
      lineColorLegendElement.innerHTML = sections.join("");
      return;
    }

    const sections = [];
    if (hasLineMetric) {
      sections.push(legendSectionHtml(activeLineMetric));
    }
    if (hasBusMetric) {
      sections.push(legendSectionHtml("busVoltage"));
    }
    if (hasGenMetric) {
      sections.push(legendSectionHtml(activeGeneratorMetric));
    }
    lineColorLegendElement.innerHTML = sections.join("");
  };

  const refreshMetricButtonsState = () => {
    const enabled = !!selectedContingencyUid && !!selectedContingencySeason && activeContingencyConverged;

    if (loadingMetricButton) {
      loadingMetricButton.disabled = !enabled;
      loadingMetricButton.classList.toggle("active", activeLineMetric === "loading");
    }

    if (lineFlowMetricButton) {
      lineFlowMetricButton.disabled = !enabled;
      lineFlowMetricButton.classList.toggle("active", activeLineMetric === "lineFlow");
    }

    if (busVoltageMetricButton) {
      busVoltageMetricButton.disabled = !enabled;
      busVoltageMetricButton.classList.toggle("active", isBusVoltageMetricActive);
    }

    if (genActiveMetricButton) {
      genActiveMetricButton.disabled = !enabled;
      genActiveMetricButton.classList.toggle("active", activeGeneratorMetric === "genActive");
    }

    if (genReactiveMetricButton) {
      genReactiveMetricButton.disabled = !enabled;
      genReactiveMetricButton.classList.toggle("active", activeGeneratorMetric === "genReactive");
    }

    const caBtn = createContingencyControl._showDataBtn;
    if (caBtn) {
      caBtn.disabled = !enabled;
    }

    // Base case buttons are always enabled when in base case mode
    if (bcLoadingMetricButton) {
      bcLoadingMetricButton.classList.toggle("active", activeBaseCaseLineMetric === "loading");
    }
    if (bcLineFlowMetricButton) {
      bcLineFlowMetricButton.classList.toggle("active", activeBaseCaseLineMetric === "lineFlow");
    }
    if (bcBusVoltageMetricButton) {
      bcBusVoltageMetricButton.classList.toggle("active", isBaseCaseBusVoltageMetricActive);
    }
    if (bcGenActiveMetricButton) {
      bcGenActiveMetricButton.classList.toggle("active", activeBaseCaseGeneratorMetric === "genActive");
    }
    if (bcGenReactiveMetricButton) {
      bcGenReactiveMetricButton.classList.toggle("active", activeBaseCaseGeneratorMetric === "genReactive");
    }
  };

  const contingencyFlowRowToPopupHtml = (row, isSelectedLine) => {
    const title = isSelectedLine ? "Line in Contingency" : "Line Flow";
    if (!row) {
      return `<b>${title}</b><br>No flow data found for this line under the selected contingency.`;
    }

    const busFrom = normalizeBusValue(row["FromBus#"] || row.__fromBus);
    const busTo = normalizeBusValue(row["ToBus#"] || row.__toBus);
    const circuit = String(row.CKT || row.__ckt || "N/A");
    const violation = String(row.Violation || "N/A");

    const detailRows = [
      `<b>Bus From:</b> ${esc(busFrom)}`,
      `<b>Bus To:</b> ${esc(busTo)}`,
      `<b>Circuit:</b> ${esc(circuit)}`,
      `<b>Active Flow i-&gt;j:</b> ${esc(formatIntegerMetric(row["Pij(MW)"], "MW"))}`,
      `<b>Reactive Flow i-&gt;j:</b> ${esc(formatMetric(row["Qij(MVAr)"], "MVAr"))}`,
      `<b>Rating:</b> ${esc(formatMetric(row.RateA, "MVA"))}`,
      `<b>Active Losses:</b> ${esc(formatMetric(row["Ploss(MW)"], "MW"))}`,
      `<b>Reactive Losses:</b> ${esc(formatMetric(row["Qloss(MVAr)"], "MVAr"))}`,
      `<b>Loading:</b> ${esc(formatIntegerMetric(row["Loading_%"], "%"))}`,
      `<b>Violation:</b> ${esc(violation)}`
    ];

    return `<b>${title}</b><br>${detailRows.join("<br>")}`;
  };

  const createContingencyControl = (branchGeo, lineNameByUid, onSelectionChange, onMetricChange) => {
    const lineOptions = Array.from(new Set((branchGeo.features || [])
      .map((feature) => String((feature && feature.properties && feature.properties.UID) || ""))
      .filter((uid) => uid.length > 0)))
      .sort((a, b) => a.localeCompare(b));

    const ContingencyControl = L.Control.extend({
      options: { position: "topleft" },
      onAdd() {
        const container = L.DomUtil.create("div", "contingency-control leaflet-bar");
        contingencyControlContainer = container;
        const panel = L.DomUtil.create("div", "contingency-panel", container);

        const button = L.DomUtil.create("button", "contingency-toggle-btn", panel);
        button.type = "button";
        button.textContent = "Contingency Analysis";
        button.title = "Show line contingency selector";

        const dropdownWrap = L.DomUtil.create("div", "contingency-dropdown-wrap", panel);
        dropdownWrap.style.display = "none";

        const select = L.DomUtil.create("select", "contingency-select", dropdownWrap);
        const noneOption = L.DomUtil.create("option", "", select);
        noneOption.value = "";
        noneOption.textContent = "Select line";

        lineOptions.forEach((uid) => {
          const option = L.DomUtil.create("option", "", select);
          option.value = uid;
          option.textContent = uid;
        });

        const seasonSelect = L.DomUtil.create("select", "contingency-select contingency-season-select", dropdownWrap);
        const noSeasonOption = L.DomUtil.create("option", "", seasonSelect);
        noSeasonOption.value = "";
        noSeasonOption.textContent = "Select season";

        const summerOption = L.DomUtil.create("option", "", seasonSelect);
        summerOption.value = "summer";
        summerOption.textContent = "Summer";

        const winterOption = L.DomUtil.create("option", "", seasonSelect);
        winterOption.value = "winter";
        winterOption.textContent = "Winter";

        const metricButtonsWrap = L.DomUtil.create("div", "contingency-metric-buttons", dropdownWrap);
        loadingMetricButton = L.DomUtil.create("button", "contingency-metric-btn active", metricButtonsWrap);
        loadingMetricButton.type = "button";
        loadingMetricButton.textContent = "Loading";

        lineFlowMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        lineFlowMetricButton.type = "button";
        lineFlowMetricButton.textContent = "Line Flow";

        busVoltageMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        busVoltageMetricButton.type = "button";
        busVoltageMetricButton.textContent = "Bus Voltages";

        genActiveMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        genActiveMetricButton.type = "button";
        genActiveMetricButton.textContent = "Gen Active Power";

        genReactiveMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        genReactiveMetricButton.type = "button";
        genReactiveMetricButton.textContent = "Gen Reactive Power";

        const seasonLabel = (season) => {
          if (season === "summer") {
            return "Summer";
          }
          if (season === "winter") {
            return "Winter";
          }
          return "";
        };

        const refreshLineOptionLabels = () => {
          Array.from(select.options).forEach((option) => {
            if (!option.value) {
              return;
            }
            const season = contingencySeasonByUid[option.value] || "";
            const baseLabel = lineNameByUid[option.value] || option.value;
            option.textContent = season ? `${baseLabel}` : baseLabel;
          });
        };

        const syncSeasonSelectWithLine = () => {
          if (!selectedContingencyUid) {
            seasonSelect.value = "";
            seasonSelect.disabled = true;
            return;
          }
          seasonSelect.disabled = false;
          seasonSelect.value = contingencySeasonByUid[selectedContingencyUid] || selectedContingencySeason || "";
        };

        seasonSelect.disabled = true;

        button.addEventListener("click", () => {
          const showing = dropdownWrap.style.display !== "none";
          dropdownWrap.style.display = showing ? "none" : "block";
          button.classList.toggle("active", !showing);
        });

        select.addEventListener("change", () => {
          selectedContingencyUid = select.value;

          // Persist the current season across line changes.
          if (selectedContingencyUid && selectedContingencySeason && !contingencySeasonByUid[selectedContingencyUid]) {
            contingencySeasonByUid[selectedContingencyUid] = selectedContingencySeason;
          }

          syncSeasonSelectWithLine();
          refreshLineHighlight();
          selectedContingencySeason = selectedContingencyUid
            ? (contingencySeasonByUid[selectedContingencyUid] || selectedContingencySeason || "")
            : "";
          onSelectionChange(selectedContingencyUid, selectedContingencySeason);
        });

        seasonSelect.addEventListener("change", () => {
          if (!selectedContingencyUid) {
            return;
          }

          if (seasonSelect.value) {
            contingencySeasonByUid[selectedContingencyUid] = seasonSelect.value;
          } else {
            delete contingencySeasonByUid[selectedContingencyUid];
          }

          refreshLineOptionLabels();
          selectedContingencySeason = contingencySeasonByUid[selectedContingencyUid] || "";
          onSelectionChange(selectedContingencyUid, selectedContingencySeason);
        });

        loadingMetricButton.addEventListener("click", () => {
          activeLineMetric = activeLineMetric === "loading" ? null : "loading";
          onMetricChange();
        });

        lineFlowMetricButton.addEventListener("click", () => {
          activeLineMetric = activeLineMetric === "lineFlow" ? null : "lineFlow";
          onMetricChange();
        });

        busVoltageMetricButton.addEventListener("click", () => {
          isBusVoltageMetricActive = !isBusVoltageMetricActive;
          onMetricChange();
        });

        genActiveMetricButton.addEventListener("click", () => {
          activeGeneratorMetric = activeGeneratorMetric === "genActive" ? null : "genActive";
          onMetricChange();
        });

        genReactiveMetricButton.addEventListener("click", () => {
          activeGeneratorMetric = activeGeneratorMetric === "genReactive" ? null : "genReactive";
          onMetricChange();
        });

        const caShowDataBtn = L.DomUtil.create("button", "bc-show-data-btn", dropdownWrap);
        caShowDataBtn.type = "button";
        caShowDataBtn.textContent = "Show Data";
        caShowDataBtn.disabled = true;
        caShowDataBtn.addEventListener("click", () => {
          if (contingencyDataPanelRef) {
            contingencyDataPanelRef.show();
          }
        });

        // Expose so applyContingencySelection can toggle enabled state
        createContingencyControl._showDataBtn = caShowDataBtn;

        refreshLineOptionLabels();
        syncSeasonSelectWithLine();
        refreshMetricButtonsState();

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        return container;
      }
    });

    map.addControl(new ContingencyControl());
  };

  const createBaseCaseControl = (onSeasonChange, onMetricChange) => {
    const BaseCaseControl = L.Control.extend({
      options: { position: "topleft" },
      onAdd() {
        const container = L.DomUtil.create("div", "contingency-control leaflet-bar");
        baseCaseControlContainer = container;
        const panel = L.DomUtil.create("div", "contingency-panel", container);

        const button = L.DomUtil.create("button", "contingency-toggle-btn active", panel);
        button.type = "button";
        button.textContent = "Base Case";
        button.title = "Show base case controls";

        const dropdownWrap = L.DomUtil.create("div", "contingency-dropdown-wrap", panel);
        dropdownWrap.style.display = "block";

        const seasonSelect = L.DomUtil.create("select", "contingency-select contingency-season-select", dropdownWrap);
        const summerOption = L.DomUtil.create("option", "", seasonSelect);
        summerOption.value = "summer";
        summerOption.textContent = "Summer";
        const winterOption = L.DomUtil.create("option", "", seasonSelect);
        winterOption.value = "winter";
        winterOption.textContent = "Winter";
        seasonSelect.value = selectedBaseCaseSeason;

        const metricButtonsWrap = L.DomUtil.create("div", "contingency-metric-buttons", dropdownWrap);

        bcLoadingMetricButton = L.DomUtil.create("button", "contingency-metric-btn active", metricButtonsWrap);
        bcLoadingMetricButton.type = "button";
        bcLoadingMetricButton.textContent = "Loading";

        bcLineFlowMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        bcLineFlowMetricButton.type = "button";
        bcLineFlowMetricButton.textContent = "Line Flow";

        bcBusVoltageMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        bcBusVoltageMetricButton.type = "button";
        bcBusVoltageMetricButton.textContent = "Bus Voltages";

        bcGenActiveMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        bcGenActiveMetricButton.type = "button";
        bcGenActiveMetricButton.textContent = "Gen Active Power";

        bcGenReactiveMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        bcGenReactiveMetricButton.type = "button";
        bcGenReactiveMetricButton.textContent = "Gen Reactive Power";

        button.addEventListener("click", () => {
          const showing = dropdownWrap.style.display !== "none";
          dropdownWrap.style.display = showing ? "none" : "block";
          button.classList.toggle("active", !showing);
        });

        seasonSelect.addEventListener("change", () => {
          selectedBaseCaseSeason = seasonSelect.value;
          onSeasonChange(selectedBaseCaseSeason);
        });

        bcLoadingMetricButton.addEventListener("click", () => {
          activeBaseCaseLineMetric = activeBaseCaseLineMetric === "loading" ? null : "loading";
          onMetricChange();
        });

        bcLineFlowMetricButton.addEventListener("click", () => {
          activeBaseCaseLineMetric = activeBaseCaseLineMetric === "lineFlow" ? null : "lineFlow";
          onMetricChange();
        });

        bcBusVoltageMetricButton.addEventListener("click", () => {
          isBaseCaseBusVoltageMetricActive = !isBaseCaseBusVoltageMetricActive;
          onMetricChange();
        });

        bcGenActiveMetricButton.addEventListener("click", () => {
          activeBaseCaseGeneratorMetric = activeBaseCaseGeneratorMetric === "genActive" ? null : "genActive";
          onMetricChange();
        });

        bcGenReactiveMetricButton.addEventListener("click", () => {
          activeBaseCaseGeneratorMetric = activeBaseCaseGeneratorMetric === "genReactive" ? null : "genReactive";
          onMetricChange();
        });

        const showDataBtn = L.DomUtil.create("button", "bc-show-data-btn", dropdownWrap);
        showDataBtn.type = "button";
        showDataBtn.textContent = "Show Data";
        showDataBtn.addEventListener("click", () => {
          if (baseCaseDataPanelRef) {
            baseCaseDataPanelRef.show();
          }
        });

        refreshMetricButtonsState();
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        return container;
      }
    });

    map.addControl(new BaseCaseControl());
  };

  const categoryPalette = [
    "#d62728", "#1f77b4", "#2ca02c", "#ff7f0e", "#9467bd", "#8c564b", "#e377c2",
    "#17becf", "#bcbd22", "#7f7f7f", "#1b9e77", "#e7298a", "#66a61e", "#e6ab02"
  ];

  const hashString = (textValue) => {
    const text = String(textValue ?? "");
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  };

  const curvedLineString = (coords, seed) => {
    if (!Array.isArray(coords) || coords.length !== 2) {
      return coords;
    }

    const [p0, p1] = coords;
    if (!Array.isArray(p0) || !Array.isArray(p1) || p0.length < 2 || p1.length < 2) {
      return coords;
    }

    const x0 = Number(p0[0]);
    const y0 = Number(p0[1]);
    const x1 = Number(p1[0]);
    const y1 = Number(p1[1]);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);

    if (!Number.isFinite(length) || length === 0) {
      return coords;
    }

    const nx = -dy / length;
    const ny = dx / length;
    const side = seed % 2 === 0 ? 1 : -1;
    const offset = length * 0.1 * side;
    const cx = (x0 + x1) / 2 + nx * offset;
    const cy = (y0 + y1) / 2 + ny * offset;

    const out = [];
    const segments = 14;
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const omt = 1 - t;
      const x = omt * omt * x0 + 2 * omt * t * cx + t * t * x1;
      const y = omt * omt * y0 + 2 * omt * t * cy + t * t * y1;
      out.push([x, y]);
    }

    return out;
  };

  const cross = (origin, a, b) => ((a[0] - origin[0]) * (b[1] - origin[1])) - ((a[1] - origin[1]) * (b[0] - origin[0]));

  const convexHull = (points) => {
    if (!Array.isArray(points) || points.length < 3) {
      return points || [];
    }

    const sorted = points
      .slice()
      .sort((p1, p2) => (p1[0] === p2[0] ? p1[1] - p2[1] : p1[0] - p2[0]));

    const lower = [];
    for (const point of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
        lower.pop();
      }
      lower.push(point);
    }

    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const point = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
        upper.pop();
      }
      upper.push(point);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
  };

  const expandPolygonFromCentroid = (points, scale = 1.12) => {
    if (!Array.isArray(points) || points.length < 3) {
      return points || [];
    }

    const cx = points.reduce((acc, point) => acc + point[0], 0) / points.length;
    const cy = points.reduce((acc, point) => acc + point[1], 0) / points.length;
    const minExpansion = 0.06;

    return points.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      if (dist < 1e-9) {
        return [x + minExpansion, y];
      }

      const expandedDist = dist * scale + minExpansion;
      const ratio = expandedDist / dist;
      return [cx + dx * ratio, cy + dy * ratio];
    });
  };

  const readGeoJson = async (name) => {
    const response = await fetch(`${geojsonBasePath}/${name}.geojson`, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Failed to load ${name}.geojson (${response.status})`);
    }
    return response.json();
  };

  const createContingencyDataPanel = (mapContainer) => {
    const makePanel = (titleText, getTabDataFn, tabDefs) => {
      const overlay = document.createElement("div");
      overlay.className = "bc-data-panel";
      overlay.style.display = "none";
      mapContainer.appendChild(overlay);

      const header = document.createElement("div");
      header.className = "bc-data-panel-header";
      overlay.appendChild(header);

      const titleEl = document.createElement("span");
      titleEl.className = "bc-data-panel-title";
      titleEl.textContent = titleText;
      header.appendChild(titleEl);

      const closeBtn = document.createElement("button");
      closeBtn.className = "bc-data-panel-close";
      closeBtn.type = "button";
      closeBtn.title = "Close";
      closeBtn.textContent = "✕";
      header.appendChild(closeBtn);

      const tabsBar = document.createElement("div");
      tabsBar.className = "bc-data-panel-tabs";
      overlay.appendChild(tabsBar);

      let activeTab = tabDefs[0].key;
      const tabBtns = {};
      tabDefs.forEach(({ key, label }) => {
        const btn = document.createElement("button");
        btn.className = `bc-data-tab${key === activeTab ? " active" : ""}`;
        btn.type = "button";
        btn.textContent = label;
        tabBtns[key] = btn;
        tabsBar.appendChild(btn);
      });

      const searchWrap = document.createElement("div");
      searchWrap.className = "bc-data-panel-search-wrap";
      overlay.appendChild(searchWrap);

      const searchInput = document.createElement("input");
      searchInput.className = "bc-data-panel-search";
      searchInput.type = "text";
      searchInput.placeholder = "Filter rows…";
      searchWrap.appendChild(searchInput);

      const rowCountEl = document.createElement("span");
      rowCountEl.className = "bc-data-panel-rowcount";
      searchWrap.appendChild(rowCountEl);

      const tableWrap = document.createElement("div");
      tableWrap.className = "bc-data-panel-table-wrap";
      overlay.appendChild(tableWrap);

      let sortCol = -1;
      let sortAsc = true;
      let currentRows = [];
      let currentHeaders = [];
      let colWidths = {};

      const renderTable = () => {
        const filter = searchInput.value.trim().toLowerCase();
        const filtered = filter
          ? currentRows.filter((row) => row.some((cell) => String(cell).toLowerCase().includes(filter)))
          : currentRows;

        const sorted = sortCol >= 0
          ? filtered.slice().sort((a, b) => {
              const va = a[sortCol];
              const vb = b[sortCol];
              const na = Number(va);
              const nb = Number(vb);
              const cmp = Number.isFinite(na) && Number.isFinite(nb)
                ? na - nb
                : String(va).localeCompare(String(vb));
              return sortAsc ? cmp : -cmp;
            })
          : filtered;

        rowCountEl.textContent = `${sorted.length} row${sorted.length !== 1 ? "s" : ""}`;
        tableWrap.innerHTML = "";

        const table = document.createElement("table");
        table.className = "bc-data-table";

        const colgroup = document.createElement("colgroup");
        currentHeaders.forEach((_, i) => {
          const col = document.createElement("col");
          const wk = `${activeTab}:${i}`;
          if (colWidths[wk]) {
            col.style.width = `${colWidths[wk]}px`;
          }
          colgroup.appendChild(col);
        });
        table.appendChild(colgroup);

        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");
        currentHeaders.forEach((h, i) => {
          const th = document.createElement("th");
          th.style.position = "relative";
          th.style.whiteSpace = "nowrap";
          const wk = `${activeTab}:${i}`;
          if (colWidths[wk]) {
            th.style.width = `${colWidths[wk]}px`;
            th.style.minWidth = `${colWidths[wk]}px`;
            th.style.maxWidth = `${colWidths[wk]}px`;
          }

          const labelSpan = document.createElement("span");
          labelSpan.className = "bc-th-label";
          const sortIndicator = i === sortCol ? (sortAsc ? " ▲" : " ▼") : "";
          labelSpan.textContent = h + sortIndicator;
          labelSpan.title = `Sort by ${h}`;
          labelSpan.addEventListener("click", () => {
            sortAsc = sortCol === i ? !sortAsc : true;
            sortCol = i;
            renderTable();
          });
          th.appendChild(labelSpan);

          const grip = document.createElement("div");
          grip.className = "bc-col-resize-grip";
          grip.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            e.preventDefault();
            const startX = e.clientX;
            const startW = th.offsetWidth;
            const onMove = (mv) => {
              const newW = Math.max(40, startW + (mv.clientX - startX));
              colWidths[wk] = newW;
              th.style.width = `${newW}px`;
              th.style.minWidth = `${newW}px`;
              th.style.maxWidth = `${newW}px`;
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
          });
          th.appendChild(grip);

          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        sorted.forEach((row) => {
          const tr = document.createElement("tr");
          row.forEach((cell) => {
            const td = document.createElement("td");
            td.textContent = String(cell);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
      };

      const switchTab = (tab) => {
        activeTab = tab;
        sortCol = -1;
        sortAsc = true;
        searchInput.value = "";
        colWidths = {};
        tabDefs.forEach(({ key }) => tabBtns[key].classList.toggle("active", key === tab));
        const data = getTabDataFn(tab);
        currentHeaders = data.headers;
        currentRows = data.rows;
        renderTable();
      };

      tabDefs.forEach(({ key }) => {
        tabBtns[key].addEventListener("click", () => switchTab(key));
      });
      searchInput.addEventListener("input", () => renderTable());
      closeBtn.addEventListener("click", () => { overlay.style.display = "none"; });

      overlay.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
      overlay.addEventListener("dblclick", (e) => e.stopPropagation());

      const resizeHandle = document.createElement("div");
      resizeHandle.className = "bc-data-panel-resize";
      overlay.appendChild(resizeHandle);
      resizeHandle.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = overlay.offsetWidth;
        const startH = overlay.offsetHeight;
        const onMove = (mv) => {
          overlay.style.width = `${Math.max(420, startW + (mv.clientX - startX))}px`;
          overlay.style.height = `${Math.max(280, startH + (mv.clientY - startY))}px`;
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      header.addEventListener("mousedown", (e) => {
        if (e.target === closeBtn) return;
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = overlay.offsetLeft;
        const startTop = overlay.offsetTop;
        overlay.classList.add("is-dragging");
        const onMove = (mv) => {
          overlay.style.left = `${startLeft + (mv.clientX - startX)}px`;
          overlay.style.top = `${startTop + (mv.clientY - startY)}px`;
        };
        const onUp = () => {
          overlay.classList.remove("is-dragging");
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });

      overlay.addEventListener("mousedown", (e) => e.stopPropagation());

      return {
        show(tab) {
          overlay.style.transform = "";
          overlay.style.display = "flex";
          const parentW = mapContainer.offsetWidth;
          const panelW = overlay.offsetWidth;
          overlay.style.left = `${Math.max(0, Math.round((parentW - panelW) / 2))}px`;
          overlay.style.top = "52px";
          switchTab(tab || activeTab);
        },
        hide() { overlay.style.display = "none"; },
        refresh() {
          if (overlay.style.display !== "none") switchTab(activeTab);
        }
      };
    };

    const fmt2 = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : (v || "N/A"); };
    const fmt1 = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(1) : (v || "N/A"); };
    const fmt4 = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(4) : (v || "N/A"); };

    const getTabData = (tab) => {
      if (tab === "lines") {
        const headers = ["From Bus", "To Bus", "CKT", "Contingency", "Pij (MW)", "Qij (MVAr)", "Rate A (MVA)", "Loading (%)", "Violation", "Converged"];
        const rows = Object.entries(activeFlowRowsByUid).map(([uid, r]) => [
          r.__fromBus || r["FromBus#"] || "",
          r.__toBus || r["ToBus#"] || "",
          r.__ckt || r.CKT || "",
          r.__contingency || "",
          fmt2(r["Pij(MW)"]),
          fmt2(r["Qij(MVAr)"]),
          fmt1(r.RateA),
          fmt1(r["Loading_%"]),
          r.Violation || "N/A",
          r.Converged || "N/A"
        ]);
        return { headers, rows };
      }
      if (tab === "buses") {
        const headers = ["Bus #", "Name", "Contingency", "Volt (p.u.)", "Angle (deg)", "Violation"];
        const rows = Object.values(activeBusRowsByBusId).map((r) => [
          r.__busId || r["Bus#"] || "",
          (r.Name || "").trim(),
          r.__contingency || "",
          fmt4(r["Volt(pu)"]),
          fmt2(r["Angle(deg)"]),
          r.Violation || "N/A"
        ]);
        return { headers, rows };
      }
      // gens
      const headers = ["Bus #", "Machine ID", "Contingency", "Pg (MW)", "Qg (MVAr)", "PgMax (MW)", "PgMin (MW)", "QgMax (MVAr)", "QgMin (MVAr)", "Violation"];
      const rows = Object.values(activeGenRowsByBusAndMachine).map((r) => [
        r.__busId || "",
        r.MachineID || "",
        r.__contingency || "",
        fmt2(r["Pg(MW)"]),
        fmt2(r["Qg(MVAr)"]),
        fmt2(r["PgMax(MW)"]),
        fmt2(r["PgMin(MW)"]),
        fmt2(r["QgMax(MVAr)"]),
        fmt2(r["QgMin(MVAr)"]),
        r.Violation || "N/A"
      ]);
      return { headers, rows };
    };

    return makePanel("Contingency Analysis Results", getTabData, [
      { key: "lines", label: "Lines" },
      { key: "buses", label: "Buses" },
      { key: "gens", label: "Generators" }
    ]);
  };

  const createBaseCaseDataPanel = (mapContainer) => {
    const overlay = document.createElement("div");
    overlay.className = "bc-data-panel";
    overlay.style.display = "none";
    mapContainer.appendChild(overlay);

    const header = document.createElement("div");
    header.className = "bc-data-panel-header";
    overlay.appendChild(header);

    const titleEl = document.createElement("span");
    titleEl.className = "bc-data-panel-title";
    titleEl.textContent = "Base Case Results";
    header.appendChild(titleEl);

    const closeBtn = document.createElement("button");
    closeBtn.className = "bc-data-panel-close";
    closeBtn.type = "button";
    closeBtn.title = "Close";
    closeBtn.textContent = "✕";
    header.appendChild(closeBtn);

    const tabsBar = document.createElement("div");
    tabsBar.className = "bc-data-panel-tabs";
    overlay.appendChild(tabsBar);

    const tabDefs = [
      { key: "lines", label: "Lines" },
      { key: "buses", label: "Buses" },
      { key: "gens", label: "Generators" }
    ];
    let activeTab = "lines";
    const tabBtns = {};
    tabDefs.forEach(({ key, label }) => {
      const btn = document.createElement("button");
      btn.className = `bc-data-tab${key === activeTab ? " active" : ""}`;
      btn.type = "button";
      btn.textContent = label;
      tabBtns[key] = btn;
      tabsBar.appendChild(btn);
    });

    const searchWrap = document.createElement("div");
    searchWrap.className = "bc-data-panel-search-wrap";
    overlay.appendChild(searchWrap);

    const searchInput = document.createElement("input");
    searchInput.className = "bc-data-panel-search";
    searchInput.type = "text";
    searchInput.placeholder = "Filter rows…";
    searchWrap.appendChild(searchInput);

    const rowCountEl = document.createElement("span");
    rowCountEl.className = "bc-data-panel-rowcount";
    searchWrap.appendChild(rowCountEl);

    const tableWrap = document.createElement("div");
    tableWrap.className = "bc-data-panel-table-wrap";
    overlay.appendChild(tableWrap);

    let sortCol = -1;
    let sortAsc = true;
    let currentRows = [];
    let currentHeaders = [];
    let colWidths = {}; // key: "tabKey:colIndex" -> px width

    const renderTable = () => {
      const filter = searchInput.value.trim().toLowerCase();
      const filtered = filter
        ? currentRows.filter((row) => row.some((cell) => String(cell).toLowerCase().includes(filter)))
        : currentRows;

      const sorted = sortCol >= 0
        ? filtered.slice().sort((a, b) => {
            const va = a[sortCol];
            const vb = b[sortCol];
            const na = Number(va);
            const nb = Number(vb);
            const cmp = Number.isFinite(na) && Number.isFinite(nb)
              ? na - nb
              : String(va).localeCompare(String(vb));
            return sortAsc ? cmp : -cmp;
          })
        : filtered;

      rowCountEl.textContent = `${sorted.length} row${sorted.length !== 1 ? "s" : ""}`;
      tableWrap.innerHTML = "";

      const table = document.createElement("table");
      table.className = "bc-data-table";

      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      currentHeaders.forEach((h, i) => {
        const th = document.createElement("th");
        th.style.position = "relative";
        th.style.whiteSpace = "nowrap";
        const widthKey = `${activeTab}:${i}`;
        if (colWidths[widthKey]) {
          th.style.width = `${colWidths[widthKey]}px`;
          th.style.minWidth = `${colWidths[widthKey]}px`;
          th.style.maxWidth = `${colWidths[widthKey]}px`;
        }

        const labelSpan = document.createElement("span");
        labelSpan.className = "bc-th-label";
        const sortIndicator = i === sortCol ? (sortAsc ? " ▲" : " ▼") : "";
        labelSpan.textContent = h + sortIndicator;
        labelSpan.title = `Sort by ${h}`;
        labelSpan.addEventListener("click", () => {
          sortAsc = sortCol === i ? !sortAsc : true;
          sortCol = i;
          renderTable();
        });
        th.appendChild(labelSpan);

        // Column resize handle
        const grip = document.createElement("div");
        grip.className = "bc-col-resize-grip";
        grip.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          const startX = e.clientX;
          const startW = th.offsetWidth;
          const onMove = (mv) => {
            const newW = Math.max(40, startW + (mv.clientX - startX));
            colWidths[widthKey] = newW;
            th.style.width = `${newW}px`;
            th.style.minWidth = `${newW}px`;
            th.style.maxWidth = `${newW}px`;
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        });
        th.appendChild(grip);

        headRow.appendChild(th);
      });
      thead.appendChild(headRow);

      // colgroup to fix widths across tbody
      const colgroup = document.createElement("colgroup");
      currentHeaders.forEach((_, i) => {
        const col = document.createElement("col");
        const widthKey = `${activeTab}:${i}`;
        if (colWidths[widthKey]) {
          col.style.width = `${colWidths[widthKey]}px`;
        }
        colgroup.appendChild(col);
      });
      table.appendChild(colgroup);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      sorted.forEach((row) => {
        const tr = document.createElement("tr");
        row.forEach((cell) => {
          const td = document.createElement("td");
          td.textContent = String(cell);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
    };

    const fmt2 = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(2) : (v || "N/A");
    };

    const fmt1 = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(1) : (v || "N/A");
    };

    const fmt4 = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(4) : (v || "N/A");
    };

    const getTabData = (tab) => {
      if (tab === "lines") {
        const headers = ["From Bus", "To Bus", "CKT", "Pij (MW)", "Qij (MVAr)", "Sij (MVA)", "Rate A (MVA)", "Loading (%)"];
        const rows = Object.values(baseCaseFlowRowsByUid).map((r) => [
          r.__fromBus || r["FromBus#"] || "",
          r.__toBus || r["ToBus#"] || "",
          r.__ckt || r.CKT || "",
          fmt2(r["Pij(MW)"]),
          fmt2(r["Qij(MVAr)"]),
          fmt2(r["Sij(MVA)"]),
          fmt1(r.RateA),
          fmt1(r["Loading_%"])
        ]);
        return { headers, rows };
      }

      if (tab === "buses") {
        const headers = ["Bus #", "Name", "Volt (p.u.)", "Angle (deg)"];
        const rows = Object.values(baseCaseBusRowsByBusId).map((r) => [
          r.__busId || r["Bus#"] || "",
          (r.Name || "").trim(),
          fmt4(r["Volt(pu)"]),
          fmt2(r["Angle(deg)"])
        ]);
        return { headers, rows };
      }

      // gens
      const headers = ["Bus #", "Machine ID", "Pg (MW)", "Qg (MVAr)", "PgMax (MW)", "PgMin (MW)", "QgMax (MVAr)", "QgMin (MVAr)"];
      const rows = Object.values(baseCaseGenRowsByBusAndMachine).map((r) => [
        r.__busId || "",
        r.MachineID || "",
        fmt2(r["Pg(MW)"]),
        fmt2(r["Qg(MVAr)"]),
        fmt2(r["PgMax(MW)"]),
        fmt2(r["PgMin(MW)"]),
        fmt2(r["QgMax(MVAr)"]),
        fmt2(r["QgMin(MVAr)"])
      ]);
      return { headers, rows };
    };

    const switchTab = (tab) => {
      activeTab = tab;
      sortCol = -1;
      sortAsc = true;
      searchInput.value = "";
      colWidths = {};
      tabDefs.forEach(({ key }) => tabBtns[key].classList.toggle("active", key === tab));
      const data = getTabData(tab);
      currentHeaders = data.headers;
      currentRows = data.rows;
      renderTable();
    };

    tabDefs.forEach(({ key }) => {
      tabBtns[key].addEventListener("click", () => switchTab(key));
    });

    searchInput.addEventListener("input", () => renderTable());

    closeBtn.addEventListener("click", () => {
      overlay.style.display = "none";
    });

    overlay.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    overlay.addEventListener("dblclick", (e) => e.stopPropagation());

    // Resize grip
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "bc-data-panel-resize";
    overlay.appendChild(resizeHandle);

    resizeHandle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = overlay.offsetWidth;
      const startH = overlay.offsetHeight;

      const onMove = (mv) => {
        const newW = Math.max(420, startW + (mv.clientX - startX));
        const newH = Math.max(280, startH + (mv.clientY - startY));
        overlay.style.width = `${newW}px`;
        overlay.style.height = `${newH}px`;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Drag-to-move via header — use offsetLeft/offsetTop to avoid any jump
    header.addEventListener("mousedown", (e) => {
      if (e.target === closeBtn) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = overlay.offsetLeft;
      const startTop = overlay.offsetTop;

      overlay.classList.add("is-dragging");

      const onMove = (mv) => {
        overlay.style.left = `${startLeft + (mv.clientX - startX)}px`;
        overlay.style.top = `${startTop + (mv.clientY - startY)}px`;
      };

      const onUp = () => {
        overlay.classList.remove("is-dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    overlay.addEventListener("mousedown", (e) => e.stopPropagation());

    return {
      show(tab) {
        // Always reset to top-center in pixel coordinates (no transform) to avoid jump on drag
        overlay.style.transform = "";
        overlay.style.display = "flex";
        const parentW = mapContainer.offsetWidth;
        const panelW = overlay.offsetWidth;
        overlay.style.left = `${Math.max(0, Math.round((parentW - panelW) / 2))}px`;
        overlay.style.top = "52px";
        switchTab(tab || activeTab);
      },
      hide() {
        overlay.style.display = "none";
      },
      refresh() {
        if (overlay.style.display !== "none") {
          switchTab(activeTab);
        }
      }
    };
  };

  const initializeMap = async () => {
    const [busGeo, branchGeo, genGeo, genConnGeo, lineNameRows] = await Promise.all([
      readGeoJson("bus"),
      readGeoJson("branch"),
      readGeoJson("gen"),
      readGeoJson("gen_conn"),
      readLineNamesCsv()
    ]);

    const lineNameByUid = buildLineNameByUid(branchGeo, lineNameRows);
    const branchMetaByUid = buildBranchMetaByUid(branchGeo);

    const mapContainer = map.getContainer();
    const statusBanner = document.createElement("div");
    statusBanner.className = "contingency-status-banner";
    mapContainer.appendChild(statusBanner);
    let statusBannerTimer = null;

    lineColorLegendElement = document.createElement("div");
    lineColorLegendElement.className = "line-color-legend";
    lineColorLegendElement.style.display = "none";
    mapContainer.appendChild(lineColorLegendElement);

    const hideStatusBanner = () => {
      statusBanner.classList.remove("show", "success", "error");
    };

    const showStatusBanner = (message, type) => {
      if (statusBannerTimer) {
        window.clearTimeout(statusBannerTimer);
      }

      statusBanner.textContent = message;
      statusBanner.classList.remove("success", "error");
      statusBanner.classList.add(type, "show");

      statusBannerTimer = window.setTimeout(() => {
        hideStatusBanner();
      }, 3000);
    };

    const refreshOpenLinePopups = () => {
      if (!linesLayer) {
        return;
      }

      linesLayer.eachLayer((layer) => {
        if (!layer || !layer.isPopupOpen || !layer.getPopup || !layer.isPopupOpen()) {
          return;
        }

        const popup = layer.getPopup();
        if (!popup || !popup.setContent) {
          return;
        }

        const feature = layer.feature || {};
        const uid = String((feature.properties && feature.properties.UID) || "").trim();

        if (currentViewMode === "contingency" && selectedContingencyUid && selectedContingencySeason && activeContingencyConverged) {
          popup.setContent(contingencyFlowRowToPopupHtml(
            activeFlowRowsByUid[uid],
            uid === selectedContingencyUid
          ));
        } else if (currentViewMode === "baseCase") {
          popup.setContent(baseCaseLineFlowPopupHtml(baseCaseFlowRowsByUid[uid]));
        } else {
          popup.setContent(propertiesToPopupHtml(feature.properties || {}, "Line"));
        }
      });
    };

    const busContingencyPopupHtml = (feature) => {
      const props = (feature && feature.properties) || {};
      const busId = normalizeBusValue(props["Bus ID"]);
      const row = activeBusRowsByBusId[busId];

      if (!row || !(currentViewMode === "contingency" && selectedContingencyUid && selectedContingencySeason && activeContingencyConverged)) {
        if (currentViewMode === "baseCase") {
          return baseCaseBusPopupHtml(feature);
        }
        return propertiesToPopupHtml(props, "Bus");
      }

      const rows = [
        `<b>Substation:</b> ${esc(String(row.Name || "N/A").trim())}`,
        `<b>Bus ID:</b> ${esc(busId)}`,
        `<b>Voltage:</b> ${esc(formatMetric(row["Volt(pu)"], "p.u."))}`,
        `<b>Angle:</b> ${esc(formatMetric(row["Angle(deg)"], "deg"))}`,
        `<b>Violation:</b> ${esc(String(row.Violation || "N/A"))}`
      ];

      return `<b>Substation</b><br>${rows.join("<br>")}`;
    };

    const baseCaseBusPopupHtml = (feature) => {
      const props = (feature && feature.properties) || {};
      const busId = normalizeBusValue(props["Bus ID"]);
      const row = baseCaseBusRowsByBusId[busId];

      if (!row) {
        return propertiesToPopupHtml(props, "Bus");
      }

      const rows = [
        `<b>Substation:</b> ${esc(String(row.Name || "N/A").trim())}`,
        `<b>Bus ID:</b> ${esc(busId)}`,
        `<b>Voltage:</b> ${esc(formatMetric(row["Volt(pu)"], "p.u."))}`,
        `<b>Angle:</b> ${esc(formatMetric(row["Angle(deg)"], "deg"))}`
      ];

      return `<b>Substation</b><br>${rows.join("<br>")}`;
    };

    const baseCaseLineFlowPopupHtml = (row) => {
      if (!row) {
        return "<b>Line Flow</b><br>No base case flow data for this line.";
      }

      const busFrom = normalizeBusValue(row["FromBus#"] || row.__fromBus);
      const busTo = normalizeBusValue(row["ToBus#"] || row.__toBus);
      const circuit = String(row.CKT || row.__ckt || "N/A");

      const detailRows = [
        `<b>Bus From:</b> ${esc(busFrom)}`,
        `<b>Bus To:</b> ${esc(busTo)}`,
        `<b>Circuit:</b> ${esc(circuit)}`,
        `<b>Active Flow i-&gt;j:</b> ${esc(formatIntegerMetric(row["Pij(MW)"], "MW"))}`,
        `<b>Reactive Flow i-&gt;j:</b> ${esc(formatMetric(row["Qij(MVAr)"], "MVAr"))}`,
        `<b>Apparent Flow:</b> ${esc(formatMetric(row["Sij(MVA)"], "MVA"))}`,
        `<b>Rating:</b> ${esc(formatMetric(row.RateA, "MVA"))}`,
        `<b>Active Losses:</b> ${esc(formatMetric(row["Ploss(MW)"], "MW"))}`,
        `<b>Reactive Losses:</b> ${esc(formatMetric(row["Qloss(MVAr)"], "MVAr"))}`,
        `<b>Loading:</b> ${esc(formatIntegerMetric(row["Loading_%"], "%"))}`
      ];

      return `<b>Line Flow</b><br>${detailRows.join("<br>")}`;
    };

    const refreshOpenBusPopups = () => {
      if (!busesLayer) {
        return;
      }

      busesLayer.eachLayer((layer) => {
        if (!layer || !layer.isPopupOpen || !layer.getPopup || !layer.isPopupOpen()) {
          return;
        }

        const popup = layer.getPopup();
        if (!popup || !popup.setContent) {
          return;
        }

        popup.setContent(busContingencyPopupHtml(layer.feature));
      });
    };

    const generatorContingencyRowForFeature = (feature) => {
      const props = (feature && feature.properties) || {};
      const busId = normalizeBusValue(
        props["Bus ID"]
          ?? props.BusNumber
          ?? props["Bus Number"]
          ?? props["Bus#"]
      );
      const machineId = normalizeMachineValue(props["Gen ID"] ?? props.MachineID);

      if (!busId || !machineId) {
        return null;
      }

      const exact = activeGenRowsByBusAndMachine[genBusMachineKey(busId, machineId)] || null;
      if (exact) {
        return exact;
      }

      const busCandidates = activeGenRowsListByBus[busId] || [];
      if (!busCandidates.length) {
        return null;
      }

      const machineLoose = normalizeMachineLoose(machineId);
      const looseMatch = busCandidates.find((row) => normalizeMachineLoose(row.MachineID) === machineLoose);
      if (looseMatch) {
        return looseMatch;
      }

      const machineNum = machineNumeric(machineId);
      if (Number.isFinite(machineNum)) {
        let bestRow = null;
        let bestDelta = Number.POSITIVE_INFINITY;
        busCandidates.forEach((row) => {
          const candidateNum = machineNumeric(row.MachineID);
          if (!Number.isFinite(candidateNum)) {
            return;
          }

          const delta = Math.abs(candidateNum - machineNum);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestRow = row;
          }
        });

        if (bestRow) {
          return bestRow;
        }
      }

      return busCandidates[0] || null;
    };

    const generatorPopupHtmlForFeature = (feature) => {
      const contingencyMode = currentViewMode === "contingency"
        && selectedContingencyUid
        && selectedContingencySeason
        && activeContingencyConverged;

      if (contingencyMode) {
        const row = generatorContingencyRowForFeature(feature);
        return generatorContingencyPopupHtml(row);
      }

      if (currentViewMode === "baseCase") {
        return baseCaseGeneratorPopupHtml(feature);
      }

      return generatorPropertiesToPopupHtml((feature && feature.properties) || {});
    };

    const baseCaseGeneratorPopupHtml = (feature) => {
      const props = (feature && feature.properties) || {};
      const busId = normalizeBusValue(props["Bus ID"] ?? props.BusNumber ?? props["Bus#"]);
      const machineId = normalizeMachineValue(props["Gen ID"] ?? props.MachineID);

      let row = null;
      if (busId && machineId) {
        row = baseCaseGenRowsByBusAndMachine[genBusMachineKey(busId, machineId)] || null;
        if (!row) {
          const busCandidates = baseCaseGenRowsListByBus[busId] || [];
          if (busCandidates.length) {
            const machineLoose = normalizeMachineLoose(machineId);
            row = busCandidates.find((r) => normalizeMachineLoose(r.MachineID) === machineLoose) || busCandidates[0] || null;
          }
        }
      }

      if (!row) {
        return generatorPropertiesToPopupHtml(props);
      }

      const lines = [
        `<b>MachineID:</b> ${esc(formatFloatValue(row.MachineID))}`,
        `<b>Active Power:</b> ${esc(`${(Number(row["Pg(MW)"]) || 0).toFixed(2)} MW`)}`,
        `<b>Reactive Power:</b> ${esc(`${(Number(row["Qg(MVAr)"]) || 0).toFixed(2)} MVAr`)}`,
        `<b>Max Active Power:</b> ${esc(`${(Number(row["PgMax(MW)"]) || 0).toFixed(2)} MW`)}`,
        `<b>Min Active Power:</b> ${esc(`${(Number(row["PgMin(MW)"]) || 0).toFixed(2)} MW`)}`
      ];
      return `<b>Generator</b><br>${lines.join("<br>")}`;
    };

    const refreshOpenGeneratorPopups = () => {
      if (!gensLayer) {
        return;
      }

      gensLayer.eachLayer((layer) => {
        if (!layer || !layer.isPopupOpen || !layer.getPopup || !layer.isPopupOpen()) {
          return;
        }

        const popup = layer.getPopup();
        if (!popup || !popup.setContent) {
          return;
        }

        popup.setContent(generatorPopupHtmlForFeature(layer.feature));
      });
    };

    const applyContingencySelection = async (uid, season) => {
      if (!uid || !season) {
        activeFlowRowsByUid = {};
        activeBusRowsByBusId = {};
        activeGenRowsByBusId = {};
        activeGenRowsByBusAndMachine = {};
        activeGenRowsListByBus = {};
        activeContingencyConverged = false;
        hideStatusBanner();
        refreshMetricButtonsState();
        refreshLineColorLegend();
        refreshOpenLinePopups();
        refreshOpenBusPopups();
        refreshOpenGeneratorPopups();
        refreshLineHighlight();
        refreshBusColors();
        refreshGeneratorColors();
        return;
      }

      const contingencyName = lineNameByUid[uid] || uid;
      const rows = await readSeasonLineFlowsCsv(season);
      const busRows = await readSeasonBusCsv(season);
      const genRows = await readSeasonGenCsv(season);
      const contingencyRows = rows.filter((row) => row.__contingency === contingencyName);
      activeContingencyConverged = contingencyRows.length > 0 && contingencyRows.every((row) => isTrueValue(row.Converged));

      if (activeContingencyConverged) {
        activeFlowRowsByUid = buildActiveFlowRowsByUid(rows, contingencyName, branchMetaByUid);
        activeBusRowsByBusId = buildActiveBusRowsByBusId(busRows, contingencyName);
        activeGenRowsByBusId = buildActiveGenRowsByBusId(genRows, contingencyName);
        activeGenRowsByBusAndMachine = buildActiveGenRowsByBusAndMachine(genRows, contingencyName);
        activeGenRowsListByBus = buildActiveGenRowsListByBus(genRows, contingencyName);
        showStatusBanner(`Contingency ${contingencyName} (${season}) is now displayed.`, "success");
      } else {
        activeFlowRowsByUid = {};
        activeBusRowsByBusId = {};
        activeGenRowsByBusId = {};
        activeGenRowsByBusAndMachine = {};
        activeGenRowsListByBus = {};
        showStatusBanner("System did not converged. Select other contingency and season.", "error");
      }

      refreshMetricButtonsState();
      refreshLineColorLegend();
      refreshLineHighlight();
      refreshBusColors();
      refreshGeneratorColors();
      refreshOpenLinePopups();
      refreshOpenBusPopups();
      refreshOpenGeneratorPopups();
      if (contingencyDataPanelRef) {
        contingencyDataPanelRef.refresh();
      }
    };

    const applyMetricSelection = () => {
      refreshMetricButtonsState();
      refreshLineColorLegend();
      refreshLineHighlight();
      refreshBusColors();
      refreshGeneratorColors();
      refreshOpenLinePopups();
      refreshOpenBusPopups();
      refreshOpenGeneratorPopups();
    };

    const loadBaseCaseData = async (season) => {
      const lineRows = await readBaseCaseLinesCsv(season);
      const busRows = await readBaseCaseBusCsv(season);
      const genRows = await readBaseCaseGenCsv(season);
      baseCaseFlowRowsByUid = buildBaseCaseFlowRowsByUid(lineRows, branchMetaByUid);
      baseCaseBusRowsByBusId = buildBaseCaseBusRowsByBusId(busRows);
      baseCaseGenRowsByBusAndMachine = buildBaseCaseGenRowsByBusAndMachine(genRows);
      baseCaseGenRowsListByBus = buildBaseCaseGenRowsListByBus(genRows);
    };

    const applyBaseCaseSeasonChange = async (season) => {
      await loadBaseCaseData(season);
      if (baseCaseDataPanelRef) {
        baseCaseDataPanelRef.refresh();
      }
      refreshMetricButtonsState();
      refreshLineColorLegend();
      refreshLineHighlight();
      refreshBusColors();
      refreshGeneratorColors();
      refreshOpenLinePopups();
      refreshOpenBusPopups();
      refreshOpenGeneratorPopups();
    };

    const applyBaseCaseMetricSelection = () => {
      refreshMetricButtonsState();
      refreshLineColorLegend();
      refreshLineHighlight();
      refreshBusColors();
      refreshGeneratorColors();
      refreshOpenLinePopups();
      refreshOpenBusPopups();
      refreshOpenGeneratorPopups();
    };

    const categoryOf = (feature) => ((feature && feature.properties && feature.properties.Category) || "Unknown");
    const uniqueCategories = Array.from(new Set((genGeo.features || []).map(categoryOf))).sort();
    const categoryColor = {};
    uniqueCategories.forEach((category, index) => {
      categoryColor[category] = categoryPalette[index % categoryPalette.length];
    });

    const busTypeOf = (feature) => ((feature && feature.properties && feature.properties["Bus Type"]) || "Unknown");
    const uniqueBusTypes = Array.from(new Set((busGeo.features || []).map(busTypeOf))).sort();
    const busTypeColor = {};
    uniqueBusTypes.forEach((busType, index) => {
      busTypeColor[busType] = categoryPalette[index % categoryPalette.length];
    });

    const curvedBranchGeo = {
      ...branchGeo,
      features: (branchGeo.features || []).map((feature) => {
        if (!feature || !feature.geometry || feature.geometry.type !== "LineString") {
          return feature;
        }

        const coords = feature.geometry.coordinates || [];
        const uid = (feature.properties && (feature.properties.UID || feature.properties["From Bus"])) || "";
        const curvedCoords = curvedLineString(coords, hashString(uid));

        return {
          ...feature,
          geometry: {
            ...feature.geometry,
            coordinates: curvedCoords
          }
        };
      })
    };

    const buildAreaLayer = () => {
      const pointsByArea = {};

      (busGeo.features || []).forEach((feature) => {
        if (!feature || !feature.geometry || feature.geometry.type !== "Point") {
          return;
        }

        const coords = feature.geometry.coordinates || [];
        if (!Array.isArray(coords) || coords.length < 2) {
          return;
        }

        const areaRaw = feature.properties ? feature.properties.Area : undefined;
        if (areaRaw === undefined || areaRaw === null) {
          return;
        }

        const area = String(areaRaw);
        if (!pointsByArea[area]) {
          pointsByArea[area] = [];
        }
        pointsByArea[area].push([Number(coords[0]), Number(coords[1])]);
      });

      const layers = [];
      Object.entries(pointsByArea).forEach(([area, points]) => {
        const valid = points.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
        if (valid.length < 3) {
          return;
        }

        const hull = convexHull(valid);
        if (hull.length < 3) {
          return;
        }

        const expandedHull = expandPolygonFromCentroid(hull, 1.12);
        if (expandedHull.length < 3) {
          return;
        }

        const latLngs = expandedHull.map(([lon, lat]) => [lat, lon]);
        const polygon = L.polygon(latLngs, areaStyleForTheme(area, false));
        polygon.options.areaId = area;
        polygon.bindTooltip(`Area ${area}`, {
          direction: "center",
          permanent: false,
          sticky: true
        });
        layers.push(polygon);
      });

      return L.featureGroup(layers);
    };

    areasLayer = buildAreaLayer().addTo(map);

    linesLayer = L.geoJSON(curvedBranchGeo, {
      style: (feature) => lineStyleForFeature(feature),
      onEachFeature: (feature, layer) => {
        bindHoverPopup(layer, () => {
          const uid = String(((feature && feature.properties) || {}).UID || "").trim();

          if (currentViewMode === "contingency" && selectedContingencyUid && selectedContingencySeason && activeContingencyConverged) {
            return contingencyFlowRowToPopupHtml(
              activeFlowRowsByUid[uid],
              uid === selectedContingencyUid
            );
          }

          if (currentViewMode === "baseCase") {
            return baseCaseLineFlowPopupHtml(baseCaseFlowRowsByUid[uid]);
          }

          return propertiesToPopupHtml(feature.properties || {}, "Line");
        });
      }
    }).addTo(map);

    createContingencyControl(branchGeo, lineNameByUid, applyContingencySelection, applyMetricSelection);
    contingencyDataPanelRef = createContingencyDataPanel(map.getContainer());
    createBaseCaseControl(applyBaseCaseSeasonChange, applyBaseCaseMetricSelection);

    // Pre-load default base case season data
    loadBaseCaseData(selectedBaseCaseSeason);

    baseCaseDataPanelRef = createBaseCaseDataPanel(map.getContainer());

    genConnLayer = L.geoJSON(genConnGeo, {
      style: () => ({ color: "#000000", weight: 2, opacity: 0.95, dashArray: "6,6" }),
      onEachFeature: (feature, layer) => {
        bindHoverPopup(layer, propertiesToPopupHtml(feature.properties || {}, "Generator Connection"));
      }
    });

    busesLayer = L.geoJSON(busGeo, {
      pointToLayer: (feature, latlng) => {
        const busType = busTypeOf(feature);
        const color = busTypeColor[busType] || "#000000";

        return L.marker(latlng, {
          baseBusColor: color,
          icon: L.divIcon({
            className: "bus-square-icon",
            html: busIconHtml(color),
            iconSize: [12, 12],
            iconAnchor: [6, 6]
          })
        });
      },
      onEachFeature: (feature, layer) => {
        bindHoverPopup(layer, () => busContingencyPopupHtml(feature));
      }
    }).addTo(map);

    const busTypeToLayers = {};
    uniqueBusTypes.forEach((busType) => {
      busTypeToLayers[busType] = [];
    });

    busesLayer.eachLayer((layer) => {
      const busType = busTypeOf(layer.feature);
      if (!busTypeToLayers[busType]) {
        busTypeToLayers[busType] = [];
      }
      busTypeToLayers[busType].push(layer);
    });

    const gensLayer = L.geoJSON(genGeo, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 5,
        color: categoryColor[categoryOf(feature)] || "#777777",
        fillColor: categoryColor[categoryOf(feature)] || "#777777",
        fillOpacity: 0.85,
        weight: 1
      }),
      onEachFeature: (feature, layer) => {
        bindHoverPopup(layer, () => generatorPopupHtmlForFeature(feature));
      }
    }).addTo(map);

    const categoryToLayers = {};
    uniqueCategories.forEach((category) => {
      categoryToLayers[category] = [];
    });

    gensLayer.eachLayer((layer) => {
      const category = categoryOf(layer.feature);
      if (!categoryToLayers[category]) {
        categoryToLayers[category] = [];
      }
      categoryToLayers[category].push(layer);
    });

    const setGeneratorMarkerColors = (usePurple) => {
      const purple = "#a855f7";

      gensLayer.eachLayer((layer) => {
        if (!layer || !layer.setStyle) {
          return;
        }

        const category = categoryOf(layer.feature);
        const color = usePurple ? purple : (categoryColor[category] || "#777777");
        layer.setStyle({
          color,
          fillColor: color
        });
      });
    };

    const refreshGeneratorColors = () => {
      if (!gensLayer) {
        return;
      }

      if (currentViewMode === "baseCase" && activeBaseCaseGeneratorMetric) {
        const bcGenRows = Object.values(baseCaseGenRowsByBusAndMachine);
        const bcValues = bcGenRows.map((r) => getMetricValueForRow(r, activeBaseCaseGeneratorMetric)).filter((v) => Number.isFinite(v));
        const bcMin = bcValues.length ? Math.floor(Math.min(...bcValues)) : 0;
        const bcMax = bcValues.length ? Math.ceil(Math.max(...bcValues)) : 1;
        const fallbackColor = colorForMetricValue(bcMin, bcMin, bcMax, activeBaseCaseGeneratorMetric);

        gensLayer.eachLayer((layer) => {
          if (!layer || !layer.setStyle) {
            return;
          }
          const feature = layer.feature || {};
          const props = (feature && feature.properties) || {};
          const busId = normalizeBusValue(props["Bus ID"] ?? props.BusNumber ?? props["Bus#"]);
          const machineId = normalizeMachineValue(props["Gen ID"] ?? props.MachineID);
          let row = null;
          if (busId && machineId) {
            row = baseCaseGenRowsByBusAndMachine[genBusMachineKey(busId, machineId)] || null;
            if (!row) {
              const busCandidates = baseCaseGenRowsListByBus[busId] || [];
              if (busCandidates.length) {
                row = busCandidates.find((r) => normalizeMachineLoose(r.MachineID) === normalizeMachineLoose(machineId)) || busCandidates[0] || null;
              }
            }
          }
          const value = getMetricValueForRow(row, activeBaseCaseGeneratorMetric);
          const color = Number.isFinite(value) ? colorForMetricValue(value, bcMin, bcMax, activeBaseCaseGeneratorMetric) : fallbackColor;
          layer.setStyle({ color, fillColor: color });
        });
        return;
      }

      if (!(currentViewMode === "contingency" && activeContingencyConverged && activeGeneratorMetric)) {
        setGeneratorMarkerColors(currentViewMode === "contingency");
        return;
      }

      const { min, max } = getMetricRange(activeGeneratorMetric);
      const fallbackColor = colorForMetricValue(min, min, max, activeGeneratorMetric);
      gensLayer.eachLayer((layer) => {
        if (!layer || !layer.setStyle) {
          return;
        }

        const feature = layer.feature || {};
        const row = generatorContingencyRowForFeature(feature);
        const value = getMetricValueForRow(row, activeGeneratorMetric);

        if (!Number.isFinite(value)) {
          layer.setStyle({
            color: fallbackColor,
            fillColor: fallbackColor
          });
          return;
        }

        const metricName = activeGeneratorMetric === "genReactive" ? "genReactive" : "genActive";
        const color = colorForMetricValue(value, min, max, metricName);
        layer.setStyle({
          color,
          fillColor: color
        });
      });
    };

    const legendLine = "<span style=\"display:inline-block;width:16px;height:0;border-top:2px solid #4f81bd;vertical-align:middle;margin-right:6px;\"></span>";
    const legendArea = "<span style=\"display:inline-block;width:10px;height:10px;background:#9ca3af;border:1px solid #6b7280;vertical-align:middle;margin-right:6px;\"></span>";
    const legendBus = "<span style=\"display:inline-block;width:12px;height:12px;background:#06b6d4;border:1px solid #0891b2;box-sizing:border-box;vertical-align:middle;margin-right:6px;position:relative;overflow:hidden;\"><span style=\"position:absolute;left:-2px;top:5px;width:16px;height:1.4px;background:#111;transform:rotate(45deg);transform-origin:center;\"></span></span>";
    const legendGen = "<span style=\"display:inline-block;width:10px;height:10px;background:#a855f7;border:1px solid #7e22ce;border-radius:50%;vertical-align:middle;margin-right:6px;\"></span>";
    const legendGenConn = "<span style=\"display:inline-block;width:16px;height:0;border-top:2px dashed #000000;vertical-align:middle;margin-right:6px;\"></span>";

    const overlays = {
      [`${legendArea}Areas`]: areasLayer,
      [`${legendLine}Lines`]: linesLayer,
      [`${legendBus}Buses`]: busesLayer,
      [`${legendGen}Generators`]: gensLayer,
      [`${legendGenConn}Generator Connections`]: genConnLayer
    };

    const layersControl = L.control.layers(null, overlays, { collapsed: false }).addTo(map);

    const setOverlayLegendEntryVisible = (labelText, visible) => {
      if (!layersControl || !layersControl.getContainer) {
        return;
      }

      const container = layersControl.getContainer();
      if (!container) {
        return;
      }

      const labels = container.querySelectorAll("label");
      labels.forEach((label) => {
        const text = (label.textContent || "").trim();
        if (text.includes(labelText)) {
          label.style.display = visible ? "" : "none";
        }
      });
    };

    const applyCategoryVisibility = (category, checked) => {
      (categoryToLayers[category] || []).forEach((layer) => {
        if (checked) {
          if (!map.hasLayer(layer)) {
            layer.addTo(map);
          }
        } else if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      });
    };

    const applyBusTypeVisibility = (busType, checked) => {
      (busTypeToLayers[busType] || []).forEach((layer) => {
        if (checked) {
          if (!map.hasLayer(layer)) {
            layer.addTo(map);
          }
        } else if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      });
    };

    let categoryCheckboxes = [];
    let categoryEnableAllCheckbox = null;
    let busTypeCheckboxes = [];
    let busTypeEnableAllCheckbox = null;
    let genLegendElement = null;
    let busLegendElement = null;

    const setAllGeneratorCategories = (checked) => {
      categoryCheckboxes.forEach((checkbox, index) => {
        checkbox.checked = checked;
        const category = uniqueCategories[index];
        applyCategoryVisibility(category, checked);
      });
      if (categoryEnableAllCheckbox) {
        categoryEnableAllCheckbox.checked = checked;
      }
    };

    const setAllBusTypes = (checked) => {
      busTypeCheckboxes.forEach((checkbox, index) => {
        checkbox.checked = checked;
        const busType = uniqueBusTypes[index];
        applyBusTypeVisibility(busType, checked);
      });
      if (busTypeEnableAllCheckbox) {
        busTypeEnableAllCheckbox.checked = checked;
      }
    };

    const setLayerVisible = (layer, visible) => {
      if (!layer) {
        return;
      }
      if (visible) {
        if (!map.hasLayer(layer)) {
          layer.addTo(map);
        }
      } else if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    };

    const genCategoryLegend = L.control({ position: "topright" });
    genCategoryLegend.onAdd = () => {
      const div = L.DomUtil.create("div", "gen-category-legend");
      genLegendElement = div;
      const title = L.DomUtil.create("div", "legend-title", div);
      title.textContent = "Generator Categories";

      const enableAllRow = L.DomUtil.create("label", "legend-row", div);
      categoryEnableAllCheckbox = L.DomUtil.create("input", "legend-checkbox", enableAllRow);
      categoryEnableAllCheckbox.type = "checkbox";
      categoryEnableAllCheckbox.checked = true;
      const enableAllText = L.DomUtil.create("span", "", enableAllRow);
      enableAllText.textContent = "Enable All";

      categoryCheckboxes = [];

      uniqueCategories.forEach((category) => {
        const row = L.DomUtil.create("label", "legend-row", div);
        const checkbox = L.DomUtil.create("input", "legend-checkbox", row);
        checkbox.type = "checkbox";
        checkbox.checked = true;
        categoryCheckboxes.push(checkbox);

        const dot = L.DomUtil.create("span", "legend-dot", row);
        dot.style.background = categoryColor[category] || "#777777";

        const text = L.DomUtil.create("span", "", row);
        text.textContent = category;

        checkbox.addEventListener("change", () => {
          applyCategoryVisibility(category, checkbox.checked);
          if (categoryEnableAllCheckbox) {
            categoryEnableAllCheckbox.checked = categoryCheckboxes.every((cb) => cb.checked);
          }
        });
      });

      categoryEnableAllCheckbox.addEventListener("change", () => {
        categoryCheckboxes.forEach((checkbox, index) => {
          checkbox.checked = categoryEnableAllCheckbox.checked;
          const category = uniqueCategories[index];
          applyCategoryVisibility(category, checkbox.checked);
        });
      });

      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };

    genCategoryLegend.addTo(map);

    const busTypeLegend = L.control({ position: "topright" });
    busTypeLegend.onAdd = () => {
      const div = L.DomUtil.create("div", "bus-type-legend");
      busLegendElement = div;
      const title = L.DomUtil.create("div", "legend-title", div);
      title.textContent = "Buses";

      const enableAllRow = L.DomUtil.create("label", "legend-row", div);
      busTypeEnableAllCheckbox = L.DomUtil.create("input", "legend-checkbox", enableAllRow);
      busTypeEnableAllCheckbox.type = "checkbox";
      busTypeEnableAllCheckbox.checked = true;
      const enableAllText = L.DomUtil.create("span", "", enableAllRow);
      enableAllText.textContent = "Enable All";

      busTypeCheckboxes = [];

      uniqueBusTypes.forEach((busType) => {
        const row = L.DomUtil.create("label", "legend-row", div);
        const checkbox = L.DomUtil.create("input", "legend-checkbox", row);
        checkbox.type = "checkbox";
        checkbox.checked = true;
        busTypeCheckboxes.push(checkbox);

        const square = L.DomUtil.create("span", "legend-square", row);
        square.style.background = busTypeColor[busType] || "#000000";

        const text = L.DomUtil.create("span", "", row);
        text.textContent = busType;

        checkbox.addEventListener("change", () => {
          applyBusTypeVisibility(busType, checkbox.checked);
          if (busTypeEnableAllCheckbox) {
            busTypeEnableAllCheckbox.checked = busTypeCheckboxes.every((cb) => cb.checked);
          }
        });
      });

      busTypeEnableAllCheckbox.addEventListener("change", () => {
        busTypeCheckboxes.forEach((checkbox, index) => {
          checkbox.checked = busTypeEnableAllCheckbox.checked;
          const busType = uniqueBusTypes[index];
          applyBusTypeVisibility(busType, checkbox.checked);
        });
      });

      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };

    busTypeLegend.addTo(map);

    const setViewMode = (mode) => {
      const isContingency = mode === "contingency";
      const isBaseCase = mode === "baseCase";
      currentViewMode = mode;

      setTheme((isContingency || isBaseCase) ? "dark" : "light");

      // Keep the overlays in a deterministic state by mode.
      setLayerVisible(linesLayer, true);
      setLayerVisible(areasLayer, !isContingency && !isBaseCase);
      setLayerVisible(genConnLayer, !isContingency && !isBaseCase);

      // Keep generators visible in both modes; contingency starts with purple generator markers enabled.
      setAllGeneratorCategories(true);
      setAllBusTypes(true);

      // Contingency/base case mode uses uniform purple generators; default restores category colors.
      setGeneratorMarkerColors(isContingency);

      if (genLegendElement) {
        genLegendElement.style.display = (isContingency || isBaseCase) ? "none" : "block";
      }
      if (busLegendElement) {
        busLegendElement.style.display = (isContingency || isBaseCase) ? "none" : "block";
      }
      if (contingencyControlContainer) {
        contingencyControlContainer.style.display = isContingency ? "block" : "none";
      }
      if (baseCaseControlContainer) {
        baseCaseControlContainer.style.display = isBaseCase ? "block" : "none";
      }

      refreshMetricButtonsState();
      refreshLineColorLegend();
      refreshLineHighlight();
      refreshBusColors();
      refreshGeneratorColors();
      refreshOpenLinePopups();
      refreshOpenBusPopups();
      refreshOpenGeneratorPopups();

      setOverlayLegendEntryVisible("Generator Connections", !isContingency && !isBaseCase);
      setOverlayLegendEntryVisible("Buses", isContingency || isBaseCase);
      setOverlayLegendEntryVisible("Generators", isContingency || isBaseCase);

      const defaultTab = document.getElementById("view-mode-default");
      const baseCaseTab = document.getElementById("view-mode-basecase");
      const contingencyTab = document.getElementById("view-mode-contingency");
      if (defaultTab) {
        defaultTab.classList.toggle("active", mode === "default");
      }
      if (baseCaseTab) {
        baseCaseTab.classList.toggle("active", isBaseCase);
      }
      if (contingencyTab) {
        contingencyTab.classList.toggle("active", isContingency);
      }
    };

    const ViewModeControl = L.Control.extend({
      options: { position: "topleft" },
      onAdd() {
        const container = L.DomUtil.create("div", "view-mode-tabs leaflet-bar");
        container.id = "view-mode-tabs";
        const defaultBtn = L.DomUtil.create("button", "view-mode-tab active", container);
        defaultBtn.id = "view-mode-default";
        defaultBtn.type = "button";
        defaultBtn.textContent = "Default";

        const baseCaseBtn = L.DomUtil.create("button", "view-mode-tab", container);
        baseCaseBtn.id = "view-mode-basecase";
        baseCaseBtn.type = "button";
        baseCaseBtn.textContent = "Base Case";

        const contingencyBtn = L.DomUtil.create("button", "view-mode-tab", container);
        contingencyBtn.id = "view-mode-contingency";
        contingencyBtn.type = "button";
        contingencyBtn.textContent = "Contingency Analysis";

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        defaultBtn.addEventListener("click", () => setViewMode("default"));
        baseCaseBtn.addEventListener("click", () => setViewMode("baseCase"));
        contingencyBtn.addEventListener("click", () => setViewMode("contingency"));

        return container;
      }
    });

    map.addControl(new ViewModeControl());

    const tabsContainer = document.getElementById("view-mode-tabs");
    if (tabsContainer) {
      map.getContainer().appendChild(tabsContainer);
    }

    const allLayers = L.featureGroup([linesLayer, busesLayer, gensLayer]);
    areasLayer.eachLayer((layer) => layer.bringToBack());

    try {
      map.fitBounds(allLayers.getBounds().pad(0.1));
    } catch (_error) {
      // Keep fallback center/zoom.
    }

    setViewMode("default");
  };

  initializeMap().catch((error) => {
    console.error(error);

    if (warning) {
      warning.style.display = "block";
      warning.textContent = `Map initialization failed: ${error.message}`;
    }
  });
})();
