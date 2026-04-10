(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else {
    root.PredictionBandRenderer = factory();
  }
})(this, function () {
  "use strict";

  /* ── Formatters ──────────────────────────────────────────── */

  var valueFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0
  });
  var compactFormatter = new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1
  });
  var preciseFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2
  });

  function escapeHtml(val) {
    return String(val == null ? "" : val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatValue(v, compact) {
    if (!Number.isFinite(v)) return "0";
    return compact ? compactFormatter.format(v) : valueFormatter.format(v);
  }

  /* ── Inline stats calc (for filtered data) ───────────────── */

  function computeStats(values) {
    var n = values.length;
    if (n === 0) return { mean: 0, median: 0, min: 0, max: 0, stddev: 0 };
    var sum = 0,
      min = Infinity,
      max = -Infinity;
    for (var i = 0; i < n; i++) {
      sum += values[i];
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    var mean = sum / n;
    var sorted = values.slice().sort(function (a, b) {
      return a - b;
    });
    var median =
      n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)];
    var sqSum = 0;
    for (var j = 0; j < n; j++)
      sqSum += (values[j] - mean) * (values[j] - mean);
    return {
      mean: mean,
      median: median,
      min: min,
      max: max,
      stddev: Math.sqrt(sqSum / n)
    };
  }

  /* ── Linear regression & residual-bootstrap prediction bands ── */

  function fitLinearRegression(xs, ys) {
    var n = xs.length;
    if (n === 0) return null;
    var sumx = 0,
      sumy = 0;
    for (var i = 0; i < n; i++) {
      sumx += xs[i];
      sumy += ys[i];
    }
    var xbar = sumx / n,
      ybar = sumy / n;
    var Sxx = 0,
      Sxy = 0;
    for (var j = 0; j < n; j++) {
      var dx = xs[j] - xbar;
      Sxx += dx * dx;
      Sxy += dx * (ys[j] - ybar);
    }
    var b = Sxx === 0 ? 0 : Sxy / Sxx;
    var a = ybar - b * xbar;
    var fitted = xs.map(function (x) {
      return a + b * x;
    });
    var resid = ys.map(function (y, i) {
      return y - fitted[i];
    });
    var ssr = 0;
    for (var k = 0; k < n; k++) ssr += resid[k] * resid[k];
    var denom = Math.max(1, n - 2);
    var mse = ssr / denom;
    return { a: a, b: b, fitted: fitted, resid: resid, mse: mse };
  }

  function _randInt(max) {
    return Math.floor(Math.random() * max);
  }

  function percentile(arr, p) {
    if (!arr.length) return NaN;
    var copy = arr.slice().sort(function (a, b) {
      return a - b;
    });
    var idx = p * (copy.length - 1);
    var lo = Math.floor(idx),
      hi = Math.ceil(idx);
    if (lo === hi) return copy[lo];
    var w = idx - lo;
    return copy[lo] * (1 - w) + copy[hi] * w;
  }

  /**
   * Residual bootstrap: for each iteration resample residuals, create y* = fitted + r*,
   * refit regression and collect predicted values. Returns {lower:[], upper:[]} arrays
   * for the provided xs order.
   */
  function residualBootstrapBands(xs, ys, alpha, iterations) {
    var n = xs.length;
    var resultLower = new Array(n),
      resultUpper = new Array(n);
    if (n < 3) {
      for (var i = 0; i < n; i++) {
        resultLower[i] = ys[i];
        resultUpper[i] = ys[i];
      }
      return { lower: resultLower, upper: resultUpper };
    }
    var base = fitLinearRegression(xs, ys);
    if (!base) return { lower: resultLower, upper: resultUpper };
    var predsByIter = new Array(iterations);
    for (var it = 0; it < iterations; it++) {
      // resample residuals with replacement
      var resampled = new Array(n);
      for (var r = 0; r < n; r++) resampled[r] = base.resid[_randInt(n)];
      var ystar = new Array(n);
      for (var t = 0; t < n; t++) ystar[t] = base.fitted[t] + resampled[t];
      var fit = fitLinearRegression(xs, ystar);
      predsByIter[it] = fit.fitted.slice(0);
    }
    var lowerP = (1 - alpha) / 2;
    var upperP = 1 - lowerP;
    for (var idx = 0; idx < n; idx++) {
      var vals = new Array(iterations);
      for (var j = 0; j < iterations; j++) vals[j] = predsByIter[j][idx];
      resultLower[idx] = percentile(vals, lowerP);
      resultUpper[idx] = percentile(vals, upperP);
    }
    return { lower: resultLower, upper: resultUpper };
  }

  function movingAverage(values, windowSize) {
    var n = values.length;
    if (!n) return [];
    var size = Math.max(1, Math.min(windowSize || 5, n));
    if (size % 2 === 0) size -= 1;
    var half = Math.floor(size / 2);
    var out = new Array(n);
    for (var i = 0; i < n; i++) {
      var start = Math.max(0, i - half);
      var end = Math.min(n - 1, i + half);
      var sum = 0;
      var count = 0;
      for (var j = start; j <= end; j++) {
        sum += values[j];
        count += 1;
      }
      out[i] = count ? sum / count : values[i];
    }
    return out;
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
    return points
      .map(function (p, i) {
        var x = chartX + i * stepX;
        var y = chartH - ((p.value - yMin) / yRange) * chartH;
        return (i === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
      })
      .join(" ");
  }

  function horizontalLine(yVal, chartX, chartW, chartH, yMin, yRange) {
    var y = chartH - ((yVal - yMin) / yRange) * chartH;
    return (
      "M" +
      chartX.toFixed(2) +
      "," +
      y.toFixed(2) +
      " L" +
      (chartX + chartW).toFixed(2) +
      "," +
      y.toFixed(2)
    );
  }

  /** Build a polyline path from an array of Y values (one per data point). */
  function statLinePath(yValues, chartX, chartW, chartH, n, yMin, yRange) {
    if (!yValues.length || yRange === 0) return "";
    var nn = yValues.length > 1 ? yValues.length : n || 1;
    var stepX = nn > 1 ? chartW / (nn - 1) : 0;
    return yValues
      .map(function (v, i) {
        var x = chartX + i * stepX;
        var y = chartH - ((v - yMin) / yRange) * chartH;
        return (i === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
      })
      .join(" ");
  }

  /** Build a closed area path between upper[] and lower[] arrays. */
  function varyingBandPath(
    upperArr,
    lowerArr,
    chartX,
    chartW,
    chartH,
    n,
    yMin,
    yRange
  ) {
    var nn = upperArr && upperArr.length > 1 ? upperArr.length : n || 0;
    if (nn === 0 || yRange === 0) return "";
    var stepX = nn > 1 ? chartW / (nn - 1) : 0;
    // Top edge left → right
    var path = upperArr
      .map(function (v, i) {
        var x = chartX + i * stepX;
        var y = chartH - ((v - yMin) / yRange) * chartH;
        return (i === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
      })
      .join(" ");
    // Bottom edge right → left
    for (var j = nn - 1; j >= 0; j--) {
      var x = chartX + j * stepX;
      var y = chartH - ((lowerArr[j] - yMin) / yRange) * chartH;
      path += " L" + x.toFixed(2) + "," + y.toFixed(2);
    }
    path += " Z";
    return path;
  }

  function bandPath(
    upperVal,
    lowerVal,
    chartX,
    chartW,
    chartH,
    n,
    yMin,
    yRange
  ) {
    if (n === 0 || yRange === 0) return "";
    var stepX = n > 1 ? chartW / (n - 1) : 0;
    var topY = chartH - ((upperVal - yMin) / yRange) * chartH;
    var botY = chartH - ((lowerVal - yMin) / yRange) * chartH;

    var path = "M" + chartX.toFixed(2) + "," + topY.toFixed(2);
    path +=
      " L" + (chartX + (n - 1) * stepX).toFixed(2) + "," + topY.toFixed(2);
    path +=
      " L" + (chartX + (n - 1) * stepX).toFixed(2) + "," + botY.toFixed(2);
    path += " L" + chartX.toFixed(2) + "," + botY.toFixed(2);
    path += " Z";
    return path;
  }

  /* ── Main render ─────────────────────────────────────────── */

  function render(root, cfg) {
    if (!root || !cfg) return;
    root.className =
      "pbc-root" + (cfg.theme === "light" ? " pbc-theme-light" : "");
    var W = cfg.containerWidth || 400;
    var H = cfg.containerHeight || 300;
    if (W < 60 || H < 60) return;
    var zoomScale = Number.isFinite(cfg.zoomScale) ? cfg.zoomScale : 1;
    var viewMode = cfg.viewMode === "table" ? "table" : "chart";
    var menuOpen = !!cfg.menuOpen;

    var rawData = cfg.data || [];
    var filterMin = cfg.filterMin;

    /* Apply filter: remove months below the threshold */
    var data;
    if (Number.isFinite(filterMin)) {
      data = rawData.filter(function (d) {
        return d.value >= filterMin;
      });
    } else {
      data = rawData;
    }

    // Optionally remove weekends and holidays when configured
    var excludeWeekends = !!cfg.excludeWeekends;
    var holidaysList = Array.isArray(cfg.holidays)
      ? cfg.holidays
      : cfg.holidays
        ? cfg.holidays
        : [];

    function fmtISO(d) {
      if (!d || isNaN(d.getTime())) return null;
      var y = d.getFullYear();
      var m = (d.getMonth() + 1).toString().padStart(2, "0");
      var dd = d.getDate().toString().padStart(2, "0");
      return y + "-" + m + "-" + dd;
    }

    if (excludeWeekends || (holidaysList && holidaysList.length)) {
      var holSet = {};
      holidaysList.forEach(function (h) {
        if (h) holSet[h] = true;
      });
      data = data.filter(function (d) {
        if (!d || !d.date) return true; // keep if no date available
        if (excludeWeekends) {
          var day = d.date.getDay();
          if (day === 0 || day === 6) return false;
        }
        var iso = fmtISO(d.date);
        if (iso && holSet[iso]) return false;
        return true;
      });
    }

    /* Recompute stats on the filtered daily dataset */
    var filteredValues = [];
    data.forEach(function (d) {
      if (Number.isFinite(d.value)) filteredValues.push(d.value);
    });
    var stats = computeStats(filteredValues);

    var mode = cfg.bandMode || "minmax";
    var annotations = Array.isArray(cfg.annotations) ? cfg.annotations : [];
    var annotationMap = {};
    annotations.forEach(function (annotation) {
      if (!annotation || !annotation.dateKey || !annotation.message) return;
      if (!annotationMap[annotation.dateKey])
        annotationMap[annotation.dateKey] = [];
      annotationMap[annotation.dateKey].push(annotation.message);
    });
    var confVal = Number.isFinite(cfg.confidence)
      ? cfg.confidence
      : Number.isFinite(cfg.confidenceLevel)
        ? cfg.confidenceLevel
        : 0.95;
    var lowerP = (1 - confVal) / 2;
    var upperP = 1 - lowerP;
    var pacingArr = movingAverage(
      filteredValues,
      Math.min(5, filteredValues.length || 1)
    );
    var bandUpperArr = [];
    var bandLowerArr = [];
    var predictedArr = pacingArr.slice();
    var residuals = filteredValues.map(function (value, idx) {
      return value - (Number.isFinite(pacingArr[idx]) ? pacingArr[idx] : value);
    });
    var residualStats = computeStats(residuals);
    var residualLower = residuals.length
      ? percentile(residuals, lowerP)
      : residualStats.min;
    var residualUpper = residuals.length
      ? percentile(residuals, upperP)
      : residualStats.max;

    var xs = filteredValues.map(function (_, i) {
      return i;
    });
    var regLower = [];
    var regUpper = [];
    if (mode === "regression" && filteredValues.length >= 3) {
      var iterations = Number.isFinite(cfg.bootstrapIterations)
        ? cfg.bootstrapIterations
        : cfg.bootstrapIterations || 500;
      var bands = residualBootstrapBands(
        xs,
        filteredValues,
        confVal,
        iterations
      );
      regLower = bands.lower;
      regUpper = bands.upper;
      var baseFit = fitLinearRegression(xs, filteredValues);
      predictedArr = baseFit && baseFit.fitted ? baseFit.fitted : predictedArr;
    }

    data.forEach(function (d, idx) {
      if (mode === "stddev") {
        bandUpperArr.push(
          (Number.isFinite(predictedArr[idx]) ? predictedArr[idx] : d.value) +
            (Number.isFinite(residualStats.stddev) ? residualStats.stddev : 0)
        );
        bandLowerArr.push(
          (Number.isFinite(predictedArr[idx]) ? predictedArr[idx] : d.value) -
            (Number.isFinite(residualStats.stddev) ? residualStats.stddev : 0)
        );
      } else if (mode === "regression") {
        bandUpperArr.push(
          Number.isFinite(regUpper[idx]) ? regUpper[idx] : d.value
        );
        bandLowerArr.push(
          Number.isFinite(regLower[idx]) ? regLower[idx] : d.value
        );
      } else {
        bandUpperArr.push(
          (Number.isFinite(predictedArr[idx]) ? predictedArr[idx] : d.value) +
            (Number.isFinite(residualUpper) ? residualUpper : 0)
        );
        bandLowerArr.push(
          (Number.isFinite(predictedArr[idx]) ? predictedArr[idx] : d.value) +
            (Number.isFinite(residualLower) ? residualLower : 0)
        );
      }
    });

    /* Reserve space used by the shell chrome so the SVG bottom labels are not clipped. */
    var chromeH = 112;
    /* margins */
    var mTop = 8,
      mRight = 20,
      mBottom = 72,
      mLeft = 64;
    var viewH = H - chromeH - mTop - mBottom;
    if (viewH < 20) return;

    /* Y range – encompass the plotted daily totals plus daily-series overlays. */
    var yMin = Infinity;
    var yMax = -Infinity;

    data.forEach(function (d) {
      if (Number.isFinite(d.value)) {
        if (d.value < yMin) yMin = d.value;
        if (d.value > yMax) yMax = d.value;
      }
    });

    predictedArr.forEach(function (v) {
      if (Number.isFinite(v)) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    });

    if (cfg.showBudgetLine && Number.isFinite(cfg.budgetValue)) {
      if (cfg.budgetValue < yMin) yMin = cfg.budgetValue;
      if (cfg.budgetValue > yMax) yMax = cfg.budgetValue;
    }
    if (cfg.showLastYearLine && Number.isFinite(cfg.lastYearValue)) {
      if (cfg.lastYearValue < yMin) yMin = cfg.lastYearValue;
      if (cfg.lastYearValue > yMax) yMax = cfg.lastYearValue;
    }

    bandUpperArr.forEach(function (v) {
      if (Number.isFinite(v) && v > yMax) yMax = v;
    });

    bandLowerArr.forEach(function (v) {
      if (Number.isFinite(v) && v < yMin) yMin = v;
    });

    if (!Number.isFinite(yMin)) yMin = 0;
    if (!Number.isFinite(yMax)) yMax = 1;
    // Allow explicit axis overrides from properties (skip padding when applied)
    var overrideMin = Number.isFinite(cfg.yAxisMin);
    var overrideMax = Number.isFinite(cfg.yAxisMax);
    if (overrideMin || overrideMax) {
      var newMin = overrideMin ? cfg.yAxisMin : yMin;
      var newMax = overrideMax ? cfg.yAxisMax : yMax;
      // Only apply if valid range
      if (Number.isFinite(newMin) && Number.isFinite(newMax) && newMax > newMin) {
        yMin = newMin;
        yMax = newMax;
        var yPad = 0;
      } else {
        var yPad = (yMax - yMin) * 0.08 || 1;
        yMin -= yPad;
        yMax += yPad;
      }
    } else {
      var yPad = (yMax - yMin) * 0.08 || 1;
      yMin -= yPad;
      yMax += yPad;
    }
    var yRange = yMax - yMin;

    var n = data.length;
    var MIN_PX_PER_POINT = 60 * zoomScale;
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
    var yAxisSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      mLeft +
      '" height="' +
      (viewH + mTop + mBottom) +
      '"' +
      ' viewBox="0 0 ' +
      mLeft +
      " " +
      (viewH + mTop + mBottom) +
      '" style="display:block">';
    yTicks.forEach(function (t) {
      var y = mTop + chartH - ((t - yMin) / yRange) * chartH;
      yAxisSvg +=
        '<text x="' +
        (mLeft - 8) +
        '" y="' +
        (y + 4).toFixed(1) +
        '" text-anchor="end" fill="rgba(132,189,0,0.5)" font-size="11">' +
        formatValue(t, true) +
        "</text>";
    });
    // Y axis label
    yAxisSvg +=
      '<text x="14" y="' +
      (mTop + chartH / 2) +
      '" text-anchor="middle" fill="rgba(132,189,0,0.7)" font-size="12" font-weight="600"' +
      ' transform="rotate(-90,14,' +
      (mTop + chartH / 2) +
      ')">' +
      escapeHtml(cfg.measLabel) +
      "</text>";
    yAxisSvg += "</svg>";

    /* ── Scrollable chart SVG ─────────────────────────────── */
    var svg = "";
    svg +=
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      svgW +
      '" height="' +
      (viewH + mTop + mBottom) +
      '"' +
      ' viewBox="0 0 ' +
      svgW +
      " " +
      (viewH + mTop + mBottom) +
      '" style="display:block;min-width:' +
      svgW +
      'px">';

    /* ── Grid lines ───────────────────────────────────────── */
    yTicks.forEach(function (t) {
      var y = mTop + chartH - ((t - yMin) / yRange) * chartH;
      svg +=
        '<line x1="' +
        mLeft +
        '" y1="' +
        y.toFixed(1) +
        '" x2="' +
        (mLeft + chartW) +
        '" y2="' +
        y.toFixed(1) +
        '" stroke="rgba(132,189,0,0.1)" stroke-width="1"/>';
    });

    /* ── Band (daily-series empirical, stddev, or regression) ─────────── */
    var bandId = "pbc-band-" + Math.random().toString(36).substr(2, 6);
    var pacingId = "pbc-pacing-" + Math.random().toString(36).substr(2, 6);

    var bPath = varyingBandPath(
      bandUpperArr,
      bandLowerArr,
      mLeft,
      chartW,
      chartH,
      n,
      yMin,
      yRange
    );
    svg += '<g transform="translate(0,' + mTop + ')">';
    svg +=
      '<path id="' +
      bandId +
      '" d="' +
      bPath +
      '" fill="' +
      escapeHtml(cfg.bandColor) +
      '" opacity="' +
      (cfg.bandOpacity || 0.2) +
      '"/>';

    if (cfg.showBudgetLine && Number.isFinite(cfg.budgetValue)) {
      svg +=
        '<path d="' +
        horizontalLine(cfg.budgetValue, mLeft, chartW, chartH, yMin, yRange) +
        '" fill="none" stroke="' +
        escapeHtml(cfg.budgetLineColor) +
        '" stroke-width="1.6" stroke-dasharray="2,4" opacity="0.95"/>';
    }
    if (cfg.showLastYearLine && Number.isFinite(cfg.lastYearValue)) {
      svg +=
        '<path d="' +
        horizontalLine(cfg.lastYearValue, mLeft, chartW, chartH, yMin, yRange) +
        '" fill="none" stroke="' +
        escapeHtml(cfg.lastYearLineColor) +
        '" stroke-width="1.8" stroke-dasharray="8,6" opacity="0.9"/>';
    }

    /* ── Data line ────────────────────────────────────────── */
    var dPath = linePath(data, mLeft, chartW, chartH, yMin, yRange);
    svg +=
      '<path d="' +
      dPath +
      '" fill="none" stroke="' +
      escapeHtml(cfg.lineColor) +
      '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';

    var pacingPath = statLinePath(
      predictedArr,
      mLeft,
      chartW,
      chartH,
      n,
      yMin,
      yRange
    );
    svg +=
      '<path id="' +
      pacingId +
      '" d="' +
      pacingPath +
      '" fill="none" stroke="' +
      escapeHtml(cfg.pacingLineColor) +
      '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';

    data.forEach(function (d, i) {
      var notes = annotationMap[d.dateKey];
      if (!notes || !notes.length) return;
      var x = mLeft + i * stepX;
      var noteLabel = notes.join(" | ");
      svg +=
        '<line x1="' +
        x.toFixed(2) +
        '" y1="0" x2="' +
        x.toFixed(2) +
        '" y2="' +
        chartH.toFixed(2) +
        '" stroke="' +
        escapeHtml(cfg.annotationLineColor) +
        '" stroke-width="1.5" opacity="0.9"/>';
      var boxWidth = Math.max(90, Math.min(190, 8 + noteLabel.length * 6.2));
      var boxHeight = 34;
      var boxX = Math.max(
        mLeft + 4,
        Math.min(x - boxWidth / 2, mLeft + chartW - boxWidth - 4)
      );
      var boxY = Math.max(12, chartH - boxHeight - 14 - (i % 2) * 38);
      svg +=
        '<rect x="' +
        boxX.toFixed(2) +
        '" y="' +
        boxY.toFixed(2) +
        '" width="' +
        boxWidth.toFixed(2) +
        '" height="' +
        boxHeight.toFixed(2) +
        '" rx="6" ry="6" fill="rgba(245,245,245,0.92)" stroke="' +
        escapeHtml(cfg.annotationLineColor) +
        '" stroke-width="1"/>';
      svg +=
        '<text x="' +
        (boxX + 8).toFixed(2) +
        '" y="' +
        (boxY + 20).toFixed(2) +
        '" fill="#555" font-size="11" text-anchor="start">' +
        escapeHtml(noteLabel) +
        "</text>";
    });

    /* ── Data points (with hover targets) ─────────────────── */
    data.forEach(function (d, i) {
      if (!Number.isFinite(d.value)) return;
      var cx = mLeft + i * stepX;
      var cy = chartH - ((d.value - yMin) / yRange) * chartH;
      // Invisible larger hit area
      svg +=
        '<circle class="pbc-hit" data-idx="' +
        i +
        '" cx="' +
        cx.toFixed(2) +
        '" cy="' +
        cy.toFixed(2) +
        '" r="14" fill="transparent" style="cursor:pointer"/>';
      // Visible dot
      svg +=
        '<circle class="pbc-dot" data-idx="' +
        i +
        '" cx="' +
        cx.toFixed(2) +
        '" cy="' +
        cy.toFixed(2) +
        '" r="3.5" fill="' +
        escapeHtml(cfg.lineColor) +
        '" stroke="#111" stroke-width="1" style="pointer-events:none"/>';
    });

    svg += "</g>"; // close chart-area group

    /* ── X-axis labels (every point when scrollable) ─────── */
    var labelStep = scrollable
      ? 1
      : Math.max(1, Math.ceil(n / Math.max(1, Math.floor(visibleChartW / 60))));
    data.forEach(function (d, i) {
      if (i % labelStep !== 0) return;
      var x = mLeft + i * stepX;
      var y = mTop + chartH + 18;
      svg +=
        '<text x="' +
        x.toFixed(1) +
        '" y="' +
        y +
        '" text-anchor="middle" fill="rgba(132,189,0,0.6)" font-size="10" transform="rotate(-35,' +
        x.toFixed(1) +
        "," +
        y +
        ')">' +
        escapeHtml(d.label) +
        "</text>";
    });

    /* ── X axis label ─────────────────────────────────────── */
    svg +=
      '<text x="' +
      (mLeft + chartW / 2) +
      '" y="' +
      (viewH + mTop + mBottom - 4) +
      '" text-anchor="middle" fill="rgba(132,189,0,0.7)" font-size="12" font-weight="600">' +
      escapeHtml(cfg.dimLabel) +
      "</text>";

    svg += "</svg>";

    /* ── Stats box HTML ───────────────────────────────────── */
    var statsBoxId = "pbc-stats-" + Math.random().toString(36).substr(2, 6);
    var statsHtml =
      '<div class="pbc-stats-box" id="' +
      statsBoxId +
      '">' +
      '<span class="pbc-stat-label">Business-Day Series</span>' +
      '<span class="pbc-stat"><b>Avg Actual:</b> ' +
      preciseFormatter.format(stats.mean) +
      "</span>" +
      '<span class="pbc-stat"><b>Avg Pace:</b> ' +
      preciseFormatter.format(computeStats(predictedArr).mean) +
      "</span>" +
      '<span class="pbc-stat"><b>Residual σ:</b> ' +
      preciseFormatter.format(residualStats.stddev) +
      "</span>" +
      '<span class="pbc-stat"><b>Min:</b> ' +
      preciseFormatter.format(stats.min) +
      "</span>" +
      '<span class="pbc-stat"><b>Max:</b> ' +
      preciseFormatter.format(stats.max) +
      "</span>" +
      '<span class="pbc-stat"><b>Business Days:</b> ' +
      filteredValues.length +
      "</span>" +
      '<span class="pbc-stat"><b>Zoom:</b> ' +
      preciseFormatter.format(zoomScale) +
      "x</span>" +
      "</div>";

    var tableHtml =
      '<div class="pbc-table-wrap"><table class="pbc-table"><thead><tr>' +
      "<th>Date</th>" +
      "<th>Actual</th>" +
      "<th>Pacing</th>" +
      "<th>Lower</th>" +
      "<th>Upper</th>" +
      (cfg.showBudgetLine && Number.isFinite(cfg.budgetValue)
        ? "<th>Budget</th>"
        : "") +
      (cfg.showLastYearLine && Number.isFinite(cfg.lastYearValue)
        ? "<th>Last Year</th>"
        : "") +
      "<th>Rows</th>" +
      "<th>Comment</th>" +
      "</tr></thead><tbody>";

    data.forEach(function (d, idx) {
      var predicted = Number.isFinite(predictedArr[idx])
        ? predictedArr[idx]
        : null;
      var lowerBound = Number.isFinite(bandLowerArr[idx])
        ? bandLowerArr[idx]
        : null;
      var upperBound = Number.isFinite(bandUpperArr[idx])
        ? bandUpperArr[idx]
        : null;
      var commentText = annotationMap[d.dateKey]
        ? annotationMap[d.dateKey].join(" | ")
        : "";
      tableHtml +=
        "<tr>" +
        "<td>" +
        escapeHtml(d.label) +
        "</td>" +
        "<td>" +
        escapeHtml(preciseFormatter.format(d.value)) +
        "</td>" +
        "<td>" +
        (Number.isFinite(predicted)
          ? escapeHtml(preciseFormatter.format(predicted))
          : "") +
        "</td>" +
        "<td>" +
        (Number.isFinite(lowerBound)
          ? escapeHtml(preciseFormatter.format(lowerBound))
          : "") +
        "</td>" +
        "<td>" +
        (Number.isFinite(upperBound)
          ? escapeHtml(preciseFormatter.format(upperBound))
          : "") +
        "</td>" +
        (cfg.showBudgetLine && Number.isFinite(cfg.budgetValue)
          ? "<td>" +
            escapeHtml(preciseFormatter.format(cfg.budgetValue)) +
            "</td>"
          : "") +
        (cfg.showLastYearLine && Number.isFinite(cfg.lastYearValue)
          ? "<td>" +
            escapeHtml(preciseFormatter.format(cfg.lastYearValue)) +
            "</td>"
          : "") +
        "<td>" +
        escapeHtml(String(d.rowCount || 1)) +
        "</td>" +
        "<td>" +
        escapeHtml(commentText) +
        "</td>" +
        "</tr>";
    });
    tableHtml += "</tbody></table></div>";

    /* ── Band toggle button ───────────────────────────────── */
    var confVal = Number.isFinite(cfg.confidence)
      ? cfg.confidence
      : Number.isFinite(cfg.confidenceLevel)
        ? cfg.confidenceLevel
        : 0.95;
    var confPct = Math.round(confVal * 100);
    var modeLabel =
      mode === "minmax"
        ? "Pacing Residual Bounds (" + confPct + "%)"
        : mode === "stddev"
          ? "Pacing ± 1σ"
          : "Regression Bootstrap";
    var toggleId = "pbc-toggle-" + Math.random().toString(36).substr(2, 6);

    /* ── Legend ────────────────────────────────────────────── */
    var legendHtml = '<div class="pbc-legend">';
    legendHtml +=
      '<span class="pbc-legend-item"><span class="pbc-swatch" style="background:' +
      escapeHtml(cfg.bandColor) +
      ';opacity:0.5"></span>Band Width</span>';
    legendHtml +=
      '<span class="pbc-legend-item"><span class="pbc-swatch" style="background:' +
      escapeHtml(cfg.pacingLineColor) +
      '"></span>Pacing Model</span>';
    legendHtml +=
      '<span class="pbc-legend-item"><span class="pbc-swatch" style="background:' +
      escapeHtml(cfg.lineColor) +
      '"></span>Actuals</span>';
    if (cfg.showBudgetLine && Number.isFinite(cfg.budgetValue)) {
      legendHtml +=
        '<span class="pbc-legend-item"><span class="pbc-swatch pbc-swatch-dash" style="background:' +
        escapeHtml(cfg.budgetLineColor) +
        '"></span>Budget</span>';
    }
    if (cfg.showLastYearLine && Number.isFinite(cfg.lastYearValue)) {
      legendHtml +=
        '<span class="pbc-legend-item"><span class="pbc-swatch pbc-swatch-dash" style="background:' +
        escapeHtml(cfg.lastYearLineColor) +
        '"></span>Last Year</span>';
    }
    legendHtml +=
      '<span class="pbc-legend-item">' + escapeHtml(modeLabel) + "</span>";
    legendHtml += "</div>";

    /* ── Title bar ────────────────────────────────────────── */
    var inputId = "pbc-input-" + Math.random().toString(36).substr(2, 6);
    var calcId = "pbc-calc-" + Math.random().toString(36).substr(2, 6);
    var clearId = "pbc-clear-" + Math.random().toString(36).substr(2, 6);
    var filterVal = Number.isFinite(filterMin) ? filterMin : "";

    var weekendId = "pbc-weekend-" + Math.random().toString(36).substr(2, 6);
    var holidaysId = "pbc-holidays-" + Math.random().toString(36).substr(2, 6);
    var commentsId = "pbc-comments-" + Math.random().toString(36).substr(2, 6);
    var themeId = "pbc-theme-" + Math.random().toString(36).substr(2, 6);
    var menuId = "pbc-menu-" + Math.random().toString(36).substr(2, 6);
    var viewChartId =
      "pbc-view-chart-" + Math.random().toString(36).substr(2, 6);
    var viewTableId =
      "pbc-view-table-" + Math.random().toString(36).substr(2, 6);

    var titleHtml =
      '<div class="pbc-header">' +
      '<span class="pbc-title">' +
      escapeHtml(cfg.title) +
      "</span>" +
      '<div class="pbc-header-controls">' +
      '<div class="pbc-menu-shell">' +
      '<button class="pbc-toggle pbc-menu-btn" id="' +
      menuId +
      '" title="Menu">&#9776;</button>' +
      (menuOpen
        ? '<div class="pbc-menu-pop"><button class="pbc-menu-item' +
          (viewMode === "chart" ? " is-active" : "") +
          '" id="' +
          viewChartId +
          '">Chart view</button><button class="pbc-menu-item' +
          (viewMode === "table" ? " is-active" : "") +
          '" id="' +
          viewTableId +
          '">Table view</button></div>'
        : "") +
      "</div>" +
      '<input id="' +
      inputId +
      '" class="pbc-filter-input" type="number" placeholder="Min value\u2026" value="' +
      escapeHtml(String(filterVal)) +
      '"/>' +
      '<button class="pbc-calc-btn" id="' +
      calcId +
      '">Calculate</button>' +
      (Number.isFinite(filterMin)
        ? '<button class="pbc-clear-btn" id="' + clearId + '">\u2715</button>'
        : "") +
      '<button class="pbc-toggle" id="' +
      toggleId +
      '">Toggle: ' +
      escapeHtml(modeLabel) +
      "</button>" +
      '<button class="pbc-toggle" id="' +
      weekendId +
      '" title="Exclude weekends">Exclude weekends</button>' +
      '<button class="pbc-toggle" id="' +
      holidaysId +
      '" title="Edit holidays">Edit holidays</button>' +
      '<button class="pbc-toggle" id="' +
      commentsId +
      '" title="Edit comments">Comments</button>' +
      '<button class="pbc-toggle" id="' +
      themeId +
      '" title="Toggle theme">&#128161;</button>' +
      "</div>" +
      "</div>";

    /* ── Assemble ─────────────────────────────────────────── */
    var chartAreaHtml =
      '<div class="pbc-chart-wrapper">' +
      '<div class="pbc-yaxis">' +
      yAxisSvg +
      "</div>" +
      '<div class="pbc-scroll">' +
      svg +
      "</div>" +
      "</div>";

    root.innerHTML =
      '<div class="pbc-shell">' +
      titleHtml +
      legendHtml +
      (viewMode === "table" ? tableHtml : chartAreaHtml) +
      statsHtml +
      "</div>";

    /* ── Bind hover on data points ──────────────────────────── */
    var statsBox = root.querySelector("#" + statsBoxId);
    var scrollEl = root.querySelector(".pbc-scroll");
    if (scrollEl && statsBox) {
      var allOverallHtml = statsBox.innerHTML;

      if (cfg.zoomAnchor && typeof cfg.zoomAnchor === "object") {
        var maxScrollLeft = Math.max(
          0,
          scrollEl.scrollWidth - scrollEl.clientWidth
        );
        var nextScrollLeft =
          cfg.zoomAnchor.contentRatio * scrollEl.scrollWidth -
          cfg.zoomAnchor.offsetRatio * scrollEl.clientWidth;
        scrollEl.scrollLeft = Math.max(
          0,
          Math.min(maxScrollLeft, nextScrollLeft)
        );
        cfg.zoomAnchor = null;
      }

      // Floating tooltip element (re-used across hovers)
      var tooltip = root.querySelector(".pbc-tooltip");
      if (!tooltip) {
        tooltip = document.createElement("div");
        tooltip.className = "pbc-tooltip";
        tooltip.style.display = "none";
        root.appendChild(tooltip);
      }

      scrollEl.addEventListener("mouseover", function (e) {
        var target = e.target;
        if (!target || !target.classList.contains("pbc-hit")) return;
        var idx = parseInt(target.getAttribute("data-idx"), 10);
        if (isNaN(idx) || !data[idx]) return;
        var d = data[idx];
        var predicted = Number.isFinite(predictedArr[idx])
          ? predictedArr[idx]
          : null;
        var lowerBound = Number.isFinite(bandLowerArr[idx])
          ? bandLowerArr[idx]
          : null;
        var upperBound = Number.isFinite(bandUpperArr[idx])
          ? bandUpperArr[idx]
          : null;

        // Update stats box
        statsBox.innerHTML =
          '<span class="pbc-stat-label">' +
          escapeHtml(d.label) +
          "</span>" +
          '<span class="pbc-stat"><b>Daily Total:</b> ' +
          preciseFormatter.format(d.value) +
          "</span>" +
          (Number.isFinite(predicted)
            ? '<span class="pbc-stat"><b>Pacing Model:</b> ' +
              preciseFormatter.format(predicted) +
              "</span>"
            : "") +
          (Number.isFinite(lowerBound)
            ? '<span class="pbc-stat"><b>Lower:</b> ' +
              preciseFormatter.format(lowerBound) +
              "</span>"
            : "") +
          (Number.isFinite(upperBound)
            ? '<span class="pbc-stat"><b>Upper:</b> ' +
              preciseFormatter.format(upperBound) +
              "</span>"
            : "") +
          (cfg.showBudgetLine && Number.isFinite(cfg.budgetValue)
            ? '<span class="pbc-stat"><b>Budget:</b> ' +
              preciseFormatter.format(cfg.budgetValue) +
              "</span>"
            : "") +
          (cfg.showLastYearLine && Number.isFinite(cfg.lastYearValue)
            ? '<span class="pbc-stat"><b>Last Year:</b> ' +
              preciseFormatter.format(cfg.lastYearValue) +
              "</span>"
            : "") +
          (annotationMap[d.dateKey]
            ? '<span class="pbc-stat"><b>Comment:</b> ' +
              escapeHtml(annotationMap[d.dateKey].join(" | ")) +
              "</span>"
            : "") +
          '<span class="pbc-stat"><b>Rows:</b> ' +
          (d.rowCount || 1) +
          "</span>";

        // Populate and position tooltip
        try {
          tooltip.innerHTML =
            '<span class="pbc-tooltip-title">' +
            escapeHtml(d.label) +
            "</span>" +
            '<span class="pbc-tooltip-line"><b>Daily Total:</b> ' +
            preciseFormatter.format(d.value) +
            "</span>" +
            (Number.isFinite(predicted)
              ? '<span class="pbc-tooltip-line"><b>Pacing Model:</b> ' +
                preciseFormatter.format(predicted) +
                "</span>"
              : "") +
            (Number.isFinite(lowerBound) && Number.isFinite(upperBound)
              ? '<span class="pbc-tooltip-line"><b>Band:</b> ' +
                preciseFormatter.format(lowerBound) +
                " to " +
                preciseFormatter.format(upperBound) +
                "</span>"
              : "") +
            (cfg.showBudgetLine && Number.isFinite(cfg.budgetValue)
              ? '<span class="pbc-tooltip-line"><b>Budget:</b> ' +
                preciseFormatter.format(cfg.budgetValue) +
                "</span>"
              : "") +
            (cfg.showLastYearLine && Number.isFinite(cfg.lastYearValue)
              ? '<span class="pbc-tooltip-line"><b>Last Year:</b> ' +
                preciseFormatter.format(cfg.lastYearValue) +
                "</span>"
              : "") +
            (annotationMap[d.dateKey]
              ? '<span class="pbc-tooltip-line"><b>Comment:</b> ' +
                escapeHtml(annotationMap[d.dateKey].join(" | ")) +
                "</span>"
              : "") +
            '<span class="pbc-tooltip-line"><b>Rows:</b> ' +
            (d.rowCount || 1) +
            "</span>";

          var rootRect = root.getBoundingClientRect();
          var tx = e.clientX - rootRect.left + 12;
          var ty = e.clientY - rootRect.top + 12;
          tooltip.style.left = tx + "px";
          tooltip.style.top = ty + "px";
          tooltip.style.display = "block";
        } catch (err) {
          // non-fatal: ignore tooltip errors
        }
      });

      scrollEl.addEventListener("mouseout", function (e) {
        var target = e.target;
        if (!target || !target.classList.contains("pbc-hit")) return;
        statsBox.innerHTML = allOverallHtml;
        if (tooltip) tooltip.style.display = "none";
      });

      if (cfg.onZoom) {
        scrollEl.addEventListener(
          "wheel",
          function (e) {
            if (!e || !Number.isFinite(e.deltaY) || e.deltaY === 0) return;
            e.preventDefault();
            var rect = scrollEl.getBoundingClientRect();
            var offsetX =
              rect.width > 0
                ? Math.max(0, Math.min(rect.width, e.clientX - rect.left))
                : 0;
            var scrollWidth = Math.max(scrollEl.scrollWidth, 1);
            var anchor = {
              contentRatio: (scrollEl.scrollLeft + offsetX) / scrollWidth,
              offsetRatio: rect.width > 0 ? offsetX / rect.width : 0.5
            };
            cfg.onZoom(e.deltaY < 0 ? 1 : -1, anchor);
          },
          { passive: false }
        );
      }
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
          if (e.key === "Enter") {
            e.stopPropagation();
            doFilter();
          }
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

    /* ── Bind exclude-weekends and edit-holidays buttons ───── */
    var weekendBtn = root.querySelector("#" + weekendId);
    if (weekendBtn && cfg.onToggleExcludeWeekends) {
      weekendBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        cfg.onToggleExcludeWeekends();
      });
    }

    var holidaysBtn = root.querySelector("#" + holidaysId);
    if (holidaysBtn && cfg.onEditHolidays) {
      holidaysBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        cfg.onEditHolidays();
      });
    }

    var commentsBtn = root.querySelector("#" + commentsId);
    if (commentsBtn && cfg.onEditAnnotations) {
      commentsBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        cfg.onEditAnnotations();
      });
    }

    var menuBtn = root.querySelector("#" + menuId);
    if (menuBtn && cfg.onMenuToggle) {
      menuBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        cfg.onMenuToggle();
      });
    }

    var viewChartBtn = root.querySelector("#" + viewChartId);
    if (viewChartBtn && cfg.onSelectViewMode) {
      viewChartBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        cfg.onSelectViewMode("chart");
      });
    }

    var viewTableBtn = root.querySelector("#" + viewTableId);
    if (viewTableBtn && cfg.onSelectViewMode) {
      viewTableBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        cfg.onSelectViewMode("table");
      });
    }

    var themeBtn = root.querySelector("#" + themeId);
    if (themeBtn && cfg.onThemeToggle) {
      themeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        cfg.onThemeToggle();
      });
    }
  }

  return { render: render };
});
