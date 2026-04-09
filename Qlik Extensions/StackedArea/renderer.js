(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else {
    root.StackedAreaRenderer = factory();
  }
})(this, function () {
  "use strict";

  var PALETTE = [
    "#ff6b6b", "#44b3ff", "#84bd00", "#ff9f43", "#7b61ff",
    "#f15bb5", "#00bbf9", "#ffd166", "#30d5c8", "#e040fb",
    "#40c4ff", "#ffab40", "#69f0ae", "#ff5252", "#7c4dff"
  ];

  var valueFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  var compactFormatter = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

  function escapeHtml(val) {
    return String(val == null ? "" : val)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatValue(v, compact) {
    if (!Number.isFinite(v)) return "0";
    return compact ? compactFormatter.format(v) : valueFormatter.format(v);
  }

  /* ── Build stacked area data ─────────────────────────────── */

  function buildStackedData(dataset) {
    var labels = dataset.labels || [];
    var seriesObj = dataset.series || {};
    var seriesNames = Object.keys(seriesObj).sort(function (a, b) {
      // Sort by total descending so largest area is at bottom
      var totalA = 0, totalB = 0;
      labels.forEach(function (l) {
        totalA += Math.abs((seriesObj[a][l] || {}).value || 0);
        totalB += Math.abs((seriesObj[b][l] || {}).value || 0);
      });
      return totalB - totalA;
    });

    // Build stacked values
    var stacked = []; // array of { name, color, points: [{x, y0, y1, value}] }
    labels.forEach(function (label, xi) {
      var cumulative = 0;
      seriesNames.forEach(function (name, si) {
        if (!stacked[si]) {
          stacked[si] = { name: name, color: PALETTE[si % PALETTE.length], points: [] };
        }
        var val = Math.abs((seriesObj[name][label] || {}).value || 0);
        stacked[si].points.push({ x: xi, y0: cumulative, y1: cumulative + val, value: (seriesObj[name][label] || {}).value || 0, label: label });
        cumulative += val;
      });
    });

    // Find max Y
    var maxY = 0;
    if (stacked.length && labels.length) {
      for (var li = 0; li < labels.length; li++) {
        var colTotal = 0;
        stacked.forEach(function (s) { colTotal += Math.abs(s.points[li].value); });
        if (colTotal > maxY) maxY = colTotal;
      }
    }

    return { labels: labels, stacked: stacked, maxY: maxY, seriesNames: seriesNames };
  }

  /* ── SVG path for stacked area ───────────────────────────── */

  function areaPath(points, maxY, chartW, chartH, totalPoints) {
    if (!points.length || maxY === 0) return "";
    var stepX = totalPoints > 1 ? chartW / (totalPoints - 1) : chartW;

    var topLine = points.map(function (p, i) {
      var x = i * stepX;
      var y = chartH - (p.y1 / maxY) * chartH;
      return (i === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
    }).join(" ");

    var bottomLine = points.slice().reverse().map(function (p, i) {
      var x = (points.length - 1 - i) * stepX;
      var y = chartH - (p.y0 / maxY) * chartH;
      return "L" + x.toFixed(2) + "," + y.toFixed(2);
    }).join(" ");

    return topLine + " " + bottomLine + " Z";
  }

  /* ── Y axis ticks ────────────────────────────────────────── */

  function buildYTicks(maxY) {
    if (maxY <= 0) return [];
    var rawStep = maxY / 5;
    var magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    var step = Math.ceil(rawStep / magnitude) * magnitude;
    var ticks = [];
    for (var v = 0; v <= maxY; v += step) {
      ticks.push(v);
    }
    if (ticks[ticks.length - 1] < maxY) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  /* ── Table markup ────────────────────────────────────────── */

  function buildTableMarkup(sd) {
    var labels = sd.labels;
    var stacked = sd.stacked;

    // Sort series columns by grand total descending
    var sortedSeries = stacked.slice().sort(function (a, b) {
      var ta = 0, tb = 0;
      a.points.forEach(function (p) { ta += Math.abs(p.value); });
      b.points.forEach(function (p) { tb += Math.abs(p.value); });
      return tb - ta;
    });

    var headerCells = '<th class="sa-tbl-th">' + escapeHtml(sd.xLabel || "Period") + '</th>';
    sortedSeries.forEach(function (s) {
      headerCells += '<th class="sa-tbl-th" style="color:' + s.color + ';">' + escapeHtml(s.name) + '</th>';
    });
    headerCells += '<th class="sa-tbl-th">Total</th>';

    var rows = labels.map(function (label, li) {
      var cells = '<td class="sa-tbl-td">' + escapeHtml(label) + '</td>';
      var rowTotal = 0;
      sortedSeries.forEach(function (s) {
        var val = s.points[li] ? s.points[li].value : 0;
        rowTotal += val;
        cells += '<td class="sa-tbl-td">' + formatValue(val, false) + '</td>';
      });
      cells += '<td class="sa-tbl-td"><strong>' + formatValue(rowTotal, false) + '</strong></td>';
      return '<tr class="sa-tbl-row">' + cells + '</tr>';
    }).join("");

    return [
      '<div class="sa-modal-overlay" data-sa-modal="table">',
      '  <div class="sa-modal">',
      '    <div class="sa-modal-header">',
      '      <h3 class="sa-modal-title">Data Table</h3>',
      '      <button class="sa-modal-close" type="button" data-sa-close="table">&times;</button>',
      '    </div>',
      '    <div class="sa-modal-body">',
      '      <table class="sa-tbl">',
      '        <thead><tr>' + headerCells + '</tr></thead>',
      '        <tbody>' + rows + '</tbody>',
      '      </table>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join("");
  }

  /* ── Fullscreen markup ───────────────────────────────────── */

  function buildFullscreenSVG(sd) {
    // Returns a function that the modal can call with actual viewport dimensions
    return sd;
  }

  function renderFullscreenSVG(sd, w, h) {
    var MARGIN = { top: 30, right: 30, bottom: 60, left: 90 };
    var chartW = Math.max(w - MARGIN.left - MARGIN.right, 100);
    var chartH = Math.max(h - MARGIN.top - MARGIN.bottom, 60);
    var maxY = sd.adjustedMaxY;
    var labels = sd.labels;
    var stacked = sd.stacked;

    var areas = stacked.slice().reverse().map(function (s) {
      return '<path d="' + areaPath(s.points, maxY, chartW, chartH, labels.length) + '" fill="' + s.color + '" opacity="0.9"></path>';
    }).join("");

    var yTicks = buildYTicks(maxY);
    var yAxis = yTicks.map(function (v) {
      var y = chartH - (v / maxY) * chartH;
      return '<line x1="0" x2="' + chartW + '" y1="' + y.toFixed(2) + '" y2="' + y.toFixed(2) + '" stroke="rgba(132,189,0,0.2)" stroke-width="1"></line>' +
        '<text x="-10" y="' + (y + 5).toFixed(2) + '" text-anchor="end" fill="#84bd00" font-size="13" font-weight="500">' + formatValue(v, true) + '</text>';
    }).join("");

    var totalLabels = labels.length;
    var maxLabels = Math.floor(chartW / 70);
    var labelStep = totalLabels > maxLabels ? Math.ceil(totalLabels / maxLabels) : 1;
    var stepX = totalLabels > 1 ? chartW / (totalLabels - 1) : chartW;

    var xAxis = labels.map(function (l, i) {
      if (i % labelStep !== 0 && i !== totalLabels - 1) return "";
      var x = i * stepX;
      return '<text x="' + x.toFixed(2) + '" y="' + (chartH + 25) + '" text-anchor="middle" fill="#84bd00" font-size="13" font-weight="500">' + escapeHtml(l) + '</text>';
    }).join("");

    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<g transform="translate(' + MARGIN.left + ',' + MARGIN.top + ')">' +
      yAxis + xAxis + areas +
      '</g></svg>';
  }

  /* ── Main render ─────────────────────────────────────────── */

  function render(root, config) {
    if (!root) return;

    var datasets = config.datasets || [];
    var activeKey = config.activeKey || "main";
    var w = config.containerWidth || 0;
    var h = config.containerHeight || 0;
    var title = escapeHtml(config.title || "Stacked Area");

    // Find active dataset
    var activeDS = datasets[0];
    datasets.forEach(function (ds) {
      if (ds.key === activeKey) activeDS = ds;
    });

    var sd = activeDS ? buildStackedData(activeDS.data) : { labels: [], stacked: [], maxY: 0, seriesNames: [] };

    // Compute adjusted maxY from ticks
    var yTicks = buildYTicks(sd.maxY);
    sd.adjustedMaxY = yTicks.length ? yTicks[yTicks.length - 1] : sd.maxY || 1;
    sd.xLabel = activeDS && activeDS.data ? activeDS.data.xLabel : "";

    // Chart dims
    var labels = sd.labels;
    var stacked = sd.stacked;
    var MARGIN = { top: 20, right: 20, bottom: 50, left: 70 };
    var MIN_COL_WIDTH = 60;
    var naturalW = w - MARGIN.left - MARGIN.right;
    var neededW = labels.length * MIN_COL_WIDTH;
    var chartW = Math.max(naturalW, neededW, 100);
    var chartH = Math.max(h - 140 - MARGIN.top - MARGIN.bottom, 60);
    var maxY = sd.adjustedMaxY;

    // Build areas (render bottom-up, so reverse the stacking order for SVG layering)
    var areas = stacked.slice().reverse().map(function (s) {
      return '<path class="sa-area-path" d="' + areaPath(s.points, maxY, chartW, chartH, labels.length) + '" fill="' + s.color + '" opacity="0.9"></path>';
    }).join("");

    // Y axis
    var yAxisMarkup = yTicks.map(function (v) {
      var y = chartH - (v / maxY) * chartH;
      return '<line x1="0" x2="' + chartW + '" y1="' + y.toFixed(2) + '" y2="' + y.toFixed(2) + '" stroke="rgba(132,189,0,0.2)" stroke-width="1"></line>' +
        '<text x="-8" y="' + (y + 4).toFixed(2) + '" text-anchor="end" fill="#84bd00" font-size="11">' + formatValue(v, true) + '</text>';
    }).join("");

    // X axis labels (skip some if too many)
    var totalLabels = labels.length;
    var maxLabelsShown = Math.floor(chartW / 60);
    var labelStep = totalLabels > maxLabelsShown ? Math.ceil(totalLabels / maxLabelsShown) : 1;
    var stepX = totalLabels > 1 ? chartW / (totalLabels - 1) : chartW;

    var xAxisMarkup = labels.map(function (l, i) {
      if (i % labelStep !== 0 && i !== totalLabels - 1) return "";
      var x = i * stepX;
      return '<text x="' + x.toFixed(2) + '" y="' + (chartH + 20) + '" text-anchor="middle" fill="#84bd00" font-size="11">' + escapeHtml(l) + '</text>';
    }).join("");

    // Hover columns (invisible rects for tooltip)
    var colW = totalLabels > 1 ? chartW / totalLabels : chartW;
    var hoverCols = labels.map(function (l, i) {
      var x = totalLabels > 1 ? i * stepX - colW / 2 : 0;
      return '<rect class="sa-hover-col" data-col="' + i + '" x="' + Math.max(0, x).toFixed(2) + '" y="0" width="' + colW.toFixed(2) + '" height="' + chartH + '" fill="transparent"></rect>';
    }).join("");

    // Dropdown
    var dropdownMarkup = "";
    if (datasets.length > 1) {
      var options = datasets.map(function (ds) {
        var sel = ds.key === activeKey ? ' selected' : '';
        return '<option value="' + escapeHtml(ds.key) + '"' + sel + '>' + escapeHtml(ds.label) + '</option>';
      }).join("");
      dropdownMarkup = '<select class="sa-dropdown" data-sa-dropdown>' + options + '</select>';
    }

    // Legend — sorted by total measure descending
    var legendSorted = stacked.slice().sort(function (a, b) {
      var ta = 0, tb = 0;
      a.points.forEach(function (p) { ta += Math.abs(p.value); });
      b.points.forEach(function (p) { tb += Math.abs(p.value); });
      return tb - ta;
    });
    var legendMarkup = legendSorted.map(function (s) {
      return '<span class="sa-legend-item">' +
        '<span class="sa-legend-dot" style="background:' + s.color + ';"></span>' +
        '<span class="sa-legend-label">' + escapeHtml(s.name) + '</span></span>';
    }).join("");

    // Grand total
    var grandTotal = 0;
    stacked.forEach(function (s) {
      s.points.forEach(function (p) { grandTotal += Math.abs(p.value); });
    });

    // Table modal
    var tableMarkup = buildTableMarkup(sd);

    // Fullscreen modal — SVG rendered on open to fill viewport
    var fsLegend = stacked.map(function (s) {
      return '<span class="sa-legend-item"><span class="sa-legend-dot" style="background:' + s.color + ';"></span>' +
        '<span class="sa-legend-label">' + escapeHtml(s.name) + '</span></span>';
    }).join("");

    var fullscreenMarkup = [
      '<div class="sa-modal-overlay" data-sa-modal="fullscreen">',
      '  <div class="sa-fs-panel">',
      '    <div class="sa-modal-header">',
      '      <h3 class="sa-modal-title">' + title + '</h3>',
      '      <button class="sa-modal-close" type="button" data-sa-close="fullscreen">&times;</button>',
      '    </div>',
      '    <div class="sa-fs-body">',
      '      <div class="sa-fs-chart" data-sa-fs-chart></div>',
      '      <div class="sa-fs-legend">' + fsLegend + '</div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join("");

    // Store sd on root for fullscreen rendering
    root.__saStackedData = sd;

    // Tooltip
    var tooltipMarkup = '<div class="sa-tooltip" data-sa-tooltip></div>';

    root.innerHTML = [
      '<div class="sa-shell">',
      '  <header class="sa-header">',
      '    <div class="sa-header-left">',
      '      <h2 class="sa-title">' + title + '</h2>',
      '      ' + dropdownMarkup,
      '    </div>',
      '    <div class="sa-header-right">',
      '      <button class="sa-action-btn" type="button" data-sa-open="table" title="View data table">',
      '        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v1H2zm0 3h12v1H2zm0 3h12v1H2zm0 3h8v1H2z" fill="currentColor"/></svg>',
      '      </button>',
      '      <button class="sa-action-btn" type="button" data-sa-open="fullscreen" title="Fullscreen">',
      '        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h5v1.5H3.5V6H2V2zm7 0h5v4h-1.5V3.5H9V2zM2 10h1.5v2.5H6V14H2v-4zm10.5 2.5V10H14v4h-4v-1.5h2.5z" fill="currentColor"/></svg>',
      '      </button>',
      '    </div>',
      '  </header>',
      '  <div class="sa-chart-wrap">',
      '    <svg class="sa-chart-svg" width="' + (chartW + MARGIN.left + MARGIN.right) + '" height="' + (chartH + MARGIN.top + MARGIN.bottom) + '">',
      '      <g transform="translate(' + MARGIN.left + ',' + MARGIN.top + ')">',
      '        ' + yAxisMarkup,
      '        ' + xAxisMarkup,
      '        ' + areas,
      '        ' + hoverCols,
      '      </g>',
      '    </svg>',
      '    ' + tooltipMarkup,
      '  </div>',
      '  <div class="sa-legend">' + legendMarkup + '</div>',
      '  ' + tableMarkup,
      '  ' + fullscreenMarkup,
      '</div>'
    ].join("");

    // Auto-scroll to the right so latest months are visible
    var chartWrap = root.querySelector(".sa-chart-wrap");
    if (chartWrap && chartWrap.scrollWidth > chartWrap.clientWidth) {
      chartWrap.scrollLeft = chartWrap.scrollWidth;
    }

    // ── Bind interactions ──
    bindDropdown(root, config);
    bindModals(root);
    bindTooltips(root, sd, stacked, labels, stepX, MARGIN, chartH, maxY);
  }

  /* ── Dropdown binding ────────────────────────────────────── */

  function bindDropdown(root, config) {
    var select = root.querySelector("[data-sa-dropdown]");
    if (!select) return;
    select.addEventListener("change", function () {
      if (typeof config.onDatasetChange === "function") {
        config.onDatasetChange(select.value);
      }
    });
  }

  /* ── Modal bindings ──────────────────────────────────────── */

  function bindModals(root) {
    root.querySelectorAll("[data-sa-open]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var key = btn.getAttribute("data-sa-open");
        var overlay = root.querySelector('[data-sa-modal="' + key + '"]');
        if (overlay) {
          overlay.classList.add("is-open");

          // If fullscreen, render the SVG to fill the actual viewport
          if (key === "fullscreen" && root.__saStackedData) {
            var fsChart = overlay.querySelector("[data-sa-fs-chart]");
            if (fsChart) {
              var vpW = window.innerWidth * 0.9 - 40;
              var vpH = window.innerHeight * 0.86 - 120;
              fsChart.innerHTML = renderFullscreenSVG(root.__saStackedData, Math.round(vpW), Math.round(vpH));
            }
          }
        }
      });
    });

    root.querySelectorAll("[data-sa-close]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var key = btn.getAttribute("data-sa-close");
        var overlay = root.querySelector('[data-sa-modal="' + key + '"]');
        if (overlay) overlay.classList.remove("is-open");
      });
    });

    root.querySelectorAll(".sa-modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) overlay.classList.remove("is-open");
      });
    });
  }

  /* ── Tooltip bindings ────────────────────────────────────── */

  function bindTooltips(root, sd, stacked, labels, stepX, margin, chartH, maxY) {
    var tooltip = root.querySelector("[data-sa-tooltip]");
    var cols = root.querySelectorAll(".sa-hover-col");
    if (!tooltip || !cols.length) return;

    cols.forEach(function (col) {
      col.addEventListener("mouseenter", function () {
        var ci = Number(col.getAttribute("data-col"));
        var label = labels[ci];
        if (!label) return;

        var lines = ['<strong>' + escapeHtml(label) + '</strong>'];
        var colTotal = 0;
        // Sort series by value desc for this column
        var sorted = stacked.slice().sort(function (a, b) {
          var va = a.points[ci] ? Math.abs(a.points[ci].value) : 0;
          var vb = b.points[ci] ? Math.abs(b.points[ci].value) : 0;
          return vb - va;
        });
        sorted.forEach(function (s) {
          var pt = s.points[ci];
          if (pt) {
            lines.push('<span style="color:' + s.color + ';">&#9679;</span> ' + escapeHtml(s.name) + ': ' + formatValue(pt.value, false));
            colTotal += pt.value;
          }
        });
        lines.push('<em>Total: ' + formatValue(colTotal, false) + '</em>');

        tooltip.innerHTML = lines.join("<br>");
        tooltip.classList.add("is-visible");

        // Position
        var svgRect = root.querySelector(".sa-chart-svg").getBoundingClientRect();
        var rootRect = root.getBoundingClientRect();
        var x = margin.left + ci * stepX - rootRect.left + svgRect.left;
        tooltip.style.left = x + "px";
        tooltip.style.top = (margin.top + 10) + "px";
      });

      col.addEventListener("mouseleave", function () {
        tooltip.classList.remove("is-visible");
      });
    });
  }

  return { render: render };
});
