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
      host.__pbcTimers.forEach(function (id) {
        clearTimeout(id);
      });
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
      config.containerWidth = Math.round(rect.width || host.clientWidth || 0);
      config.containerHeight = Math.round(
        rect.height || host.clientHeight || 0
      );
      renderer.render(root, config);
    });
  }

  function queueRenders(host) {
    clearTimers(host);
    host.__pbcTimers = [0, 80, 250, 500].map(function (d) {
      return setTimeout(function () {
        scheduleRender(host);
      }, d);
    });
  }

  function ensureBindings(host) {
    if (!host || host.__pbcBound) return;
    host.__pbcTimers = [];
    host.__pbcBound = true;

    if (typeof ResizeObserver === "function") {
      host.__pbcRO = new ResizeObserver(function () {
        queueRenders(host);
      });
      host.__pbcRO.observe(host);
      if (host.parentElement) host.__pbcRO.observe(host.parentElement);
    }

    host.__pbcWinResize = function () {
      queueRenders(host);
    };
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
    var sorted = values.slice().sort(function (a, b) {
      return a - b;
    });
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

  var MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];

  function qlikSerialToLocalDate(qNum) {
    if (!Number.isFinite(qNum)) return null;
    var wholeDays = Math.floor(qNum);
    var utcDate = new Date(Date.UTC(1899, 11, 30 + wholeDays));
    if (isNaN(utcDate.getTime())) return null;
    return new Date(
      utcDate.getUTCFullYear(),
      utcDate.getUTCMonth(),
      utcDate.getUTCDate()
    );
  }

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
      var d = qlikSerialToLocalDate(qNum);
      if (!isNaN(d.getTime())) {
        var yy = d.getFullYear();
        var mm = d.getMonth();
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

  /**
   * Convert a dimension cell to a JS Date if possible.
   * Returns null when conversion fails.
   */
  function cellToDate(cell) {
    if (!cell) return null;
    var qNum = cell.qNum;
    if (Number.isFinite(qNum) && qNum > 1000) {
      return qlikSerialToLocalDate(qNum);
    }
    var txt = (cell.qText || "").trim();
    if (!txt) return null;
    // Try ISO or common formats
    var iso = txt.match(/(\d{4})[\-\/]?(\d{1,2})[\-\/]?(\d{1,2})/);
    if (iso) {
      var y = parseInt(iso[1], 10);
      var m = parseInt(iso[2], 10) - 1;
      var day = parseInt(iso[3] || "1", 10);
      var dd = new Date(y, m, day);
      return isNaN(dd.getTime()) ? null : dd;
    }
    var parsed = new Date(txt);
    if (isNaN(parsed.getTime())) return null;
    // Normalize parsed dates to local midnight
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  function monthKeyToLabel(key) {
    // key = "2024-01"
    var parts = key.split("-");
    var mi = parseInt(parts[1], 10) - 1;
    return MONTH_NAMES[mi] + " " + parts[0];
  }

  function formatDateKey(date) {
    if (!date || isNaN(date.getTime())) return null;
    var year = date.getFullYear();
    var month = (date.getMonth() + 1).toString();
    var day = date.getDate().toString();
    if (month.length < 2) month = "0" + month;
    if (day.length < 2) day = "0" + day;
    return year + "-" + month + "-" + day;
  }

  function formatDateLabel(date, fallback) {
    if (!date || isNaN(date.getTime())) return fallback || "";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function parseAnnotationEntries(raw) {
    if (!raw || typeof raw !== "string") return [];
    return raw
      .split(/\r?\n|;/)
      .map(function (entry) {
        return entry.trim();
      })
      .filter(Boolean)
      .map(function (entry) {
        var parts = entry.split("|");
        var dateKey = (parts.shift() || "").trim();
        var message = parts.join("|").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !message) return null;
        return { dateKey: dateKey, message: message };
      })
      .filter(Boolean);
  }

  function getDateSortValue(cell) {
    if (!cell) return NaN;
    if (Number.isFinite(cell.qNum)) return cell.qNum;
    var parsed = new Date((cell.qText || "").trim());
    if (!isNaN(parsed.getTime())) return parsed.getTime();
    return NaN;
  }

  /**
   * Extract and aggregate values to one point per invoice date.
   * This keeps the plotted series and prediction overlays on the same daily grain.
   */
  function extractDateData(cube) {
    if (!cube) return [];
    var page = (cube.qDataPages || [])[0];
    var rows = page ? page.qMatrix : [];
    if (!rows.length) return [];

    var grouped = {};

    rows.forEach(function (row) {
      var date = cellToDate(row[0]);
      if (!date) return;
      var val = parseNum(row[1]);
      if (!Number.isFinite(val)) return;

      var dateKey = formatDateKey(date);
      if (!dateKey) return;
      var monthKey = dateKey.slice(0, 7);

      if (!grouped[dateKey]) {
        grouped[dateKey] = {
          label: formatDateLabel(date, row[0] && row[0].qText),
          value: 0,
          monthKey: monthKey,
          monthLabel: monthKeyToLabel(monthKey),
          sortValue: date.getTime(),
          date: date,
          dateKey: dateKey,
          rowCount: 0
        };
      }

      grouped[dateKey].value += val;
      grouped[dateKey].rowCount += 1;
    });

    var points = Object.keys(grouped).map(function (key) {
      return grouped[key];
    });

    points.sort(function (a, b) {
      if (Number.isFinite(a.sortValue) && Number.isFinite(b.sortValue)) {
        return a.sortValue - b.sortValue;
      }
      return a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0;
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
              { value: "minmax", label: "Empirical Bounds (pct)" },
              { value: "stddev", label: "Pacing ± 1σ" },
              { value: "regression", label: "Regression Bootstrap" }
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
          confidenceLevel: {
            ref: "props.confidenceLevel",
            label: "Confidence Level",
            type: "number",
            defaultValue: 0.95,
            expression: "optional"
          },
          bootstrapIterations: {
            ref: "props.bootstrapIterations",
            label: "Bootstrap Iterations",
            type: "number",
            defaultValue: 500,
            expression: "optional"
          },
          pacingLineColor: {
            ref: "props.pacingLineColor",
            label: "Pacing Line Color",
            type: "string",
            defaultValue: "#e35a24"
          },
          budgetValue: {
            ref: "props.budgetValue",
            label: "Budget Value",
            type: "number",
            defaultValue: 0,
            expression: "optional"
          },
          showBudgetLine: {
            ref: "props.showBudgetLine",
            label: "Show Budget Line",
            type: "boolean",
            defaultValue: false
          },
          budgetLineColor: {
            ref: "props.budgetLineColor",
            label: "Budget Line Color",
            type: "string",
            defaultValue: "#44b3ff"
          },
          lastYearValue: {
            ref: "props.lastYearValue",
            label: "Last Year Value",
            type: "number",
            defaultValue: 0,
            expression: "optional"
          },
          showLastYearLine: {
            ref: "props.showLastYearLine",
            label: "Show Last Year Line",
            type: "boolean",
            defaultValue: false
          },
          lastYearLineColor: {
            ref: "props.lastYearLineColor",
            label: "Last Year Line Color",
            type: "string",
            defaultValue: "#6e6e6e"
          },
          annotationEntries: {
            ref: "props.annotationEntries",
            label: "Comments (YYYY-MM-DD|Message)",
            type: "string",
            defaultValue: ""
          },
          annotationLineColor: {
            ref: "props.annotationLineColor",
            label: "Comment Line Color",
            type: "string",
            defaultValue: "#b8b8b8"
          }
          ,
          yAxisMin: {
            ref: "props.yAxisMin",
            label: "Y Axis Minimum (optional)",
            type: "number",
            expression: "optional"
          },
          yAxisMax: {
            ref: "props.yAxisMax",
            label: "Y Axis Maximum (optional)",
            type: "number",
            expression: "optional"
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
      var pendingZoomAnchor = host.__pbcZoomAnchor || null;
      host.__pbcZoomAnchor = null;
      var annotationEntriesText =
        typeof host.__pbcAnnotationsText === "string"
          ? host.__pbcAnnotationsText
          : props.annotationEntries || "";

      var rect = host.getBoundingClientRect
        ? host.getBoundingClientRect()
        : { width: 0, height: 0 };

      host.__pbcConfig = {
        title: props.chartTitle || "Prediction Band Chart",
        theme: host.__pbcTheme === "light" ? "light" : "dark",
        viewMode: host.__pbcViewMode === "table" ? "table" : "chart",
        menuOpen: Boolean(host.__pbcMenuOpen),
        bandMode: props.bandMode || "minmax",
        lineColor: props.lineColor || "#84bd00",
        bandColor: props.bandColor || "#44b3ff",
        bandOpacity: Number.isFinite(props.bandOpacity)
          ? props.bandOpacity
          : 0.2,
        pacingLineColor: props.pacingLineColor || "#e35a24",
        budgetValue: Number.isFinite(props.budgetValue)
          ? props.budgetValue
          : null,
        showBudgetLine: props.showBudgetLine === true,
        budgetLineColor: props.budgetLineColor || "#44b3ff",
        lastYearValue: Number.isFinite(props.lastYearValue)
          ? props.lastYearValue
          : null,
        showLastYearLine: props.showLastYearLine === true,
        lastYearLineColor: props.lastYearLineColor || "#6e6e6e",
        annotations: parseAnnotationEntries(annotationEntriesText),
        annotationLineColor: props.annotationLineColor || "#b8b8b8",
        data: data,
        stats: stats,
        dimLabel: getDimLabel(layout.qHyperCube),
        measLabel: getMeasLabel(layout.qHyperCube),
        containerWidth: Math.round(rect.width || host.clientWidth || 0),
        containerHeight: Math.round(rect.height || host.clientHeight || 0),
        confidence: Number.isFinite(props.confidenceLevel)
          ? props.confidenceLevel
          : 0.95,
        bootstrapIterations: Number.isFinite(props.bootstrapIterations)
          ? props.bootstrapIterations
          : 500,
        zoomScale: Number.isFinite(host.__pbcZoomScale)
          ? host.__pbcZoomScale
          : 1,
        zoomAnchor: pendingZoomAnchor,
        excludeWeekends: Boolean(host.__pbcExcludeWeekends),
        holidays: Array.isArray(host.__pbcHolidays)
          ? host.__pbcHolidays
          : host.__pbcHolidays
            ? host.__pbcHolidays
            : [],
        filterMin: Number.isFinite(host.__pbcFilterMin)
          ? host.__pbcFilterMin
          : undefined,
        yAxisMin: Number.isFinite(props.yAxisMin) ? props.yAxisMin : undefined,
        yAxisMax: Number.isFinite(props.yAxisMax) ? props.yAxisMax : undefined,
        onToggleExcludeWeekends: function () {
          host.__pbcExcludeWeekends = !host.__pbcExcludeWeekends;
          if (host.__pbcConfig)
            host.__pbcConfig.excludeWeekends = Boolean(
              host.__pbcExcludeWeekends
            );
          queueRenders(host);
        },
        onEditHolidays: function () {
          // Ask user for comma-separated YYYY-MM-DD list
          try {
            var curr = Array.isArray(host.__pbcHolidays)
              ? host.__pbcHolidays.join(",")
              : host.__pbcHolidays || "";
            var res = window.prompt(
              "Enter holiday dates (comma-separated, YYYY-MM-DD):",
              curr || ""
            );
            if (res !== null) {
              var arr = res
                .split(/[,;]+/)
                .map(function (s) {
                  return s.trim();
                })
                .filter(Boolean);
              host.__pbcHolidays = arr;
              if (host.__pbcConfig) host.__pbcConfig.holidays = arr;
              queueRenders(host);
            }
          } catch (e) {
            /* ignore */
          }
        },
        onEditAnnotations: function () {
          try {
            var curr =
              typeof host.__pbcAnnotationsText === "string"
                ? host.__pbcAnnotationsText
                : props.annotationEntries || "";
            var res = window.prompt(
              "Enter comments as YYYY-MM-DD|Message ; YYYY-MM-DD|Message",
              curr || ""
            );
            if (res !== null) {
              host.__pbcAnnotationsText = res;
              if (host.__pbcConfig)
                host.__pbcConfig.annotations = parseAnnotationEntries(res);
              queueRenders(host);
            }
          } catch (e) {
            /* ignore */
          }
        },
        onBandToggle: function () {
          var curr = host.__pbcConfig.bandMode;
          var next =
            curr === "minmax"
              ? "stddev"
              : curr === "stddev"
                ? "regression"
                : "minmax";
          host.__pbcConfig.bandMode = next;
          queueRenders(host);
        },
        onThemeToggle: function () {
          host.__pbcTheme = host.__pbcTheme === "light" ? "dark" : "light";
          if (host.__pbcConfig) host.__pbcConfig.theme = host.__pbcTheme;
          queueRenders(host);
        },
        onMenuToggle: function () {
          host.__pbcMenuOpen = !host.__pbcMenuOpen;
          if (host.__pbcConfig) host.__pbcConfig.menuOpen = host.__pbcMenuOpen;
          queueRenders(host);
        },
        onSelectViewMode: function (mode) {
          host.__pbcViewMode = mode === "table" ? "table" : "chart";
          host.__pbcMenuOpen = false;
          if (host.__pbcConfig) {
            host.__pbcConfig.viewMode = host.__pbcViewMode;
            host.__pbcConfig.menuOpen = false;
          }
          queueRenders(host);
        },
        onZoom: function (direction, anchorRatio) {
          var currZoom = Number.isFinite(host.__pbcZoomScale)
            ? host.__pbcZoomScale
            : 1;
          var factor = direction > 0 ? 1.2 : 1 / 1.2;
          var nextZoom = Math.max(0.35, Math.min(8, currZoom * factor));
          if (Math.abs(nextZoom - currZoom) < 0.001) return;
          host.__pbcZoomScale = nextZoom;
          host.__pbcZoomAnchor =
            anchorRatio && typeof anchorRatio === "object" ? anchorRatio : null;
          if (host.__pbcConfig) host.__pbcConfig.zoomScale = nextZoom;
          if (host.__pbcConfig)
            host.__pbcConfig.zoomAnchor = host.__pbcZoomAnchor;
          queueRenders(host);
        },
        onFilter: function (val) {
          host.__pbcFilterMin = Number.isFinite(val) ? val : undefined;
          if (host.__pbcConfig)
            host.__pbcConfig.filterMin = host.__pbcFilterMin;
          queueRenders(host);
        }
      };

      queueRenders(host);
    },

    resize: function ($element) {
      queueRenders($element[0] || $element);
    }
  };
});
