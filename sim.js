/* Simulated 3D camera and inspection logic. All scan data here is made up in the browser. */
(function (root) {
  'use strict';
  var NX = 240, NY = 360, DX = 0.25, DY = 0.5, N = NX * NY;
  var UMAX = 22;
  var XMAX = (NX - 1) * DX, YMAX = (NY - 1) * DY;

  var SCANS = [
    { id: 'g1', name: 'Good part A', exp: 'OK' },
    { id: 'g2', name: 'Good part B', exp: 'OK' },
    { id: 'g3', name: 'Good part C', exp: 'OK' },
    { id: 'spike', name: 'Spike', exp: 'NG' },
    { id: 'low', name: 'Weld sits low', exp: 'NG' },
    { id: 'crack', name: 'Long thin crack', exp: 'NG' },
    { id: 'split', name: 'Broken-up defect', exp: 'NG' },
    { id: 'pores', name: 'Many small pores', exp: 'NG' },
    { id: 'missing', name: 'Missing weld', exp: 'NG' },
    { id: 'hole', name: 'No-data stretch', exp: 'Not inspected' },
    { id: 'shift', name: 'Part shifted 6 mm', exp: 'OK' },
    { id: 'tilt', name: 'Part tilted 3°', exp: 'OK' },
    { id: 'raised', name: 'Part sits 0.6 mm higher', exp: 'OK' },
    { id: 'shiny', name: 'Shiny weld', exp: 'OK' },
    { id: 'track', name: 'Weld off track', exp: 'NG' },
    { id: 'spatter', name: 'Spatter beside weld', exp: 'NG' },
    { id: 'stamp', name: 'Stamped text', exp: 'OK', hidden: true },
    { id: 'edgeA', name: 'Capture end', exp: 'NG', hidden: true },
    { id: 'edgeB', name: 'Capture start', exp: 'NG', hidden: true }
  ];

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function median(a) {
    if (!a.length) return NaN;
    var s = a.slice().sort(function (p, q) { return p - q; });
    return s[s.length >> 1];
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ramp(y, a, b, e) { return clamp((y - a) / e, 0, 1) * clamp((b - y) / e, 0, 1); }

  function capParams(id) {
    if (id === 'c1') return { c: 30, H: 3.0, s: 2.4, door: 0.2, trim: 52 };
    if (id === 'c2') return { c: 27, H: 2.5, s: 2.0, door: -0.15, trim: 48 };
    var R = rng(hash('cap' + id));
    return { c: 26 + R() * 6, H: 2.4 + R() * 0.8, s: 2 + R() * 0.5, door: (R() - 0.5) * 0.4, trim: 47 + R() * 6 };
  }

  /* ---------- camera: one scan ---------- */
  function exposureFactor(e, hdr, shiny) {
    var off = Math.abs(Math.log((e || 400) / 400)) / Math.log(4);
    var f = 1 + 7 * off * off;
    if (shiny) f *= 2.5;
    if (hdr && hdr !== 'No HDR') f = Math.max(0.5, f * 0.25);
    return f;
  }

  var scanCache = {};
  function genScan(capId, scanId, sim) {
    sim = sim || {};
    var key = [capId, scanId, sim.tilt || 0, sim.shift || 0, sim.exposure || 400, sim.hdr || 'No HDR'].join('|');
    if (scanCache[key]) return scanCache[key];
    var keys = Object.keys(scanCache);
    if (keys.length > 70) delete scanCache[keys[0]];

    var cap = capParams(capId), R = rng(hash(capId + '/' + scanId));
    var z = new Float32Array(N), I = new Uint8Array(N);
    var shiny = scanId === 'shiny';
    var gz = shiny ? new Float32Array(N) : null, gs = shiny ? new Uint8Array(N) : null;
    var y0 = 12 + R() * 2, y1 = 166 + R() * 2;
    var bias = (R() - 0.5) * 0.1 + (scanId === 'raised' ? 0.6 : 0);
    var tiltDeg = (sim.tilt || 0) + (scanId === 'tilt' ? 3 : 0);
    var slope = Math.tan(tiltDeg * Math.PI / 180);
    var shift = (sim.shift || 0) + (scanId === 'shift' ? 6 : 0);
    var ph = R() * 6.28, ph2 = R() * 6.28, k;

    var pores = [], drops = [], patches = [], holesKeep = [];
    if (scanId === 'pores') for (k = 0; k < 14; k++) pores.push({ y: 42 + k * 7 + R() * 3, d: (R() - 0.5) * 5 });
    if (scanId === 'spatter') for (k = 0; k < 11; k++) drops.push({ y: 30 + R() * 120, d: (R() < 0.5 ? -1 : 1) * (7.5 + R() * 5), r: 0.7 + R() * 0.4 });
    if (shiny) for (k = 0; k < 8; k++) patches.push({ y: 20 + k * 18 + R() * 8, l: 8 + R() * 10, side: R() < 0.5 ? -1 : 1 });

    var stampMask = null;
    if (scanId === 'stamp' && typeof document !== 'undefined') {
      var mc = document.createElement('canvas'); mc.width = NY; mc.height = NX;
      var mx = mc.getContext('2d', { willReadFrequently: true });
      mx.fillStyle = '#fff'; mx.font = '700 44px Arial, sans-serif'; mx.textBaseline = 'middle';
      mx.fillText('FR 2048', 90, 44);
      stampMask = mx.getImageData(0, 0, NY, NX).data;
    }

    var cTrue = new Float32Array(NY);
    for (var j = 0; j < NY; j++) {
      var y = j * DY, inPart = y >= y0 && y <= y1;
      var c = cap.c + 1.0 * Math.sin(y / 40 + ph) + shift;
      if (scanId === 'track' && y > 85 && y < 135) c += 9 * Math.pow(Math.sin(Math.PI * (y - 85) / 50), 2);
      cTrue[j] = c;
      var H = cap.H * (1 + 0.02 * Math.sin(y / 17 + ph2));
      if (scanId === 'low') H *= 1 - 0.38 * ramp(y, 70, 130, 4);
      if (scanId === 'missing') H *= 1 - ramp(y, 100, 124, 1);
      for (var i = 0; i < NX; i++) {
        var q = j * NX + i;
        if (!inPart) { z[q] = NaN; I[q] = 6; continue; }
        var x = i * DX, d = x - c;
        var door = cap.door / (1 + Math.exp(-d / 1.2));
        var dome = H * Math.exp(-d * d / (2 * cap.s * cap.s));
        var trim = 4.5 * clamp((x - (cap.trim + shift)) / 0.8, 0, 1);
        var v = door + dome + trim + slope * (x - cap.c) + bias - 0.0006 * Math.pow(x - cap.c, 2) * 0.5 + (R() - 0.5) * 0.05;
        var inten = 150 + (x > c ? 12 : 0) - 58 * Math.exp(-d * d / (2 * cap.s * cap.s)) + (R() - 0.5) * 34;

        if (scanId === 'spike') v += 1.5 * Math.exp(-d * d / 2 - Math.pow(y - 68, 2) / (2 * 2 * 2));
        if (scanId === 'crack' && Math.abs(d - 2.2) <= 0.3 && y >= 60 && y <= 115) { v -= 1.0; inten -= 30; }
        if (scanId === 'split') for (k = 0; k < 6; k++) { var yk = 90 + k * 3.6; if (y >= yk && y <= yk + 2.4 && d >= 0.9 && d <= 3.1) { v -= 1.0; inten -= 28; } }
        if (scanId === 'edgeA' && y >= y1 - 2 && Math.abs(d) <= 1.6) { v += 1.4; inten += 30; }
        if (scanId === 'edgeB' && y <= y0 + 2 && Math.abs(d) <= 1.6) { v += 1.4; inten += 30; }
        for (k = 0; k < pores.length; k++) { var p = pores[k], r2 = Math.pow(d - p.d, 2) + Math.pow(y - p.y, 2); if (r2 < 0.49) { v -= 1.1; inten -= 40; } }
        for (k = 0; k < drops.length; k++) { var pd = drops[k], r3 = Math.pow(d - pd.d, 2) + Math.pow(y - pd.y, 2); if (r3 < pd.r * pd.r) { v += 1.0 * (1 - r3 / (pd.r * pd.r)) + 0.1; inten += 46; } }
        if (scanId === 'hole' && y >= 120 && y <= 128 && Math.abs(d) < 5) { v = NaN; inten = 8; }
        if (stampMask && stampMask[(i * NY + j) * 4 + 3] > 128) { v += 0.5; inten += 5; }

        if (shiny) {
          gz[q] = NaN;
          for (k = 0; k < patches.length; k++) {
            var pa = patches[k];
            if (y >= pa.y && y <= pa.y + pa.l && d * pa.side >= 2.2 && d * pa.side <= 5.0) {
              gz[q] = v + 1.3 + (R() - 0.5) * 0.1;
              gs[q] = R() < 0.82 ? 2 : 1;
            }
          }
          inten += 24 * Math.exp(-d * d / 8) + (R() - 0.5) * 30;
        }
        z[q] = v;
        I[q] = clamp(inten, 8, 250);
      }
    }
    /* scattered small dropouts */
    var f = exposureFactor(sim.exposure, sim.hdr, shiny);
    var nh = Math.round(90 * f);
    for (k = 0; k < nh; k++) {
      var jj = Math.floor(R() * NY), near = R() < 0.6;
      var cc = cTrue[jj];
      var ii = Math.floor((near ? cc + (R() - 0.5) * 12 : R() * XMAX) / DX);
      var ww = 1 + Math.floor(R() * 4), hh = 1 + Math.floor(R() * 2);
      for (var a = jj; a < Math.min(NY, jj + hh); a++) for (var b = Math.max(0, ii); b < Math.min(NX, ii + ww); b++) { z[a * NX + b] = NaN; }
    }
    var out = { z: z, I: I, gz: gz, gs: gs, cap: cap, y0: y0, y1: y1, cTrue: cTrue, id: scanId, capId: capId, slope: slope, shift: shift };
    scanCache[key] = out;
    return out;
  }

  /* ---------- peak selection ---------- */
  function applyPeak(scan, peak) {
    if (!scan.gz || peak === 'Bottom') return scan.z;
    var o = Float32Array.from(scan.z), R = rng(7);
    for (var q = 0; q < N; q++) {
      var g = scan.gz[q];
      if (g !== g || o[q] !== o[q]) continue;
      if (peak === 'Top') o[q] = g;
      else if (peak === 'Best' && scan.gs[q] === 2) o[q] = g;
      else if (peak === 'Continuity' && R() < 0.015) o[q] = g;
    }
    return o;
  }

  /* ---------- filters ---------- */
  function applyFilters(z, f) {
    var a = Float32Array.from(z), filled = new Uint8Array(N), j, i;
    var gx = Math.round((+f.gapX || 0) / DX), gy = Math.round((+f.gapY || 0) / DY);
    if (gx > 0) for (j = 0; j < NY; j++) {
      var last = -1;
      for (i = 0; i < NX; i++) {
        var v = a[j * NX + i];
        if (v === v) {
          if (last >= 0 && i - last - 1 > 0 && i - last - 1 <= gx) {
            var v0 = a[j * NX + last];
            for (var k = last + 1; k < i; k++) { a[j * NX + k] = v0 + (v - v0) * (k - last) / (i - last); filled[j * NX + k] = 1; }
          }
          last = i;
        }
      }
    }
    if (gy > 0) for (i = 0; i < NX; i++) {
      var ly = -1;
      for (j = 0; j < NY; j++) {
        var vy = a[j * NX + i];
        if (vy === vy) {
          if (ly >= 0 && j - ly - 1 > 0 && j - ly - 1 <= gy) {
            var vy0 = a[ly * NX + i];
            for (var m = ly + 1; m < j; m++) { a[m * NX + i] = vy0 + (vy - vy0) * (m - ly) / (j - ly); filled[m * NX + i] = 1; }
          }
          ly = j;
        }
      }
    }
    var mw = Math.round((+f.median || 0) / DX / 2);
    if (mw > 0) {
      var src = Float32Array.from(a);
      for (j = 0; j < NY; j++) for (i = 0; i < NX; i++) {
        var w = [];
        for (var n = Math.max(0, i - mw); n <= Math.min(NX - 1, i + mw); n++) { var t = src[j * NX + n]; if (t === t) w.push(t); }
        if (src[j * NX + i] === src[j * NX + i] && w.length) a[j * NX + i] = median(w);
      }
    }
    var sw = Math.round((+f.smooth || 0) / DX / 2);
    if (sw > 0) {
      var s2 = Float32Array.from(a);
      for (j = 0; j < NY; j++) for (i = 0; i < NX; i++) {
        var sum = 0, cnt = 0;
        for (var o = Math.max(0, i - sw); o <= Math.min(NX - 1, i + sw); o++) { var t2 = s2[j * NX + o]; if (t2 === t2) { sum += t2; cnt++; } }
        if (s2[j * NX + i] === s2[j * NX + i] && cnt) a[j * NX + i] = sum / cnt;
      }
    }
    return { z: a, filled: filled };
  }

  /* ---------- region ---------- */
  function regionOf(z, rg) {
    var valid = new Float32Array(NY), j, i;
    for (j = 0; j < NY; j++) { var c = 0; for (i = 0; i < NX; i++) { var v = z[j * NX + i]; if (v === v) c++; } valid[j] = c / NX * 100; }
    var j0 = 0, j1 = NY - 1, detected = true;
    if (rg.mode === 'manual') { j0 = clamp(Math.round(rg.y0 / DY), 0, NY - 1); j1 = clamp(Math.round(rg.y1 / DY), j0, NY - 1); }
    else if (rg.mode === 'auto') {
      var best = 0, bs = -1, st = -1;
      for (j = 0; j <= NY; j++) {
        if (j < NY && valid[j] >= rg.minValid) { if (st < 0) st = j; }
        else if (st >= 0) { if (j - st > best) { best = j - st; bs = st; } st = -1; }
      }
      detected = best * DY >= rg.minLen;
      if (detected) { j0 = bs + Math.round((+rg.margin || 0) / DY); j1 = bs + best - 1 - Math.round((+rg.margin || 0) / DY); }
    }
    var ignore = new Uint8Array(NY);
    (rg.ignore || []).forEach(function (zn) {
      for (var a = Math.round(zn.y0 / DY); a <= Math.round(zn.y1 / DY); a++) if (a >= 0 && a < NY) ignore[a] = 1;
    });
    return { valid: valid, j0: j0, j1: j1, ignore: ignore, detected: detected };
  }

  /* ---------- locate ---------- */
  function locate(z, lc, rg, cap) {
    var c = new Float32Array(NY).fill(NaN), found = new Uint8Array(NY), j, i, wl = +lc.wl, wr = +lc.wr;
    if (lc.mode === 'manual') {
      var cx = (+lc.x0 + +lc.x1) / 2; wl = wr = Math.abs(+lc.x1 - +lc.x0) / 2;
      for (j = 0; j < NY; j++) { c[j] = cx; found[j] = 1; }
      return { c: c, found: found, wl: wl, wr: wr, foundPct: 100, raw: c, manual: true };
    }
    var i0 = clamp(Math.round(lc.b0 / DX), 0, NX - 1), i1 = clamp(Math.round(lc.b1 / DX), i0, NX - 1), raw = new Float32Array(NY).fill(NaN), nf = 0, tot = 0;
    for (j = rg.j0; j <= rg.j1; j++) {
      tot++;
      var vals = [], mx = -1e9, mi = -1;
      for (i = i0; i <= i1; i++) { var v = z[j * NX + i]; if (v === v) { vals.push(v); if (v > mx) { mx = v; mi = i; } } }
      if (vals.length < (i1 - i0 + 1) * 0.4) continue;
      var base = median(vals);
      if (mx - base < 0.8) continue;
      if (lc.find === 'mid') {
        var half = (mx + base) / 2, l = -1, r = -1;
        for (i = i0; i <= i1; i++) { var w = z[j * NX + i]; if (w === w && w > half) { if (l < 0) l = i; r = i; } }
        raw[j] = (l + r) / 2 * DX;
      } else raw[j] = mi * DX;
      found[j] = 1; nf++;
    }
    /* smooth along y; lines with nothing found take their neighbours */
    var ok = [], k;
    for (j = rg.j0; j <= rg.j1; j++) if (raw[j] === raw[j]) ok.push(raw[j]);
    if (lc.track === 'scan') {
      var mc = ok.length ? median(ok) : cap.c;
      for (j = 0; j < NY; j++) c[j] = mc;
    } else {
      var lastC = ok.length ? ok[0] : cap.c;
      for (j = 0; j < NY; j++) {
        var w2 = [];
        for (k = Math.max(0, j - 7); k <= Math.min(NY - 1, j + 7); k++) if (raw[k] === raw[k]) w2.push(raw[k]);
        if (w2.length) lastC = median(w2);
        c[j] = lastC;
      }
    }
    return { c: c, found: found, wl: wl, wr: wr, foundPct: tot ? nf / tot * 100 : 0, raw: raw, manual: false };
  }

  /* ---------- reference ---------- */
  function winVal(z, j, a, b, top) {
    var v = [], i0 = clamp(Math.round(a / DX), 0, NX - 1), i1 = clamp(Math.round(b / DX), 0, NX - 1), n = i1 - i0 + 1;
    for (var i = i0; i <= i1; i++) { var t = z[j * NX + i]; if (t === t) v.push(t); }
    if (v.length < n * 0.3) return NaN;
    v.sort(function (p, q) { return q - p; });
    var keep = Math.max(1, Math.round(v.length * top / 100));
    return v[Math.floor(keep / 2)];
  }
  function smoothY(a, rg, mm) {
    var h = Math.round((+mm || 0) / DY / 2), o = new Float32Array(NY).fill(NaN), j, k;
    var last = NaN;
    for (j = rg.j0; j <= rg.j1; j++) if (a[j] === a[j]) { last = a[j]; break; }
    for (j = rg.j0; j <= rg.j1; j++) {
      var w = [];
      for (k = Math.max(rg.j0, j - h); k <= Math.min(rg.j1, j + h); k++) if (a[k] === a[k]) w.push(a[k]);
      if (w.length) last = median(w);
      o[j] = last;
    }
    return o;
  }
  function reference(z, rc, lc, ctx, rg, cap) {
    var rL = new Float32Array(NY).fill(NaN), rR = new Float32Array(NY).fill(NaN), xL = new Float32Array(NY), xR = new Float32Array(NY), noRef = 0, j;
    var gap = +rc.gap, w = +rc.w, top = +rc.top, follow = lc.fixture && lc.mode !== 'manual';
    for (j = rg.j0; j <= rg.j1; j++) {
      var cj = follow ? ctx.c[j] : (lc.mode === 'manual' ? ctx.c[j] : cap.c);
      var la = cj - ctx.wl - gap - w, lb = cj - ctx.wl - gap, ra = cj + ctx.wr + gap, rb = ra + w;
      xL[j] = (la + lb) / 2; xR[j] = (ra + rb) / 2;
      rL[j] = winVal(z, j, la, lb, top); rR[j] = winVal(z, j, ra, rb, top);
      if (rL[j] !== rL[j] || rR[j] !== rR[j]) noRef++;
    }
    return { rL: smoothY(rL, rg, rc.smooth), rR: smoothY(rR, rg, rc.smooth), xL: xL, xR: xR, noRef: noRef, follow: follow };
  }
  function refAt(rf, rc, j, x) {
    var m = rc.mode;
    if (m === 'roof') return rf.rL[j];
    if (m === 'door') return rf.rR[j];
    if (m === 'line') return rf.rL[j] + (rf.rR[j] - rf.rL[j]) * (x - rf.xL[j]) / (rf.xR[j] - rf.xL[j]);
    if (m === 'both') return (rf.rL[j] + rf.rR[j]) / 2;
    if (m === 'abs') return +rc.absZ || 0;
    return 0;
  }

  /* ---------- golden profile ---------- */
  var goldenCache = {};
  function gBin(u) { return clamp(Math.round((u + UMAX) / DX), 0, GN - 1); }
  var GN = Math.round(2 * UMAX / DX) + 1;
  function getGolden(capId, cfg) {
    var ids = cfg.golden.ids || [];
    var key = JSON.stringify([capId, ids, cfg.peak, cfg.exposure, cfg.hdr, cfg.filter, cfg.region, cfg.locate, cfg.ref]);
    if (goldenCache[key]) return goldenCache[key];
    if (Object.keys(goldenCache).length > 24) goldenCache = {};
    var bins = [], bins2 = [], b;
    for (b = 0; b < GN; b++) { bins.push([]); bins2.push([]); }
    var lines = 0;
    ids.forEach(function (id) {
      var scan = genScan(capId, id, { exposure: cfg.exposure, hdr: cfg.hdr });
      var zf = applyFilters(applyPeak(scan, cfg.peak), cfg.filter).z;
      var rg = regionOf(zf, cfg.region), lc = locate(zf, cfg.locate, rg, scan.cap);
      var rf = reference(zf, cfg.ref, cfg.locate, lc, rg, scan.cap);
      for (var j = rg.j0; j <= rg.j1; j += 2) {
        lines++;
        var base = 0;
        if (cfg.ref.mode === 'golden') base = (rf.rL[j] + rf.rR[j]) / 2;
        for (var bi = 0; bi < GN; bi++) {
          var u = -UMAX + bi * DX, x = lc.c[j] + u, i = Math.round(x / DX);
          if (i < 0 || i >= NX) continue;
          var v = zf[j * NX + i];
          if (v !== v) continue;
          if (cfg.ref.mode === 'both') { bins[bi].push(v - rf.rL[j]); bins2[bi].push(v - rf.rR[j]); }
          else if (cfg.ref.mode === 'golden') bins[bi].push(v - base);
          else bins[bi].push(v - refAt(rf, cfg.ref, j, x));
        }
      }
    });
    var g = new Float32Array(GN), gd = new Float32Array(GN), lo = new Float32Array(GN), hi = new Float32Array(GN);
    for (b = 0; b < GN; b++) {
      var s = bins[b].sort(function (p, q) { return p - q; });
      if (s.length) { g[b] = s[s.length >> 1]; lo[b] = s[Math.floor(s.length * 0.03)]; hi[b] = s[Math.floor(s.length * 0.97)]; } else g[b] = NaN;
      var s2 = bins2[b].sort(function (p, q) { return p - q; });
      gd[b] = s2.length ? s2[s2.length >> 1] : NaN;
    }
    var out = { g: g, gd: gd, lo: lo, hi: hi, lines: lines, scans: ids.length, u0: -UMAX, du: DX, n: GN };
    goldenCache[key] = out;
    return out;
  }
  function gAt(a, u) { var v = a[gBin(u)]; return v === v ? v : 0; }

  /* ---------- blobs ---------- */
  function findBlobs(cells, val, merge) {
    var map = new Int32Array(N).fill(-1), blobs = [], rx = Math.max(1, Math.ceil((+merge || 0) / DX)), ry = Math.max(1, Math.ceil((+merge || 0) / DY));
    var i, q;
    for (i = 0; i < cells.length; i++) map[cells[i]] = -2;
    for (i = 0; i < cells.length; i++) {
      q = cells[i];
      if (map[q] !== -2) continue;
      var id = blobs.length, st = [q], pts = [];
      map[q] = id;
      while (st.length) {
        var c = st.pop(); pts.push(c);
        var cj = Math.floor(c / NX), ci = c - cj * NX;
        for (var a = Math.max(0, cj - ry); a <= Math.min(NY - 1, cj + ry); a++) {
          for (var b = Math.max(0, ci - rx); b <= Math.min(NX - 1, ci + rx); b++) {
            var w = a * NX + b;
            if (map[w] === -2) { map[w] = id; st.push(w); }
          }
        }
      }
      var jmin = 1e9, jmax = -1, imin = 1e9, imax = -1, vol = 0, peak = 0, sum = 0, lineMin = {}, lineMax = {};
      for (var p = 0; p < pts.length; p++) {
        var t = pts[p], tj = Math.floor(t / NX), ti = t - tj * NX, v = val[t];
        if (tj < jmin) jmin = tj; if (tj > jmax) jmax = tj;
        if (ti < imin) imin = ti; if (ti > imax) imax = ti;
        vol += Math.abs(v) * DX * DY; sum += v;
        if (Math.abs(v) > Math.abs(peak)) peak = v;
        if (lineMin[tj] === undefined || ti < lineMin[tj]) lineMin[tj] = ti;
        if (lineMax[tj] === undefined || ti > lineMax[tj]) lineMax[tj] = ti;
      }
      var xw = 0;
      for (var lj in lineMin) xw = Math.max(xw, (lineMax[lj] - lineMin[lj] + 1) * DX);
      blobs.push({ n: pts.length, jmin: jmin, jmax: jmax, imin: imin, imax: imax, xWin: xw, yWin: (jmax - jmin + 1) * DY, area: pts.length * DX * DY, vol: vol, peak: peak, high: sum > 0, pts: pts });
    }
    return blobs;
  }

  /* ---------- everything for one scan ---------- */
  function run(capId, scanId, cfg, sim) {
    sim = sim || {};
    var scan = genScan(capId, scanId, { tilt: sim.tilt, shift: sim.shift, exposure: cfg.exposure, hdr: cfg.hdr });
    var zPeak = applyPeak(scan, cfg.peak);
    var fl = applyFilters(zPeak, cfg.filter), zf = fl.z;
    var rg = regionOf(zf, cfg.region);
    var lc = locate(zf, cfg.locate, rg, scan.cap);
    var rf = reference(zf, cfg.ref, cfg.locate, lc, rg, scan.cap);
    var useGold = cfg.golden.on || cfg.ref.mode === 'golden';
    var gd = useGold ? getGolden(capId, cfg) : null;
    var m = cfg.ref.mode, j, i;

    var delta = new Float32Array(N).fill(NaN), zr = new Float32Array(N).fill(NaN), beside = new Float32Array(N).fill(NaN);
    var align = new Float32Array(NY);
    var rawMin = new Float32Array(NY).fill(NaN), rawMax = new Float32Array(NY).fill(NaN), dMin = new Float32Array(NY).fill(NaN), dMax = new Float32Array(NY).fill(NaN);
    var crest = new Float32Array(NY).fill(NaN), width = new Float32Array(NY).fill(NaN), area = new Float32Array(NY).fill(NaN), noDataLine = new Float32Array(NY), wCells = 0, wMissing = 0;
    var cellsW = [];

    for (j = rg.j0; j <= rg.j1; j++) {
      if (rg.ignore[j]) continue;
      var c = lc.c[j], a = clamp(Math.round((c - lc.wl) / DX), 0, NX - 1), b = clamp(Math.round((c + lc.wr) / DX), 0, NX - 1);
      if (m === 'golden' && gd) {
        var diffs = [];
        for (i = clamp(Math.round((c - lc.wl - cfg.ref.gap - cfg.ref.w) / DX), 0, NX - 1); i <= clamp(Math.round((c + lc.wr + cfg.ref.gap + cfg.ref.w) / DX), 0, NX - 1); i += 2) {
          var vv = zf[j * NX + i]; if (vv === vv) diffs.push(vv - gAt(gd.g, i * DX - c));
        }
        align[j] = median(diffs) || 0;
      }
      var lmin = 1e9, lmax = -1e9, dmin = 1e9, dmax = -1e9, cr = -1e9, ar = 0, valid = 0, total = b - a + 1;
      for (i = a; i <= b; i++) {
        var q = j * NX + i, v = zf[q];
        wCells++;
        if (v !== v) { wMissing++; continue; }
        valid++;
        var x = i * DX, u = x - c, dv, base;
        if (m === 'golden') { base = align[j]; dv = v - base - gAt(gd.g, u); }
        else if (m === 'both') {
          base = (rf.rL[j] + rf.rR[j]) / 2;
          var d1 = v - rf.rL[j], d2 = v - rf.rR[j];
          if (useGold) { d1 -= gAt(gd.g, u); d2 -= gAt(gd.gd, u); }
          dv = Math.abs(d1) > Math.abs(d2) ? d1 : d2;
        } else { base = refAt(rf, cfg.ref, j, x); dv = v - base - (useGold ? gAt(gd.g, u) : 0); }
        delta[q] = dv; zr[q] = v - base;
        cellsW.push(q);
        if (v < lmin) lmin = v; if (v > lmax) lmax = v;
        if (dv < dmin) dmin = dv; if (dv > dmax) dmax = dv;
        if (v - base > cr) cr = v - base;
        ar += Math.max(0, v - base) * DX;
      }
      noDataLine[j] = (1 - valid / total) * 100;
      if (valid) { rawMin[j] = lmin; rawMax[j] = lmax; dMin[j] = dmin; dMax[j] = dmax; crest[j] = cr; area[j] = ar;
        var wc = 0; for (i = a; i <= b; i++) { var z2 = zr[j * NX + i]; if (z2 === z2 && z2 > cr * 0.5) wc++; } width[j] = wc * DX; }
      /* beside the weld: the reference bands */
      var bands = [[c - lc.wl - cfg.ref.gap - cfg.ref.w, c - lc.wl - cfg.ref.gap, rf.rL[j]], [c + lc.wr + cfg.ref.gap, c + lc.wr + cfg.ref.gap + cfg.ref.w, rf.rR[j]]];
      for (var bd = 0; bd < 2; bd++) {
        var ba = clamp(Math.round(bands[bd][0] / DX), 0, NX - 1), bb = clamp(Math.round(bands[bd][1] / DX), 0, NX - 1);
        for (i = ba; i <= bb; i++) { var q3 = j * NX + i, v3 = zf[q3]; if (v3 === v3) beside[q3] = v3 - bands[bd][2]; }
      }
    }

    /* checks */
    var cmp = useGold ? 'gold' : 'ref', merge = cfg.merge, ruleOut = {}, defects = [], counts = [];
    ['gap', 'height', 'spike', 'spatter'].forEach(function (rid) {
      var r = cfg.rules[rid]; if (!r || !r.on) { ruleOut[rid] = { blobs: [], flagged: [] }; return; }
      var rng2 = r[cmp] || [-1, 1], lo = +rng2[0], hi = +rng2[1], cells = [], src = r.where === 'beside' ? beside : delta, q2;
      if (r.where === 'beside') { lo = +r.gold[0]; hi = +r.gold[1]; for (q2 = 0; q2 < N; q2++) { var w2 = src[q2]; if (w2 === w2 && (w2 < lo || w2 > hi)) cells.push(q2); } }
      else for (var cw = 0; cw < cellsW.length; cw++) { q2 = cellsW[cw]; var dq = src[q2]; if (dq < lo || dq > hi) cells.push(q2); }
      var blobs = cells.length > 26000 ? [] : findBlobs(cells, src, merge), flagged = [];
      blobs.forEach(function (bl) {
        bl.rule = rid;
        bl.pass = r.size === 'area' ? bl.area >= +r.minA : r.size === 'volume' ? bl.vol >= +r.minV : (bl.xWin >= +r.minX && bl.yWin >= +r.minY);
        if (bl.pass) flagged.push(bl);
      });
      var countHit = false;
      if (r.countOn) {
        var nb = blobs.filter(function (bl) { return bl.area >= +r.countA; }).length;
        countHit = nb >= +r.countN;
        if (countHit) counts.push({ rule: rid, n: nb });
      }
      ruleOut[rid] = { blobs: blobs, flagged: flagged, countHit: countHit, tooMany: cells.length > 26000 };
      flagged.forEach(function (bl) { defects.push(bl); });
    });
    /* one physical defect can breach several checks: keep the widest check's name */
    var uniq = [];
    defects.forEach(function (d) {
      var dup = uniq.some(function (u) { return !(d.jmax < u.jmin || d.jmin > u.jmax || d.imax < u.imin || d.imin > u.imax); });
      if (!dup) uniq.push(d);
    });

    /* no data */
    var longest = 0, runL = 0;
    for (j = rg.j0; j <= rg.j1; j++) { if (noDataLine[j] >= 50 && !rg.ignore[j]) { runL++; if (runL > longest) longest = runL; } else runL = 0; }
    var ndPct = wCells ? wMissing / wCells * 100 : 0, ndLong = longest * DY;
    var ndHit = rg.j1 - rg.j0 < 2 ? true : (ndLong > +cfg.nodata.maxLen || ndPct > +cfg.nodata.maxPct);

    /* measures */
    var pos = lc.c, msr = {};
    var mVals = { crest: crest, width: width, area: area, pos: pos }, mHit = [];
    Object.keys(cfg.measures).forEach(function (k) {
      var ms = cfg.measures[k], arr = mVals[k], rn = 0, worst = 0, ok = [], lo = +ms.lo, hi = +ms.hi, hit = false, minRun = Math.round(5 / DY);
      for (var jm = rg.j0; jm <= rg.j1; jm++) {
        var v4 = arr[jm];
        if (v4 !== v4 || rg.ignore[jm]) { rn = 0; continue; }
        ok.push(v4);
        var bad = ms.inv ? (v4 >= lo && v4 <= hi) : (v4 < lo || v4 > hi);
        if (bad) { rn++; if (rn >= minRun) hit = true; } else rn = 0;
      }
      var s = ok.slice().sort(function (p, q) { return p - q; });
      var val = !s.length ? NaN : ms.stat === 'Min' ? s[0] : ms.stat === 'Max' ? s[s.length - 1] : s.reduce(function (p, q) { return p + q; }, 0) / s.length;
      msr[k] = { val: val, min: s[0], max: s[s.length - 1], med: s[s.length >> 1], hit: hit && ms.on, on: ms.on };
      if (hit && ms.on) mHit.push(k);
    });

    var reasons = [];
    ['gap', 'height', 'spike', 'spatter'].forEach(function (rid) { if (ruleOut[rid].flagged.length || ruleOut[rid].countHit) reasons.push(rid); });
    mHit.forEach(function (k) { reasons.push(k); });
    var verdict = reasons.length ? 'NG' : (ndHit ? (cfg.nodata.action === 'NG' ? 'NG' : 'Not inspected') : 'OK');
    if (ndHit && cfg.nodata.action === 'NG') reasons.push('nodata');

    return {
      scan: scan, zRaw: scan.z, zPeak: zPeak, z: zf, filled: fl.filled, rg: rg, lc: lc, rf: rf, gd: gd, useGold: useGold, delta: delta, zr: zr, align: align,
      rawMin: rawMin, rawMax: rawMax, dMin: dMin, dMax: dMax, crest: crest, width: width, area: area, noDataLine: noDataLine,
      rules: ruleOut, defects: uniq, counts: counts, ndPct: ndPct, ndLong: ndLong, ndHit: ndHit, msr: msr, verdict: verdict, reasons: reasons
    };
  }

  function noDataPct(z, rg) {
    var c = 0, t = 0;
    for (var j = rg.j0; j <= rg.j1; j++) for (var i = 0; i < NX; i++) { t++; var v = z[j * NX + i]; if (v !== v) c++; }
    return t ? c / t * 100 : 0;
  }

  root.Sim = {
    NX: NX, NY: NY, DX: DX, DY: DY, XMAX: XMAX, YMAX: YMAX, UMAX: UMAX, SCANS: SCANS,
    genScan: genScan, applyPeak: applyPeak, applyFilters: applyFilters, regionOf: regionOf, locate: locate, reference: reference, refAt: refAt,
    getGolden: getGolden, gAt: gAt, run: run, median: median, clamp: clamp, capParams: capParams, noDataPct: noDataPct
  };
})(window);
