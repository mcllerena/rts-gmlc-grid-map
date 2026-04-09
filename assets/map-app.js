(() => {
  const config = window.RTS_MAP_CONFIG || {};
  const geojsonBasePath = config.geojsonBasePath || "./gis";
  const fallbackCenter = Array.isArray(config.initialCenter) ? config.initialCenter : [39.5, -98.35];
  const fallbackZoom = Number.isFinite(config.initialZoom) ? config.initialZoom : 6;

  const map = L.map("map", { zoomControl: true }).setView(fallbackCenter, fallbackZoom);

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
  let genConnLayer = null;
  let areasLayer = null;
  let contingencyControlContainer = null;
  let selectedContingencyUid = "";
  const contingencySeasonByUid = {};
  const popupLayers = [];
  const warning = document.getElementById("map-warning");

  const defaultLineStyle = {
    color: "#4f81bd",
    weight: 2,
    opacity: 0.75,
    dashArray: ""
  };

  const contingencyLineStyle = {
    color: "#ff0000",
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

  const propertiesToPopupHtml = (props, title) => {
    const entries = Object.entries(props || {});
    if (!entries.length) {
      return `<b>${esc(title)}</b><br>No properties`;
    }

    const rows = entries
      .map(([key, value]) => `<b>${esc(key)}:</b> ${esc(value ?? "N/A")}`)
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
      .map((key) => `<b>${esc(key)}:</b> ${esc(p[key] ?? "N/A")}`)
      .join("<br>");
    return `<b>Generator</b><br>${rows}`;
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

  const bindHoverPopup = (layer, html) => {
    layer._popupPinned = false;
    layer.bindPopup(html, {
      closeButton: true,
      autoClose: false,
      closeOnClick: false,
      autoPan: false
    });

    popupLayers.push(layer);

    layer.on("mouseover", function onOver() {
      if (!this._popupPinned) {
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
      this.openPopup(event ? event.latlng : undefined);
    });

    layer.on("popupclose", function onClose() {
      this._popupPinned = false;
    });
  };

  const lineStyleForFeature = (feature) => {
    const uid = String((feature && feature.properties && feature.properties.UID) || "");
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

  const normalizeBusValue = (value) => {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return String(Math.trunc(numeric));
    }
    return String(value ?? "").trim();
  };

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

  const createContingencyControl = (branchGeo, lineNameByUid) => {
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
            option.textContent = season ? `${baseLabel} (${seasonLabel(season)})` : baseLabel;
          });
        };

        const syncSeasonSelectWithLine = () => {
          if (!selectedContingencyUid) {
            seasonSelect.value = "";
            seasonSelect.disabled = true;
            return;
          }
          seasonSelect.disabled = false;
          seasonSelect.value = contingencySeasonByUid[selectedContingencyUid] || "";
        };

        seasonSelect.disabled = true;

        button.addEventListener("click", () => {
          const showing = dropdownWrap.style.display !== "none";
          dropdownWrap.style.display = showing ? "none" : "block";
        });

        select.addEventListener("change", () => {
          selectedContingencyUid = select.value;
          syncSeasonSelectWithLine();
          refreshLineHighlight();
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
        });

        refreshLineOptionLabels();
        syncSeasonSelectWithLine();

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);
        return container;
      }
    });

    map.addControl(new ContingencyControl());
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

  const initializeMap = async () => {
    const [busGeo, branchGeo, genGeo, genConnGeo, lineNameRows] = await Promise.all([
      readGeoJson("bus"),
      readGeoJson("branch"),
      readGeoJson("gen"),
      readGeoJson("gen_conn"),
      readLineNamesCsv()
    ]);

    const lineNameByUid = buildLineNameByUid(branchGeo, lineNameRows);

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
        bindHoverPopup(layer, propertiesToPopupHtml(feature.properties || {}, "Line"));
      }
    }).addTo(map);

    createContingencyControl(branchGeo, lineNameByUid);

    genConnLayer = L.geoJSON(genConnGeo, {
      style: () => ({ color: "#000000", weight: 2, opacity: 0.95, dashArray: "6,6" }),
      onEachFeature: (feature, layer) => {
        bindHoverPopup(layer, propertiesToPopupHtml(feature.properties || {}, "Generator Connection"));
      }
    });

    const busesLayer = L.geoJSON(busGeo, {
      pointToLayer: (feature, latlng) => {
        const busType = busTypeOf(feature);
        const color = busTypeColor[busType] || "#000000";

        return L.marker(latlng, {
          icon: L.divIcon({
            className: "bus-square-icon",
            html: `<div style="width:12px;height:12px;background:${color};border:1px solid ${color};box-sizing:border-box;position:relative;overflow:hidden;"><span style="position:absolute;left:-2px;top:5px;width:16px;height:1.4px;background:#111;transform:rotate(45deg);transform-origin:center;"></span></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
          })
        });
      },
      onEachFeature: (feature, layer) => {
        bindHoverPopup(layer, propertiesToPopupHtml(feature.properties || {}, "Bus"));
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
        bindHoverPopup(layer, generatorPropertiesToPopupHtml(feature.properties || {}));
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

    const legendLine = "<span style=\"display:inline-block;width:16px;height:0;border-top:2px solid #4f81bd;vertical-align:middle;margin-right:6px;\"></span>";
    const legendGenConn = "<span style=\"display:inline-block;width:16px;height:0;border-top:2px dashed #000000;vertical-align:middle;margin-right:6px;\"></span>";

    const overlays = {
      Areas: areasLayer,
      [`${legendLine}Lines`]: linesLayer,
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

      setTheme(isContingency ? "dark" : "light");

      // Keep the overlays in a deterministic state by mode.
      setLayerVisible(linesLayer, true);
      setLayerVisible(areasLayer, !isContingency);
      setLayerVisible(genConnLayer, !isContingency);

      // Default mode = all component data; contingency mode = lines-only focus.
      setAllGeneratorCategories(!isContingency);
      setAllBusTypes(!isContingency);

      if (genLegendElement) {
        genLegendElement.style.display = isContingency ? "none" : "block";
      }
      if (busLegendElement) {
        busLegendElement.style.display = isContingency ? "none" : "block";
      }
      if (contingencyControlContainer) {
        contingencyControlContainer.style.display = isContingency ? "block" : "none";
      }

      setOverlayLegendEntryVisible("Generator Connections", !isContingency);

      const defaultTab = document.getElementById("view-mode-default");
      const contingencyTab = document.getElementById("view-mode-contingency");
      if (defaultTab && contingencyTab) {
        defaultTab.classList.toggle("active", !isContingency);
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

        const contingencyBtn = L.DomUtil.create("button", "view-mode-tab", container);
        contingencyBtn.id = "view-mode-contingency";
        contingencyBtn.type = "button";
        contingencyBtn.textContent = "Contingency Analysis";

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        defaultBtn.addEventListener("click", () => setViewMode("default"));
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
