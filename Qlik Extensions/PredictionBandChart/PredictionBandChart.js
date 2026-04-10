define([
  "qlik",
  "text!./template.html",
  "./renderer",
  "css!./PredictionBandChart.css"
], function (qlik, template, renderer) {
  "use strict";

  /* ── Resize / lifecycle helpers ──────────────────────────── */

  function clearTimers(host) {
    if (host && host.__pbcTimers) {
      host.__pbcTimers.forEach(function (id) { clearTimeout(id); });
      host.__pbcTimers = [];
    }
  }

  function scheduleRender(host) {
    if (!host) return;
    if (host.__pbcFrame) cancelAnimationFrame(host.__pbcFrame);
    host.__pbcFrame = requestAnimationFrame(function () {
      host.__pbcFrame = null;
      var root = host.querySelector(".pbc-root");
      var config = host.__pbcConfig;
      if (!root || !config) return;
      var rect = host.getBoundingClientRect
        ? host.getBoundingClientRect()
        : { width: 0, height: 0 };
      config.containerWidth  = Math.round(rect.width  || host.clientWidth  || 0);
      config.containerHeight = Math.round(rect.height || host.clientHeight || 0);
      renderer.render(root, config);
    });
  }

  function queueRenders(host) {
    clearTimers(host);
    host.__pbcTimers = [0, 80, 250, 500].map(function (d) {
      return setTimeout(function () { scheduleRender(host); }, d);
    });
  }

  function ensureBindings(host) {
    if (!host || host.__pbcBound) return;
    host.__pbcTimers = [];
    host.__pbcBound = true;

    if (typeof ResizeObserver === "function") {
      host.__pbcRO = new ResizeObserver(function () { queueRenders(host); });
      host.__pbcRO.observe(host);
      if (host.parentElement) host.__pbcRO.observe(host.parentElement);
    }

    host.__pbcWinResize = function () { queueRenders(host); };
    window.addEventListener("resize", host.__pbcWinResize);

    host.__pbcVisibility = function () {
      if (!document.hidden) queueRenders(host);
    };
    document.addEventListener("visibilitychange", host.__pbcVisibility);
  }

  /* ── Statistical helpers ─────────────────────────────────── */

  function calcStats(values) {
    var n = values.length;
    if (n === 0) return { mean: 0, median: 0, min: 0, max: 0, stddev: 0 };

    var sum = 0;
    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < n; i++) {
      sum += values[i];
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    var mean = sum / n;

    // Median
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var median;
    if (n % 2 === 0) {
      median = (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    } else {
      median = sorted[Math.floor(n / 2)];
    }

    // Population standard deviation
    var sqDiffSum = 0;
    for (var j = 0; j < n; j++) {
      sqDiffSum += (values[j] - mean) * (values[j] - mean);
    }
    var stddev = Math.sqrt(sqDiffSum / n);

    return { mean: mean, median: median, min: min, max: max, stddev: stddev };
  }

  /* ── Extract & aggregate data by month ────────────────────── */

  var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun",
                     "Jul","Aug","Sep","Oct","Nov","Dec"];

  function parseNum(cell) {
    if (!cell) return NaN;
    var v = cell.qNum;
    if (Number.isFinite(v)) return v;
    // Fallback: parse the formatted text (strip thousands separators)
    var txt = (cell.qText || "").replace(/[^\d.\-eE]/g, "");
    var n = parseFloat(txt);
    return Number.isFinite(n) ? n : NaN;
  }

  /**
   * Try to extract a YYYY-MM key from a date string or Qlik serial date.
   * Qlik stores dates as serial numbers (days since 1899-12-30).
   * Dimension qText may be "1/15/2024", "2024-01-15", "Jan 2024", etc.
   */
  function toMonthKey(cell) {
    if (!cell) return null;

    // 1. Try Qlik serial date number → JS Date
    var qNum = cell.qNum;
    if (Number.isFinite(qNum) && qNum > 1000) {
      // Qlik epoch: 1899-12-30
      var ms = (qNum - 25569) * 86400000; // convert to Unix ms
      var d = new Date(ms);
      if (!isNaN(d.getTime())) {
        var yy = d.getUTCFullYear();
        var mm = d.getUTCMonth(); // 0-based
        return yy + "-" + (mm < 9 ? "0" : "") + (mm + 1);
      }
    }

    // 2. Try parsing qText as a date string
    var txt = (cell.qText || "").trim();
    if (!txt) return null;

    // ISO-ish: 2024-01-15 or 2024/01/15
    var iso = txt.match(/(\d{4})[\-\/](\d{1,2})/);
    if (iso) return iso[1] + "-" + (iso[2].length === 1 ? "0" : "") + iso[2];

    // US-ish: 1/15/2024 or 01-15-2024
    var us = txt.match(/(\d{1,2})[\-\/]\d{1,2}[\-\/](\d{4})/);
    if (us) return us[2] + "-" + (us[1].length === 1 ? "0" : "") + us[1];

    // Fallback: let JS parse it
    var parsed = new Date(txt);
    if (!isNaN(parsed.getTime())) {
      var py = parsed.getFullYear();
      var pm = parsed.getMonth();
      return py + "-" + (pm < 9 ? "0" : "") + (pm + 1);
    }

    return null;
  }

  function monthKeyToLabel(key) {
    // key = "2024-01"
    var parts = key.split("-");
    var mi = parseInt(parts[1], 10) - 1;
    return MONTH_NAMES[mi] + " " + parts[0];
  }

  function getDateSortValue(cell) {
    if (!cell) return NaN;
    if (Number.isFinite(cell.qNum)) return cell.qNum;
    var parsed = new Date((cell.qText || "").trim());
    if (!isNaN(parsed.getTime())) return parsed.getTime();
    return NaN;
  }

  /**
   * Extract raw date points in ascending order.
   * The main line stays at date grain; month grouping is used only for overlays.
   */
  function extractDateData(cube) {
    if (!cube) return [];
    var page = (cube.qDataPages || [])[0];
    var rows = page ? page.qMatrix : [];
    if (!rows.length) return [];

    var points = [];

    rows.forEach(function (row) {
      var mKey = toMonthKey(row[0]);
      if (!mKey) return;
      var val = parseNum(row[1]);
      if (!Number.isFinite(val)) return;

      points.push({
        label: row[0] && row[0].qText ? row[0].qText : monthKeyToLabel(mKey),
        value: val,
        monthKey: mKey,
        monthLabel: monthKeyToLabel(mKey),
        sortValue: getDateSortValue(row[0])
      });
    });

    points.sort(function (a, b) {
      if (Number.isFinite(a.sortValue) && Number.isFinite(b.sortValue)) {
        return a.sortValue - b.sortValue;
      }
      if (a.monthKey !== b.monthKey) return a.monthKey < b.monthKey ? -1 : 1;
      return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    });

    return points;
  }

  function getDimLabel(cube) {
    var dims = cube && cube.qDimensionInfo;
    return dims && dims[0] ? dims[0].qFallbackTitle : "Invoice Date";
  }

  function getMeasLabel(cube) {
    var meas = cube && cube.qMeasureInfo;
    return meas && meas[0] ? meas[0].qFallbackTitle : "Material Value";
  }

  /* ── Property panel definition ───────────────────────────── */

  var definition = {
    type: "items",
    component: "accordion",
    items: {
      dimensions: {
        uses: "dimensions",
        min: 1,
        max: 1
      },
      measures: {
        uses: "measures",
        min: 1,
        max: 1
      },
      sorting: {
        uses: "sorting"
      },
      settings: {
        uses: "settings"
      },
      bandSettings: {
        label: "Prediction Band",
        type: "items",
        items: {
          bandMode: {
            ref: "props.bandMode",
            label: "Band Mode",
            type: "string",
            component: "buttongroup",
            defaultValue: "minmax",
            options: [
              { value: "minmax",  label: "Min / Max" },
              { value: "stddev", label: "Mean ± 1σ" }
            ]
          },
          chartTitle: {
            ref: "props.chartTitle",
            label: "Chart Title",
            type: "string",
            defaultValue: "Prediction Band Chart"
          },
          lineColor: {
            ref: "props.lineColor",
            label: "Line Color",
            type: "string",
            defaultValue: "#84bd00"
          },
          bandColor: {
            ref: "props.bandColor",
            label: "Band Fill Color",
            type: "string",
            defaultValue: "#44b3ff"
          },
          bandOpacity: {
            ref: "props.bandOpacity",
            label: "Band Opacity (0–1)",
            type: "number",
            defaultValue: 0.2,
            expression: "optional"
          },
          meanLineColor: {
            ref: "props.meanLineColor",
            label: "Mean Line Color",
            type: "string",
            defaultValue: "#ff9f43"
          },
          medianLineColor: {
            ref: "props.medianLineColor",
            label: "Median Line Color",
            type: "string",
            defaultValue: "#f15bb5"
          },
          showMeanLine: {
            ref: "props.showMeanLine",
            label: "Show Mean Line",
            type: "boolean",
            defaultValue: true
          },
          showMedianLine: {
            ref: "props.showMedianLine",
            label: "Show Median Line",
            type: "boolean",
            defaultValue: true
          }
        }
      }
    }
  };

  /* ── Extension return ────────────────────────────────────── */

  return {
    template: template,
    definition: definition,
    support: { snapshot: true, export: true, exportData: false },

    initialProperties: {
      qHyperCubeDef: {
        qDimensions: [],
        qMeasures: [],
        qInitialDataFetch: [{ qWidth: 2, qHeight: 5000 }],
        qInterColumnSortOrder: [0],
        qSuppressMissing: true
      }
    },

    paint: function ($element, layout) {
      var host = $element[0] || $element;
      ensureBindings(host);

      var data = extractDateData(layout.qHyperCube);
      var values = [];
      data.forEach(function (d) {
        if (Number.isFinite(d.value)) values.push(d.value);
      });

      var stats = calcStats(values);
      var props = layout.props || {};

      var rect = host.getBoundingClientRect
        ? host.getBoundingClientRect()
        : { width: 0, height: 0 };

      host.__pbcConfig = {
        title:          props.chartTitle     || "Prediction Band Chart",
        bandMode:       props.bandMode       || "minmax",
        lineColor:      props.lineColor      || "#84bd00",
        bandColor:      props.bandColor      || "#44b3ff",
        bandOpacity:    Number.isFinite(props.bandOpacity) ? props.bandOpacity : 0.2,
        meanLineColor:  props.meanLineColor  || "#ff9f43",
        medianLineColor:props.medianLineColor|| "#f15bb5",
        showMeanLine:   props.showMeanLine !== false,
        showMedianLine: props.showMedianLine !== false,
        data:           data,
        stats:          stats,
        dimLabel:       getDimLabel(layout.qHyperCube),
        measLabel:      getMeasLabel(layout.qHyperCube),
        containerWidth: Math.round(rect.width  || host.clientWidth  || 0),
        containerHeight:Math.round(rect.height || host.clientHeight || 0),
        filterMin:      Number.isFinite(host.__pbcFilterMin) ? host.__pbcFilterMin : undefined,
        onBandToggle: function () {
          var curr = host.__pbcConfig.bandMode;
          host.__pbcConfig.bandMode = curr === "minmax" ? "stddev" : "minmax";
          queueRenders(host);
        },
        onFilter: function (val) {
          host.__pbcFilterMin = Number.isFinite(val) ? val : undefined;
          if (host.__pbcConfig) host.__pbcConfig.filterMin = host.__pbcFilterMin;
          queueRenders(host);
        },
        onFullscreen: function (entering) {
          // After toggling, let the CSS transition settle, then re-measure
          setTimeout(function () {
            var shell = host.querySelector(".pbc-shell");
            if (shell && entering) {
              host.__pbcConfig.containerWidth  = window.innerWidth;
              host.__pbcConfig.containerHeight = window.innerHeight;
            } else {
              var r = host.getBoundingClientRect();
              host.__pbcConfig.containerWidth  = Math.round(r.width  || host.clientWidth  || 0);
              host.__pbcConfig.containerHeight = Math.round(r.height || host.clientHeight || 0);
            }
            queueRenders(host);
          }, 50);
        }
      };

      queueRenders(host);
    },

    resize: function ($element) {
      queueRenders($element[0] || $element);
    }
  };
});
