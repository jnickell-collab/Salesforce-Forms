(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else {
    root.MasterOfPieRenderer = factory();
  }
})(this, function () {
  "use strict";

  /* ── Palette sets — one per quadrant ──────────────────────── */

  var PALETTES = [
    ["#ff6b6b", "#ff9f43", "#ffd166", "#30d5c8", "#44b3ff", "#7b61ff", "#f15bb5", "#00bbf9"],
    ["#00f5d4", "#00bbf9", "#9b5de5", "#f15bb5", "#fee440", "#fb5607", "#3a86ff", "#8ac926"],
    ["#ff8fab", "#fb6f92", "#ffc971", "#90f1ef", "#5e60ce", "#c77dff", "#f3722c", "#43aa8b"],
    ["#e040fb", "#40c4ff", "#ffab40", "#69f0ae", "#ff5252", "#7c4dff", "#ffd740", "#18ffff"]
  ];

  var ACCENT_COLORS = ["#ff9f43", "#00f5d4", "#ff8fab", "#72efdd"];

  var valueFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  var compactFormatter = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
  var percentFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /* ── Helpers ──────────────────────────────────────────────── */

  function escapeHtml(val) {
    return String(val == null ? "" : val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function formatValue(v, vt, compact) {
    if (!Number.isFinite(v)) return vt || "0";
    return compact ? compactFormatter.format(v) : (vt || valueFormatter.format(v));
  }

  function polarToCartesian(cx, cy, r, deg) {
    var rad = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function donutPath(cx, cy, ri, ro, sa, ea) {
    var se = ea - sa >= 360 ? sa + 359.999 : ea;
    var os = polarToCartesian(cx, cy, ro, se);
    var oe = polarToCartesian(cx, cy, ro, sa);
    var is = polarToCartesian(cx, cy, ri, se);
    var ie = polarToCartesian(cx, cy, ri, sa);
    var large = se - sa > 180 ? 1 : 0;
    return [
      "M", os.x, os.y,
      "A", ro, ro, 0, large, 0, oe.x, oe.y,
      "L", ie.x, ie.y,
      "A", ri, ri, 0, large, 1, is.x, is.y,
      "Z"
    ].join(" ");
  }

  function normalizeData(raw, palette) {
    return (raw || []).map(function (item, i) {
      var v = Number(item.value);
      return {
        index: i,
        label: item.label || "Untitled",
        value: Number.isFinite(v) ? v : 0,
        absValue: Number.isFinite(v) ? Math.abs(v) : 0,
        valueText: item.valueText,
        color: palette[i % palette.length],
        elemNumber: item.elemNumber
      };
    }).filter(function (d) { return d.absValue > 0; }).sort(function (a, b) {
      return b.absValue - a.absValue;
    });
  }

  function buildSlices(data, innerRatio) {
    var CX = 110, CY = 110, OR = 95;
    var absTotal = data.reduce(function (s, d) { return s + d.absValue; }, 0);
    var sa = -90;
    return data.map(function (item, i) {
      var angle = data.length === 1 ? 359.999 : (item.absValue / absTotal) * 360;
      var ea = sa + angle;
      var mid = sa + angle / 2;
      var ed = clamp(6 + angle / 24, 6, 16);
      var ep = polarToCartesian(0, 0, ed, mid);
      var slice = {
        index: i, label: item.label, value: item.value, absValue: item.absValue,
        valueText: item.valueText,
        elemNumber: item.elemNumber, color: item.color,
        percent: absTotal ? (item.absValue / absTotal) * 100 : 0,
        path: donutPath(CX, CY, CX * innerRatio, OR, sa, ea),
        midAngle: mid,
        explodeX: ep.x, explodeY: ep.y
      };
      sa = ea;
      return slice;
    });
  }

  /* ── Viewport classes ────────────────────────────────────── */

  function shellClasses(w, h) {
    var cls = ["mop-shell"];
    if ((w > 0 && w <= 560) || (h > 0 && h <= 400)) cls.push("mop-shell_stacked");
    else if ((w > 0 && w <= 800) || (h > 0 && h <= 500)) cls.push("mop-shell_tight");
    if ((w > 0 && w <= 420) || (h > 0 && h <= 320)) cls.push("mop-shell_micro");
    return cls.join(" ");
  }

  /* ── Data‑table modal markup ─────────────────────────────── */

  function buildTableMarkup(chart, slices, total, accent, idx) {
    var title = escapeHtml(chart.title || ("Chart " + (idx + 1)));
    var dimLabel = escapeHtml(chart.dimLabel || "Dimension");
    var measLabel = escapeHtml(chart.measLabel || "Measure");

    var rows = slices.map(function (sl, i) {
      return [
        '<tr class="mop-tbl-row" style="animation-delay:' + (i * 40) + 'ms;">',
        '  <td class="mop-tbl-rank">' + (i + 1) + '</td>',
        '  <td class="mop-tbl-color"><span style="background:' + sl.color + ';box-shadow:0 0 8px ' + sl.color + ';"></span></td>',
        '  <td class="mop-tbl-label">' + escapeHtml(sl.label) + '</td>',
        '  <td class="mop-tbl-value">' + escapeHtml(formatValue(sl.value, sl.valueText, false)) + '</td>',
        '  <td class="mop-tbl-pct">' + percentFormatter.format(sl.percent) + '%</td>',
        '  <td class="mop-tbl-bar"><span class="mop-tbl-bar-track"><i style="width:' + percentFormatter.format(sl.percent) + '%;background:' + sl.color + ';"></i></span></td>',
        '</tr>'
      ].join("");
    }).join("");

    return [
      '<div class="mop-modal-overlay" data-modal="' + idx + '">',
      '  <div class="mop-modal">',
      '    <div class="mop-modal-header">',
      '      <div>',
      '        <p class="mop-modal-kicker">Data Table</p>',
      '        <h3 class="mop-modal-title">' + title + '</h3>',
      '      </div>',
      '      <div class="mop-modal-stats">',
      '        <span class="mop-modal-stat"><em>Total</em><strong>' + escapeHtml(formatValue(total, null, false)) + '</strong></span>',
      '        <span class="mop-modal-stat"><em>Items</em><strong>' + slices.length + '</strong></span>',
      '      </div>',
      '      <button class="mop-modal-close" type="button" data-modal-close="' + idx + '" aria-label="Close">&times;</button>',
      '    </div>',
      '    <div class="mop-modal-body">',
      '      <table class="mop-tbl">',
      '        <thead>',
      '          <tr>',
      '            <th class="mop-tbl-rank">#</th>',
      '            <th class="mop-tbl-color"></th>',
      '            <th class="mop-tbl-label">' + dimLabel + '</th>',
      '            <th class="mop-tbl-value">' + measLabel + '</th>',
      '            <th class="mop-tbl-pct">Share</th>',
      '            <th class="mop-tbl-bar">Distribution</th>',
      '          </tr>',
      '        </thead>',
      '        <tbody>' + rows + '</tbody>',
      '        <tfoot>',
      '          <tr>',
      '            <td class="mop-tbl-rank"></td>',
      '            <td class="mop-tbl-color"></td>',
      '            <td class="mop-tbl-label"><strong>Total</strong></td>',
      '            <td class="mop-tbl-value"><strong>' + escapeHtml(formatValue(total, null, false)) + '</strong></td>',
      '            <td class="mop-tbl-pct"><strong>100%</strong></td>',
      '            <td class="mop-tbl-bar"></td>',
      '          </tr>',
      '        </tfoot>',
      '      </table>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join("");
  }

  /* ── Build a single card ─────────────────────────────────── */

  function buildCardMarkup(chart, idx) {
    var palette = PALETTES[idx % PALETTES.length];
    var accent = ACCENT_COLORS[idx % ACCENT_COLORS.length];
    var data = normalizeData(chart.data, palette);
    var title = escapeHtml(chart.title || ("Chart " + (idx + 1)));

    if (!data.length) {
      return [
        '<article class="mop-card mop-card_empty" data-card-index="' + idx + '">',
        '  <div class="mop-card-header">',
        '    <h3 class="mop-card-title">' + title + '</h3>',
        '  </div>',
        '  <div class="mop-card-body"><span>No data available</span></div>',
        '</article>'
      ].join("");
    }

    var total = data.reduce(function (s, d) { return s + d.value; }, 0);
    var slices = buildSlices(data, 0.58);

    var sliceMarkup = slices.map(function (sl, i) {
      return [
        '<g class="mop-slice-group" data-card="' + idx + '" data-slice="' + i + '" style="--slice-delay:' + (i * 80) + 'ms;--explode-x:' + sl.explodeX + 'px;--explode-y:' + sl.explodeY + 'px;">',
        '  <path class="mop-slice" d="' + sl.path + '" fill="' + sl.color + '"></path>',
        '</g>'
      ].join("");
    }).join("");

    var legendMarkup = slices.map(function (sl, i) {
      return [
        '<button class="mop-legend-item" type="button" data-card="' + idx + '" data-legend="' + i + '">',
        '  <span class="mop-legend-dot" style="background:' + sl.color + ';--dot-color:' + sl.color + ';"></span>',
        '  <span class="mop-legend-label">' + escapeHtml(sl.label) + '</span>',
        '  <span class="mop-legend-pct">' + percentFormatter.format(sl.percent) + '%</span>',
        '  <span class="mop-legend-bar"><i style="width:' + percentFormatter.format(sl.percent) + '%;background:' + sl.color + ';"></i></span>',
        '</button>'
      ].join("");
    }).join("");

    return [
      '<article class="mop-card" data-card-index="' + idx + '">',
      '  <div class="mop-card-header">',
      '    <h3 class="mop-card-title">' + title + '</h3>',
      '    <div class="mop-card-actions">',
      '      <button class="mop-card-tbl-btn" type="button" data-open-table="' + idx + '" title="View data table">',
      '        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v1H2zm0 3h12v1H2zm0 3h12v1H2zm0 3h8v1H2z" fill="currentColor"/></svg>',
      '      </button>',
      '      <button class="mop-card-tbl-btn" type="button" data-open-fullscreen="' + idx + '" title="Fullscreen chart">',
      '        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h5v1.5H3.5V6H2V2zm7 0h5v4h-1.5V3.5H9V2zM2 10h1.5v2.5H6V14H2v-4zm10.5 2.5V10H14v4h-4v-1.5h2.5z" fill="currentColor"/></svg>',
      '      </button>',
      '    </div>',
      '  </div>',
      '  <div class="mop-card-body">',
      '    <div class="mop-donut-wrap">',
      '      <svg class="mop-donut-svg" viewBox="0 0 220 220">',
      '        ' + sliceMarkup,
      '      </svg>',
      '      <div class="mop-donut-center" data-center-card="' + idx + '">',
      '        <strong class="mop-donut-center-value" data-center-value="' + idx + '">' + escapeHtml(formatValue(total, null, true)) + '</strong>',
      '        <span class="mop-donut-center-label" data-center-label="' + idx + '">Total</span>',
      '      </div>',
      '    </div>',
      '    <div class="mop-legend" role="list">' + legendMarkup + '</div>',
      '  </div>',
      '</article>'
    ].join("");
  }

  /* ── Bind hover / click per card ─────────────────────────── */

  function bindCardInteractions(root, cardIdx, slices, total, onSliceClick) {
    var sliceNodes = root.querySelectorAll('[data-card="' + cardIdx + '"][data-slice]');
    var legendNodes = root.querySelectorAll('[data-card="' + cardIdx + '"][data-legend]');
    var centerValue = root.querySelector('[data-center-value="' + cardIdx + '"]');
    var centerLabel = root.querySelector('[data-center-label="' + cardIdx + '"]');

    function setActive(index) {
      sliceNodes.forEach(function (n) {
        n.classList.toggle("is-active", Number(n.getAttribute("data-slice")) === index);
      });
      legendNodes.forEach(function (n) {
        n.classList.toggle("is-active", Number(n.getAttribute("data-legend")) === index);
      });
      if (typeof index === "number" && slices[index]) {
        var s = slices[index];
        if (centerValue) centerValue.textContent = formatValue(s.value, s.valueText, true);
        if (centerLabel) centerLabel.textContent = percentFormatter.format(s.percent) + "%";
      } else {
        if (centerValue) centerValue.textContent = formatValue(total, null, true);
        if (centerLabel) centerLabel.textContent = "Total";
      }
    }

    sliceNodes.forEach(function (n) {
      var i = Number(n.getAttribute("data-slice"));
      n.addEventListener("mouseenter", function () { setActive(i); });
      n.addEventListener("mouseleave", function () { setActive(null); });
      n.addEventListener("click", function () {
        if (typeof onSliceClick === "function") onSliceClick(slices[i]);
      });
    });

    legendNodes.forEach(function (n) {
      var i = Number(n.getAttribute("data-legend"));
      n.addEventListener("mouseenter", function () { setActive(i); });
      n.addEventListener("mouseleave", function () { setActive(null); });
      n.addEventListener("focus", function () { setActive(i); });
      n.addEventListener("blur", function () { setActive(null); });
      n.addEventListener("click", function () {
        if (typeof onSliceClick === "function") onSliceClick(slices[i]);
      });
    });
  }

  /* ── Bind table modal open / close ───────────────────────── */

  function bindTableModals(root) {
    root.querySelectorAll("[data-open-table]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = btn.getAttribute("data-open-table");
        var overlay = root.querySelector('[data-modal="' + idx + '"]');
        if (overlay) {
          overlay.classList.add("is-open");
        }
      });
    });

    root.querySelectorAll("[data-modal-close]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = btn.getAttribute("data-modal-close");
        var overlay = root.querySelector('[data-modal="' + idx + '"]');
        if (overlay) {
          overlay.classList.remove("is-open");
        }
      });
    });

    root.querySelectorAll(".mop-modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) {
          overlay.classList.remove("is-open");
        }
      });
    });
  }

  /* ── Build fullscreen overlay for a single card ──────────── */

  function buildFullscreenMarkup(chart, idx, cardDatum, accent) {
    var title = escapeHtml(chart.title || ("Chart " + (idx + 1)));
    var slices = cardDatum.slices;
    var total = cardDatum.total;
    if (!slices.length) return "";

    var sliceMarkup = slices.map(function (sl, i) {
      return [
        '<g class="mop-slice-group" data-fs-card="' + idx + '" data-fs-slice="' + i + '" style="--slice-delay:' + (i * 80) + 'ms;--explode-x:' + sl.explodeX + 'px;--explode-y:' + sl.explodeY + 'px;">',
        '  <path class="mop-slice" d="' + sl.path + '" fill="' + sl.color + '"></path>',
        '</g>'
      ].join("");
    }).join("");

    var legendMarkup = slices.map(function (sl, i) {
      return [
        '<button class="mop-legend-item" type="button" data-fs-card="' + idx + '" data-fs-legend="' + i + '">',
        '  <span class="mop-legend-dot" style="background:' + sl.color + ';--dot-color:' + sl.color + ';"></span>',
        '  <span class="mop-legend-label">' + escapeHtml(sl.label) + '</span>',
        '  <span class="mop-legend-pct">' + percentFormatter.format(sl.percent) + '%</span>',
        '  <span class="mop-legend-value">' + escapeHtml(formatValue(sl.value, sl.valueText, false)) + '</span>',
        '  <span class="mop-legend-bar"><i style="width:' + percentFormatter.format(sl.percent) + '%;background:' + sl.color + ';"></i></span>',
        '</button>'
      ].join("");
    }).join("");

    return [
      '<div class="mop-fs-overlay" data-fullscreen="' + idx + '">',
      '  <div class="mop-fs-panel">',
      '    <div class="mop-fs-header">',
      '      <h3 class="mop-fs-title">' + title + '</h3>',
      '      <button class="mop-modal-close" type="button" data-fs-close="' + idx + '" aria-label="Close">&times;</button>',
      '    </div>',
      '    <div class="mop-fs-body">',
      '      <div class="mop-fs-donut-wrap">',
      '        <svg class="mop-donut-svg" viewBox="0 0 220 220">',
      '          ' + sliceMarkup,
      '        </svg>',
      '        <div class="mop-donut-center">',
      '          <strong class="mop-donut-center-value" data-fs-center-value="' + idx + '">' + escapeHtml(formatValue(total, null, true)) + '</strong>',
      '          <span class="mop-donut-center-label" data-fs-center-label="' + idx + '">Total</span>',
      '        </div>',
      '      </div>',
      '      <div class="mop-fs-legend" role="list">' + legendMarkup + '</div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join("");
  }

  /* ── Bind fullscreen open / close ─────────────────────────── */

  function bindFullscreenModals(root) {
    root.querySelectorAll("[data-open-fullscreen]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = btn.getAttribute("data-open-fullscreen");
        var overlay = root.querySelector('[data-fullscreen="' + idx + '"]');
        if (overlay) overlay.classList.add("is-open");
      });
    });

    root.querySelectorAll("[data-fs-close]").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = btn.getAttribute("data-fs-close");
        var overlay = root.querySelector('[data-fullscreen="' + idx + '"]');
        if (overlay) overlay.classList.remove("is-open");
      });
    });

    root.querySelectorAll(".mop-fs-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) overlay.classList.remove("is-open");
      });
    });

    // Bind hover interactions inside fullscreen
    root.querySelectorAll(".mop-fs-overlay").forEach(function (overlay) {
      var idx = Number(overlay.getAttribute("data-fullscreen"));
      var sliceNodes = overlay.querySelectorAll('[data-fs-slice]');
      var legendNodes = overlay.querySelectorAll('[data-fs-legend]');
      var centerValue = overlay.querySelector('[data-fs-center-value="' + idx + '"]');
      var centerLabel = overlay.querySelector('[data-fs-center-label="' + idx + '"]');

      function setActive(index) {
        sliceNodes.forEach(function (n) {
          n.classList.toggle("is-active", Number(n.getAttribute("data-fs-slice")) === index);
        });
        legendNodes.forEach(function (n) {
          n.classList.toggle("is-active", Number(n.getAttribute("data-fs-legend")) === index);
        });
      }

      sliceNodes.forEach(function (n) {
        var i = Number(n.getAttribute("data-fs-slice"));
        n.addEventListener("mouseenter", function () { setActive(i); });
        n.addEventListener("mouseleave", function () { setActive(null); });
      });

      legendNodes.forEach(function (n) {
        var i = Number(n.getAttribute("data-fs-legend"));
        n.addEventListener("mouseenter", function () { setActive(i); });
        n.addEventListener("mouseleave", function () { setActive(null); });
      });
    });
  }

  /* ── Main render ─────────────────────────────────────────── */

  function render(root, config) {
    if (!root) return;

    var charts = config.charts || [];
    var w = config.containerWidth || 0;
    var h = config.containerHeight || 0;
    var cls = shellClasses(w, h);
    var dashTitle = escapeHtml(config.title || "Overage Breakdown");

    var cardData = charts.map(function (chart, idx) {
      var palette = PALETTES[idx % PALETTES.length];
      var data = normalizeData(chart.data, palette);
      var total = data.reduce(function (s, d) { return s + d.value; }, 0);
      return { data: data, total: total, slices: buildSlices(data, 0.58) };
    });
    // Overage badge shows only Chart 1 total
    var overageTotal = cardData[0] ? cardData[0].total : 0;

    var cardsMarkup = charts.map(function (chart, idx) {
      return buildCardMarkup(chart, idx);
    }).join("");

    var modalsMarkup = charts.map(function (chart, idx) {
      var cd = cardData[idx];
      if (!cd.slices.length) return "";
      return buildTableMarkup(chart, cd.slices, cd.total, ACCENT_COLORS[idx % ACCENT_COLORS.length], idx);
    }).join("");

    var fullscreenMarkup = charts.map(function (chart, idx) {
      var cd = cardData[idx];
      if (!cd.slices.length) return "";
      return buildFullscreenMarkup(chart, idx, cd, ACCENT_COLORS[idx % ACCENT_COLORS.length]);
    }).join("");

    root.innerHTML = [
      '<div class="' + cls + '">',
      '  <header class="mop-header">',
      '    <div>',
      '      <h2>' + dashTitle + '</h2>',
      '    </div>',
      '    <div class="mop-total-badge">',
      '      <span>Overage</span>',
      '      <strong>' + escapeHtml(formatValue(overageTotal, null, true)) + '</strong>',
      '    </div>',
      '  </header>',
      '  <div class="mop-grid">' + cardsMarkup + '</div>',
      '  ' + modalsMarkup,
      '  ' + fullscreenMarkup,
      '</div>'
    ].join("");

    cardData.forEach(function (cd, idx) {
      if (cd.slices.length) {
        bindCardInteractions(root, idx, cd.slices, cd.total, charts[idx] && charts[idx].onSliceClick);
      }
    });

    bindTableModals(root);
    bindFullscreenModals(root);
  }

  return { render: render };
});
