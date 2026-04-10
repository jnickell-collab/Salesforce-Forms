(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else {
    root.PredictionBandRenderer = factory();
  }
})(this, function () {
  "use strict";

  /* ── Formatters ──────────────────────────────────────────── */

  var valueFormatter   = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  var compactFormatter = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  var preciseFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

  function escapeHtml(val) {
    return String(val == null ? "" : val)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function formatValue(v, compact) {
    if (!Number.isFinite(v)) return "0";
    return compact ? compactFormatter.format(v) : valueFormatter.format(v);
  }

  /* ── Inline stats calc (for filtered data) ───────────────── */

  function computeStats(values) {
    var n = values.length;
    if (n === 0) return { mean: 0, median: 0, min: 0, max: 0, stddev: 0 };
    var sum = 0, min = Infinity, max = -Infinity;
    for (var i = 0; i < n; i++) {
      sum += values[i];
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    var mean = sum / n;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    var sqSum = 0;
    for (var j = 0; j < n; j++) sqSum += (values[j] - mean) * (values[j] - mean);
    return { mean: mean, median: median, min: min, max: max, stddev: Math.sqrt(sqSum / n) };
  }

  /* ── Y-axis ticks ────────────────────────────────────────── */

  function buildYTicks(minY, maxY) {
    if (maxY <= minY) return [];
    var range = maxY - minY;
    var rawStep = range / 5;
    var magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    var step = Math.ceil(rawStep / magnitude) * magnitude;
    var ticks = [];
    var start = Math.floor(minY / step) * step;
    for (var v = start; v <= maxY + step * 0.01; v += step) {
      ticks.push(v);
    }
    return ticks;
  }

  /* ── SVG path builders ───────────────────────────────────── */

  function linePath(points, chartX, chartW, chartH, yMin, yRange) {
    if (!points.length || yRange === 0) return "";
    var n = points.length;
    var stepX = n > 1 ? chartW / (n - 1) : 0;
    return points.map(function (p, i) {
      var x = chartX + i * stepX;
      var y = chartH - ((p.value - yMin) / yRange) * chartH;
      return (i === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
    }).join(" ");
  }

  function horizontalLine(yVal, chartX, chartW, chartH, yMin, yRange) {
    var y = chartH - ((yVal - yMin) / yRange) * chartH;
    return "M" + chartX.toFixed(2) + "," + y.toFixed(2) +
           " L" + (chartX + chartW).toFixed(2) + "," + y.toFixed(2);
  }

  /** Build a polyline path from an array of Y values (one per data point). */
  function statLinePath(yValues, chartX, chartW, chartH, n, yMin, yRange) {
    if (!yValues.length || yRange === 0) return "";
    var nn = (yValues.length > 1) ? yValues.length : (n || 1);
    var stepX = nn > 1 ? chartW / (nn - 1) : 0;
    return yValues.map(function (v, i) {
      var x = chartX + i * stepX;
      var y = chartH - ((v - yMin) / yRange) * chartH;
      return (i === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
    }).join(" ");
  }

  /** Build a closed area path between upper[] and lower[] arrays. */
  function varyingBandPath(upperArr, lowerArr, chartX, chartW, chartH, n, yMin, yRange) {
    var nn = (upperArr && upperArr.length > 1) ? upperArr.length : (n || 0);
    if (nn === 0 || yRange === 0) return "";
    var stepX = nn > 1 ? chartW / (nn - 1) : 0;
    // Top edge left → right
    var path = upperArr.map(function (v, i) {
      var x = chartX + i * stepX;
      var y = chartH - ((v - yMin) / yRange) * chartH;
      return (i === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
    }).join(" ");
    // Bottom edge right → left
    for (var j = nn - 1; j >= 0; j--) {
      var x = chartX + j * stepX;
      var y = chartH - ((lowerArr[j] - yMin) / yRange) * chartH;
      path += " L" + x.toFixed(2) + "," + y.toFixed(2);
    }
    path += " Z";
    return path;
  }

  function bandPath(upperVal, lowerVal, chartX, chartW, chartH, n, yMin, yRange) {
    if (n === 0 || yRange === 0) return "";
    var stepX = n > 1 ? chartW / (n - 1) : 0;
    var topY  = chartH - ((upperVal - yMin) / yRange) * chartH;
    var botY  = chartH - ((lowerVal - yMin) / yRange) * chartH;

    var path = "M" + chartX.toFixed(2) + "," + topY.toFixed(2);
    path += " L" + (chartX + (n - 1) * stepX).toFixed(2) + "," + topY.toFixed(2);
    path += " L" + (chartX + (n - 1) * stepX).toFixed(2) + "," + botY.toFixed(2);
    path += " L" + chartX.toFixed(2) + "," + botY.toFixed(2);
    path += " Z";
    return path;
  }

  /* ── Main render ─────────────────────────────────────────── */

  function render(root, cfg) {
    if (!root || !cfg) return;
    var W = cfg.containerWidth  || 400;
    var H = cfg.containerHeight || 300;
    if (W < 60 || H < 60) return;

    var rawData = cfg.data || [];
    var filterMin = cfg.filterMin;

    /* Apply filter: remove months below the threshold */
    var data;
    if (Number.isFinite(filterMin)) {
      data = rawData.filter(function (d) { return d.value >= filterMin; });
    } else {
      data = rawData;
    }

    /* Recompute stats on the filtered dataset */
    var filteredValues = [];
    data.forEach(function (d) {
      if (Number.isFinite(d.value)) filteredValues.push(d.value);
    });
    var stats = computeStats(filteredValues);

    /* Build month buckets from the filtered date-grain points. */
    var monthBuckets = {};
    data.forEach(function (d) {
      if (!d.monthKey) return;
      if (!monthBuckets[d.monthKey]) {
        monthBuckets[d.monthKey] = {
          label: d.monthLabel || d.monthKey,
          values: []
        };
      }
      monthBuckets[d.monthKey].values.push(d.value);
    });

    var monthStatsByKey = {};
    Object.keys(monthBuckets).forEach(function (monthKey) {
      monthStatsByKey[monthKey] = computeStats(monthBuckets[monthKey].values);
      monthStatsByKey[monthKey].label = monthBuckets[monthKey].label;
      monthStatsByKey[monthKey].count = monthBuckets[monthKey].values.length;
      monthStatsByKey[monthKey].values = monthBuckets[monthKey].values;
    });

    var mode  = cfg.bandMode || "minmax";

    var meanArr = [];
    var medianArr = [];
    var bandUpperArr = [];
    var bandLowerArr = [];

    data.forEach(function (d) {
      var monthStats = monthStatsByKey[d.monthKey] || { mean: 0, median: 0, min: 0, max: 0, stddev: 0 };
      var mmean = Number(monthStats.mean);
      meanArr.push(Number.isFinite(mmean) ? mmean : 0);
      var mmed = Number(monthStats.median);
      medianArr.push(Number.isFinite(mmed) ? mmed : (Number.isFinite(mmean) ? mmean : 0));
      if (mode === "stddev") {
        var msd = Number(monthStats.stddev);
        bandUpperArr.push((Number.isFinite(mmean) ? mmean : 0) + (Number.isFinite(msd) ? msd : 0));
        bandLowerArr.push((Number.isFinite(mmean) ? mmean : 0) - (Number.isFinite(msd) ? msd : 0));
      } else {
        var mmax = Number(monthStats.max);
        var mmin = Number(monthStats.min);
        bandUpperArr.push(Number.isFinite(mmax) ? mmax : (Number.isFinite(mmean) ? mmean : 0));
        bandLowerArr.push(Number.isFinite(mmin) ? mmin : (Number.isFinite(mmean) ? mmean : 0));
      }
    });

    /* Reserve space used by the shell chrome so the SVG bottom labels are not clipped. */
    var chromeH = 112;
    /* margins */
    var mTop = 8, mRight = 20, mBottom = 72, mLeft = 64;
    var viewH = H - chromeH - mTop - mBottom;
    if (viewH < 20) return;

    /* Y range – encompass the plotted monthly totals plus month-level overlays. */
    var yMin = Infinity;
    var yMax = -Infinity;

    data.forEach(function (d) {
      if (Number.isFinite(d.value)) {
        if (d.value < yMin) yMin = d.value;
        if (d.value > yMax) yMax = d.value;
      }
    });

    meanArr.forEach(function (v) {
      if (Number.isFinite(v)) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    });

    medianArr.forEach(function (v) {
      if (Number.isFinite(v)) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    });

    bandUpperArr.forEach(function (v) {
      if (Number.isFinite(v) && v > yMax) yMax = v;
    });

    bandLowerArr.forEach(function (v) {
      if (Number.isFinite(v) && v < yMin) yMin = v;
    });

    if (!Number.isFinite(yMin)) yMin = 0;
    if (!Number.isFinite(yMax)) yMax = 1;
    var yPad = (yMax - yMin) * 0.08 || 1;
    yMin -= yPad;
    yMax += yPad;
    var yRange = yMax - yMin;

    var n = data.length;
    var MIN_PX_PER_POINT = 60;
    var visibleChartW = W - mLeft - mRight;
    var neededW = Math.max(visibleChartW, (n - 1) * MIN_PX_PER_POINT);
    var svgW = mLeft + neededW + mRight;
    var chartW = neededW;
    var chartH = viewH;
    var stepX = n > 1 ? chartW / (n - 1) : 0;
    var scrollable = svgW > W;

    /* Y ticks */
    var yTicks = buildYTicks(yMin, yMax);

    /* ── Fixed Y-axis SVG (stays in place while scrolling) ── */
    var yAxisSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + mLeft + '" height="' + (viewH + mTop + mBottom) + '"' +
                   ' viewBox="0 0 ' + mLeft + ' ' + (viewH + mTop + mBottom) + '" style="display:block">';
    yTicks.forEach(function (t) {
      var y = mTop + chartH - ((t - yMin) / yRange) * chartH;
      yAxisSvg += '<text x="' + (mLeft - 8) + '" y="' + (y + 4).toFixed(1) +
                  '" text-anchor="end" fill="rgba(132,189,0,0.5)" font-size="11">' + formatValue(t, true) + '</text>';
    });
    // Y axis label
    yAxisSvg += '<text x="14" y="' + (mTop + chartH / 2) +
               '" text-anchor="middle" fill="rgba(132,189,0,0.7)" font-size="12" font-weight="600"' +
               ' transform="rotate(-90,14,' + (mTop + chartH / 2) + ')">' +
               escapeHtml(cfg.measLabel) + '</text>';
    yAxisSvg += '</svg>';

    /* ── Scrollable chart SVG ─────────────────────────────── */
    var svg = '';
    svg += '<svg xmlns="http://www.w3.org/2000/svg" width="' + svgW + '" height="' + (viewH + mTop + mBottom) + '"' +
           ' viewBox="0 0 ' + svgW + ' ' + (viewH + mTop + mBottom) + '" style="display:block;min-width:' + svgW + 'px">';

    /* ── Grid lines ───────────────────────────────────────── */
    yTicks.forEach(function (t) {
      var y = mTop + chartH - ((t - yMin) / yRange) * chartH;
      svg += '<line x1="' + mLeft + '" y1="' + y.toFixed(1) + '" x2="' + (mLeft + chartW) + '" y2="' + y.toFixed(1) +
             '" stroke="rgba(132,189,0,0.1)" stroke-width="1"/>';
    });

    /* ── Band (month-by-month min/max or mean±σ) ─────────── */
    var bandId = "pbc-band-" + Math.random().toString(36).substr(2, 6);
    var meanId = "pbc-mean-" + Math.random().toString(36).substr(2, 6);
    var medianId = "pbc-median-" + Math.random().toString(36).substr(2, 6);

    var bPath = varyingBandPath(bandUpperArr, bandLowerArr, mLeft, chartW, chartH, n, yMin, yRange);
    svg += '<g transform="translate(0,' + mTop + ')">';
    svg += '<path id="' + bandId + '" d="' + bPath + '" fill="' + escapeHtml(cfg.bandColor) +
           '" opacity="' + (cfg.bandOpacity || 0.2) + '"/>';

    /* ── Data line ────────────────────────────────────────── */
    var dPath = linePath(data, mLeft, chartW, chartH, yMin, yRange);
    svg += '<path d="' + dPath + '" fill="none" stroke="' + escapeHtml(cfg.lineColor) +
           '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';

    /* ── Mean line (month-by-month) ─────────────────────── */
    if (cfg.showMeanLine) {
      var mPath = statLinePath(meanArr, mLeft, chartW, chartH, n, yMin, yRange);
      svg += '<path id="' + meanId + '" d="' + mPath + '" fill="none" stroke="' + escapeHtml(cfg.meanLineColor) +
             '" stroke-width="1.5" stroke-dasharray="8,4" opacity="0.85"/>';
    }

    /* ── Median line (month-by-month) ───────────────────── */
    if (cfg.showMedianLine) {
      var mdPath = statLinePath(medianArr, mLeft, chartW, chartH, n, yMin, yRange);
      svg += '<path id="' + medianId + '" d="' + mdPath + '" fill="none" stroke="' + escapeHtml(cfg.medianLineColor) +
             '" stroke-width="1.5" stroke-dasharray="4,4" opacity="0.85"/>';
    }

    /* ── Data points (with hover targets) ─────────────────── */
    data.forEach(function (d, i) {
      if (!Number.isFinite(d.value)) return;
      var cx = mLeft + i * stepX;
      var cy = chartH - ((d.value - yMin) / yRange) * chartH;
      // Invisible larger hit area
      svg += '<circle class="pbc-hit" data-idx="' + i + '" cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) +
             '" r="14" fill="transparent" style="cursor:pointer"/>';
      // Visible dot
      svg += '<circle class="pbc-dot" data-idx="' + i + '" cx="' + cx.toFixed(2) + '" cy="' + cy.toFixed(2) +
             '" r="3.5" fill="' + escapeHtml(cfg.lineColor) + '" stroke="#111" stroke-width="1" style="pointer-events:none"/>';
    });

    svg += '</g>'; // close chart-area group

    /* ── X-axis labels (every point when scrollable) ─────── */
    var labelStep = scrollable ? 1 : Math.max(1, Math.ceil(n / Math.max(1, Math.floor(visibleChartW / 60))));
    data.forEach(function (d, i) {
      if (i % labelStep !== 0) return;
      var x = mLeft + i * stepX;
      var y = mTop + chartH + 18;
      svg += '<text x="' + x.toFixed(1) + '" y="' + y +
             '" text-anchor="middle" fill="rgba(132,189,0,0.6)" font-size="10" transform="rotate(-35,' +
             x.toFixed(1) + ',' + y + ')">' + escapeHtml(d.label) + '</text>';
    });

    /* ── X axis label ─────────────────────────────────────── */
    svg += '<text x="' + (mLeft + chartW / 2) + '" y="' + (viewH + mTop + mBottom - 4) +
           '" text-anchor="middle" fill="rgba(132,189,0,0.7)" font-size="12" font-weight="600">' +
           escapeHtml(cfg.dimLabel) + '</text>';

    svg += '</svg>';

    /* ── Stats box HTML ───────────────────────────────────── */
    var statsBoxId = "pbc-stats-" + Math.random().toString(36).substr(2, 6);
    var statsHtml = '<div class="pbc-stats-box" id="' + statsBoxId + '">' +
      '<span class="pbc-stat-label">All Dates</span>' +
      '<span class="pbc-stat"><b>Mean:</b> ' + preciseFormatter.format(stats.mean) + '</span>' +
      '<span class="pbc-stat"><b>Median:</b> ' + preciseFormatter.format(stats.median) + '</span>' +
      '<span class="pbc-stat"><b>σ:</b> ' + preciseFormatter.format(stats.stddev) + '</span>' +
      '<span class="pbc-stat"><b>Min:</b> ' + preciseFormatter.format(stats.min) + '</span>' +
      '<span class="pbc-stat"><b>Max:</b> ' + preciseFormatter.format(stats.max) + '</span>' +
      '<span class="pbc-stat"><b>Count:</b> ' + filteredValues.length + '</span>' +
      '</div>';

    /* ── Band toggle button ───────────────────────────────── */
    var modeLabel = mode === "minmax" ? "Min / Max" : "Mean ± 1σ";
    var toggleId = "pbc-toggle-" + Math.random().toString(36).substr(2, 6);

    /* ── Legend ────────────────────────────────────────────── */
    var legendHtml = '<div class="pbc-legend">';
    legendHtml += '<span class="pbc-legend-item"><span class="pbc-swatch" style="background:' + escapeHtml(cfg.lineColor) + '"></span>Data</span>';
    if (cfg.showMeanLine) {
      legendHtml += '<span class="pbc-legend-item"><span class="pbc-swatch pbc-swatch-dash" style="background:' + escapeHtml(cfg.meanLineColor) + '"></span>Mean</span>';
    }
    if (cfg.showMedianLine) {
      legendHtml += '<span class="pbc-legend-item"><span class="pbc-swatch pbc-swatch-dash" style="background:' + escapeHtml(cfg.medianLineColor) + '"></span>Median</span>';
    }
    legendHtml += '<span class="pbc-legend-item"><span class="pbc-swatch" style="background:' + escapeHtml(cfg.bandColor) + ';opacity:0.5"></span>Band (' + escapeHtml(modeLabel) + ')</span>';
    legendHtml += '</div>';

    /* ── Title bar ────────────────────────────────────────── */
    var inputId = "pbc-input-" + Math.random().toString(36).substr(2, 6);
    var calcId  = "pbc-calc-"  + Math.random().toString(36).substr(2, 6);
    var clearId = "pbc-clear-" + Math.random().toString(36).substr(2, 6);
    var filterVal = Number.isFinite(filterMin) ? filterMin : "";

    var fsId = "pbc-fs-" + Math.random().toString(36).substr(2, 6);

    var titleHtml = '<div class="pbc-header">' +
      '<span class="pbc-title">' + escapeHtml(cfg.title) + '</span>' +
      '<div class="pbc-header-controls">' +
        '<input id="' + inputId + '" class="pbc-filter-input" type="number" placeholder="Min value\u2026" value="' + escapeHtml(String(filterVal)) + '"/>' +
        '<button class="pbc-calc-btn" id="' + calcId + '">Calculate</button>' +
        (Number.isFinite(filterMin) ? '<button class="pbc-clear-btn" id="' + clearId + '">\u2715</button>' : '') +
        '<button class="pbc-toggle" id="' + toggleId + '">Toggle: ' + escapeHtml(modeLabel) + '</button>' +
        '<button class="pbc-fs-btn" id="' + fsId + '" title="Fullscreen">\u26F6</button>' +
      '</div>' +
      '</div>';

    /* ── Assemble ─────────────────────────────────────────── */
    var chartAreaHtml = '<div class="pbc-chart-wrapper">' +
      '<div class="pbc-yaxis">' + yAxisSvg + '</div>' +
      '<div class="pbc-scroll">' + svg + '</div>' +
      '</div>';

    root.innerHTML = '<div class="pbc-shell">' +
      titleHtml + legendHtml +
      chartAreaHtml +
      statsHtml +
      '</div>';

    /* ── Bind hover on data points ──────────────────────────── */
    var statsBox = root.querySelector("#" + statsBoxId);
    var scrollEl = root.querySelector(".pbc-scroll");
    var bandEl   = root.querySelector("#" + bandId);
    var meanEl   = root.querySelector("#" + meanId);
    var medianEl = root.querySelector("#" + medianId);

    // Save original paths for restore
    var origBandD   = bandEl   ? bandEl.getAttribute("d")   : null;
    var origMeanD   = meanEl   ? meanEl.getAttribute("d")   : null;
    var origMedianD = medianEl ? medianEl.getAttribute("d") : null;

    if (scrollEl && statsBox) {
      var allOverallHtml = statsBox.innerHTML;

      function updateLines(ms) {
        // Compute band bounds from the per-month stats
        var hu, hl;
        if (mode === "stddev") {
          hu = ms.mean + ms.stddev;
          hl = ms.mean - ms.stddev;
        } else {
          hu = ms.max;
          hl = ms.min;
        }
        if (bandEl)   bandEl.setAttribute("d",   bandPath(hu, hl, mLeft, chartW, chartH, n, yMin, yRange));
        if (meanEl)   meanEl.setAttribute("d",   horizontalLine(ms.mean, mLeft, chartW, chartH, yMin, yRange));
        if (medianEl) medianEl.setAttribute("d", horizontalLine(ms.median, mLeft, chartW, chartH, yMin, yRange));
      }

      function restoreLines() {
        if (bandEl   && origBandD)   bandEl.setAttribute("d",   origBandD);
        if (meanEl   && origMeanD)   meanEl.setAttribute("d",   origMeanD);
        if (medianEl && origMedianD) medianEl.setAttribute("d", origMedianD);
      }

      scrollEl.addEventListener("mouseover", function (e) {
        var target = e.target;
        if (!target || !target.classList.contains("pbc-hit")) return;
        var idx = parseInt(target.getAttribute("data-idx"), 10);
        if (isNaN(idx) || !data[idx]) return;
        var d = data[idx];
        var monthInfo = monthStatsByKey[d.monthKey];
        if (!monthInfo) return;
        var monthVals = monthInfo.values || [];
        var ms = monthInfo;

        // Update SVG lines & band
        updateLines(ms);

        // Update stats box
        statsBox.innerHTML =
          '<span class="pbc-stat-label">' + escapeHtml(monthInfo.label) + ' / ' + escapeHtml(d.label) + '</span>' +
          '<span class="pbc-stat"><b>Value:</b> ' + preciseFormatter.format(d.value) + '</span>' +
          '<span class="pbc-stat"><b>Mean:</b> ' + preciseFormatter.format(ms.mean) + '</span>' +
          '<span class="pbc-stat"><b>Median:</b> ' + preciseFormatter.format(ms.median) + '</span>' +
          '<span class="pbc-stat"><b>σ:</b> ' + preciseFormatter.format(ms.stddev) + '</span>' +
          '<span class="pbc-stat"><b>Min:</b> ' + preciseFormatter.format(ms.min) + '</span>' +
          '<span class="pbc-stat"><b>Max:</b> ' + preciseFormatter.format(ms.max) + '</span>' +
          '<span class="pbc-stat"><b>Count:</b> ' + monthVals.length + '</span>';
      });

      scrollEl.addEventListener("mouseout", function (e) {
        var target = e.target;
        if (!target || !target.classList.contains("pbc-hit")) return;
        restoreLines();
        statsBox.innerHTML = allOverallHtml;
      });
    }

    /* ── Bind toggle click ────────────────────────────────── */
    var btn = root.querySelector("#" + toggleId);
    if (btn && cfg.onBandToggle) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        cfg.onBandToggle();
      });
    }

    /* ── Bind filter calculate ─────────────────────────────── */
    var inp = root.querySelector("#" + inputId);
    var calcBtn = root.querySelector("#" + calcId);
    if (calcBtn && cfg.onFilter) {
      var doFilter = function () {
        var raw = inp ? inp.value : "";
        var num = parseFloat(raw);
        cfg.onFilter(Number.isFinite(num) ? num : null);
      };
      calcBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        doFilter();
      });
      if (inp) {
        inp.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.stopPropagation(); doFilter(); }
        });
      }
    }
    var clearBtn = root.querySelector("#" + clearId);
    if (clearBtn && cfg.onFilter) {
      clearBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        cfg.onFilter(null);
      });
    }

    /* ── Bind fullscreen button ───────────────────────────── */
    var fsBtn = root.querySelector("#" + fsId);
    if (fsBtn) {
      fsBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var shell = root.querySelector(".pbc-shell");
        if (!shell) return;
        var isFs = shell.classList.contains("pbc-fullscreen");
        shell.classList.toggle("pbc-fullscreen");
        // Re-render with new dimensions after transition
        if (cfg.onFullscreen) cfg.onFullscreen(!isFs);
      });
    }
  }

  return { render: render };
});
