(() => {
  const config = window.RTS_MAP_CONFIG || {};
  const geojsonBasePath = config.geojsonBasePath || "./gis";
  const fallbackCenter = Array.isArray(config.initialCenter) ? config.initialCenter : [39.5, -98.35];
  const fallbackZoom = Number.isFinite(config.initialZoom) ? config.initialZoom : 6;

  const map = L.map("map", {
    zoomControl: true,
    zoomDelta: 0.25,
    zoomSnap: 0.25,
    wheelPxPerZoomLevel: 180,
    wheelDebounceTime: 70
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
  let gensLayer = null;
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
  let tempCondMetricButton = null;
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
  let bcTempCondMetricButton = null;
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
  let baseCasePlotPanelRef = null;
  let contingencyDataPanelRef = null;
  let contingencyPlotPanelRef = null;
  let flowAnimationButtons = [];
  let flowAnimationLayer = null;
  let flowAnimationActors = [];
  let flowAnimationFrameId = 0;
  let flowAnimationLastFrameTs = 0;
  let isFlowAnimationActive = false;
  let violationGlowLayer = null;
  let violationGlowButton = null;
  let isViolationGlowActive = false;
  let violationGlowSummaryRender = null;

  // ── Simulation (annual conductor temperature animation) ────────────────
  let simulationControlContainer = null;
  let selectedSimulationSeason = "summer";
  let simulationTempByUid = {};       // uid -> current frame's °C
  let simulationRFactorByUid = {};    // uid -> current frame's R multiplier
  let simulationFrameIndex = 0;
  let simulationIsRunning = false;
  let simulationFrameId = 0;
  let simulationLastTickTs = 0;
  let simulationFps = 24;
  let simulationManifestBySeason = new Map(); // season -> manifest object
  let simulationTimestampElement = null;
  let simulationFrameSlider = null;
  let simulationPlayPauseButton = null;
  let simulationFrameLabelElement = null;
  let simulationScope = "year";       // "year" | "month"
  let simulationSelectedMonth = 0;    // 0 = January … 11 = December
  let simulationMonthSelect = null;
  let simulationMonthLabel = null;

  // Forward-declared holder so module-scope simulation functions can refresh
  // hover popups (the actual implementation is created inside initializeMap).
  let refreshOpenLinePopupsImpl = () => {};
  let plotlyLoaderPromise = null;
  const flowAngleEpsilonDeg = 1e-5;
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

  // Color lines by stress (|Pij|/RateA, 0–150 %) when metric is lineFlow,
  // so colors reflect actual loading rather than raw MW magnitude.
  const lineFlowStressColor = (row) => {
    const p = Math.abs(Number(row && row["Pij(MW)"]));
    const rate = Number(row && row.RateA);
    if (!Number.isFinite(p) || !Number.isFinite(rate) || rate <= 0) {
      return null;
    }
    return colorForMetricValue(p / rate * 100, 0, 150, "loading");
  };

  const lineStyleForFeature = (feature) => {
    const uid = String((feature && feature.properties && feature.properties.UID) || "");
    if (currentViewMode === "contingency" && activeContingencyConverged && (activeLineMetric === "loading" || activeLineMetric === "lineFlow" || activeLineMetric === "tempCond")) {
      const value = getMetricValueForUid(uid, activeLineMetric);
      if (Number.isFinite(value)) {
        let color;
        if (activeLineMetric === "lineFlow") {
          color = lineFlowStressColor(activeFlowRowsByUid[uid]);
        }
        if (!color) {
          const { min, max } = getMetricRange(activeLineMetric);
          color = colorForMetricValue(value, min, max, activeLineMetric);
        }
        return {
          color,
          weight: 3.2,
          opacity: 0.95,
          dashArray: ""
        };
      }
    }

    if (currentViewMode === "baseCase" && (activeBaseCaseLineMetric === "loading" || activeBaseCaseLineMetric === "lineFlow" || activeBaseCaseLineMetric === "tempCond")) {
      const row = baseCaseFlowRowsByUid[uid];
      const value = getMetricValueForRow(row, activeBaseCaseLineMetric);
      if (Number.isFinite(value)) {
        let color;
        if (activeBaseCaseLineMetric === "lineFlow") {
          color = lineFlowStressColor(row);
        }
        if (!color) {
          let min;
          let max;
          if (activeBaseCaseLineMetric === "loading") {
            min = 0;
            max = 150;
          } else if (activeBaseCaseLineMetric === "tempCond") {
            min = 25;
            max = 125;
          } else {
            const sourceRows = Object.values(baseCaseFlowRowsByUid);
            const values = sourceRows.map((r) => getMetricValueForRow(r, activeBaseCaseLineMetric)).filter((v) => Number.isFinite(v));
            min = values.length ? Math.floor(Math.min(...values)) : 0;
            max = values.length ? Math.ceil(Math.max(...values)) : 1;
          }
          color = colorForMetricValue(value, min, max, activeBaseCaseLineMetric);
        }
        return {
          color,
          weight: 3.2,
          opacity: 0.95,
          dashArray: ""
        };
      }
    }

    if (currentViewMode === "simulation") {
      const value = Number(simulationTempByUid[uid]);
      if (Number.isFinite(value)) {
        return {
          color: colorForMetricValue(value, 25, 125, "tempCond"),
          weight: 3.2,
          opacity: 0.95,
          dashArray: ""
        };
      }
      return defaultLineStyle;
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
    refreshViolationGlow();
    if (violationGlowSummaryRender) {
      violationGlowSummaryRender();
    }
  };

  const isViolationTrue = (value) =>
    String(value || "").trim().toLowerCase() === "true";

  // Counts violations across line, bus, and generator results for the
  // currently active contingency.
  const countActiveViolations = () => {
    let lines = 0;
    let buses = 0;
    let gens = 0;
    Object.values(activeFlowRowsByUid).forEach((r) => {
      if (r && isViolationTrue(r.Violation)) lines += 1;
    });
    Object.values(activeBusRowsByBusId).forEach((r) => {
      if (r && isViolationTrue(r.Violation)) buses += 1;
    });
    Object.values(activeGenRowsByBusAndMachine).forEach((r) => {
      if (r && isViolationTrue(r.Violation)) gens += 1;
    });
    return { lines, buses, gens, total: lines + buses + gens };
  };

  // Draws a yellow halo beneath each branch / bus / generator whose
  // contingency row has Violation === True. The button only applies in
  // contingency mode.
  const refreshViolationGlow = () => {
    if (violationGlowLayer) {
      violationGlowLayer.clearLayers();
    }

    const shouldShow = isViolationGlowActive
      && currentViewMode === "contingency"
      && selectedContingencyUid
      && activeContingencyConverged
      && linesLayer;

    if (!shouldShow) {
      if (violationGlowLayer && map.hasLayer(violationGlowLayer)) {
        map.removeLayer(violationGlowLayer);
      }
      return;
    }

    if (!violationGlowLayer) {
      violationGlowLayer = L.layerGroup();
    }

    // Branches
    linesLayer.eachLayer((layer) => {
      if (!layer || !layer.feature || !layer.getLatLngs) {
        return;
      }
      const uid = String(((layer.feature.properties) || {}).UID || "");
      const row = activeFlowRowsByUid[uid];
      if (!row || !isViolationTrue(row.Violation)) {
        return;
      }
      const latlngs = layer.getLatLngs();
      if (!latlngs || (Array.isArray(latlngs) && latlngs.length === 0)) {
        return;
      }
      const halo = L.polyline(latlngs, {
        color: "#facc15",
        weight: 12,
        opacity: 0.55,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
        className: "violation-glow"
      });
      violationGlowLayer.addLayer(halo);
    });

    // Buses
    if (busesLayer) {
      busesLayer.eachLayer((layer) => {
        if (!layer || !layer.feature || !layer.getLatLng) {
          return;
        }
        const busId = normalizeBusValue(((layer.feature.properties) || {})["Bus ID"]);
        if (!busId) {
          return;
        }
        const row = activeBusRowsByBusId[busId];
        if (!row || !isViolationTrue(row.Violation)) {
          return;
        }
        const halo = L.circleMarker(layer.getLatLng(), {
          radius: 12,
          color: "#facc15",
          weight: 0,
          fillColor: "#facc15",
          fillOpacity: 0.55,
          interactive: false,
          className: "violation-glow"
        });
        violationGlowLayer.addLayer(halo);
      });
    }

    // Generators
    if (gensLayer) {
      gensLayer.eachLayer((layer) => {
        if (!layer || !layer.feature || !layer.getLatLng) {
          return;
        }
        const props = (layer.feature && layer.feature.properties) || {};
        const busId = normalizeBusValue(props["Bus ID"]);
        const machineId = normalizeMachineValue(props["Gen ID"] ?? props.MachineID);
        if (!busId || !machineId) {
          return;
        }
        const row = activeGenRowsByBusAndMachine[genBusMachineKey(busId, machineId)];
        if (!row || !isViolationTrue(row.Violation)) {
          return;
        }
        const halo = L.circleMarker(layer.getLatLng(), {
          radius: 11,
          color: "#facc15",
          weight: 0,
          fillColor: "#facc15",
          fillOpacity: 0.55,
          interactive: false,
          className: "violation-glow"
        });
        violationGlowLayer.addLayer(halo);
      });
    }

    if (!map.hasLayer(violationGlowLayer)) {
      violationGlowLayer.addTo(map);
    }
    // Keep the glow under the regular markers/lines so click/hover still works.
    if (violationGlowLayer.eachLayer) {
      violationGlowLayer.eachLayer((l) => {
        if (l && l.bringToBack) {
          l.bringToBack();
        }
      });
    }
  };

  const getActiveLineRowByUidForFlow = (uid) => {
    if (currentViewMode === "contingency") {
      return activeFlowRowsByUid[uid] || null;
    }
    if (currentViewMode === "baseCase") {
      return baseCaseFlowRowsByUid[uid] || null;
    }
    return null;
  };

  const getBusAngleForFlow = (busId) => {
    if (!busId) {
      return Number.NaN;
    }

    if (currentViewMode === "contingency") {
      const row = activeBusRowsByBusId[busId];
      return row ? Number(row["Angle(deg)"]) : Number.NaN;
    }

    if (currentViewMode === "baseCase") {
      const row = baseCaseBusRowsByBusId[busId];
      return row ? Number(row["Angle(deg)"]) : Number.NaN;
    }

    return Number.NaN;
  };

  const getLineLatLngPath = (layer) => {
    if (!layer || !layer.getLatLngs) {
      return [];
    }

    const latlngs = layer.getLatLngs();
    if (!Array.isArray(latlngs) || !latlngs.length) {
      return [];
    }

    if (Array.isArray(latlngs[0])) {
      return latlngs[0] || [];
    }

    return latlngs;
  };

  const buildPathMetrics = (latlngs) => {
    const cumulative = [0];
    let total = 0;

    for (let i = 1; i < latlngs.length; i += 1) {
      const segment = map.distance(latlngs[i - 1], latlngs[i]);
      total += Number.isFinite(segment) ? segment : 0;
      cumulative.push(total);
    }

    return { cumulative, total };
  };

  const buildPathPixelLength = (latlngs) => {
    if (!Array.isArray(latlngs) || latlngs.length < 2) {
      return 0;
    }

    let total = 0;
    for (let i = 1; i < latlngs.length; i += 1) {
      const a = map.latLngToLayerPoint(latlngs[i - 1]);
      const b = map.latLngToLayerPoint(latlngs[i]);
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return total;
  };

  const flowArrowVisualByZoom = () => {
    const z = Number(map.getZoom()) || 6;
    const size = Math.max(14, Math.min(34, Math.round(14 + ((z - 6) * 2.2))));
    return { size };
  };

  const interpolateOnPath = (latlngs, cumulative, total, progress) => {
    if (!latlngs.length) {
      return null;
    }
    if (latlngs.length === 1 || total <= 0) {
      return {
        latlng: latlngs[0],
        bearingDeg: 0
      };
    }

    const bounded = Math.max(0, Math.min(1, progress));
    const target = bounded * total;

    let segmentIndex = 0;
    for (let i = 0; i < cumulative.length - 1; i += 1) {
      if (target >= cumulative[i] && target <= cumulative[i + 1]) {
        segmentIndex = i;
        break;
      }
    }

    const a = latlngs[segmentIndex];
    const b = latlngs[Math.min(segmentIndex + 1, latlngs.length - 1)];
    const segStart = cumulative[segmentIndex];
    const segEnd = cumulative[Math.min(segmentIndex + 1, cumulative.length - 1)];
    const segLen = Math.max(0.0001, segEnd - segStart);
    const t = Math.max(0, Math.min(1, (target - segStart) / segLen));

    const lat = a.lat + (b.lat - a.lat) * t;
    const lng = a.lng + (b.lng - a.lng) * t;
    // Compute visual heading in screen space so arrows always point along motion.
    const pa = map.latLngToLayerPoint(a);
    const pb = map.latLngToLayerPoint(b);
    const bearingDeg = Math.atan2(pb.y - pa.y, pb.x - pa.x) * (180 / Math.PI);

    return {
      latlng: L.latLng(lat, lng),
      bearingDeg
    };
  };

  const clearFlowAnimationActors = () => {
    flowAnimationActors.forEach((actor) => {
      if (actor.marker && flowAnimationLayer && flowAnimationLayer.hasLayer(actor.marker)) {
        flowAnimationLayer.removeLayer(actor.marker);
      }
    });
    flowAnimationActors = [];
  };

  const stopFlowAnimationLoop = () => {
    if (flowAnimationFrameId) {
      window.cancelAnimationFrame(flowAnimationFrameId);
      flowAnimationFrameId = 0;
    }
    flowAnimationLastFrameTs = 0;
  };

  const hasFlowAnimationData = () => {
    if (currentViewMode === "baseCase") {
      return Object.keys(baseCaseBusRowsByBusId).length > 0;
    }

    if (currentViewMode === "contingency") {
      return !!selectedContingencyUid && activeContingencyConverged && Object.keys(activeBusRowsByBusId).length > 0;
    }

    return false;
  };

  const rebuildFlowAnimationActors = () => {
    if (!linesLayer || !hasFlowAnimationData()) {
      clearFlowAnimationActors();
      return;
    }

    if (!flowAnimationLayer) {
      flowAnimationLayer = L.layerGroup().addTo(map);
    }

    clearFlowAnimationActors();

    linesLayer.eachLayer((lineLayer) => {
      const feature = (lineLayer && lineLayer.feature) || {};
      const props = feature.properties || {};
      const uid = String(props.UID || "").trim();

      // In contingency mode, the selected contingency line is outaged/disconnected.
      if (currentViewMode === "contingency" && selectedContingencyUid && uid === selectedContingencyUid) {
        return;
      }

      const fromBus = normalizeBusValue(props["From Bus"]);
      const toBus = normalizeBusValue(props["To Bus"]);

      const fromAngle = getBusAngleForFlow(fromBus);
      const toAngle = getBusAngleForFlow(toBus);
      if (!Number.isFinite(fromAngle) || !Number.isFinite(toAngle)) {
        return;
      }

      if (Math.abs(fromAngle - toAngle) <= flowAngleEpsilonDeg) {
        return;
      }

      const basePath = getLineLatLngPath(lineLayer);
      if (!basePath.length || basePath.length < 2) {
        return;
      }

      // Real-power direction is from higher phase angle bus to lower phase angle bus.
      const directedPath = fromAngle > toAngle ? basePath.slice() : basePath.slice().reverse();
      const { cumulative, total } = buildPathMetrics(directedPath);
      if (!Number.isFinite(total) || total < 20) {
        return;
      }

      const row = getActiveLineRowByUidForFlow(uid);
      const absMw = Math.abs(Number(row && row["Pij(MW)"]));
      const speed = Number.isFinite(absMw)
        ? Math.min(1.15, 0.22 + (absMw / 1400))
        : 0.28;
      const arrowColor = (lineLayer && lineLayer.options && lineLayer.options.color)
        || (lineStyleForFeature(feature) || {}).color
        || "#06b6d4";

      const { size: arrowSize } = flowArrowVisualByZoom();

      const icon = L.divIcon({
        className: "flow-arrow-marker",
        html: `<span class="flow-arrow-glyph" style="width:${arrowSize}px;height:${arrowSize}px;font-size:${arrowSize}px;line-height:${arrowSize}px;color:${arrowColor};">&gt;</span>`,
        iconSize: [arrowSize, arrowSize],
        iconAnchor: [Math.round(arrowSize / 2), Math.round(arrowSize / 2)]
      });

      // Place multiple arrows on each line so the flow direction is visible everywhere.
      const pixelLength = buildPathPixelLength(directedPath);
      const markerCount = Math.max(2, Math.min(20, Math.floor(pixelLength / 120) + 1));
      const seed = (hashString(uid) % 1000) / 1000;

      for (let i = 0; i < markerCount; i += 1) {
        const marker = L.marker(directedPath[0], {
          icon,
          interactive: false,
          keyboard: false,
          pane: "markerPane"
        }).addTo(flowAnimationLayer);

        const seededProgress = (seed + (i / markerCount)) % 1;

        flowAnimationActors.push({
          marker,
          directedPath,
          cumulative,
          total,
          progress: seededProgress,
          speed,
          glyphEl: null
        });
      }
    });
  };

  const animateFlowFrame = (timestamp) => {
    if (!isFlowAnimationActive) {
      stopFlowAnimationLoop();
      return;
    }

    if (!flowAnimationActors.length) {
      flowAnimationFrameId = window.requestAnimationFrame(animateFlowFrame);
      return;
    }

    if (!flowAnimationLastFrameTs) {
      flowAnimationLastFrameTs = timestamp;
    }

    const dt = Math.min(0.16, Math.max(0, (timestamp - flowAnimationLastFrameTs) / 1000));
    flowAnimationLastFrameTs = timestamp;

    flowAnimationActors.forEach((actor) => {
      actor.progress = (actor.progress + (actor.speed * dt)) % 1;
      const sample = interpolateOnPath(actor.directedPath, actor.cumulative, actor.total, actor.progress);
      if (!sample) {
        return;
      }

      actor.marker.setLatLng(sample.latlng);

      if (!actor.glyphEl) {
        const markerEl = actor.marker.getElement();
        actor.glyphEl = markerEl ? markerEl.querySelector(".flow-arrow-glyph") : null;
      }

      if (actor.glyphEl) {
        actor.glyphEl.style.transform = `rotate(${sample.bearingDeg}deg)`;
      }
    });

    flowAnimationFrameId = window.requestAnimationFrame(animateFlowFrame);
  };

  const stopFlowAnimation = () => {
    isFlowAnimationActive = false;
    stopFlowAnimationLoop();
    clearFlowAnimationActors();

    flowAnimationButtons.forEach((btn) => btn.classList.remove("active"));

    if (flowAnimationLayer && map.hasLayer(flowAnimationLayer)) {
      map.removeLayer(flowAnimationLayer);
    }
  };

  const startFlowAnimation = () => {
    if (!hasFlowAnimationData()) {
      return;
    }

    isFlowAnimationActive = true;
    if (!flowAnimationLayer) {
      flowAnimationLayer = L.layerGroup().addTo(map);
    } else if (!map.hasLayer(flowAnimationLayer)) {
      flowAnimationLayer.addTo(map);
    }

    rebuildFlowAnimationActors();

    flowAnimationButtons.forEach((btn) => btn.classList.add("active"));

    if (!flowAnimationFrameId) {
      flowAnimationFrameId = window.requestAnimationFrame(animateFlowFrame);
    }
  };

  const refreshFlowAnimationControlState = () => {
    const showControl = currentViewMode === "baseCase" || currentViewMode === "contingency";

    if (!showControl) {
      if (isFlowAnimationActive) {
        stopFlowAnimation();
      }
      return;
    }

    const enabled = hasFlowAnimationData();
    flowAnimationButtons.forEach((btn) => {
      btn.disabled = !enabled;
      btn.classList.toggle("active", isFlowAnimationActive);
    });

    if (!enabled && isFlowAnimationActive) {
      stopFlowAnimation();
      return;
    }

    if (enabled && isFlowAnimationActive) {
      startFlowAnimation();
    }
  };

  const appendFlowAnimationButton = (parent) => {
    const btn = L.DomUtil.create("button", "flow-animation-btn", parent);
    btn.type = "button";
    btn.textContent = "Animated Flow";
    btn.title = "Animate line flow from higher to lower bus angle";
    btn.addEventListener("click", () => {
      if (btn.disabled) {
        return;
      }
      if (isFlowAnimationActive) {
        stopFlowAnimation();
      } else {
        startFlowAnimation();
      }
      refreshFlowAnimationControlState();
    });
    flowAnimationButtons.push(btn);
    return btn;
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

    if (metric === "tempCond") {
      return Number(row[TEMP_COND_COLUMN]);
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
    // Loading and lineFlow always use a fixed 0–150 % scale
    if (metric === "loading" || metric === "lineFlow") {
      return { min: 0, max: 150 };
    }
    // Conductor temperature uses a fixed 25–125 °C scale anchored on the
    // 75 °C ACSR design max (mid-band) and 105–125 °C overload region (red).
    if (metric === "tempCond") {
      return { min: 25, max: 125 };
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

  // Julia-aligned color stops: each entry is [normalized_position_in_[0,1], [r,g,b]].
  // Voltage stops are anchored as if VMIN=0.90, VMID=1.00, VMAX=1.10 (Julia
  // DEFAULT_VOLTAGE_MAP_RANGE).  Loading stops are anchored at 0/60/80/100/150 %.
  const VOLTAGE_COLOR_STOPS = [
    [0.00, [  0,  50, 200]],   // 0.90 pu — deep blue
    [0.15, [ 30, 160, 255]],   // 0.93 pu — sky blue
    [0.35, [  0, 210, 200]],   // 0.97 pu — cyan/teal
    [0.50, [ 40, 200,  60]],   // 1.00 pu — green (nominal)
    [0.65, [160, 210,   0]],   // 1.03 pu — yellow-green
    [0.85, [255, 160,   0]],   // 1.07 pu — orange
    [1.00, [210,   0,   0]]    // 1.10 pu — red
  ];
  const LOADING_COLOR_STOPS = [
    [0.0000, [ 30,  80, 200]], //   0 % — blue
    [0.2000, [  0, 170, 220]], //  30 % — cyan
    [0.3333, [  0, 180,  60]], //  50 % — green
    [0.4667, [180, 210,   0]], //  70 % — yellow-green
    [0.5667, [255, 220,   0]], //  85 % — yellow
    [0.6333, [255, 165,   0]], //  95 % — orange
    [0.7000, [240,  90,   0]], // 105 % — red-orange
    [0.8000, [210,   0,   0]], // 120 % — red
    [1.0000, [120,   0,   0]]  // 150 % — dark red
  ];

  const interpolateColorStops = (t, stops) => {
    const tc = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
    if (tc <= stops[0][0]) {
      const [, c] = stops[0];
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
    if (tc >= stops[stops.length - 1][0]) {
      const [, c] = stops[stops.length - 1];
      return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
    }
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (tc >= t0 && tc <= t1) {
        const f = (tc - t0) / (t1 - t0);
        const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
        const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
        const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
        return `rgb(${r}, ${g}, ${b})`;
      }
    }
    const [, c] = stops[stops.length - 1];
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  };

  const colorStopsForMetric = (metric) =>
    metric === "busVoltage" ? VOLTAGE_COLOR_STOPS : LOADING_COLOR_STOPS;

  const colorForMetricValue = (value, min, max, metric) => {
    let t = 0;
    if (Number.isFinite(value) && Number.isFinite(min) && Number.isFinite(max) && max !== min) {
      t = (value - min) / (max - min);
      t = Math.max(0, Math.min(1, t));
    }
    return interpolateColorStops(t, colorStopsForMetric(metric));
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

    // Merge conductor temperature (real weather) when available
    try {
      const tempMap = await loadN1TempMap(season);
      if (tempMap && tempMap.size) {
        rows.forEach((r) => {
          const key = `${r.__contingency}|${r.__fromBus}|${r.__toBus}|${r.__ckt}`;
          const v = tempMap.get(key);
          if (v != null) {
            r[TEMP_COND_COLUMN] = String(v);
          }
        });
      }
    } catch (_e) { /* leave rows untouched */ }

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

    // Merge conductor temperature (real weather) when available
    try {
      const tempMap = await loadBaseCaseTempMap(season);
      if (tempMap && tempMap.size) {
        rows.forEach((r) => {
          const key = `${r.__fromBus}|${r.__toBus}|${r.__ckt}`;
          const v = tempMap.get(key);
          if (v != null) {
            r[TEMP_COND_COLUMN] = String(v);
          }
        });
      }
    } catch (_e) { /* leave rows untouched */ }

    baseCaseLineRowsCacheBySeason.set(season, rows);
    return rows;
  };

  // ── Conductor temperature (real weather) ────────────────────────────────
  // Loaders for the *_with_realweather_T.csv companion files. The temperature
  // column is merged into the existing line rows on demand.
  const TEMP_COND_COLUMN = "Tcond_realweather(degC)";
  const baseCaseTempBySeason = new Map();   // season -> Map<from|to|ckt, °C>
  const n1TempBySeason = new Map();         // season -> Map<contingency|from|to|ckt, °C>

  const getBaseCaseTempCsvPath = (season) =>
    season === "summer"
      ? "./ca_results/summer/base_lines_with_realweather_T.csv"
      : "./ca_results/winter/base_lines_with_realweather_T.csv";

  const getN1TempCsvPath = (season) =>
    season === "summer"
      ? "./ca_results/summer/N1_lines_with_realweather_T.csv"
      : "./ca_results/winter/N1_lines_with_realweather_T.csv";

  const fetchTextOrEmpty = async (path) => {
    try {
      const response = await fetch(path, { cache: "no-cache" });
      return response.ok ? await response.text() : "";
    } catch (_error) {
      return "";
    }
  };

  const loadBaseCaseTempMap = async (season) => {
    if (baseCaseTempBySeason.has(season)) {
      return baseCaseTempBySeason.get(season);
    }
    const out = new Map();
    const text = await fetchTextOrEmpty(getBaseCaseTempCsvPath(season));
    if (text) {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length > 1) {
        const header = parseCsvLine(lines[0]);
        const fIdx = header.indexOf("FromBus#");
        const tIdx = header.indexOf("ToBus#");
        const cIdx = header.indexOf("CKT");
        const kIdx = header.indexOf(TEMP_COND_COLUMN);
        if (fIdx >= 0 && tIdx >= 0 && cIdx >= 0 && kIdx >= 0) {
          for (let i = 1; i < lines.length; i += 1) {
            const cols = parseCsvLine(lines[i]);
            const key = `${normalizeBusValue(cols[fIdx])}|${normalizeBusValue(cols[tIdx])}|${normalizeCktValue(cols[cIdx])}`;
            const value = Number(cols[kIdx]);
            if (Number.isFinite(value)) {
              out.set(key, value);
            }
          }
        }
      }
    }
    baseCaseTempBySeason.set(season, out);
    return out;
  };

  const loadN1TempMap = async (season) => {
    if (n1TempBySeason.has(season)) {
      return n1TempBySeason.get(season);
    }
    const out = new Map();
    const text = await fetchTextOrEmpty(getN1TempCsvPath(season));
    if (text) {
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length > 1) {
        const header = parseCsvLine(lines[0]);
        const contIdx = header.indexOf("Contingency");
        const fIdx = header.indexOf("FromBus#");
        const tIdx = header.indexOf("ToBus#");
        const cIdx = header.indexOf("CKT");
        const kIdx = header.indexOf(TEMP_COND_COLUMN);
        if (contIdx >= 0 && fIdx >= 0 && tIdx >= 0 && cIdx >= 0 && kIdx >= 0) {
          for (let i = 1; i < lines.length; i += 1) {
            const cols = parseCsvLine(lines[i]);
            const key = `${String(cols[contIdx] || "").trim()}|${normalizeBusValue(cols[fIdx])}|${normalizeBusValue(cols[tIdx])}|${normalizeCktValue(cols[cIdx])}`;
            const value = Number(cols[kIdx]);
            if (Number.isFinite(value)) {
              out.set(key, value);
            }
          }
        }
      }
    }
    n1TempBySeason.set(season, out);
    return out;
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
      return "Active Flow ij (% of Rating)";
    }
    if (metric === "tempCond") {
      return "Conductor Temperature (°C)";
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

  const metricGradient = (metric /* , max */) => {
    const stops = colorStopsForMetric(metric);
    const cssStops = stops
      .map(([t, c]) => `rgb(${c[0]}, ${c[1]}, ${c[2]}) ${(t * 100).toFixed(2)}%`)
      .join(", ");
    return `linear-gradient(to right, ${cssStops})`;
  };

  const legendSectionHtml = (metric) => {
    const { min, max } = getMetricRange(metric);
    const gradient = metricGradient(metric, max);
    return `
      <div class="line-color-legend-section">
        <div class="line-color-legend-title">${esc(metricLabel(metric))}</div>
        <div class="line-color-legend-scale-wrap">
          <div class="line-color-legend-min">${esc(formatLegendLimit(min, metric))}</div>
          <div class="line-color-legend-gradient" style="background:${gradient};"></div>
          <div class="line-color-legend-max">${esc(formatLegendLimit(max, metric))}</div>
        </div>
      </div>
    `;
  };

  const legendSectionHtmlForRows = (metric, rows) => {
    // Loading and lineFlow use a fixed 0–150 % scale (lineFlow is colored by
    // |Pij|/RateA stress ratio, not raw MW magnitude).
    if (metric === "loading" || metric === "lineFlow") {
      const gradient = metricGradient(metric, 150);
      return `
      <div class="line-color-legend-section">
        <div class="line-color-legend-title">${esc(metricLabel(metric))}</div>
        <div class="line-color-legend-scale-wrap">
          <div class="line-color-legend-min">0</div>
          <div class="line-color-legend-gradient" style="background:${gradient};"></div>
          <div class="line-color-legend-max">150</div>
        </div>
      </div>
    `;
    }
    if (metric === "tempCond") {
      const gradient = metricGradient(metric, 125);
      return `
      <div class="line-color-legend-section">
        <div class="line-color-legend-title">${esc(metricLabel(metric))}</div>
        <div class="line-color-legend-scale-wrap">
          <div class="line-color-legend-min">25</div>
          <div class="line-color-legend-gradient" style="background:${gradient};"></div>
          <div class="line-color-legend-max">125</div>
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
          <div class="line-color-legend-min">${esc(formatLegendLimit(min, metric))}</div>
          <div class="line-color-legend-gradient" style="background:${gradient};"></div>
          <div class="line-color-legend-max">${esc(formatLegendLimit(max, metric))}</div>
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

    const shouldShowSimulation = currentViewMode === "simulation";

    const shouldShow = shouldShowContingency || shouldShowBaseCase || shouldShowSimulation;
    lineColorLegendElement.style.display = shouldShow ? "block" : "none";

    if (!shouldShow) {
      return;
    }

    if (shouldShowSimulation) {
      lineColorLegendElement.innerHTML = legendSectionHtml("tempCond");
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

    if (tempCondMetricButton) {
      tempCondMetricButton.disabled = !enabled;
      tempCondMetricButton.classList.toggle("active", activeLineMetric === "tempCond");
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

    if (violationGlowButton) {
      violationGlowButton.disabled = !enabled;
      if (!enabled && isViolationGlowActive) {
        isViolationGlowActive = false;
      }
      violationGlowButton.classList.toggle("active", isViolationGlowActive);
      if (violationGlowSummaryRender) {
        violationGlowSummaryRender();
      }
    }

    const caBtn = createContingencyControl._showDataBtn;
    if (caBtn) {
      caBtn.disabled = !enabled;
    }

    const caPlotBtn = createContingencyControl._plotDataBtn;
    if (caPlotBtn) {
      caPlotBtn.disabled = !enabled;
    }

    // Base case buttons are always enabled when in base case mode
    if (bcLoadingMetricButton) {
      bcLoadingMetricButton.classList.toggle("active", activeBaseCaseLineMetric === "loading");
    }
    if (bcLineFlowMetricButton) {
      bcLineFlowMetricButton.classList.toggle("active", activeBaseCaseLineMetric === "lineFlow");
    }
    if (bcTempCondMetricButton) {
      bcTempCondMetricButton.classList.toggle("active", activeBaseCaseLineMetric === "tempCond");
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

    if (row[TEMP_COND_COLUMN] != null && String(row[TEMP_COND_COLUMN]).length > 0) {
      detailRows.splice(detailRows.length - 1, 0,
        `<b>Conductor Temp:</b> ${esc(formatMetric(row[TEMP_COND_COLUMN], "°C"))}`);
    }

    return `<b>${title}</b><br>${detailRows.join("<br>")}`;
  };

  // Tracks contingency names whose power-flow case did NOT converge for a
  // given season. These are the ones that get a warning marker in the
  // contingency dropdown.
  const nonConvergedContingencyNamesBySeason = new Map();

  const loadNonConvergedContingencyNames = async (season) => {
    if (!season) {
      return new Set();
    }
    if (nonConvergedContingencyNamesBySeason.has(season)) {
      return nonConvergedContingencyNamesBySeason.get(season);
    }
    const set = new Set();
    const collect = (rows) => {
      rows.forEach((r) => {
        const converged = String(r.Converged != null ? r.Converged : r.__converged || "").trim().toLowerCase();
        if (converged === "false") {
          const name = String(r.__contingency || "").trim();
          if (name) {
            set.add(name);
          }
        }
      });
    };
    try {
      const [lineRows, busRows, genRows] = await Promise.all([
        readSeasonLineFlowsCsv(season).catch(() => []),
        readSeasonBusCsv(season).catch(() => []),
        readSeasonGenCsv(season).catch(() => [])
      ]);
      collect(lineRows);
      collect(busRows);
      collect(genRows);
    } catch (_e) { /* keep empty set */ }
    nonConvergedContingencyNamesBySeason.set(season, set);
    return set;
  };

  const createContingencyControl = (branchGeo, lineNameByUid, onSelectionChange, onMetricChange, onPlotData) => {
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

        // Custom searchable combobox for the contingency line picker. The
        // search input only appears when the dropdown is opened. We expose a
        // tiny `select`-like API (`.value`, `.options`, `addEventListener`,
        // `.disabled`) so the rest of the control logic stays unchanged.
        const lineCombo = L.DomUtil.create("div", "contingency-combo", dropdownWrap);
        const lineComboTrigger = L.DomUtil.create("button", "contingency-select contingency-combo-trigger", lineCombo);
        lineComboTrigger.type = "button";
        const lineComboTriggerLabel = L.DomUtil.create("span", "contingency-combo-trigger-label", lineComboTrigger);
        lineComboTriggerLabel.textContent = "Select line";
        const lineComboCaret = L.DomUtil.create("span", "contingency-combo-caret", lineComboTrigger);
        lineComboCaret.textContent = "▾";

        const lineComboPanel = L.DomUtil.create("div", "contingency-combo-panel", lineCombo);
        lineComboPanel.style.display = "none";
        L.DomEvent.disableClickPropagation(lineComboPanel);
        L.DomEvent.disableScrollPropagation(lineComboPanel);

        const lineComboSearch = L.DomUtil.create("input", "contingency-search", lineComboPanel);
        lineComboSearch.type = "search";
        lineComboSearch.placeholder = "Search by line, bus #, or circuit…";
        lineComboSearch.autocomplete = "off";
        L.DomEvent.disableClickPropagation(lineComboSearch);

        const lineComboList = L.DomUtil.create("div", "contingency-combo-list", lineComboPanel);
        const lineComboEmpty = L.DomUtil.create("div", "contingency-search-empty", lineComboPanel);
        lineComboEmpty.textContent = "No lines match the search.";
        lineComboEmpty.style.display = "none";

        // Synthetic option model — exposes the same shape as <option>.
        const comboOptions = [];
        const makeOption = (uid, textContent) => {
          const node = L.DomUtil.create("button", "contingency-combo-option", lineComboList);
          node.type = "button";
          node.textContent = textContent;
          const option = {
            value: uid,
            _node: node,
            _hidden: false,
            get textContent() { return node.textContent; },
            set textContent(v) { node.textContent = v; },
            get hidden() { return option._hidden; },
            set hidden(v) {
              option._hidden = !!v;
              node.style.display = v ? "none" : "";
            },
            classList: node.classList
          };
          node.addEventListener("click", () => {
            comboSetValue(uid, true);
            closeLineCombo();
          });
          comboOptions.push(option);
          return option;
        };

        // Placeholder option (kept for parity with the old <select>; not rendered).
        const noneOption = {
          value: "",
          _hidden: false,
          textContent: "Select line",
          get hidden() { return this._hidden; },
          set hidden(v) { this._hidden = !!v; },
          classList: { toggle() {} }
        };
        comboOptions.push(noneOption);

        lineOptions.forEach((uid) => makeOption(uid, uid));

        let comboValue = "";
        const comboListeners = [];
        const comboSetValue = (val, fireChange) => {
          comboValue = val || "";
          const opt = comboOptions.find((o) => o.value === comboValue);
          lineComboTriggerLabel.textContent = opt && opt.value
            ? opt.textContent
            : "Select line";
          if (fireChange) {
            comboListeners.forEach((fn) => fn());
          }
        };

        const select = {
          get value() { return comboValue; },
          set value(v) { comboSetValue(v, false); },
          get options() { return comboOptions; },
          get disabled() { return lineComboTrigger.disabled; },
          set disabled(v) { lineComboTrigger.disabled = !!v; },
          addEventListener(evt, fn) {
            if (evt === "change") {
              comboListeners.push(fn);
            }
          }
        };

        const applyComboSearchFilter = () => {
          const query = String(lineComboSearch.value || "").trim().toLowerCase();
          let visibleCount = 0;
          comboOptions.forEach((option) => {
            if (!option.value) {
              return;
            }
            const baseLabel = lineNameByUid[option.value] || option.value;
            const haystack = `${option.value} ${baseLabel}`.toLowerCase();
            const match = !query || haystack.includes(query);
            option.hidden = !match;
            if (match) visibleCount += 1;
          });
          lineComboEmpty.style.display = (query && visibleCount === 0) ? "block" : "none";
        };

        const openLineCombo = () => {
          lineComboPanel.style.display = "block";
          lineComboTrigger.classList.add("open");
          lineComboSearch.value = "";
          applyComboSearchFilter();
          // Defer focus until after the panel is laid out.
          window.setTimeout(() => lineComboSearch.focus(), 0);
        };

        const closeLineCombo = () => {
          lineComboPanel.style.display = "none";
          lineComboTrigger.classList.remove("open");
        };

        lineComboTrigger.addEventListener("click", (e) => {
          e.preventDefault();
          if (lineComboPanel.style.display === "none") {
            openLineCombo();
          } else {
            closeLineCombo();
          }
        });
        lineComboSearch.addEventListener("input", applyComboSearchFilter);
        // Click-outside closes the panel.
        document.addEventListener("mousedown", (e) => {
          if (!lineCombo.contains(e.target)) {
            closeLineCombo();
          }
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

        tempCondMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        tempCondMetricButton.type = "button";
        tempCondMetricButton.textContent = "Conductor Temperature";
        tempCondMetricButton.title = "Real-weather IEEE 738 conductor surface temperature";

        busVoltageMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        busVoltageMetricButton.type = "button";
        busVoltageMetricButton.textContent = "Bus Voltages";

        genActiveMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        genActiveMetricButton.type = "button";
        genActiveMetricButton.textContent = "Gen Active Power";

        genReactiveMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        genReactiveMetricButton.type = "button";
        genReactiveMetricButton.textContent = "Gen Reactive Power";

        violationGlowButton = L.DomUtil.create("button", "contingency-metric-btn violation-glow-btn", metricButtonsWrap);
        violationGlowButton.type = "button";
        violationGlowButton.textContent = "Show Violations";
        violationGlowButton.title = "Glow lines, buses, and generators with Violation = True under the selected contingency";
        violationGlowButton.disabled = true;

        // Floating summary panel anchored at the top of the map (under tabs).
        // Created lazily on first activation so it always lives above the map.
        let violationSummaryPanel = null;
        let violationSummaryText = null;

        const ensureViolationSummaryPanel = () => {
          if (violationSummaryPanel) {
            return;
          }
          const host = map.getContainer();
          violationSummaryPanel = document.createElement("div");
          violationSummaryPanel.className = "violation-summary-panel";
          violationSummaryPanel.style.display = "none";
          L.DomEvent.disableClickPropagation(violationSummaryPanel);
          L.DomEvent.disableScrollPropagation(violationSummaryPanel);

          violationSummaryText = document.createElement("div");
          violationSummaryText.className = "violation-summary-panel-text";
          violationSummaryPanel.appendChild(violationSummaryText);

          const closeBtn = document.createElement("button");
          closeBtn.type = "button";
          closeBtn.className = "violation-summary-panel-close";
          closeBtn.setAttribute("aria-label", "Close violations summary");
          closeBtn.textContent = "×";
          closeBtn.addEventListener("click", () => {
            // Closing the window also turns the glow off so state stays in sync.
            isViolationGlowActive = false;
            if (violationGlowButton) {
              violationGlowButton.classList.remove("active");
            }
            refreshViolationGlow();
            renderViolationSummary();
          });
          violationSummaryPanel.appendChild(closeBtn);
          host.appendChild(violationSummaryPanel);
        };

        const renderViolationSummary = () => {
          if (!isViolationGlowActive) {
            if (violationSummaryPanel) {
              violationSummaryPanel.style.display = "none";
            }
            return;
          }
          ensureViolationSummaryPanel();
          const { lines, buses, gens, total } = countActiveViolations();
          if (total === 0) {
            violationSummaryText.textContent = "No violations to show.";
            violationSummaryPanel.classList.add("violation-summary-panel--empty");
          } else {
            const parts = [];
            if (lines) parts.push(`${lines} line${lines === 1 ? "" : "s"}`);
            if (buses) parts.push(`${buses} bus${buses === 1 ? "" : "es"}`);
            if (gens) parts.push(`${gens} generator${gens === 1 ? "" : "s"}`);
            violationSummaryText.textContent = `${total} violation${total === 1 ? "" : "s"} found: ${parts.join(", ")}.`;
            violationSummaryPanel.classList.remove("violation-summary-panel--empty");
          }
          violationSummaryPanel.style.display = "flex";
        };
        violationGlowSummaryRender = renderViolationSummary;

        violationGlowButton.addEventListener("click", () => {
          isViolationGlowActive = !isViolationGlowActive;
          violationGlowButton.classList.toggle("active", isViolationGlowActive);
          refreshViolationGlow();
          renderViolationSummary();
        });

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
          // Build the union of contingency names whose case did NOT converge
          // across any season we have already loaded. Marked options surface
          // the lines whose outage breaks the power flow.
          const nonConvergedUnion = new Set();
          nonConvergedContingencyNamesBySeason.forEach((set) => {
            set.forEach((name) => nonConvergedUnion.add(name));
          });
          Array.from(select.options).forEach((option) => {
            if (!option.value) {
              return;
            }
            const season = contingencySeasonByUid[option.value] || "";
            const baseLabel = lineNameByUid[option.value] || option.value;
            const contName = lineNameByUid[option.value] || option.value;
            const isNonConverged = nonConvergedUnion.has(contName);
            option.textContent = `${isNonConverged ? "⚠ " : ""}${baseLabel}${season ? "" : ""}`;
            option.classList.toggle("contingency-option-violation", isNonConverged);
          });
          // Keep the combobox trigger label in sync with the relabeled option.
          if (comboValue) {
            const opt = comboOptions.find((o) => o.value === comboValue);
            if (opt) {
              lineComboTriggerLabel.textContent = opt.textContent;
            }
          }
        };

        const ensureViolationDataForSeason = (season) => {
          if (!season) {
            return;
          }
          if (nonConvergedContingencyNamesBySeason.has(season)) {
            refreshLineOptionLabels();
            return;
          }
          loadNonConvergedContingencyNames(season).then(() => {
            refreshLineOptionLabels();
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

        // Eagerly load both seasons' violation sets so the dropdown can
        // highlight lines whose outage causes any violation.
        ensureViolationDataForSeason("summer");
        ensureViolationDataForSeason("winter");

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

        tempCondMetricButton.addEventListener("click", () => {
          activeLineMetric = activeLineMetric === "tempCond" ? null : "tempCond";
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

        const actionsCard = L.DomUtil.create("div", "control-actions-card", dropdownWrap);

        const caShowDataBtn = L.DomUtil.create("button", "bc-show-data-btn", actionsCard);
        caShowDataBtn.type = "button";
        caShowDataBtn.textContent = "Show Data";
        caShowDataBtn.disabled = true;
        caShowDataBtn.addEventListener("click", () => {
          if (contingencyDataPanelRef) {
            contingencyDataPanelRef.show();
          }
        });

        const caPlotDataBtn = L.DomUtil.create("button", "bc-plot-data-btn", actionsCard);
        caPlotDataBtn.type = "button";
        caPlotDataBtn.textContent = "Plot Data";
        caPlotDataBtn.disabled = true;
        caPlotDataBtn.addEventListener("click", () => {
          if (typeof onPlotData === "function") {
            onPlotData();
          }
        });

        appendFlowAnimationButton(actionsCard);

        // Expose so applyContingencySelection can toggle enabled state
        createContingencyControl._showDataBtn = caShowDataBtn;
        createContingencyControl._plotDataBtn = caPlotDataBtn;

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

  const createBaseCaseControl = (onSeasonChange, onMetricChange, onPlotData) => {
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

        bcTempCondMetricButton = L.DomUtil.create("button", "contingency-metric-btn", metricButtonsWrap);
        bcTempCondMetricButton.type = "button";
        bcTempCondMetricButton.textContent = "Conductor Temperature";
        bcTempCondMetricButton.title = "Real-weather IEEE 738 conductor surface temperature";

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

        bcTempCondMetricButton.addEventListener("click", () => {
          activeBaseCaseLineMetric = activeBaseCaseLineMetric === "tempCond" ? null : "tempCond";
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

        const actionsCard = L.DomUtil.create("div", "control-actions-card", dropdownWrap);

        const showDataBtn = L.DomUtil.create("button", "bc-show-data-btn", actionsCard);
        showDataBtn.type = "button";
        showDataBtn.textContent = "Show Data";
        showDataBtn.addEventListener("click", () => {
          if (baseCaseDataPanelRef) {
            baseCaseDataPanelRef.show();
          }
        });

        const plotDataBtn = L.DomUtil.create("button", "bc-plot-data-btn", actionsCard);
        plotDataBtn.type = "button";
        plotDataBtn.textContent = "Plot Data";
        plotDataBtn.addEventListener("click", () => {
          if (typeof onPlotData === "function") {
            onPlotData();
          }
        });

        appendFlowAnimationButton(actionsCard);

        refreshMetricButtonsState();
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        return container;
      }
    });

    map.addControl(new BaseCaseControl());
  };

  // ── Simulation: annual conductor temperature animation ─────────────────
  const SIMULATION_TIMESERIES_URL = (season) => `./ca_results/${season}/temperature_timeseries.json`;

  const formatSimulationTimestamp = (date) => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pad = (n) => String(n).padStart(2, "0");
    return `${days[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} — ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
  };

  const stopSimulationLoop = () => {
    simulationIsRunning = false;
    if (simulationFrameId) {
      clearInterval(simulationFrameId);
      simulationFrameId = 0;
    }
    if (simulationPlayPauseButton) {
      simulationPlayPauseButton.textContent = "▶ Run";
      simulationPlayPauseButton.classList.remove("active");
    }
  };

  const getSimulationFrameRange = () => {
    // Returns [startFrame, endFrameInclusive] for the active scope.
    const manifest = simulationManifestBySeason.get(selectedSimulationSeason);
    const count = (manifest && manifest.count) || 0;
    if (count <= 0) return { start: 0, end: 0 };
    if (simulationScope !== "month") {
      return { start: 0, end: count - 1 };
    }
    const startMs = Date.parse(manifest.startIso || "2020-01-01T00:00:00Z");
    const stepMs = (manifest.stepMinutes || 60) * 60 * 1000;
    let start = -1;
    let end = -1;
    for (let i = 0; i < count; i += 1) {
      const m = new Date(startMs + i * stepMs).getUTCMonth();
      if (m === simulationSelectedMonth) {
        if (start < 0) start = i;
        end = i;
      } else if (start >= 0) {
        break;
      }
    }
    if (start < 0) {
      return { start: 0, end: count - 1 };
    }
    return { start, end };
  };

  const updateSimulationSliderBounds = () => {
    if (!simulationFrameSlider) return;
    const { start, end } = getSimulationFrameRange();
    simulationFrameSlider.min = String(start);
    simulationFrameSlider.max = String(end);
  };

  const ensureSimulationDataLoaded = async (season) => {
    if (simulationManifestBySeason.has(season)) {
      return simulationManifestBySeason.get(season);
    }
    const res = await fetch(SIMULATION_TIMESERIES_URL(season));
    if (!res.ok) {
      throw new Error(`Failed to load ${SIMULATION_TIMESERIES_URL(season)}: ${res.status}`);
    }
    const manifest = await res.json();
    simulationManifestBySeason.set(season, manifest);
    if (selectedSimulationSeason === season && currentViewMode === "simulation") {
      const { start, end } = getSimulationFrameRange();
      simulationFrameIndex = Math.min(Math.max(simulationFrameIndex, start), end);
      updateSimulationSliderBounds();
      if (simulationFrameSlider) {
        simulationFrameSlider.value = String(simulationFrameIndex);
      }
      applySimulationFrame(simulationFrameIndex);
    }
    return manifest;
  };

  const applySimulationFrame = (index) => {
    const manifest = simulationManifestBySeason.get(selectedSimulationSeason);
    if (!manifest || !manifest.lines) {
      return;
    }
    const count = manifest.count || 0;
    if (count <= 0) return;
    const { start, end } = getSimulationFrameRange();
    const span = end - start + 1;
    const offset = ((Math.round(index) - start) % span + span) % span;
    const i = start + offset;
    simulationFrameIndex = i;

    const next = {};
    const lines = manifest.lines;
    for (const uid in lines) {
      const arr = lines[uid];
      if (arr && arr.length > i) {
        next[uid] = arr[i];
      }
    }
    simulationTempByUid = next;

    const rFactorMap = manifest.rFactor || {};
    const nextR = {};
    for (const uid in rFactorMap) {
      const arr = rFactorMap[uid];
      if (arr && arr.length > i) {
        nextR[uid] = arr[i];
      }
    }
    simulationRFactorByUid = nextR;

    // Update timestamp banner.
    if (simulationTimestampElement) {
      const startMs = Date.parse(manifest.startIso || "2020-01-01T00:00:00Z");
      const stepMs = (manifest.stepMinutes || 60) * 60 * 1000;
      const ts = new Date(startMs + i * stepMs);
      simulationTimestampElement.querySelector(".simulation-timestamp-text").textContent =
        formatSimulationTimestamp(ts);
    }
    if (simulationFrameSlider && simulationFrameSlider.value !== String(i)) {
      simulationFrameSlider.value = String(i);
    }
    if (simulationFrameLabelElement) {
      const localIndex = i - start + 1;
      simulationFrameLabelElement.textContent = `Frame ${localIndex} / ${span}`;
    }

    if (currentViewMode === "simulation") {
      refreshLineHighlight();
      refreshOpenLinePopupsImpl();
    }
  };

  const simulationTick = () => {
    if (!simulationIsRunning) return;
    try {
      const manifest = simulationManifestBySeason.get(selectedSimulationSeason);
      const count = (manifest && manifest.count) || 0;
      if (count <= 0) return;
      const { start, end } = getSimulationFrameRange();
      const span = end - start + 1;
      const next = start + (((simulationFrameIndex - start + 1) % span + span) % span);
      applySimulationFrame(next);
    } catch (err) {
      console.error("simulationTick error", err);
    }
  };

  const startSimulationLoop = () => {
    if (simulationIsRunning) return;
    simulationIsRunning = true;
    if (simulationPlayPauseButton) {
      simulationPlayPauseButton.textContent = "⏸ Pause";
      simulationPlayPauseButton.classList.add("active");
    }
    if (simulationFrameId) clearInterval(simulationFrameId);
    const interval = Math.max(8, Math.round(1000 / Math.max(1, simulationFps)));
    simulationFrameId = setInterval(simulationTick, interval);
  };

  // Used by the speed dropdown to apply the new fps without losing playback state.
  const restartSimulationLoopIfRunning = () => {
    if (!simulationIsRunning) return;
    if (simulationFrameId) clearInterval(simulationFrameId);
    const interval = Math.max(8, Math.round(1000 / Math.max(1, simulationFps)));
    simulationFrameId = setInterval(simulationTick, interval);
  };

  const createSimulationControl = () => {
    const SimulationControl = L.Control.extend({
      options: { position: "topleft" },
      onAdd() {
        const container = L.DomUtil.create("div", "contingency-control simulation-control leaflet-bar");
        simulationControlContainer = container;
        container.style.display = "none";

        const panel = L.DomUtil.create("div", "contingency-panel", container);

        const button = L.DomUtil.create("button", "contingency-toggle-btn active", panel);
        button.type = "button";
        button.textContent = "Simulation";
        button.title = "Annual conductor temperature animation";

        const dropdownWrap = L.DomUtil.create("div", "contingency-dropdown-wrap", panel);
        dropdownWrap.style.display = "block";

        const seasonLabel = L.DomUtil.create("div", "simulation-field-label", dropdownWrap);
        seasonLabel.textContent = "Season";

        const seasonSelect = L.DomUtil.create("select", "contingency-select contingency-season-select", dropdownWrap);
        const summerOption = L.DomUtil.create("option", "", seasonSelect);
        summerOption.value = "summer";
        summerOption.textContent = "Summer (peak case)";
        const winterOption = L.DomUtil.create("option", "", seasonSelect);
        winterOption.value = "winter";
        winterOption.textContent = "Winter (peak case)";
        seasonSelect.value = selectedSimulationSeason;

        const scopeLabel = L.DomUtil.create("div", "simulation-field-label", dropdownWrap);
        scopeLabel.textContent = "Range";

        const scopeWrap = L.DomUtil.create("div", "simulation-scope-toggle", dropdownWrap);
        const yearScopeBtn = L.DomUtil.create("button", "simulation-scope-btn", scopeWrap);
        yearScopeBtn.type = "button";
        yearScopeBtn.textContent = "Full Year";
        yearScopeBtn.classList.toggle("active", simulationScope === "year");

        const monthScopeBtn = L.DomUtil.create("button", "simulation-scope-btn", scopeWrap);
        monthScopeBtn.type = "button";
        monthScopeBtn.textContent = "By Month";
        monthScopeBtn.classList.toggle("active", simulationScope === "month");

        const monthLabel = L.DomUtil.create("div", "simulation-field-label", dropdownWrap);
        monthLabel.textContent = "Month";
        monthLabel.style.display = simulationScope === "month" ? "" : "none";
        simulationMonthLabel = monthLabel;

        const monthSelect = L.DomUtil.create("select", "contingency-select", dropdownWrap);
        monthSelect.style.display = simulationScope === "month" ? "" : "none";
        simulationMonthSelect = monthSelect;
        const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"];
        MONTH_NAMES.forEach((name, idx) => {
          const o = L.DomUtil.create("option", "", monthSelect);
          o.value = String(idx);
          o.textContent = name;
          if (idx === simulationSelectedMonth) o.selected = true;
        });

        const speedLabel = L.DomUtil.create("div", "simulation-field-label", dropdownWrap);
        speedLabel.textContent = "Playback Speed";

        const speedSelect = L.DomUtil.create("select", "contingency-select", dropdownWrap);
        [
          { v: 8, t: "Slow (8 fps)" },
          { v: 16, t: "Normal (16 fps)" },
          { v: 24, t: "Fast (24 fps)" },
          { v: 48, t: "Very Fast (48 fps)" }
        ].forEach((opt) => {
          const o = L.DomUtil.create("option", "", speedSelect);
          o.value = String(opt.v);
          o.textContent = opt.t;
          if (opt.v === simulationFps) o.selected = true;
        });

        const sliderLabel = L.DomUtil.create("div", "simulation-field-label simulation-frame-label", dropdownWrap);
        sliderLabel.textContent = "Frame 1 / —";
        simulationFrameLabelElement = sliderLabel;

        const slider = L.DomUtil.create("input", "simulation-frame-slider", dropdownWrap);
        slider.type = "range";
        slider.min = "0";
        slider.max = "0";
        slider.step = "1";
        slider.value = "0";
        simulationFrameSlider = slider;

        const actionsCard = L.DomUtil.create("div", "control-actions-card simulation-actions", dropdownWrap);

        const playBtn = L.DomUtil.create("button", "simulation-run-btn", actionsCard);
        playBtn.type = "button";
        playBtn.textContent = "▶ Run";
        simulationPlayPauseButton = playBtn;

        const resetBtn = L.DomUtil.create("button", "simulation-stop-btn", actionsCard);
        resetBtn.type = "button";
        resetBtn.textContent = "⏹ Reset";

        // Wire up events.
        button.addEventListener("click", () => {
          const showing = dropdownWrap.style.display !== "none";
          dropdownWrap.style.display = showing ? "none" : "block";
          button.classList.toggle("active", !showing);
        });

        seasonSelect.addEventListener("change", () => {
          selectedSimulationSeason = seasonSelect.value;
          stopSimulationLoop();
          ensureSimulationDataLoaded(selectedSimulationSeason)
            .then(() => {
              const { start } = getSimulationFrameRange();
              simulationFrameIndex = start;
              updateSimulationSliderBounds();
              applySimulationFrame(start);
            })
            .catch((err) => console.error(err));
        });

        const applyScopeChange = () => {
          yearScopeBtn.classList.toggle("active", simulationScope === "year");
          monthScopeBtn.classList.toggle("active", simulationScope === "month");
          const showMonth = simulationScope === "month";
          if (simulationMonthLabel) simulationMonthLabel.style.display = showMonth ? "" : "none";
          if (simulationMonthSelect) simulationMonthSelect.style.display = showMonth ? "" : "none";
          stopSimulationLoop();
          updateSimulationSliderBounds();
          const { start } = getSimulationFrameRange();
          applySimulationFrame(start);
        };

        yearScopeBtn.addEventListener("click", () => {
          if (simulationScope === "year") return;
          simulationScope = "year";
          applyScopeChange();
        });

        monthScopeBtn.addEventListener("click", () => {
          if (simulationScope === "month") return;
          simulationScope = "month";
          applyScopeChange();
        });

        monthSelect.addEventListener("change", () => {
          const v = Number(monthSelect.value);
          if (!Number.isFinite(v)) return;
          simulationSelectedMonth = Math.max(0, Math.min(11, Math.round(v)));
          stopSimulationLoop();
          updateSimulationSliderBounds();
          const { start } = getSimulationFrameRange();
          applySimulationFrame(start);
        });

        speedSelect.addEventListener("change", () => {
          const v = Number(speedSelect.value);
          if (Number.isFinite(v) && v > 0) {
            simulationFps = v;
            restartSimulationLoopIfRunning();
          }
        });

        slider.addEventListener("input", () => {
          const v = Number(slider.value);
          if (!Number.isFinite(v)) return;
          stopSimulationLoop();
          applySimulationFrame(Math.round(v));
        });

        playBtn.addEventListener("click", () => {
          if (simulationIsRunning) {
            stopSimulationLoop();
          } else {
            ensureSimulationDataLoaded(selectedSimulationSeason)
              .then(() => startSimulationLoop())
              .catch((err) => console.error(err));
          }
        });

        resetBtn.addEventListener("click", () => {
          stopSimulationLoop();
          const { start } = getSimulationFrameRange();
          applySimulationFrame(start);
        });

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        return container;
      }
    });

    map.addControl(new SimulationControl());

    // Floating timestamp banner just below the view-mode tabs.
    const banner = document.createElement("div");
    banner.className = "simulation-timestamp-banner";
    banner.style.display = "none";
    banner.innerHTML = '<span class="simulation-timestamp-label">Conductor Temperature</span>'
      + '<span class="simulation-timestamp-text">—</span>';
    map.getContainer().appendChild(banner);
    simulationTimestampElement = banner;
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

  const ensurePlotlyLoaded = async () => {
    if (window.Plotly) {
      return window.Plotly;
    }

    if (!plotlyLoaderPromise) {
      plotlyLoaderPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.plot.ly/plotly-2.35.2.min.js";
        script.async = true;
        script.onload = () => {
          if (window.Plotly) {
            resolve(window.Plotly);
          } else {
            reject(new Error("Plotly loaded but window.Plotly is unavailable."));
          }
        };
        script.onerror = () => {
          reject(new Error("Failed to load Plotly from CDN."));
        };
        document.head.appendChild(script);
      });
    }

    return plotlyLoaderPromise;
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

  const createBaseCasePlotPanel = (mapContainer) => {
    const overlay = document.createElement("div");
    overlay.className = "bc-data-panel bc-plot-panel";
    overlay.style.display = "none";
    mapContainer.appendChild(overlay);

    const header = document.createElement("div");
    header.className = "bc-data-panel-header";
    overlay.appendChild(header);

    const titleEl = document.createElement("span");
    titleEl.className = "bc-data-panel-title";
    titleEl.textContent = "Base Case Plots";
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
      {
        key: "buses",
        label: "Buses",
        xLabel: "Bus #",
        itemLabelPlural: "buses",
        metrics: [
          { key: "busVoltage", label: "Voltage", yLabel: "Voltage (p.u.)", primaryColor: "#2563eb", accentColor: "#10b981" },
          { key: "busAngle", label: "Angle", yLabel: "Angle (deg)", primaryColor: "#f97316", accentColor: "#f59e0b" }
        ]
      },
      {
        key: "lines",
        label: "Lines",
        xLabel: "Line (From-To CKT)",
        itemLabelPlural: "lines",
        metrics: [
          { key: "lineLoading", label: "Loading", yLabel: "Loading (%)", primaryColor: "#dc2626", accentColor: "#f97316" },
          { key: "lineActiveFlow", label: "Active Flow From-To", yLabel: "Active Flow i-j (MW)", primaryColor: "#7c3aed", accentColor: "#a855f7" },
          { key: "lineReactiveFlow", label: "Reactive Flow From-To", yLabel: "Reactive Flow i-j (MVAr)", primaryColor: "#0891b2", accentColor: "#06b6d4" }
        ]
      },
      {
        key: "generators",
        label: "Generators",
        xLabel: "Generator (Bus|Machine)",
        itemLabelPlural: "generators",
        metrics: [
          { key: "genActive", label: "Active Power", yLabel: "Active Power (MW)", primaryColor: "#2563eb", accentColor: "#3b82f6" },
          { key: "genReactive", label: "Reactive Power", yLabel: "Reactive Power (MVAr)", primaryColor: "#0f766e", accentColor: "#14b8a6" }
        ]
      }
    ];

    const tabByKey = Object.fromEntries(tabDefs.map((tab) => [tab.key, tab]));
    const metricByKey = {};
    tabDefs.forEach((tab) => {
      tab.metrics.forEach((metric) => {
        metricByKey[metric.key] = metric;
      });
    });

    let activeTab = tabDefs[0].key;
    const activeMetricByTab = {
      buses: "busVoltage",
      lines: "lineLoading",
      generators: "genActive"
    };

    const tabBtns = {};
    tabDefs.forEach(({ key, label }) => {
      const btn = document.createElement("button");
      btn.className = `bc-data-tab${key === activeTab ? " active" : ""}`;
      btn.type = "button";
      btn.textContent = label;
      tabBtns[key] = btn;
      tabsBar.appendChild(btn);
    });

    const contentWrap = document.createElement("div");
    contentWrap.className = "bc-plot-content";
    overlay.appendChild(contentWrap);

    const controlsRow = document.createElement("div");
    controlsRow.className = "bc-plot-controls";
    contentWrap.appendChild(controlsRow);

    const metricLabelEl = document.createElement("label");
    metricLabelEl.className = "bc-plot-controls-label";
    metricLabelEl.textContent = "Metric";
    metricLabelEl.setAttribute("for", "bc-plot-metric-select");
    controlsRow.appendChild(metricLabelEl);

    const metricSelect = document.createElement("select");
    metricSelect.className = "bc-plot-metric-select";
    metricSelect.id = "bc-plot-metric-select";
    controlsRow.appendChild(metricSelect);

    const infoBar = document.createElement("div");
    infoBar.className = "bc-plot-info";
    contentWrap.appendChild(infoBar);

    const chartWrap = document.createElement("div");
    chartWrap.className = "bc-plot-chart-wrap";
    contentWrap.appendChild(chartWrap);

    const chartEl = document.createElement("div");
    chartEl.className = "bc-plot-chart";
    chartWrap.appendChild(chartEl);

    const emptyStateEl = document.createElement("div");
    emptyStateEl.className = "bc-plot-empty";
    emptyStateEl.style.display = "none";
    chartWrap.appendChild(emptyStateEl);

    let renderNonce = 0;

    const showEmpty = (message) => {
      emptyStateEl.textContent = message;
      emptyStateEl.style.display = "flex";
      chartEl.style.display = "none";
    };

    const hideEmpty = () => {
      emptyStateEl.style.display = "none";
      chartEl.style.display = "block";
    };

    const sortedBusRows = () => Object.values(baseCaseBusRowsByBusId)
      .slice()
      .sort((a, b) => {
        const aNum = Number(a.__busId);
        const bNum = Number(b.__busId);
        if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
          return aNum - bNum;
        }
        return String(a.__busId || "").localeCompare(String(b.__busId || ""));
      });

    const sortedLineRows = () => Object.values(baseCaseFlowRowsByUid)
      .slice()
      .sort((a, b) => {
        const aFrom = Number(a.__fromBus);
        const bFrom = Number(b.__fromBus);
        if (Number.isFinite(aFrom) && Number.isFinite(bFrom) && aFrom !== bFrom) {
          return aFrom - bFrom;
        }
        const aTo = Number(a.__toBus);
        const bTo = Number(b.__toBus);
        if (Number.isFinite(aTo) && Number.isFinite(bTo) && aTo !== bTo) {
          return aTo - bTo;
        }
        return String(a.__ckt || "").localeCompare(String(b.__ckt || ""));
      });

    const sortedGeneratorRows = () => Object.values(baseCaseGenRowsByBusAndMachine)
      .slice()
      .sort((a, b) => {
        const aBus = Number(a.__busId);
        const bBus = Number(b.__busId);
        if (Number.isFinite(aBus) && Number.isFinite(bBus) && aBus !== bBus) {
          return aBus - bBus;
        }
        return String(a.MachineID || "").localeCompare(String(b.MachineID || ""));
      });

    const getMetricValue = (row, metricKey) => {
      if (metricKey === "busVoltage") {
        return Number(row["Volt(pu)"]);
      }
      if (metricKey === "busAngle") {
        return Number(row["Angle(deg)"]);
      }
      if (metricKey === "lineLoading") {
        return Number(row["Loading_%"]);
      }
      if (metricKey === "lineActiveFlow") {
        return Number(row["Pij(MW)"]);
      }
      if (metricKey === "lineReactiveFlow") {
        return Number(row["Qij(MVAr)"]);
      }
      if (metricKey === "genActive") {
        return Number(row["Pg(MW)"]);
      }
      if (metricKey === "genReactive") {
        return Number(row["Qg(MVAr)"]);
      }
      return Number.NaN;
    };

    const getRowsByTab = (tabKey) => {
      if (tabKey === "buses") {
        return sortedBusRows();
      }
      if (tabKey === "lines") {
        return sortedLineRows();
      }
      return sortedGeneratorRows();
    };

    const getXForRow = (tabKey, row) => {
      if (tabKey === "buses") {
        return row.__busId || row["Bus#"] || "";
      }
      if (tabKey === "lines") {
        const from = row.__fromBus || row["FromBus#"] || "?";
        const to = row.__toBus || row["ToBus#"] || "?";
        const ckt = row.__ckt || row.CKT || "?";
        return `${from}-${to} (${ckt})`;
      }
      const bus = row.__busId || "?";
      const machine = row.__machineId || row.MachineID || "?";
      return `${bus}|${machine}`;
    };

    const getHoverText = (tabKey, row) => {
      if (tabKey === "buses") {
        const busId = row.__busId || row["Bus#"] || "N/A";
        const name = String(row.Name || "").trim() || "N/A";
        const voltage = Number(row["Volt(pu)"]);
        const angle = Number(row["Angle(deg)"]);
        const voltageText = Number.isFinite(voltage) ? voltage.toFixed(4) : "N/A";
        const angleText = Number.isFinite(angle) ? angle.toFixed(2) : "N/A";
        return `Bus: ${busId}<br>Name: ${esc(name)}<br>Voltage: ${voltageText} p.u.<br>Angle: ${angleText} deg`;
      }

      if (tabKey === "lines") {
        const from = row.__fromBus || row["FromBus#"] || "N/A";
        const to = row.__toBus || row["ToBus#"] || "N/A";
        const ckt = row.__ckt || row.CKT || "N/A";
        const loading = Number(row["Loading_%"]);
        const p = Number(row["Pij(MW)"]);
        const q = Number(row["Qij(MVAr)"]);
        return `From-To: ${from}-${to}<br>CKT: ${ckt}<br>Loading: ${Number.isFinite(loading) ? loading.toFixed(2) : "N/A"} %<br>Active Flow: ${Number.isFinite(p) ? p.toFixed(2) : "N/A"} MW<br>Reactive Flow: ${Number.isFinite(q) ? q.toFixed(2) : "N/A"} MVAr`;
      }

      const bus = row.__busId || "N/A";
      const machine = row.__machineId || row.MachineID || "N/A";
      const pg = Number(row["Pg(MW)"]);
      const qg = Number(row["Qg(MVAr)"]);
      return `Bus: ${bus}<br>Machine: ${machine}<br>Active Power: ${Number.isFinite(pg) ? pg.toFixed(2) : "N/A"} MW<br>Reactive Power: ${Number.isFinite(qg) ? qg.toFixed(2) : "N/A"} MVAr`;
    };

    const populateMetricOptions = () => {
      const tab = tabByKey[activeTab];
      metricSelect.innerHTML = "";
      tab.metrics.forEach((metric) => {
        const option = document.createElement("option");
        option.value = metric.key;
        option.textContent = metric.label;
        metricSelect.appendChild(option);
      });

      if (!tab.metrics.some((metric) => metric.key === activeMetricByTab[activeTab])) {
        activeMetricByTab[activeTab] = tab.metrics[0].key;
      }
      metricSelect.value = activeMetricByTab[activeTab];
    };

    const buildPlotData = () => {
      const tab = tabByKey[activeTab];
      const metric = metricByKey[activeMetricByTab[activeTab]];
      const rows = getRowsByTab(activeTab);

      const seriesRows = rows.filter((row) => Number.isFinite(getMetricValue(row, metric.key)));
      const x = seriesRows.map((row) => getXForRow(activeTab, row));
      const y = seriesRows.map((row) => getMetricValue(row, metric.key));
      const hover = seriesRows.map((row) => getHoverText(activeTab, row));

      return {
        rowsCount: rows.length,
        pointsCount: seriesRows.length,
        x,
        y,
        hover,
        yLabel: metric.yLabel,
        xLabel: tab.xLabel,
        title: `Base Case ${tab.label} - ${metric.label} (${selectedBaseCaseSeason})`,
        itemLabelPlural: tab.itemLabelPlural,
        metricKey: metric.key,
        metricPrimaryColor: metric.primaryColor,
        metricAccentColor: metric.accentColor
      };
    };

    const renderPlot = async () => {
      renderNonce += 1;
      const nonce = renderNonce;
      const payload = buildPlotData();

      infoBar.textContent = `${payload.rowsCount} ${payload.itemLabelPlural} available • ${payload.pointsCount} plotted`;

      if (!payload.pointsCount) {
        try {
          if (window.Plotly) {
            window.Plotly.purge(chartEl);
          }
        } catch (_error) {
          // Ignore purge errors.
        }
        showEmpty(`No values available for ${selectedBaseCaseSeason} (${payload.yLabel}).`);
        return;
      }

      try {
        await ensurePlotlyLoaded();
      } catch (error) {
        showEmpty(`Plotly could not be loaded (${error.message}).`);
        return;
      }

      if (nonce !== renderNonce) {
        return;
      }

      hideEmpty();

      const dark = document.body.classList.contains("dark-mode");
      const trace = {
        x: payload.x,
        y: payload.y,
        type: "scattergl",
        mode: "lines+markers",
        hovertemplate: "%{text}<extra></extra>",
        text: payload.hover,
        marker: {
          size: 6,
          color: payload.metricAccentColor
        },
        line: {
          width: 1.6,
          color: payload.metricPrimaryColor
        }
      };

      const layout = {
        title: {
          text: payload.title,
          font: { size: 14 }
        },
        margin: { l: 62, r: 18, t: 44, b: 62 },
        xaxis: {
          title: payload.xLabel,
          type: "category",
          automargin: true,
          tickangle: -45,
          color: dark ? "#e5e7eb" : "#1f2937",
          gridcolor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
        },
        yaxis: {
          title: payload.yLabel,
          automargin: true,
          color: dark ? "#e5e7eb" : "#1f2937",
          gridcolor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
        },
        plot_bgcolor: dark ? "#0f172a" : "#ffffff",
        paper_bgcolor: dark ? "#1b2230" : "#ffffff",
        font: {
          color: dark ? "#e5e7eb" : "#111827",
          family: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
        },
        hoverlabel: {
          bgcolor: dark ? "#0f172a" : "#ffffff",
          bordercolor: dark ? "#334155" : "#cbd5e1",
          font: { color: dark ? "#e5e7eb" : "#0f172a" }
        }
      };

      if (payload.metricKey === "busVoltage") {
        const voltageLowerLimit = 0.95;
        const voltageUpperLimit = 1.1;
        const minSeries = Math.min(...payload.y, voltageLowerLimit);
        const maxSeries = Math.max(...payload.y, voltageUpperLimit);
        const pad = Math.max(0.005, (maxSeries - minSeries) * 0.05);

        layout.yaxis.range = [minSeries - pad, maxSeries + pad];
        layout.shapes = [
          {
            type: "line",
            xref: "paper",
            yref: "y",
            x0: 0,
            x1: 1,
            y0: voltageUpperLimit,
            y1: voltageUpperLimit,
            line: {
              color: dark ? "#fca5a5" : "#dc2626",
              width: 1.6,
              dash: "dash"
            }
          },
          {
            type: "line",
            xref: "paper",
            yref: "y",
            x0: 0,
            x1: 1,
            y0: voltageLowerLimit,
            y1: voltageLowerLimit,
            line: {
              color: dark ? "#fdba74" : "#ea580c",
              width: 1.6,
              dash: "dash"
            }
          }
        ];

        layout.annotations = [
          {
            xref: "paper",
            yref: "y",
            x: 0.995,
            y: voltageUpperLimit,
            xanchor: "right",
            yanchor: "bottom",
            text: `Vmax ${voltageUpperLimit.toFixed(2)}`,
            showarrow: false,
            bgcolor: dark ? "rgba(127, 29, 29, 0.7)" : "rgba(254, 226, 226, 0.88)",
            bordercolor: dark ? "#ef4444" : "#dc2626",
            borderwidth: 1,
            font: {
              size: 11,
              color: dark ? "#fee2e2" : "#7f1d1d"
            }
          },
          {
            xref: "paper",
            yref: "y",
            x: 0.995,
            y: voltageLowerLimit,
            xanchor: "right",
            yanchor: "top",
            text: `Vmin ${voltageLowerLimit.toFixed(2)}`,
            showarrow: false,
            bgcolor: dark ? "rgba(124, 45, 18, 0.72)" : "rgba(255, 237, 213, 0.9)",
            bordercolor: dark ? "#f97316" : "#ea580c",
            borderwidth: 1,
            font: {
              size: 11,
              color: dark ? "#ffedd5" : "#7c2d12"
            }
          }
        ];
      }

      const config = {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
        toImageButtonOptions: {
          filename: `base_case_${activeTab}_${payload.metricKey}_${selectedBaseCaseSeason}`
        }
      };

      await window.Plotly.react(chartEl, [trace], layout, config);
      window.Plotly.Plots.resize(chartEl);
    };

    const switchTab = (tab) => {
      activeTab = tab;
      tabDefs.forEach(({ key }) => {
        tabBtns[key].classList.toggle("active", key === tab);
      });
      populateMetricOptions();
      renderPlot();
    };

    tabDefs.forEach(({ key }) => {
      tabBtns[key].addEventListener("click", () => switchTab(key));
    });

    metricSelect.addEventListener("change", () => {
      activeMetricByTab[activeTab] = metricSelect.value;
      renderPlot();
    });

    closeBtn.addEventListener("click", () => {
      overlay.style.display = "none";
    });

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
        const newW = Math.max(520, startW + (mv.clientX - startX));
        const newH = Math.max(360, startH + (mv.clientY - startY));
        overlay.style.width = `${newW}px`;
        overlay.style.height = `${newH}px`;
        if (window.Plotly && chartEl.style.display !== "none") {
          window.Plotly.Plots.resize(chartEl);
        }
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

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
          populateMetricOptions();
          renderPlot();
        }
      }
    };
  };

  const createContingencyPlotPanel = (mapContainer) => {
    const overlay = document.createElement("div");
    overlay.className = "bc-data-panel bc-plot-panel";
    overlay.style.display = "none";
    mapContainer.appendChild(overlay);

    const header = document.createElement("div");
    header.className = "bc-data-panel-header";
    overlay.appendChild(header);

    const titleEl = document.createElement("span");
    titleEl.className = "bc-data-panel-title";
    titleEl.textContent = "Contingency Plots";
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
      {
        key: "buses",
        label: "Buses",
        xLabel: "Bus #",
        itemLabelPlural: "buses",
        metrics: [
          { key: "busVoltage", label: "Voltage", yLabel: "Voltage (p.u.)", primaryColor: "#2563eb", accentColor: "#10b981" },
          { key: "busAngle", label: "Angle", yLabel: "Angle (deg)", primaryColor: "#f97316", accentColor: "#f59e0b" }
        ]
      },
      {
        key: "lines",
        label: "Lines",
        xLabel: "Line (From-To CKT)",
        itemLabelPlural: "lines",
        metrics: [
          { key: "lineLoading", label: "Loading", yLabel: "Loading (%)", primaryColor: "#dc2626", accentColor: "#f97316" },
          { key: "lineActiveFlow", label: "Active Flow From-To", yLabel: "Active Flow i-j (MW)", primaryColor: "#7c3aed", accentColor: "#a855f7" },
          { key: "lineReactiveFlow", label: "Reactive Flow From-To", yLabel: "Reactive Flow i-j (MVAr)", primaryColor: "#0891b2", accentColor: "#06b6d4" }
        ]
      },
      {
        key: "generators",
        label: "Generators",
        xLabel: "Generator (Bus|Machine)",
        itemLabelPlural: "generators",
        metrics: [
          { key: "genActive", label: "Active Power", yLabel: "Active Power (MW)", primaryColor: "#2563eb", accentColor: "#3b82f6" },
          { key: "genReactive", label: "Reactive Power", yLabel: "Reactive Power (MVAr)", primaryColor: "#0f766e", accentColor: "#14b8a6" }
        ]
      }
    ];

    const tabByKey = Object.fromEntries(tabDefs.map((tab) => [tab.key, tab]));
    const metricByKey = {};
    tabDefs.forEach((tab) => {
      tab.metrics.forEach((metric) => {
        metricByKey[metric.key] = metric;
      });
    });

    let activeTab = tabDefs[0].key;
    const activeMetricByTab = {
      buses: "busVoltage",
      lines: "lineLoading",
      generators: "genActive"
    };

    const tabBtns = {};
    tabDefs.forEach(({ key, label }) => {
      const btn = document.createElement("button");
      btn.className = `bc-data-tab${key === activeTab ? " active" : ""}`;
      btn.type = "button";
      btn.textContent = label;
      tabBtns[key] = btn;
      tabsBar.appendChild(btn);
    });

    const contentWrap = document.createElement("div");
    contentWrap.className = "bc-plot-content";
    overlay.appendChild(contentWrap);

    const controlsRow = document.createElement("div");
    controlsRow.className = "bc-plot-controls";
    contentWrap.appendChild(controlsRow);

    const metricLabelEl = document.createElement("label");
    metricLabelEl.className = "bc-plot-controls-label";
    metricLabelEl.textContent = "Metric";
    metricLabelEl.setAttribute("for", "ca-plot-metric-select");
    controlsRow.appendChild(metricLabelEl);

    const metricSelect = document.createElement("select");
    metricSelect.className = "bc-plot-metric-select";
    metricSelect.id = "ca-plot-metric-select";
    controlsRow.appendChild(metricSelect);

    const infoBar = document.createElement("div");
    infoBar.className = "bc-plot-info";
    contentWrap.appendChild(infoBar);

    const chartWrap = document.createElement("div");
    chartWrap.className = "bc-plot-chart-wrap";
    contentWrap.appendChild(chartWrap);

    const chartEl = document.createElement("div");
    chartEl.className = "bc-plot-chart";
    chartWrap.appendChild(chartEl);

    const emptyStateEl = document.createElement("div");
    emptyStateEl.className = "bc-plot-empty";
    emptyStateEl.style.display = "none";
    chartWrap.appendChild(emptyStateEl);

    let renderNonce = 0;

    const showEmpty = (message) => {
      emptyStateEl.textContent = message;
      emptyStateEl.style.display = "flex";
      chartEl.style.display = "none";
    };

    const hideEmpty = () => {
      emptyStateEl.style.display = "none";
      chartEl.style.display = "block";
    };

    const sortedBusRows = () => Object.values(activeBusRowsByBusId)
      .slice()
      .sort((a, b) => {
        const aNum = Number(a.__busId);
        const bNum = Number(b.__busId);
        if (Number.isFinite(aNum) && Number.isFinite(bNum)) {
          return aNum - bNum;
        }
        return String(a.__busId || "").localeCompare(String(b.__busId || ""));
      });

    const sortedLineRows = () => Object.values(activeFlowRowsByUid)
      .slice()
      .sort((a, b) => {
        const aFrom = Number(a.__fromBus);
        const bFrom = Number(b.__fromBus);
        if (Number.isFinite(aFrom) && Number.isFinite(bFrom) && aFrom !== bFrom) {
          return aFrom - bFrom;
        }
        const aTo = Number(a.__toBus);
        const bTo = Number(b.__toBus);
        if (Number.isFinite(aTo) && Number.isFinite(bTo) && aTo !== bTo) {
          return aTo - bTo;
        }
        return String(a.__ckt || "").localeCompare(String(b.__ckt || ""));
      });

    const sortedGeneratorRows = () => Object.values(activeGenRowsByBusAndMachine)
      .slice()
      .sort((a, b) => {
        const aBus = Number(a.__busId);
        const bBus = Number(b.__busId);
        if (Number.isFinite(aBus) && Number.isFinite(bBus) && aBus !== bBus) {
          return aBus - bBus;
        }
        return String(a.MachineID || "").localeCompare(String(b.MachineID || ""));
      });

    const getMetricValue = (row, metricKey) => {
      if (metricKey === "busVoltage") {
        return Number(row["Volt(pu)"]);
      }
      if (metricKey === "busAngle") {
        return Number(row["Angle(deg)"]);
      }
      if (metricKey === "lineLoading") {
        return Number(row["Loading_%"]);
      }
      if (metricKey === "lineActiveFlow") {
        return Number(row["Pij(MW)"]);
      }
      if (metricKey === "lineReactiveFlow") {
        return Number(row["Qij(MVAr)"]);
      }
      if (metricKey === "genActive") {
        return Number(row["Pg(MW)"]);
      }
      if (metricKey === "genReactive") {
        return Number(row["Qg(MVAr)"]);
      }
      return Number.NaN;
    };

    const getRowsByTab = (tabKey) => {
      if (tabKey === "buses") {
        return sortedBusRows();
      }
      if (tabKey === "lines") {
        return sortedLineRows();
      }
      return sortedGeneratorRows();
    };

    const getXForRow = (tabKey, row) => {
      if (tabKey === "buses") {
        return row.__busId || row["Bus#"] || "";
      }
      if (tabKey === "lines") {
        const from = row.__fromBus || row["FromBus#"] || "?";
        const to = row.__toBus || row["ToBus#"] || "?";
        const ckt = row.__ckt || row.CKT || "?";
        return `${from}-${to} (${ckt})`;
      }
      const bus = row.__busId || "?";
      const machine = row.__machineId || row.MachineID || "?";
      return `${bus}|${machine}`;
    };

    const getHoverText = (tabKey, row) => {
      if (tabKey === "buses") {
        const busId = row.__busId || row["Bus#"] || "N/A";
        const name = String(row.Name || "").trim() || "N/A";
        const voltage = Number(row["Volt(pu)"]);
        const angle = Number(row["Angle(deg)"]);
        const voltageText = Number.isFinite(voltage) ? voltage.toFixed(4) : "N/A";
        const angleText = Number.isFinite(angle) ? angle.toFixed(2) : "N/A";
        return `Bus: ${busId}<br>Name: ${esc(name)}<br>Voltage: ${voltageText} p.u.<br>Angle: ${angleText} deg`;
      }

      if (tabKey === "lines") {
        const from = row.__fromBus || row["FromBus#"] || "N/A";
        const to = row.__toBus || row["ToBus#"] || "N/A";
        const ckt = row.__ckt || row.CKT || "N/A";
        const loading = Number(row["Loading_%"]);
        const p = Number(row["Pij(MW)"]);
        const q = Number(row["Qij(MVAr)"]);
        return `From-To: ${from}-${to}<br>CKT: ${ckt}<br>Loading: ${Number.isFinite(loading) ? loading.toFixed(2) : "N/A"} %<br>Active Flow: ${Number.isFinite(p) ? p.toFixed(2) : "N/A"} MW<br>Reactive Flow: ${Number.isFinite(q) ? q.toFixed(2) : "N/A"} MVAr`;
      }

      const bus = row.__busId || "N/A";
      const machine = row.__machineId || row.MachineID || "N/A";
      const pg = Number(row["Pg(MW)"]);
      const qg = Number(row["Qg(MVAr)"]);
      return `Bus: ${bus}<br>Machine: ${machine}<br>Active Power: ${Number.isFinite(pg) ? pg.toFixed(2) : "N/A"} MW<br>Reactive Power: ${Number.isFinite(qg) ? qg.toFixed(2) : "N/A"} MVAr`;
    };

    const populateMetricOptions = () => {
      const tab = tabByKey[activeTab];
      metricSelect.innerHTML = "";
      tab.metrics.forEach((metric) => {
        const option = document.createElement("option");
        option.value = metric.key;
        option.textContent = metric.label;
        metricSelect.appendChild(option);
      });

      if (!tab.metrics.some((metric) => metric.key === activeMetricByTab[activeTab])) {
        activeMetricByTab[activeTab] = tab.metrics[0].key;
      }
      metricSelect.value = activeMetricByTab[activeTab];
    };

    const buildPlotData = () => {
      const tab = tabByKey[activeTab];
      const metric = metricByKey[activeMetricByTab[activeTab]];
      const rows = getRowsByTab(activeTab);

      const seriesRows = rows.filter((row) => Number.isFinite(getMetricValue(row, metric.key)));
      const x = seriesRows.map((row) => getXForRow(activeTab, row));
      const y = seriesRows.map((row) => getMetricValue(row, metric.key));
      const hover = seriesRows.map((row) => getHoverText(activeTab, row));
      const contingencyLabel = selectedContingencyUid || "N/A";
      const seasonLabel = selectedContingencySeason || "N/A";

      return {
        rowsCount: rows.length,
        pointsCount: seriesRows.length,
        x,
        y,
        hover,
        yLabel: metric.yLabel,
        xLabel: tab.xLabel,
        title: `Contingency ${tab.label} - ${metric.label} (${contingencyLabel}, ${seasonLabel})`,
        itemLabelPlural: tab.itemLabelPlural,
        metricKey: metric.key,
        metricPrimaryColor: metric.primaryColor,
        metricAccentColor: metric.accentColor,
        contingencyLabel,
        seasonLabel
      };
    };

    const renderPlot = async () => {
      renderNonce += 1;
      const nonce = renderNonce;
      const payload = buildPlotData();

      infoBar.textContent = `${payload.rowsCount} ${payload.itemLabelPlural} available • ${payload.pointsCount} plotted`;

      if (!payload.pointsCount) {
        try {
          if (window.Plotly) {
            window.Plotly.purge(chartEl);
          }
        } catch (_error) {
          // Ignore purge errors.
        }
        showEmpty(`No values available for ${payload.contingencyLabel} (${payload.seasonLabel}, ${payload.yLabel}).`);
        return;
      }

      try {
        await ensurePlotlyLoaded();
      } catch (error) {
        showEmpty(`Plotly could not be loaded (${error.message}).`);
        return;
      }

      if (nonce !== renderNonce) {
        return;
      }

      hideEmpty();

      const dark = document.body.classList.contains("dark-mode");
      const trace = {
        x: payload.x,
        y: payload.y,
        type: "scattergl",
        mode: "lines+markers",
        hovertemplate: "%{text}<extra></extra>",
        text: payload.hover,
        marker: {
          size: 6,
          color: payload.metricAccentColor
        },
        line: {
          width: 1.6,
          color: payload.metricPrimaryColor
        }
      };

      const layout = {
        title: {
          text: payload.title,
          font: { size: 14 }
        },
        margin: { l: 62, r: 18, t: 44, b: 62 },
        xaxis: {
          title: payload.xLabel,
          type: "category",
          automargin: true,
          tickangle: -45,
          color: dark ? "#e5e7eb" : "#1f2937",
          gridcolor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
        },
        yaxis: {
          title: payload.yLabel,
          automargin: true,
          color: dark ? "#e5e7eb" : "#1f2937",
          gridcolor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
        },
        plot_bgcolor: dark ? "#0f172a" : "#ffffff",
        paper_bgcolor: dark ? "#1b2230" : "#ffffff",
        font: {
          color: dark ? "#e5e7eb" : "#111827",
          family: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
        },
        hoverlabel: {
          bgcolor: dark ? "#0f172a" : "#ffffff",
          bordercolor: dark ? "#334155" : "#cbd5e1",
          font: { color: dark ? "#e5e7eb" : "#0f172a" }
        }
      };

      if (payload.metricKey === "busVoltage") {
        const voltageLowerLimit = 0.95;
        const voltageUpperLimit = 1.1;
        const minSeries = Math.min(...payload.y, voltageLowerLimit);
        const maxSeries = Math.max(...payload.y, voltageUpperLimit);
        const pad = Math.max(0.005, (maxSeries - minSeries) * 0.05);

        layout.yaxis.range = [minSeries - pad, maxSeries + pad];
        layout.shapes = [
          {
            type: "line",
            xref: "paper",
            yref: "y",
            x0: 0,
            x1: 1,
            y0: voltageUpperLimit,
            y1: voltageUpperLimit,
            line: {
              color: dark ? "#fca5a5" : "#dc2626",
              width: 1.6,
              dash: "dash"
            }
          },
          {
            type: "line",
            xref: "paper",
            yref: "y",
            x0: 0,
            x1: 1,
            y0: voltageLowerLimit,
            y1: voltageLowerLimit,
            line: {
              color: dark ? "#fdba74" : "#ea580c",
              width: 1.6,
              dash: "dash"
            }
          }
        ];

        layout.annotations = [
          {
            xref: "paper",
            yref: "y",
            x: 0.995,
            y: voltageUpperLimit,
            xanchor: "right",
            yanchor: "bottom",
            text: `Vmax ${voltageUpperLimit.toFixed(2)}`,
            showarrow: false,
            bgcolor: dark ? "rgba(127, 29, 29, 0.7)" : "rgba(254, 226, 226, 0.88)",
            bordercolor: dark ? "#ef4444" : "#dc2626",
            borderwidth: 1,
            font: {
              size: 11,
              color: dark ? "#fee2e2" : "#7f1d1d"
            }
          },
          {
            xref: "paper",
            yref: "y",
            x: 0.995,
            y: voltageLowerLimit,
            xanchor: "right",
            yanchor: "top",
            text: `Vmin ${voltageLowerLimit.toFixed(2)}`,
            showarrow: false,
            bgcolor: dark ? "rgba(124, 45, 18, 0.72)" : "rgba(255, 237, 213, 0.9)",
            bordercolor: dark ? "#f97316" : "#ea580c",
            borderwidth: 1,
            font: {
              size: 11,
              color: dark ? "#ffedd5" : "#7c2d12"
            }
          }
        ];
      }

      const config = {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"],
        toImageButtonOptions: {
          filename: `contingency_${activeTab}_${payload.metricKey}_${payload.contingencyLabel}_${payload.seasonLabel}`
        }
      };

      await window.Plotly.react(chartEl, [trace], layout, config);
      window.Plotly.Plots.resize(chartEl);
    };

    const switchTab = (tab) => {
      activeTab = tab;
      tabDefs.forEach(({ key }) => {
        tabBtns[key].classList.toggle("active", key === tab);
      });
      populateMetricOptions();
      renderPlot();
    };

    tabDefs.forEach(({ key }) => {
      tabBtns[key].addEventListener("click", () => switchTab(key));
    });

    metricSelect.addEventListener("change", () => {
      activeMetricByTab[activeTab] = metricSelect.value;
      renderPlot();
    });

    closeBtn.addEventListener("click", () => {
      overlay.style.display = "none";
    });

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
        const newW = Math.max(520, startW + (mv.clientX - startX));
        const newH = Math.max(360, startH + (mv.clientY - startY));
        overlay.style.width = `${newW}px`;
        overlay.style.height = `${newH}px`;
        if (window.Plotly && chartEl.style.display !== "none") {
          window.Plotly.Plots.resize(chartEl);
        }
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

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
          populateMetricOptions();
          renderPlot();
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

    const buildLineHoverPopupHtml = (feature) => {
      const props = (feature && feature.properties) || {};
      const uid = String(props.UID || "").trim();
      const name = lineNameByUid[uid] || uid || "Line";

      const formatNumber = (value, digits = 4) => {
        const n = Number(value);
        return Number.isFinite(n) ? n.toFixed(digits) : "—";
      };

      let tempValue = null;
      let resistanceValue = Number(props.R);
      if (currentViewMode === "simulation") {
        tempValue = simulationTempByUid[uid];
        const rFactor = Number(simulationRFactorByUid[uid]);
        const baseR = Number(props.R);
        if (Number.isFinite(rFactor) && Number.isFinite(baseR)) {
          resistanceValue = baseR * rFactor;
        }
      } else if (currentViewMode === "contingency" && activeContingencyConverged) {
        const row = activeFlowRowsByUid[uid];
        if (row) tempValue = row[TEMP_COND_COLUMN];
      } else if (currentViewMode === "baseCase") {
        const row = baseCaseFlowRowsByUid[uid];
        if (row) tempValue = row[TEMP_COND_COLUMN];
      }
      const tempNum = Number(tempValue);
      const tempText = Number.isFinite(tempNum)
        ? `${tempNum.toFixed(1)} °C / ${(tempNum * 9 / 5 + 32).toFixed(1)} °F`
        : "—";

      return `<b>${esc(name)}</b><br>`
        + `<b>Resistance (R):</b> ${esc(formatNumber(resistanceValue))} Ω<br>`
        + `<b>Reactance (X):</b> ${esc(formatNumber(props.X))} Ω<br>`
        + `<b>Conductor Temp:</b> ${esc(tempText)}`;
    };

    const refreshOpenLinePopups = () => {
      if (!linesLayer) {
        return;
      }

      linesLayer.eachLayer((layer) => {
        try {
          if (!layer || !layer.isPopupOpen || !layer.getPopup || !layer.isPopupOpen()) {
            return;
          }
          const popup = layer.getPopup();
          if (!popup || !popup.setContent) return;
          const feature = layer.feature || {};
          popup.setContent(buildLineHoverPopupHtml(feature));
        } catch (err) {
          // Don't let a single popup failure break the simulation loop.
          console.error("refreshOpenLinePopups error", err);
        }
      });
    };

    // Expose to the module-scope simulation tick.
    refreshOpenLinePopupsImpl = refreshOpenLinePopups;

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

      if (row[TEMP_COND_COLUMN] != null && String(row[TEMP_COND_COLUMN]).length > 0) {
        detailRows.push(`<b>Conductor Temp:</b> ${esc(formatMetric(row[TEMP_COND_COLUMN], "°C"))}`);
      }

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
        refreshFlowAnimationControlState();
        refreshLineHighlight();
        refreshViolationGlow();
        refreshBusColors();
        refreshGeneratorColors();
        if (contingencyPlotPanelRef) {
          contingencyPlotPanelRef.refresh();
        }
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
      refreshFlowAnimationControlState();
      if (contingencyDataPanelRef) {
        contingencyDataPanelRef.refresh();
      }
      if (contingencyPlotPanelRef) {
        contingencyPlotPanelRef.refresh();
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
      refreshFlowAnimationControlState();
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
      if (baseCasePlotPanelRef) {
        baseCasePlotPanelRef.refresh();
      }
      refreshFlowAnimationControlState();
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
      refreshFlowAnimationControlState();
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
        bindHoverPopup(layer, () => buildLineHoverPopupHtml(feature));
      }
    }).addTo(map);

    createContingencyControl(
      branchGeo,
      lineNameByUid,
      applyContingencySelection,
      applyMetricSelection,
      () => {
        if (contingencyPlotPanelRef) {
          contingencyPlotPanelRef.show();
        }
      }
    );
    contingencyDataPanelRef = createContingencyDataPanel(map.getContainer());
    contingencyPlotPanelRef = createContingencyPlotPanel(map.getContainer());
    createBaseCaseControl(
      applyBaseCaseSeasonChange,
      applyBaseCaseMetricSelection,
      () => {
        if (baseCasePlotPanelRef) {
          baseCasePlotPanelRef.show();
        }
      }
    );

    createSimulationControl();

    // Pre-load default base case season data
    loadBaseCaseData(selectedBaseCaseSeason).then(() => {
      refreshFlowAnimationControlState();
    });

    baseCaseDataPanelRef = createBaseCaseDataPanel(map.getContainer());
    baseCasePlotPanelRef = createBaseCasePlotPanel(map.getContainer());

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

    gensLayer = L.geoJSON(genGeo, {
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

    map.on("zoomend", () => {
      if (isFlowAnimationActive) {
        startFlowAnimation();
      }
    });

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
      const isSimulation = mode === "simulation";
      currentViewMode = mode;

      setTheme((isContingency || isBaseCase || isSimulation) ? "dark" : "light");

      // Keep the overlays in a deterministic state by mode.
      setLayerVisible(linesLayer, true);
      setLayerVisible(areasLayer, !isContingency && !isBaseCase && !isSimulation);
      setLayerVisible(genConnLayer, !isContingency && !isBaseCase && !isSimulation);

      // Keep generators visible in both modes; contingency starts with purple generator markers enabled.
      setAllGeneratorCategories(true);
      setAllBusTypes(true);

      // Contingency/base case mode uses uniform purple generators; default restores category colors.
      setGeneratorMarkerColors(isContingency);

      if (genLegendElement) {
        genLegendElement.style.display = (isContingency || isBaseCase || isSimulation) ? "none" : "block";
      }
      if (busLegendElement) {
        busLegendElement.style.display = (isContingency || isBaseCase || isSimulation) ? "none" : "block";
      }
      if (contingencyControlContainer) {
        contingencyControlContainer.style.display = isContingency ? "block" : "none";
      }
      if (baseCaseControlContainer) {
        baseCaseControlContainer.style.display = isBaseCase ? "block" : "none";
      }
      if (simulationControlContainer) {
        simulationControlContainer.style.display = isSimulation ? "block" : "none";
      }
      if (simulationTimestampElement) {
        simulationTimestampElement.style.display = isSimulation ? "flex" : "none";
      }
      if (!isSimulation) {
        stopSimulationLoop();
      } else {
        ensureSimulationDataLoaded(selectedSimulationSeason).catch((err) => console.error(err));
      }

      refreshFlowAnimationControlState();

      refreshMetricButtonsState();
      refreshLineColorLegend();
      refreshLineHighlight();
      refreshBusColors();
      refreshGeneratorColors();
      refreshOpenLinePopups();
      refreshOpenBusPopups();
      refreshOpenGeneratorPopups();

      setOverlayLegendEntryVisible("Generator Connections", !isContingency && !isBaseCase && !isSimulation);
      setOverlayLegendEntryVisible("Buses", isContingency || isBaseCase);
      setOverlayLegendEntryVisible("Generators", isContingency || isBaseCase);

      const defaultTab = document.getElementById("view-mode-default");
      const baseCaseTab = document.getElementById("view-mode-basecase");
      const contingencyTab = document.getElementById("view-mode-contingency");
      const simulationTab = document.getElementById("view-mode-simulation");
      if (defaultTab) {
        defaultTab.classList.toggle("active", mode === "default");
      }
      if (baseCaseTab) {
        baseCaseTab.classList.toggle("active", isBaseCase);
      }
      if (contingencyTab) {
        contingencyTab.classList.toggle("active", isContingency);
      }
      if (simulationTab) {
        simulationTab.classList.toggle("active", isSimulation);
      }
    };

    const INFO_PANEL_HTML = `
      <header class="info-panel-header">
        <h2>Conductor Temperature Methodology</h2>
        <button type="button" class="info-panel-close" aria-label="Close" id="info-panel-close">×</button>
      </header>
      <div class="info-panel-body">
        <h3>Nomenclature</h3>
        <table class="info-panel-nomenclature">
          <thead>
            <tr><th>Symbol</th><th>Description</th><th>Units</th></tr>
          </thead>
          <tbody>
            <tr><td>$T_s$</td><td>Conductor surface temperature</td><td>K (or °C)</td></tr>
            <tr><td>$T_a$</td><td>Ambient air temperature</td><td>K</td></tr>
            <tr><td>$T_{\\text{film}}$</td><td>Boundary-layer (film) temperature, $\\tfrac{1}{2}(T_s+T_a)$</td><td>K</td></tr>
            <tr><td>$I$</td><td>Conductor current magnitude (AC power-flow solution)</td><td>A</td></tr>
            <tr><td>$P_{ij},\\,Q_{ij}$</td><td>Active / reactive power flowing out of bus $i$ on branch $i\\!\\to\\!j$</td><td>MW, MVAr</td></tr>
            <tr><td>$|V_i|$</td><td>Voltage magnitude at the sending bus $i$</td><td>kV (line-to-line)</td></tr>
            <tr><td>$R$</td><td>Conductor AC resistance per unit length</td><td>Ω&nbsp;m$^{-1}$</td></tr>
            <tr><td>$D_0$</td><td>Outside conductor diameter</td><td>m</td></tr>
            <tr><td>$\\alpha_s$</td><td>Solar absorptivity of conductor surface</td><td>—</td></tr>
            <tr><td>$\\varepsilon$</td><td>Emissivity of conductor surface</td><td>—</td></tr>
            <tr><td>$\\sigma$</td><td>Stefan–Boltzmann constant, $5.67\\times10^{-8}$</td><td>W&nbsp;m$^{-2}$&nbsp;K$^{-4}$</td></tr>
            <tr><td>$G$</td><td>Global horizontal solar irradiance</td><td>W&nbsp;m$^{-2}$</td></tr>
            <tr><td>$V_w$</td><td>Wind speed at conductor</td><td>m&nbsp;s$^{-1}$</td></tr>
            <tr><td>$\\phi$</td><td>Angle between wind direction and conductor axis</td><td>°</td></tr>
            <tr><td>$K_{\\text{angle}}$</td><td>Wind direction factor (IEEE&nbsp;738 eq.&nbsp;4a)</td><td>—</td></tr>
            <tr><td>$\\rho_f$</td><td>Air density at $T_{\\text{film}}$</td><td>kg&nbsp;m$^{-3}$</td></tr>
            <tr><td>$\\mu_f$</td><td>Dynamic viscosity of air at $T_{\\text{film}}$</td><td>kg&nbsp;m$^{-1}$&nbsp;s$^{-1}$</td></tr>
            <tr><td>$k_f$</td><td>Thermal conductivity of air at $T_{\\text{film}}$</td><td>W&nbsp;m$^{-1}$&nbsp;K$^{-1}$</td></tr>
            <tr><td>$N_{\\text{Re}}$</td><td>Reynolds number, $D_0\\rho_f|V_w|/\\mu_f$</td><td>—</td></tr>
            <tr><td>$H_e$</td><td>Conductor elevation above sea level</td><td>m</td></tr>
            <tr><td>$p$</td><td>Surface air pressure</td><td>Pa</td></tr>
            <tr><td>$\\mathrm{RH}$</td><td>Relative humidity (fraction)</td><td>—</td></tr>
            <tr><td>$p_{wv}$</td><td>Partial pressure of water vapor</td><td>Pa</td></tr>
            <tr><td>$p_{wv,\\text{sat}}$</td><td>Saturation vapor pressure of water (Tetens)</td><td>Pa</td></tr>
            <tr><td>$R_d,\\,R_v$</td><td>Specific gas constants for dry air and water vapor</td><td>J&nbsp;kg$^{-1}$&nbsp;K$^{-1}$</td></tr>
            <tr><td>$q_s$</td><td>Solar heat gain per unit length</td><td>W&nbsp;m$^{-1}$</td></tr>
            <tr><td>$q_r$</td><td>Radiative heat loss per unit length</td><td>W&nbsp;m$^{-1}$</td></tr>
            <tr><td>$q_c$</td><td>Convective heat loss per unit length (max of three regimes)</td><td>W&nbsp;m$^{-1}$</td></tr>
            <tr><td>$q_{c,\\text{nat}},\\,q_{c,1},\\,q_{c,2}$</td><td>Natural / low-wind / high-wind convective regimes</td><td>W&nbsp;m$^{-1}$</td></tr>
            <tr><td>$q_J$</td><td>Joule heat gain per unit length, $I^{2}R$</td><td>W&nbsp;m$^{-1}$</td></tr>
          </tbody>
        </table>

        <p>
          For every transmission line in the system the conductor surface temperature
          $T_s$ is obtained by solving the steady-state IEEE&nbsp;Std&nbsp;738-2023
          per-unit-length heat balance:
        </p>
        $$ q_c(T_s) + q_r(T_s) \\;=\\; q_s + I^{2}\\,R(T_s) $$
        <p>
          where $q_c$ is convective cooling, $q_r$ is radiative cooling,
          $q_s$ is solar heating, and $I^{2}R$ is Joule heating from the
          AC power-flow current $I$. The equation is solved by bisection on
          $T_s\\in[T_{\\text{amb}},\\,250\\,^{\\circ}\\mathrm{C}]$ to a tolerance
          of $10^{-3}\\,\\mathrm{K}$.
        </p>

        <h3>Current calculation</h3>
        <p>
          The conductor current magnitude $I$ is obtained directly from the AC
          power-flow solution at the sending end of each branch $i\\!\\to\\!j$
          using the apparent power and bus voltage:
        </p>
        $$ S_{ij} \\;=\\; \\sqrt{P_{ij}^{\\,2} + Q_{ij}^{\\,2}} $$
        $$ I \\;=\\; \\frac{S_{ij}\\times 10^{6}}{\\sqrt{3}\\,|V_i|\\times 10^{3}}
                \\;=\\; \\frac{1000\\,S_{ij}\\,[\\mathrm{MVA}]}{\\sqrt{3}\\,|V_i|\\,[\\mathrm{kV}]} $$
        <p>
          where $P_{ij}$ [MW] and $Q_{ij}$ [MVAr] are the active and reactive
          power flowing out of bus $i$ on the branch, and $|V_i|$ [kV] is the
          line-to-line voltage magnitude at the sending bus. The factor
          $\\sqrt{3}$ converts three-phase line-to-line quantities to the
          per-conductor current used in the IEEE&nbsp;738 heat balance. Both
          $|V_i|$ and $P_{ij},Q_{ij}$ come from the same AC&nbsp;power-flow
          snapshot (base case or N-1 contingency) so the resulting $I$ is
          self-consistent with the voltage profile.
        </p>

        <h3>Solar heating</h3>
        <p>The solar contribution per unit length, given the global horizontal irradiance $G$ [W&nbsp;m$^{-2}$], conductor diameter $D_0$ [m] and solar absorptivity $\\alpha_s$:</p>
        $$ q_s \\;=\\; \\alpha_s\\,G\\,D_0 $$

        <h3>Radiative cooling</h3>
        <p>Stefan–Boltzmann radiation exchange between the conductor surface and the surrounding air at temperatures $T_s$, $T_a$ [K], with emissivity $\\varepsilon$ and Stefan–Boltzmann constant $\\sigma=5.67\\times10^{-8}$ W&nbsp;m$^{-2}$&nbsp;K$^{-4}$:</p>
        $$ q_r \\;=\\; \\pi\\,D_0\\,\\varepsilon\\,\\sigma\\,\\bigl(T_s^{\\,4}-T_a^{\\,4}\\bigr) $$

        <h3>Convective cooling</h3>
        <p>The film temperature is the mean of conductor and ambient air:</p>
        $$ T_{\\text{film}} \\;=\\; \\tfrac{1}{2}\\bigl(T_s + T_a\\bigr) $$
        <p>Air properties at $T_{\\text{film}}$ (IEEE&nbsp;738 eqs. 13a–15a):</p>
        $$ \\mu_f \\;=\\; \\frac{1.458\\times10^{-6}\\,T_{\\text{film}}^{\\,1.5}}{T_{\\text{film}}-273.15+383.4} $$
        $$ \\rho_f \\;=\\; \\frac{1.293-1.525\\times10^{-4} H_e + 6.379\\times10^{-9} H_e^{2}}{1+0.00367\\,(T_{\\text{film}}-273.15)} $$
        $$ k_f \\;=\\; 2.424\\times10^{-2} + 7.477\\times10^{-5}(T_{\\text{film}}-273.15) - 4.407\\times10^{-9}(T_{\\text{film}}-273.15)^{2} $$
        <p>Reynolds number for windspeed $V_w$:</p>
        $$ N_{\\text{Re}} \\;=\\; \\frac{D_0\\,\\rho_f\\,|V_w|}{\\mu_f} $$
        <p>Wind direction factor for the angle $\\phi$ between the wind vector and conductor axis (IEEE&nbsp;738 eq. 4a):</p>
        $$ K_{\\text{angle}} \\;=\\; 1.194 - \\cos\\phi + 0.194\\cos 2\\phi + 0.368\\sin 2\\phi $$
        <p>The convective cooling rate is the maximum of three regimes — natural (zero wind), low-wind forced and high-wind forced (IEEE&nbsp;738 eqs. 3a, 3b, 3c):</p>
        $$ q_{c,\\text{nat}} \\;=\\; 3.645\\,\\rho_f^{0.5}\\,D_0^{0.75}\\,(T_s-T_a)^{1.25} $$
        $$ q_{c,1} \\;=\\; K_{\\text{angle}}\\bigl(1.01 + 1.35\\,N_{\\text{Re}}^{0.52}\\bigr)\\,k_f\\,(T_s-T_a) $$
        $$ q_{c,2} \\;=\\; K_{\\text{angle}}\\,0.754\\,N_{\\text{Re}}^{0.6}\\,k_f\\,(T_s-T_a) $$
        $$ q_c \\;=\\; \\max\\bigl(q_{c,\\text{nat}},\\,q_{c,1},\\,q_{c,2}\\bigr) $$

        <h3>Air density (ideal-gas, with humidity)</h3>
        <p>The implementation uses the moist-air ideal-gas form rather than IEEE&nbsp;738 eq.&nbsp;14a, with the saturation vapor pressure of water given by the Tetens formula and partial pressure $p_{wv}=\\mathrm{RH}\\,p_{wv,\\text{sat}}(T)$:</p>
        $$ p_{wv,\\text{sat}}(T) \\;=\\; 610.78\\,\\exp\\!\\left(\\frac{17.27\\,(T-273.15)}{(T-273.15)+237.3}\\right) $$
        $$ \\rho_{\\text{air}} \\;=\\; \\frac{p-p_{wv}}{R_d\\,T} + \\frac{p_{wv}}{R_v\\,T},\\qquad R_d=287.058,\\;R_v=461.495\\;\\text{J kg}^{-1}\\text{K}^{-1} $$

        <h3>Joule heating</h3>
        <p>Per-unit-length ohmic loss for the AC-power-flow current magnitude $I$ and conductor resistance $R$ (Ω&nbsp;m$^{-1}$):</p>
        $$ q_J \\;=\\; I^{2}\\,R $$

        <h3>Default conductor parameters (ACSR Drake-like)</h3>
        <ul class="info-panel-list">
          <li>$D_0 = 0.02814\\;\\mathrm{m}$</li>
          <li>$R = 8.688\\times10^{-5}\\;\\Omega\\,\\mathrm{m}^{-1}$</li>
          <li>$\\varepsilon = 0.8$, $\\;\\alpha_s = 0.8$</li>
          <li>Maximum design temperature $T_{\\max}=75\\,^{\\circ}\\mathrm{C}$</li>
        </ul>

        <h3>Workflow</h3>
        <ol class="info-panel-list">
          <li>Read line-flow CSV (base or N-1) — current $I$ comes from the AC power-flow solution.</li>
          <li>Read <code>bus.geojson</code> for bus coordinates; compute each line's midpoint and forward bearing.</li>
          <li>Match each midpoint to the nearest weather site (KDTree on <code>meta.csv</code>).</li>
          <li>Slice the five weather parquets at the requested timestamp for $T_a$, $V_w$, $G$, RH, and air pressure.</li>
          <li>Solve the heat balance above by bisection for the steady-state $T_s$.</li>
        </ol>

        <h3>Weather data</h3>
        <p>
          Weather inputs are sourced from NLR's
          <a href="https://nsrdb.nrel.gov/" target="_blank" rel="noopener">National Solar Radiation Database (NSRDB)</a>,
          extracted on the NLR Kestrel HPC from
          <code>/kfs2/datasets/NSRDB/current/nsrdb_2022.h5</code>
          and pre-sliced to the California footprint for the 2022 calendar year. The
          per-variable parquet files used by this application live in
          <code>temperature_calculation/data/ca_2022/</code>:
        </p>
        <ul class="info-panel-list">
          <li><code>air_temperature.parquet</code> — ambient air temperature $T_a$ [°C], hourly.</li>
          <li><code>ghi.parquet</code> — global horizontal irradiance $G$ [W&nbsp;m$^{-2}$], hourly.</li>
          <li><code>surface_pressure.parquet</code> — surface air pressure $p$ [Pa], hourly.</li>
          <li><code>wind_speed.parquet</code> — 10&nbsp;m wind speed $V_w$ [m&nbsp;s$^{-1}$], hourly.</li>
          <li><code>wind_direction.parquet</code> — 10&nbsp;m wind direction [°], hourly; combined with the line bearing to obtain the wind/conductor angle $\\phi$.</li>
          <li><code>meta.csv</code> — NSRDB site metadata (site id, latitude, longitude, elevation) used to build the KDTree for nearest-site lookup.</li>
        </ul>
        <p>
          Relative humidity is held at the default $\\mathrm{RH}=0.5$ (50&nbsp;%); NSRDB
          relative humidity can be substituted by extending the parquet set without
          changing the solver.
        </p>

        <h3>Bibliography</h3>
        <ol class="info-panel-bibliography">
          <li>
            IEEE Power and Energy Society. <em>IEEE Standard for Calculating the
            Current-Temperature Relationship of Bare Overhead Conductors</em>,
            IEEE Std 738-2012 (Revision of IEEE Std 738-2006 — Incorporates IEEE
            Std 738-2012 Cor 1-2013), pp. 1–72, 23 Dec. 2013.
            <a href="https://doi.org/10.1109/IEEESTD.2013.6692858" target="_blank" rel="noopener">doi:10.1109/IEEESTD.2013.6692858</a>.
          </li>
          <li>
            IEEE Power and Energy Society. <em>IEEE Standard for Calculating the
            Current-Temperature Relationship of Bare Overhead Conductors</em>,
            IEEE Std 738-2023.
          </li>
          <li>
            Bartos, M., Chester, M., Johnson, N., Gorman, B., Eisenberg, D.,
            Linkov, I., &amp; Bates, M. (2016).
            Impacts of rising air temperatures on electric transmission ampacity
            and peak electricity load in the United States.
            <em>Environmental Research Letters</em>, 11(11), 114008.
            <a href="https://dx.doi.org/10.1088/1748-9326/11/11/114008" target="_blank" rel="noopener">doi:10.1088/1748-9326/11/11/114008</a>.
          </li>
          <li>
            Tetens, O. (1930). Über einige meteorologische Begriffe.
            <em>Zeitschrift für Geophysik</em>, 6, 297–309.
            (Saturation vapor pressure formula; see
            <a href="https://en.wikipedia.org/wiki/Vapour_pressure_of_water" target="_blank" rel="noopener">Wikipedia: Vapour pressure of water</a>.)
          </li>
          <li>
            Sengupta, M., Xie, Y., Lopez, A., Habte, A., Maclaurin, G., &amp; Shelby, J. (2018).
            The National Solar Radiation Data Base (NSRDB).
            <em>Renewable and Sustainable Energy Reviews</em>, 89, 51–60.
            <a href="https://doi.org/10.1016/j.rser.2018.03.003" target="_blank" rel="noopener">doi:10.1016/j.rser.2018.03.003</a>.
            Data accessed on the NLR Kestrel HPC at
            <code>/kfs2/datasets/NSRDB/current/nsrdb_2022.h5</code>.
          </li>
        </ol>
      </div>
    `;

    let infoPanelEl = null;
    let infoPanelOverlayEl = null;
    let infoPanelTypeset = false;

    const closeInfoPanel = () => {
      if (infoPanelEl) {
        infoPanelEl.classList.remove("open");
      }
      if (infoPanelOverlayEl) {
        infoPanelOverlayEl.classList.remove("open");
      }
    };

    const openInfoPanel = () => {
      if (!infoPanelEl) {
        return;
      }
      infoPanelEl.classList.add("open");
      if (infoPanelOverlayEl) {
        infoPanelOverlayEl.classList.add("open");
      }
      if (!infoPanelTypeset && window.MathJax && window.MathJax.typesetPromise) {
        window.MathJax.typesetPromise([infoPanelEl]).then(() => {
          infoPanelTypeset = true;
        }).catch(() => {});
      }
    };

    const createInfoPanel = () => {
      if (infoPanelEl) {
        return;
      }
      const overlay = document.createElement("div");
      overlay.className = "info-panel-overlay";
      overlay.addEventListener("click", closeInfoPanel);
      document.body.appendChild(overlay);
      infoPanelOverlayEl = overlay;

      const panel = document.createElement("aside");
      panel.className = "info-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "Conductor temperature methodology");
      panel.innerHTML = INFO_PANEL_HTML;
      document.body.appendChild(panel);
      infoPanelEl = panel;

      const closeBtn = panel.querySelector("#info-panel-close");
      if (closeBtn) {
        closeBtn.addEventListener("click", closeInfoPanel);
      }

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeInfoPanel();
        }
      });
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

        const simulationBtn = L.DomUtil.create("button", "view-mode-tab", container);
        simulationBtn.id = "view-mode-simulation";
        simulationBtn.type = "button";
        simulationBtn.textContent = "Simulation";

        const infoBtn = L.DomUtil.create("button", "view-mode-info-btn", container);
        infoBtn.id = "view-mode-info";
        infoBtn.type = "button";
        infoBtn.title = "Conductor temperature methodology";
        infoBtn.setAttribute("aria-label", "Information");
        infoBtn.innerHTML = "<span class=\"info-glyph\">i</span>";

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        defaultBtn.addEventListener("click", () => setViewMode("default"));
        baseCaseBtn.addEventListener("click", () => setViewMode("baseCase"));
        contingencyBtn.addEventListener("click", () => setViewMode("contingency"));
        simulationBtn.addEventListener("click", () => setViewMode("simulation"));
        infoBtn.addEventListener("click", () => openInfoPanel());

        return container;
      }
    });

    map.addControl(new ViewModeControl());

    createInfoPanel();

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
