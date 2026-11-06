/* Canvas views: height map, charts, 3D surface and raw laser view. */
(function (root) {
  'use strict';
  var C = { bg: '#0e1013', grid: '#24272c', axis: '#3b3f46', tick: '#8f949a', text: '#d5d8dc', win: 'rgba(74,163,255,.15)', blue: '#4aa3ff', red: '#ff5a52', white: '#ffffff', yellow: '#ffd23f', green: '#2fd08f', violet: '#a78bfa', orange: '#ff7a45', pink: '#e87ba4' };
  var FONT = '11px Outfit, system-ui, sans-serif';
  var NX = Sim.NX, NY = Sim.NY, DX = Sim.DX, DY = Sim.DY;

  function turbo(x) {
    var x2 = x * x, x3 = x2 * x, x4 = x3 * x, x5 = x4 * x;
    return [0.13572138 + 4.6153926 * x - 42.66032258 * x2 + 132.13108234 * x3 - 152.94239396 * x4 + 59.28637943 * x5,
      0.09140261 + 2.19418839 * x + 4.84296658 * x2 - 14.18503333 * x3 + 4.27729857 * x4 + 2.82956604 * x5,
      0.1066733 + 12.64194608 * x - 60.58204836 * x2 + 110.36276771 * x3 - 89.90310912 * x4 + 27.34824973 * x5].map(function (c) { return Math.max(0, Math.min(255, Math.round(c * 255))); });
  }
  var LUT = { colour: [], gray: [] };
  for (var t = 0; t < 256; t++) { LUT.colour.push(turbo(t / 255)); LUT.gray.push([t, t, t]); }

  function fit(cv) {
    var dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 600, h = cv.clientHeight || 200;
    var W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c: c, w: w, h: h };
  }
  function niceStep(range, target) {
    var raw = range / Math.max(1, target), mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }
  function autoRange(z, j0, j1) {
    var s = [], a = j0 === undefined ? 0 : j0, b = j1 === undefined ? NY - 1 : j1;
    for (var j = a; j <= b; j += 3) for (var i = 0; i < NX; i += 3) { var v = z[j * NX + i]; if (v === v) s.push(v); }
    if (!s.length) return [0, 1];
    s.sort(function (p, q) { return p - q; });
    return [s[Math.floor(s.length * 0.01)], s[Math.floor(s.length * 0.99)]];
  }

  /* ---------- height map ---------- */
  var ML = 44, MR = 10, MT = 6, MB = 20;
  function drawMap(cv, o) {
    var f = fit(cv), c = f.c, w = f.w, h = f.h;
    c.fillStyle = C.bg; c.fillRect(0, 0, w, h);
    var off = cv._off || (cv._off = document.createElement('canvas')); off.width = NY; off.height = NX;
    var ox = off.getContext('2d'), im = ox.createImageData(NY, NX), p = im.data, z = o.z, lo = o.lo, hi = o.hi, lut = LUT[o.pal === 'gray' ? 'gray' : 'colour'], k = 255 / Math.max(1e-6, hi - lo);
    var I = o.I;
    for (var j = 0; j < NY; j++) for (var i = 0; i < NX; i++) {
      var q = (i * NY + j) * 4, v = z[j * NX + i], r, g, b;
      if (o.pal === 'ref') { var gv = I[j * NX + i]; r = g = b = gv; }
      else if (v !== v) { r = 232; g = 123; b = 164; }
      else { var n = Math.max(0, Math.min(255, Math.round((v - lo) * k))), e = lut[n]; r = e[0]; g = e[1]; b = e[2]; }
      p[q] = r; p[q + 1] = g; p[q + 2] = b; p[q + 3] = 255;
    }
    ox.putImageData(im, 0, 0);
    var PW = w - ML - MR, PH = h - MT - MB;
    c.imageSmoothingEnabled = true;
    c.drawImage(off, ML, MT, PW, PH);
    var P = {
      X: function (j2) { return ML + j2 / (NY - 1) * PW; }, Y: function (xmm) { return MT + xmm / Sim.XMAX * PH; },
      iX: function (px) { return (px - ML) / PW * (NY - 1); }, iY: function (py) { return (py - MT) / PH * Sim.XMAX; }, c: c, w: w, h: h, L: ML, T: MT, PW: PW, PH: PH, kind: 'map'
    };
    /* axes */
    c.font = FONT; c.fillStyle = C.tick; c.textBaseline = 'middle'; c.textAlign = 'right';
    for (var xm = 0; xm <= 60; xm += 20) c.fillText(String(xm), ML - 6, P.Y(xm));
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (var ym = 0; ym <= 160; ym += 20) c.fillText(String(ym), P.X(ym / DY), h - 6);
    c.save(); c.translate(12, MT + PH / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText('X (mm)', 0, 0); c.restore();
    c.textAlign = 'right'; c.fillText('Y (mm)', w - MR, h - 6 - 0);
    if (o.draw) o.draw(P);
    cv._P = P;
    return P;
  }
  function polyAlong(P, fn, j0, j1, color, width, dash) {
    var c = P.c; c.save(); c.strokeStyle = color; c.lineWidth = width || 1; if (dash) c.setLineDash(dash);
    c.beginPath(); var pen = false;
    for (var j = j0; j <= j1; j += 2) { var v = fn(j); if (v !== v) { pen = false; continue; } var X = P.X(j), Y = P.Y(v); if (pen) c.lineTo(X, Y); else c.moveTo(X, Y); pen = true; }
    c.stroke(); c.restore();
  }
  function lineMarker(P, j) {
    var c = P.c, x = P.X(j);
    c.save(); c.strokeStyle = '#000'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, P.T); c.lineTo(x, P.T + P.PH); c.stroke();
    c.strokeStyle = C.white; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, P.T); c.lineTo(x, P.T + P.PH); c.stroke(); c.restore();
  }
  function blobBox(P, b, color, label) {
    var c = P.c, x0 = P.X(b.jmin) - 2, x1 = P.X(b.jmax) + 2, y0 = P.Y(b.imin * DX) - 2, y1 = P.Y(b.imax * DX) + 2;
    c.save(); c.strokeStyle = color; c.lineWidth = 2; c.strokeRect(x0, y0, Math.max(5, x1 - x0), Math.max(5, y1 - y0));
    if (label) { c.font = '600 11px Outfit, sans-serif'; var tw = c.measureText(label).width + 8; var ly = y0 - 15 < P.T ? y1 + 1 : y0 - 15; c.fillStyle = color; c.fillRect(x0, ly, tw, 14); c.fillStyle = '#000'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(label, x0 + 4, ly + 7); }
    c.restore();
  }

  /* ---------- general chart ---------- */
  function drawChart(cv, s) {
    var f = fit(cv), c = f.c, w = f.w, h = f.h, L = s.L === undefined ? ML : s.L, R = s.R === undefined ? MR : s.R, T = s.T === undefined ? 10 : s.T, B = s.B === undefined ? 24 : s.B;
    c.fillStyle = C.bg; c.fillRect(0, 0, w, h);
    var PW = w - L - R, PH = h - T - B, xr = s.xmax - s.xmin, yr = (s.ymax - s.ymin) || 1;
    var P = {
      X: function (v) { return L + (v - s.xmin) / xr * PW; }, Y: function (v) { return T + (s.ymax - v) / yr * PH; },
      iX: function (px) { return s.xmin + (px - L) / PW * xr; }, iY: function (py) { return s.ymax - (py - T) / PH * yr; }, c: c, w: w, h: h, L: L, T: T, PW: PW, PH: PH, kind: 'chart'
    };
    c.save(); c.beginPath(); c.rect(L, T, PW, PH); c.clip();
    (s.bands || []).forEach(function (b) {
      var a = P.X(b.a), e = P.X(b.b);
      c.fillStyle = b.fill; c.fillRect(a, T, e - a, PH);
      if (b.stroke) { c.save(); c.strokeStyle = b.stroke; c.setLineDash(b.dash || []); c.strokeRect(a, T + 0.5, e - a, PH - 1); c.restore(); }
    });
    (s.hbands || []).forEach(function (b) { c.fillStyle = b.fill; var y1 = P.Y(b.b), y2 = P.Y(b.a); c.fillRect(L, y1, PW, y2 - y1); });
    (s.fills || []).forEach(function (F) {
      c.fillStyle = F.fill; c.beginPath(); var n = F.xs.length, st = false;
      for (var i = 0; i < n; i++) { if (F.hi[i] !== F.hi[i]) continue; var X = P.X(F.xs[i]), Y = P.Y(F.hi[i]); if (st) c.lineTo(X, Y); else { c.moveTo(X, Y); st = true; } }
      for (i = n - 1; i >= 0; i--) { if (F.lo[i] !== F.lo[i]) continue; c.lineTo(P.X(F.xs[i]), P.Y(F.lo[i])); }
      c.closePath(); c.fill();
    });
    var st2 = niceStep(yr, Math.max(2, Math.round(PH / 34)));
    c.strokeStyle = C.grid; c.lineWidth = 1;
    for (var yv = Math.ceil(s.ymin / st2) * st2; yv <= s.ymax + 1e-6; yv += st2) { var ypx = Math.round(P.Y(yv)) + 0.5; c.beginPath(); c.moveTo(L, ypx); c.lineTo(L + PW, ypx); c.stroke(); }
    var sx = s.xstep || niceStep(xr, Math.max(2, Math.round(PW / 64)));
    for (var xv = Math.ceil(s.xmin / sx) * sx; xv <= s.xmax + 1e-6; xv += sx) { var xpx = Math.round(P.X(xv)) + 0.5; c.beginPath(); c.moveTo(xpx, T); c.lineTo(xpx, T + PH); c.stroke(); }
    (s.hlines || []).forEach(function (l) { c.save(); c.strokeStyle = l.color; c.lineWidth = l.width || 1.2; if (l.dash) c.setLineDash(l.dash); var y = P.Y(l.y); c.beginPath(); c.moveTo(l.x0 !== undefined ? P.X(l.x0) : L, y); c.lineTo(l.x1 !== undefined ? P.X(l.x1) : L + PW, y); c.stroke(); c.restore(); });
    (s.segs || []).forEach(function (l) { c.save(); c.strokeStyle = l.color; c.lineWidth = l.width || 1.2; if (l.dash) c.setLineDash(l.dash); c.beginPath(); c.moveTo(P.X(l.x0), P.Y(l.y0)); c.lineTo(P.X(l.x1), P.Y(l.y1)); c.stroke(); c.restore(); });
    (s.series || []).forEach(function (S) {
      c.save(); c.strokeStyle = S.color; c.lineWidth = S.width || 1.6; c.lineJoin = 'round'; if (S.dash) c.setLineDash(S.dash);
      c.beginPath(); var pen = false, n = S.xs.length;
      for (var i = 0; i < n; i++) { var yy = S.ys[i]; if (yy !== yy) { pen = false; continue; } var X = P.X(S.xs[i]), Y = P.Y(yy); if (pen) c.lineTo(X, Y); else c.moveTo(X, Y); pen = true; }
      c.stroke(); c.restore();
    });
    (s.dots || []).forEach(function (D) { c.fillStyle = D.color; D.pts.forEach(function (pt) { c.fillRect(P.X(pt[0]) - 1.5, P.Y(pt[1]) - 1.5, 3, 3); }); });
    (s.vlines || []).forEach(function (l) { c.save(); c.strokeStyle = l.color; c.lineWidth = l.width || 1; if (l.dash) c.setLineDash(l.dash); var x = P.X(l.x); c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + PH); c.stroke(); c.restore(); });
    (s.markers || []).forEach(function (m) { c.save(); c.fillStyle = m.color; c.strokeStyle = C.bg; c.lineWidth = 2; c.beginPath(); c.arc(P.X(m.x), P.Y(m.y), m.r || 4, 0, 6.3); c.fill(); c.stroke(); c.restore(); });
    if (s.draw) s.draw(P);
    c.restore();
    /* axis text */
    c.font = FONT; c.fillStyle = C.tick; c.textBaseline = 'middle'; c.textAlign = 'right';
    if (!s.noY) for (yv = Math.ceil(s.ymin / st2) * st2; yv <= s.ymax + 1e-6; yv += st2) c.fillText(Math.abs(st2) < 1 ? yv.toFixed(1) : String(Math.round(yv)), L - 6, P.Y(yv));
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    var lw = s.xlabel ? c.measureText(s.xlabel).width + 18 : 0;
    for (xv = Math.ceil(s.xmin / sx) * sx; xv <= s.xmax + 1e-6; xv += sx) { if (s.xlabel && P.X(xv) > L + PW - lw) continue; c.fillText(String(Math.round(xv * 10) / 10), P.X(xv), h - B + 15); }
    if (s.ylabel) { c.save(); c.translate(11, T + PH / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText(s.ylabel, 0, 0); c.restore(); }
    if (s.xlabel) { c.textAlign = 'right'; c.fillText(s.xlabel, L + PW, h - B + 15); }
    (s.tops || []).forEach(function (l) { c.textAlign = 'center'; c.fillStyle = l.color || C.text; c.font = '600 11px Outfit, sans-serif'; c.fillText(l.t, Math.max(L + 30, Math.min(L + PW - 30, P.X(l.x))), T + 12); c.font = FONT; });
    (s.handles || []).forEach(function (hd) { var hx = P.X(hd.x); c.fillStyle = C.yellow; c.fillRect(hx - 3, T + PH / 2 - 9, 6, 18); });
    cv._P = P;
    return P;
  }

  /* ---------- 3D surface ---------- */
  function draw3D(cv, o) {
    var f = fit(cv), c = f.c, w = f.w, h = f.h;
    c.fillStyle = C.bg; c.fillRect(0, 0, w, h);
    var z = o.z, zlo = o.lo, zhi = o.hi, yaw = o.yaw, pit = o.pitch, zs = o.zs || 3;
    var sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pit), cp = Math.cos(pit), scale = Math.min(w / 240, h / 150);
    function pr(ymm, xmm, zz) {
      var a = ymm - 90, b = xmm - 30, d = (zz - zlo) * zs - 6;
      var X = a * cy - b * sy, Y = a * sy + b * cy;
      var Y2 = Y * cp - d * sp, D = Y * sp + d * cp;
      return [w / 2 + X * scale, h / 2 + Y2 * scale * 1, D];
    }
    var quads = [], SJ = 4, SI = 3, lut = LUT[o.pal === 'gray' ? 'gray' : 'colour'], k = 255 / Math.max(1e-6, zhi - zlo);
    for (var j = 0; j < NY - SJ; j += SJ) for (var i = 0; i < NX - SI; i += SI) {
      var a = z[j * NX + i], b = z[j * NX + i + SI], d = z[(j + SJ) * NX + i + SI], e = z[(j + SJ) * NX + i];
      if (a !== a || b !== b || d !== d || e !== e) continue;
      var p1 = pr(j * DY, i * DX, a), p2 = pr(j * DY, (i + SI) * DX, b), p3 = pr((j + SJ) * DY, (i + SI) * DX, d), p4 = pr((j + SJ) * DY, i * DX, e);
      quads.push([p1, p2, p3, p4, (a + b + d + e) / 4, p1[2] + p2[2] + p3[2] + p4[2]]);
    }
    quads.sort(function (m, n) { return m[5] - n[5]; });
    for (var q = 0; q < quads.length; q++) {
      var Q = quads[q], n2 = Math.max(0, Math.min(255, Math.round((Q[4] - zlo) * k))), col = lut[n2], cs = 'rgb(' + col[0] + ',' + col[1] + ',' + col[2] + ')';
      c.fillStyle = cs; c.strokeStyle = cs; c.lineWidth = 0.6; c.beginPath(); c.moveTo(Q[0][0], Q[0][1]); c.lineTo(Q[1][0], Q[1][1]); c.lineTo(Q[2][0], Q[2][1]); c.lineTo(Q[3][0], Q[3][1]); c.closePath(); c.fill(); c.stroke();
    }
    if (o.box) {
      var B = o.box, top = B.z1, bot = B.z0, cs2 = [[B.y0, B.x0], [B.y1, B.x0], [B.y1, B.x1], [B.y0, B.x1]];
      c.save(); c.strokeStyle = C.yellow; c.lineWidth = 1.5;
      [bot, top].forEach(function (zv) { c.beginPath(); cs2.forEach(function (pt, ix) { var P = pr(pt[0], pt[1], zv); if (ix) c.lineTo(P[0], P[1]); else c.moveTo(P[0], P[1]); }); c.closePath(); c.stroke(); });
      cs2.forEach(function (pt) { var A = pr(pt[0], pt[1], bot), E = pr(pt[0], pt[1], top); c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(E[0], E[1]); c.stroke(); c.fillStyle = C.yellow; c.fillRect(E[0] - 3, E[1] - 3, 6, 6); });
      var lb = pr(B.y0, B.x0, top); c.font = '600 11px Outfit, sans-serif'; c.fillStyle = C.yellow; c.fillText(B.label || 'Region 1', lb[0] + 6, lb[1] - 6);
      c.restore();
    }
    if (o.fixture) {
      var F = o.fixture, O = pr(F.y, F.x, F.z), XA = pr(F.y + 22, F.x, F.z), YA = pr(F.y, F.x + 14, F.z), ZA = pr(F.y, F.x, F.z + 4);
      c.save(); c.lineWidth = 2; c.font = '600 11px Outfit, sans-serif';
      [[XA, C.red, 'Y'], [YA, C.green, 'X'], [ZA, C.blue, 'Z']].forEach(function (s) { c.strokeStyle = s[1]; c.fillStyle = s[1]; c.beginPath(); c.moveTo(O[0], O[1]); c.lineTo(s[0][0], s[0][1]); c.stroke(); c.fillText(s[2], s[0][0] + 4, s[0][1]); });
      c.restore();
    }
    c.font = FONT; c.fillStyle = C.tick; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('Drag to rotate', 10, 8);
  }

  /* ---------- raw laser view (what the camera's imager sees on one line) ---------- */
  function drawLaser(cv, o) {
    var f = fit(cv), c = f.c, w = f.w, h = f.h, rows = 150;
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    var off = cv._off || (cv._off = document.createElement('canvas')); off.width = NX; off.height = rows;
    var ox = off.getContext('2d'), im = ox.createImageData(NX, rows), p = im.data, j = o.j, scan = o.scan, zTop = 7.5, zBot = -1;
    var B = Math.max(0.06, (o.exposure || 400) / 400), hdr = o.hdr && o.hdr !== 'No HDR';
    var col = new Float32Array(rows);
    function rowOf(v) { return (zTop - v) / (zTop - zBot) * (rows - 1); }
    for (var i = 0; i < NX; i++) {
      col.fill(0);
      var v = scan.z[j * NX + i], ct = scan.cTrue[j], d = i * DX - ct, refl = 1 + 1.4 * Math.exp(-d * d / 18), e = hdr ? 1.0 : B * refl;
      var wd = 1.1 + Math.min(3.2, e * 0.8);
      if (v === v && e > 0.12) { var r = rowOf(v); for (var k = Math.max(0, Math.floor(r - 9)); k <= Math.min(rows - 1, Math.ceil(r + 9)); k++) col[k] += 215 * e * Math.exp(-Math.pow(k - r, 2) / (2 * wd * wd)); }
      if (scan.gz) { var g = scan.gz[j * NX + i]; if (g === g) { var rg = rowOf(g), strong = scan.gs[j * NX + i] === 2 ? 1.25 : 0.55; for (k = Math.max(0, Math.floor(rg - 7)); k <= Math.min(rows - 1, Math.ceil(rg + 7)); k++) col[k] += 215 * e * strong * Math.exp(-Math.pow(k - rg, 2) / (2 * 1.8 * 1.8)); } }
      for (k = 0; k < rows; k++) {
        var q = (k * NX + i) * 4, a = col[k] + 3;
        if (a >= 255) { p[q] = 255; p[q + 1] = 52; p[q + 2] = 42; }
        else { p[q] = p[q + 1] = p[q + 2] = a; }
        p[q + 3] = 255;
      }
    }
    ox.putImageData(im, 0, 0);
    var L = ML, T = 6, B2 = 24, PW = w - L - MR, PH = h - T - B2;
    c.imageSmoothingEnabled = false; c.drawImage(off, L, T, PW, PH);
    var P = { X: function (x) { return L + x / Sim.XMAX * PW; }, Y: function (v) { return T + rowOf(v) / (rows - 1) * PH; }, iX: function (px) { return (px - L) / PW * Sim.XMAX; }, c: c, L: L, T: T, PW: PW, PH: PH, kind: 'laser' };
    c.font = FONT; c.fillStyle = C.tick; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (var xm = 0; xm <= 50; xm += 10) c.fillText(String(xm), P.X(xm), h - 7);
    c.textAlign = 'right'; c.fillText('X (mm)', L + PW, h - 7);
    c.textBaseline = 'middle'; for (var rw = 0; rw <= 150; rw += 50) c.fillText(String(rw * 4), L - 6, T + rw / (rows - 1) * PH);
    c.save(); c.translate(11, T + PH / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText('Imager row', 0, 0); c.restore();
    if (o.spots) { c.fillStyle = '#35e0ff'; for (i = 0; i < NX; i += 2) { var sv = o.spots[j * NX + i]; if (sv === sv) c.fillRect(P.X(i * DX) - 1, P.Y(sv) - 1, 2.2, 2.2); } }
    return P;
  }

  /* ---------- pointer helper ---------- */
  function drag(cv, handles, move, end) {
    var active = null;
    function pos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function hit(p) {
      if (!cv._P) return null;
      var hs = handles(cv._P) || [], best = null, bd = 8;
      hs.forEach(function (H) { var d = H.y !== undefined ? Math.abs(p[1] - H.y) : Math.abs(p[0] - H.x); if (d < bd) { bd = d; best = H; } });
      return best;
    }
    cv.addEventListener('pointerdown', function (e) {
      var p = pos(e), H = hit(p); active = H ? H.id : 'line';
      try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      move(active, p, cv._P); e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      var p = pos(e);
      if (active) { move(active, p, cv._P); return; }
      var H = hit(p); cv.style.cursor = H ? (H.y !== undefined ? 'row-resize' : 'col-resize') : 'crosshair';
    });
    function stop() { if (active) { active = null; if (end) end(); } }
    cv.addEventListener('pointerup', stop); cv.addEventListener('pointercancel', stop);
  }

  root.Views = { C: C, LUT: LUT, turbo: turbo, fit: fit, autoRange: autoRange, drawMap: drawMap, polyAlong: polyAlong, lineMarker: lineMarker, blobBox: blobBox, drawChart: drawChart, draw3D: draw3D, drawLaser: drawLaser, drag: drag, ML: ML, MR: MR };
})(window);
