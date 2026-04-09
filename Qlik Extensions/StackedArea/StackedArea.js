define([
  "qlik",
  "text!./template.html",
  "./renderer",
  "css!./StackedArea.css"
], function (qlik, template, renderer) {
  "use strict";

  /* ── Resize / lifecycle ──────────────────────────────────── */

  function clearTimers(host) {
    if (host && host.__saTimers) {
      host.__saTimers.forEach(function (id) { clearTimeout(id); });
      host.__saTimers = [];
    }
  }

  function scheduleRender(host) {
    if (!host) return;
    if (host.__saFrame) cancelAnimationFrame(host.__saFrame);
    host.__saFrame = requestAnimationFrame(function () {
      host.__saFrame = null;
      var root = host.querySelector(".sa-root");
      var config = host.__saConfig;
      if (!root || !config) return;
      var rect = host.getBoundingClientRect ? host.getBoundingClientRect() : { width: 0, height: 0 };
      config.containerWidth = Math.round(rect.width || host.clientWidth || 0);
      config.containerHeight = Math.round(rect.height || host.clientHeight || 0);
      renderer.render(root, config);
    });
  }

  function queueRenders(host) {
    clearTimers(host);
    host.__saTimers = [0, 80, 250, 500].map(function (d) {
      return setTimeout(function () { scheduleRender(host); }, d);
    });
  }

  function ensureBindings(host) {
    if (!host || host.__saBound) return;
    host.__saTimers = [];
    host.__saBound = true;

    if (typeof ResizeObserver === "function") {
      host.__saRO = new ResizeObserver(function () { queueRenders(host); });
      host.__saRO.observe(host);
      if (host.parentElement) host.__saRO.observe(host.parentElement);
    }

    host.__saWinResize = function () { queueRenders(host); };
    window.addEventListener("resize", host.__saWinResize);
  }

  /* ── Data extraction ─────────────────────────────────────── */

  function extractMainData(cube) {
    if (!cube) return { labels: [], series: {} };
    var page = (cube.qDataPages || [])[0];
    var rows = page ? page.qMatrix : [];
    var dimInfo = cube.qDimensionInfo || [];
    var measInfo = cube.qMeasureInfo || [];

    if (dimInfo.length < 2 || measInfo.length < 1) {
      return { labels: [], series: {}, xLabel: "", seriesLabel: "", measLabel: "" };
    }

    var labelsMap = {};
    var labelsOrder = [];
    var series = {};

    rows.forEach(function (row) {
      var xVal = row[0] && row[0].qText;
      var seriesName = row[1] && row[1].qText;
      var measure = row[2] && row[2].qNum;
      var measureText = row[2] && row[2].qText;

      if (!labelsMap[xVal]) {
        labelsMap[xVal] = true;
        labelsOrder.push(xVal);
      }

      if (!series[seriesName]) {
        series[seriesName] = {};
      }
      series[seriesName][xVal] = { value: Number.isFinite(measure) ? measure : 0, text: measureText };
    });

    return {
      labels: labelsOrder,
      series: series,
      xLabel: dimInfo[0].qFallbackTitle || "X Axis",
      seriesLabel: dimInfo[1].qFallbackTitle || "Series",
      measLabel: measInfo[0].qFallbackTitle || "Measure"
    };
  }

  function extractSessionData(reply) {
    var cube = reply && reply.qHyperCube;
    if (!cube) return null;
    var page = (cube.qDataPages || [])[0];
    var rows = page ? page.qMatrix : [];
    var dimInfo = cube.qDimensionInfo || [];
    var measInfo = cube.qMeasureInfo || [];

    if (dimInfo.length < 2 || measInfo.length < 1) return null;

    var labelsMap = {};
    var labelsOrder = [];
    var series = {};

    rows.forEach(function (row) {
      var xVal = row[0] && row[0].qText;
      var seriesName = row[1] && row[1].qText;
      var measure = row[2] && row[2].qNum;
      var measureText = row[2] && row[2].qText;

      if (!labelsMap[xVal]) {
        labelsMap[xVal] = true;
        labelsOrder.push(xVal);
      }

      if (!series[seriesName]) {
        series[seriesName] = {};
      }
      series[seriesName][xVal] = { value: Number.isFinite(measure) ? measure : 0, text: measureText };
    });

    return {
      labels: labelsOrder,
      series: series,
      xLabel: dimInfo[0].qFallbackTitle || "X Axis",
      seriesLabel: dimInfo[1].qFallbackTitle || "Series",
      measLabel: measInfo[0].qFallbackTitle || "Measure"
    };
  }

  /* ── Session cube management ─────────────────────────────── */

  function destroySessionCubes(host) {
    if (!host.__saSessionCubes) return;
    host.__saSessionCubes.forEach(function (h) {
      if (h && typeof h.close === "function") {
        try { h.close(); } catch (e) { /* ignore */ }
      }
    });
    host.__saSessionCubes = [];
  }

  /* ── Build config & render ───────────────────────────────── */

  function buildAndRender(host, layout, self, altDatasets) {
    var props = layout.props || {};
    var rect = host.getBoundingClientRect ? host.getBoundingClientRect() : { width: 0, height: 0 };

    var mainData = extractMainData(layout.qHyperCube);

    // Build dataset list: main + alternates
    var datasets = [];
    var mainSeriesLabel = mainData.seriesLabel || props.seriesDim || "Series";
    datasets.push({
      key: "main",
      label: mainSeriesLabel,
      data: mainData
    });

    // Add alternate datasets
    if (altDatasets) {
      Object.keys(altDatasets).forEach(function (key) {
        var ad = altDatasets[key];
        if (ad && ad.data && ad.data.labels.length > 0) {
          datasets.push({
            key: key,
            label: ad.label || key,
            data: ad.data
          });
        }
      });
    }

    // Determine active dataset (user selection stored in host)
    var activeKey = host.__saActiveDataset || "main";
    // Validate activeKey exists
    var found = datasets.some(function (ds) { return ds.key === activeKey; });
    if (!found) activeKey = "main";

    host.__saConfig = {
      title: props.chartTitle || "Stacked Area",
      datasets: datasets,
      activeKey: activeKey,
      containerWidth: Math.round(rect.width || host.clientWidth || 0),
      containerHeight: Math.round(rect.height || host.clientHeight || 0),
      onDatasetChange: function (key) {
        host.__saActiveDataset = key;
        if (host.__saConfig) host.__saConfig.activeKey = key;
        queueRenders(host);
      }
    };

    queueRenders(host);
  }

  /* ── Extension definition ────────────────────────────────── */

  return {
    initialProperties: {
      qHyperCubeDef: {
        qDimensions: [],
        qMeasures: [],
        qInitialDataFetch: [{ qWidth: 3, qHeight: 3000 }]
      }
    },
    definition: {
      type: "items",
      component: "accordion",
      items: {
        data: {
          type: "items",
          label: "Data",
          items: {
            dimensions: {
              uses: "dimensions",
              min: 2,
              max: 2,
              description: "First dimension = X axis (e.g. Invoice Date). Second dimension = series (e.g. Brand)."
            },
            measures: {
              uses: "measures",
              min: 1,
              max: 1
            }
          }
        },
        alternates: {
          type: "items",
          label: "Alternate Series",
          items: {
            altInfo: {
              label: "Add alternate series dimensions below. They share the same X-axis and measure but swap the series (2nd) dimension.",
              component: "text"
            },
            alt1Label: { ref: "props.alt1Label", type: "string", label: "Alternate 1 — Label", defaultValue: "" },
            alt1Dim: { ref: "props.alt1Dim", type: "string", label: "Alternate 1 — Series Field", defaultValue: "" },
            alt2Label: { ref: "props.alt2Label", type: "string", label: "Alternate 2 — Label", defaultValue: "" },
            alt2Dim: { ref: "props.alt2Dim", type: "string", label: "Alternate 2 — Series Field", defaultValue: "" },
            alt3Label: { ref: "props.alt3Label", type: "string", label: "Alternate 3 — Label", defaultValue: "" },
            alt3Dim: { ref: "props.alt3Dim", type: "string", label: "Alternate 3 — Series Field", defaultValue: "" },
            alt4Label: { ref: "props.alt4Label", type: "string", label: "Alternate 4 — Label", defaultValue: "" },
            alt4Dim: { ref: "props.alt4Dim", type: "string", label: "Alternate 4 — Series Field", defaultValue: "" },
            alt5Label: { ref: "props.alt5Label", type: "string", label: "Alternate 5 — Label", defaultValue: "" },
            alt5Dim: { ref: "props.alt5Dim", type: "string", label: "Alternate 5 — Series Field", defaultValue: "" }
          }
        },
        appearance: {
          type: "items",
          label: "Appearance",
          items: {
            chartTitle: {
              ref: "props.chartTitle",
              type: "string",
              label: "Chart Title",
              defaultValue: "Stacked Area"
            }
          }
        },
        settings: {
          uses: "settings"
        }
      }
    },
    support: {
      snapshot: true,
      export: true,
      exportData: true
    },
    paint: function ($element, layout) {
      var self = this;
      var host = $element[0];
      var app = qlik.currApp(this);
      var props = layout.props || {};

      if (!host.querySelector(".sa-root")) {
        $element.html(template);
      }
      ensureBindings(host);

      // Get the X-axis dimension expression from the main cube
      var mainCube = layout.qHyperCube;
      var xDimExpr = "";
      var xDimLibId = "";
      var mainDimInfo = mainCube && mainCube.qDimensionInfo;
      if (mainDimInfo && mainDimInfo[0]) {
        // Check for library (master) dimension first
        if (mainDimInfo[0].qLibraryId) {
          xDimLibId = mainDimInfo[0].qLibraryId;
        }
        // qGroupFieldDefs has the actual field expression
        if (mainDimInfo[0].qGroupFieldDefs && mainDimInfo[0].qGroupFieldDefs[0]) {
          xDimExpr = mainDimInfo[0].qGroupFieldDefs[0];
        }
        if (!xDimExpr && mainDimInfo[0].qFallbackTitle) {
          xDimExpr = mainDimInfo[0].qFallbackTitle;
        }
      }

      // Get measure — detect if it's a master (library) measure
      var measExpr = "";
      var measLibId = "";
      var mainMeasInfo = mainCube && mainCube.qMeasureInfo;
      // 1) Check resolved qMeasureInfo for library ID
      if (mainMeasInfo && mainMeasInfo[0] && mainMeasInfo[0].qLibraryId) {
        measLibId = mainMeasInfo[0].qLibraryId;
      }
      // 2) Try qHyperCubeDef for inline expression
      var hcDef = layout.qHyperCubeDef;
      if (hcDef && hcDef.qMeasures && hcDef.qMeasures[0]) {
        var mDef0 = hcDef.qMeasures[0];
        if (mDef0.qDef && mDef0.qDef.qDef) {
          measExpr = mDef0.qDef.qDef;
        }
        if (!measLibId && mDef0.qLibraryId) {
          measLibId = mDef0.qLibraryId;
        }
      }
      // We need either a library ID or an expression to create session cubes
      var hasMeas = !!(measExpr || measLibId);
      var hasDim = !!(xDimExpr || xDimLibId);

      console.log("[StackedArea] xDimExpr:", xDimExpr, "xDimLibId:", xDimLibId,
        "measExpr:", measExpr, "measLibId:", measLibId,
        "hasDim:", hasDim, "hasMeas:", hasMeas);

      // Build alternate configs
      var altConfigs = [];
      for (var i = 1; i <= 5; i++) {
        var label = (props["alt" + i + "Label"] || "").trim();
        var dim = (props["alt" + i + "Dim"] || "").trim();
        if (dim && hasDim && hasMeas) {
          altConfigs.push({ num: i, label: label || dim, dim: dim });
        }
      }

      // Build config key to avoid re-creating session cubes unnecessarily
      var configKey = (xDimExpr || xDimLibId) + "|" + (measExpr || measLibId) + "|" + altConfigs.map(function (c) { return c.dim; }).join("|");
      var configChanged = (host.__saConfigKey !== configKey);

      if (configChanged) {
        host.__saConfigKey = configKey;
        destroySessionCubes(host);
        host.__saSessionCubes = [];
        host.__saAltData = {};

        if (altConfigs.length === 0) {
          buildAndRender(host, layout, self, {});
        } else {
          var pending = altConfigs.length;

          altConfigs.forEach(function (cfg) {
            // Build X-axis dimension def — use library ID if available, else field expression
            var xDimDef;
            if (xDimLibId) {
              xDimDef = { qLibraryId: xDimLibId, qDef: { qSortCriterias: [{ qSortByAscii: 1 }] } };
            } else {
              xDimDef = { qDef: { qFieldDefs: [xDimExpr], qSortCriterias: [{ qSortByAscii: 1 }] } };
            }

            // Build measure def — use library ID if available, else expression
            var measDef;
            if (measLibId) {
              measDef = { qLibraryId: measLibId };
            } else {
              var mExpr = measExpr;
              if (mExpr.charAt(0) !== "=") mExpr = "=" + mExpr;
              measDef = { qDef: { qDef: mExpr } };
            }

            var handle = app.createCube({
              qDimensions: [
                xDimDef,
                { qDef: { qFieldDefs: [cfg.dim] } }
              ],
              qMeasures: [measDef],
              qInitialDataFetch: [{ qWidth: 3, qHeight: 3000 }]
            }, function (reply) {
              var parsed = extractSessionData(reply);
              if (parsed) {
                host.__saAltData["alt" + cfg.num] = {
                  label: cfg.label,
                  data: parsed
                };
              }
              buildAndRender(host, layout, self, host.__saAltData);
              pending--;
            });

            if (handle) host.__saSessionCubes.push(handle);
          });
        }
      } else {
        buildAndRender(host, layout, self, host.__saAltData || {});
      }

      return qlik.Promise.resolve();
    }
  };
});
