define([
  "qlik",
  "text!./template.html",
  "./renderer",
  "css!./MasterOfPie.css"
], function (qlik, template, renderer) {
  "use strict";

  /* -- Resize / lifecycle helpers ----------------------------- */

  function clearTimers(host) {
    if (host && host.__mopTimers) {
      host.__mopTimers.forEach(function (id) { clearTimeout(id); });
      host.__mopTimers = [];
    }
  }

  function scheduleRender(host) {
    if (!host) return;
    if (host.__mopFrame) cancelAnimationFrame(host.__mopFrame);
    host.__mopFrame = requestAnimationFrame(function () {
      host.__mopFrame = null;
      var root = host.querySelector(".mop-root");
      var config = host.__mopConfig;
      if (!root || !config) return;
      var rect = host.getBoundingClientRect ? host.getBoundingClientRect() : { width: 0, height: 0 };
      config.containerWidth = Math.round(rect.width || host.clientWidth || 0);
      config.containerHeight = Math.round(rect.height || host.clientHeight || 0);
      renderer.render(root, config);
    });
  }

  function queueRenders(host) {
    clearTimers(host);
    host.__mopTimers = [0, 80, 250, 500].map(function (d) {
      return setTimeout(function () { scheduleRender(host); }, d);
    });
  }

  function ensureBindings(host) {
    if (!host || host.__mopBound) return;
    host.__mopTimers = [];
    host.__mopBound = true;

    if (typeof ResizeObserver === "function") {
      host.__mopRO = new ResizeObserver(function () { queueRenders(host); });
      host.__mopRO.observe(host);
      if (host.parentElement) host.__mopRO.observe(host.parentElement);
    }

    host.__mopWinResize = function () { queueRenders(host); };
    window.addEventListener("resize", host.__mopWinResize);

    host.__mopVisibility = function () {
      if (!document.hidden) queueRenders(host);
    };
    document.addEventListener("visibilitychange", host.__mopVisibility);
  }

  /* -- Extract data from the main hypercube ------------------- */

  function extractData(cube) {
    if (!cube) return [];
    var page = (cube.qDataPages || [])[0];
    var rows = page ? page.qMatrix : [];
    return rows.map(function (row) {
      return {
        label: row[0] && row[0].qText,
        value: row[1] && row[1].qNum,
        valueText: row[1] && row[1].qText,
        elemNumber: row[0] && row[0].qElemNumber
      };
    });
  }

  function getDimLabel(cube) {
    var dims = cube && cube.qDimensionInfo;
    return dims && dims[0] ? dims[0].qFallbackTitle : "Dimension";
  }

  function getMeasLabel(cube) {
    var meas = cube && cube.qMeasureInfo;
    return meas && meas[0] ? meas[0].qFallbackTitle : "Measure";
  }

  /* -- Extract data from a session cube callback -------------- */

  function extractSessionData(reply) {
    var cube = reply && reply.qHyperCube;
    if (!cube) return [];
    var page = (cube.qDataPages || [])[0];
    var rows = page ? page.qMatrix : [];
    return rows.map(function (row) {
      return {
        label: row[0] && row[0].qText,
        value: row[1] && row[1].qNum,
        valueText: row[1] && row[1].qText,
        elemNumber: row[0] && row[0].qElemNumber
      };
    });
  }

  function getSessionDimLabel(reply) {
    var cube = reply && reply.qHyperCube;
    return getDimLabel(cube);
  }

  function getSessionMeasLabel(reply) {
    var cube = reply && reply.qHyperCube;
    return getMeasLabel(cube);
  }

  /* -- Session cube management -------------------------------- */

  function destroySessionCubes(host) {
    if (!host.__mopSessionCubes) return;
    host.__mopSessionCubes.forEach(function (handle) {
      if (handle && typeof handle.close === "function") {
        try { handle.close(); } catch (e) { /* ignore */ }
      }
    });
    host.__mopSessionCubes = [];
  }

  /* -- Build config & render ---------------------------------- */

  function buildAndRender(host, layout, self, sessionDataMap) {
    var props = layout.props || {};
    var rect = host.getBoundingClientRect ? host.getBoundingClientRect() : { width: 0, height: 0 };
    var cube1 = layout.qHyperCube;
    var hasCube1 = cube1 && cube1.qDimensionInfo && cube1.qDimensionInfo.length > 0
      && cube1.qMeasureInfo && cube1.qMeasureInfo.length > 0;

    var charts = [
      {
        title: props.chart1Title || "Chart 1",
        dimLabel: getDimLabel(cube1),
        measLabel: getMeasLabel(cube1),
        data: hasCube1 ? extractData(cube1) : [],
        onSliceClick: function (slice) {
          if (slice && typeof slice.elemNumber === "number") {
            self.backendApi.selectValues(0, [slice.elemNumber], true);
          }
        }
      }
    ];

    // Charts 2-4 from session cube data
    [2, 3, 4].forEach(function (num) {
      var sd = sessionDataMap && sessionDataMap[num];
      charts.push({
        title: props["chart" + num + "Title"] || ("Chart " + num),
        dimLabel: sd ? sd.dimLabel : (props["chart" + num + "Dim"] || "Dimension"),
        measLabel: sd ? sd.measLabel : (props["chart" + num + "Meas"] || "Measure"),
        data: sd ? sd.data : [],
        onSliceClick: function (slice) {
          if (slice && slice.label) {
            var dimField = props["chart" + num + "Dim"];
            if (dimField) {
              var app = qlik.currApp(self);
              // Clean the field name: remove leading = and brackets
              var cleanField = dimField.replace(/^\s*=?\s*\[?/, "").replace(/\]?\s*$/, "");
              if (app && cleanField) {
                app.field(cleanField).selectValues([{qText: slice.label}], true, false);
              }
            }
          }
        }
      });
    });

    host.__mopConfig = {
      title: props.dashTitle,
      subtitle: props.dashSubtitle,
      containerWidth: Math.round(rect.width || host.clientWidth || 0),
      containerHeight: Math.round(rect.height || host.clientHeight || 0),
      charts: charts
    };

    queueRenders(host);
  }

  /* -- Extension definition ----------------------------------- */

  return {
    initialProperties: {
      qHyperCubeDef: {
        qDimensions: [],
        qMeasures: [],
        qInitialDataFetch: [{ qWidth: 2, qHeight: 500 }]
      }
    },
    definition: {
      type: "items",
      component: "accordion",
      items: {
        chart1: {
          type: "items",
          label: "Chart 1 - Dimension & Measure",
          items: {
            chart1Title: {
              ref: "props.chart1Title",
              type: "string",
              label: "Title",
              defaultValue: "Chart 1"
            },
            dimensions: {
              uses: "dimensions",
              min: 0,
              max: 1
            },
            measures: {
              uses: "measures",
              min: 0,
              max: 1
            }
          }
        },
        chart2: {
          type: "items",
          label: "Chart 2 - Dimension & Measure",
          items: {
            chart2Title: {
              ref: "props.chart2Title",
              type: "string",
              label: "Title",
              defaultValue: "Chart 2"
            },
            chart2Dim: {
              ref: "props.chart2Dim",
              type: "string",
              label: "Dimension (field name, e.g. [MyField] or MyField)",
              defaultValue: ""
            },
            chart2Meas: {
              ref: "props.chart2Meas",
              type: "string",
              label: "Measure (expression, e.g. Sum(Amount))",
              defaultValue: ""
            }
          }
        },
        chart3: {
          type: "items",
          label: "Chart 3 - Dimension & Measure",
          items: {
            chart3Title: {
              ref: "props.chart3Title",
              type: "string",
              label: "Title",
              defaultValue: "Chart 3"
            },
            chart3Dim: {
              ref: "props.chart3Dim",
              type: "string",
              label: "Dimension (field name, e.g. [MyField] or MyField)",
              defaultValue: ""
            },
            chart3Meas: {
              ref: "props.chart3Meas",
              type: "string",
              label: "Measure (expression, e.g. Sum(Amount))",
              defaultValue: ""
            }
          }
        },
        chart4: {
          type: "items",
          label: "Chart 4 - Dimension & Measure",
          items: {
            chart4Title: {
              ref: "props.chart4Title",
              type: "string",
              label: "Title",
              defaultValue: "Chart 4"
            },
            chart4Dim: {
              ref: "props.chart4Dim",
              type: "string",
              label: "Dimension (field name, e.g. [MyField] or MyField)",
              defaultValue: ""
            },
            chart4Meas: {
              ref: "props.chart4Meas",
              type: "string",
              label: "Measure (expression, e.g. Sum(Amount))",
              defaultValue: ""
            }
          }
        },
        settings: {
          uses: "settings",
          items: {
            dashboard: {
              type: "items",
              label: "Dashboard Settings",
              items: {
                dashTitle: {
                  ref: "props.dashTitle",
                  type: "string",
                  label: "Dashboard Title",
                  defaultValue: "Overage Breakdown"
                },
                dashSubtitle: {
                  ref: "props.dashSubtitle",
                  type: "string",
                  component: "textarea",
                  rows: 2,
                  label: "Dashboard Subtitle",
                  defaultValue: ""
                }
              }
            }
          }
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

      // Only insert template HTML once — avoid wiping the DOM on every paint
      if (!host.querySelector(".mop-root")) {
        $element.html(template);
      }
      ensureBindings(host);

      // Build a config key from the secondary chart dim/meas settings
      // so we only destroy/recreate session cubes when config changes
      var configKey = [
        (props.chart2Dim || ""), (props.chart2Meas || ""),
        (props.chart3Dim || ""), (props.chart3Meas || ""),
        (props.chart4Dim || ""), (props.chart4Meas || "")
      ].join("|");

      var configChanged = (host.__mopConfigKey !== configKey);

      if (configChanged) {
        host.__mopConfigKey = configKey;

        // Destroy previous session cubes
        destroySessionCubes(host);
        host.__mopSessionCubes = [];
        host.__mopSessionDataMap = {};

        // Build the list of secondary charts that need session cubes
        var secondaryConfigs = [
          { num: 2, dim: (props.chart2Dim || "").trim(), meas: (props.chart2Meas || "").trim() },
          { num: 3, dim: (props.chart3Dim || "").trim(), meas: (props.chart3Meas || "").trim() },
          { num: 4, dim: (props.chart4Dim || "").trim(), meas: (props.chart4Meas || "").trim() }
        ];

        var pendingCount = 0;

        secondaryConfigs.forEach(function (cfg) {
          if (cfg.dim && cfg.meas) pendingCount++;
        });

        if (pendingCount === 0) {
          buildAndRender(host, layout, self, host.__mopSessionDataMap);
        } else {
          secondaryConfigs.forEach(function (cfg) {
            if (!cfg.dim || !cfg.meas) return;

            var measExpr = cfg.meas;
            if (measExpr.charAt(0) !== "=") {
              measExpr = "=" + measExpr;
            }

            var handle = app.createCube({
              qDimensions: [{
                qDef: { qFieldDefs: [cfg.dim] }
              }],
              qMeasures: [{
                qDef: { qDef: measExpr }
              }],
              qInitialDataFetch: [{ qWidth: 2, qHeight: 500 }]
            }, function (reply) {
              host.__mopSessionDataMap[cfg.num] = {
                data: extractSessionData(reply),
                dimLabel: getSessionDimLabel(reply),
                measLabel: getSessionMeasLabel(reply)
              };
              // Re-render when session data updates (e.g. selections)
              buildAndRender(host, layout, self, host.__mopSessionDataMap);
            });

            if (handle) {
              host.__mopSessionCubes.push(handle);
            }
          });
        }
      } else {
        // Config unchanged — just re-render with existing session data
        buildAndRender(host, layout, self, host.__mopSessionDataMap || {});
      }

      return qlik.Promise.resolve();
    }
  };
});
