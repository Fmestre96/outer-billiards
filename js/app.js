(function () {
  'use strict';

  var MAXV = SHADERS.MAXV;

  /* ---------------------------------------------------------------- state */

  var state = {
    model: HB.MODELS.hyperbolic,
    verts: [],
    sides: 5,
    radius: 1.2,
    twist: 0,
    iters: 40,
    mode: 0,
    stepPick: 1,
    eps: 1e-6,
    hue: 0,
    cscale: 0.15,
    sat: 0.72,
    val: 1.0,
    ss: 2,
    olen: 60,
    showPoly: true,
    showOrbit: true,
    seed: null,
    center: [0, 0],
    scale: 1 / 300,
    convex: true
  };

  // per-geometry table and camera, swapped when the tabs change
  var saved = {};

  var glCanvas = document.getElementById('gl');
  var ov = document.getElementById('overlay');
  var ctx = ov.getContext('2d');
  var hud = document.getElementById('hud');
  var warn = document.getElementById('warn');

  var gl = glCanvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) {
    document.body.innerHTML = '<p style="padding:24px">This visualizer needs WebGL2.</p>';
    return;
  }

  /* ------------------------------------------------------------- gl setup */

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    }
    return s;
  }

  var prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, SHADERS.VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, SHADERS.FRAG));
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  var U = {};
  ['uVerts', 'uKVerts', 'uN', 'uGeom', 'uIters', 'uMode', 'uStepPick', 'uSS', 'uCenter', 'uScale',
    'uResolution', 'uHueShift', 'uCScale', 'uSat', 'uVal', 'uEps', 'uBg', 'uTable']
    .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

  /* --------------------------------------------------------- table layout */

  var kverts = [];

  function rebuildTable() {
    // orient counter-clockwise so the tangency and inside tests agree
    var k = state.verts.map(state.model.proj);
    if (HB.signedAreaKlein(k) < 0) {
      state.verts.reverse();
      k = state.verts.map(state.model.proj);
    }
    kverts = k;
    state.convex = HB.isConvexKlein(k);
    warn.classList.toggle('hidden', state.convex);
  }

  function makeRegular() {
    state.verts = HB.regularPolygon(state.model, state.sides, state.radius, Math.PI / 2 + state.twist);
    rebuildTable();
  }

  /* -------------------------------------------------------- view mapping */

  var W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = ov.parentElement.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    [glCanvas, ov].forEach(function (c) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function fitView() {
    state.center = [0, 0];
    state.scale = state.model.extent / (0.5 * Math.min(W, H));
  }

  function toScreen(z) {
    return [(z[0] - state.center[0]) / state.scale + W / 2,
            H / 2 - (z[1] - state.center[1]) / state.scale];
  }

  function toDisk(px, py) {
    return [state.center[0] + (px - W / 2) * state.scale,
            state.center[1] - (py - H / 2) * state.scale];
  }

  /* -------------------------------------------------------------- render */

  var pending = false;
  function render() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; draw(); });
  }

  function draw() {
    var flatP = new Float32Array(MAXV * 2);
    var flatK = new Float32Array(MAXV * 2);
    for (var i = 0; i < state.verts.length && i < MAXV; i++) {
      flatP[2 * i] = state.verts[i][0]; flatP[2 * i + 1] = state.verts[i][1];
      flatK[2 * i] = kverts[i][0]; flatK[2 * i + 1] = kverts[i][1];
    }

    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2fv(U.uVerts, flatP);
    gl.uniform2fv(U.uKVerts, flatK);
    gl.uniform1i(U.uN, Math.min(state.verts.length, MAXV));
    gl.uniform1i(U.uGeom, state.model.id);
    gl.uniform1i(U.uIters, state.iters);
    gl.uniform1i(U.uMode, state.mode);
    gl.uniform1i(U.uStepPick, state.stepPick);
    gl.uniform1i(U.uSS, state.ss);
    gl.uniform2f(U.uCenter, state.center[0], state.center[1]);
    gl.uniform1f(U.uScale, state.scale / dpr);
    gl.uniform2f(U.uResolution, glCanvas.width, glCanvas.height);
    gl.uniform1f(U.uHueShift, state.hue);
    gl.uniform1f(U.uCScale, state.cscale);
    gl.uniform1f(U.uSat, state.sat);
    gl.uniform1f(U.uVal, state.val);
    gl.uniform1f(U.uEps, state.eps);
    gl.uniform3f(U.uBg, 0.039, 0.047, 0.071);
    gl.uniform3f(U.uTable, 0.93, 0.95, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    drawOverlay();
  }

  function strokeGeodesic(a, b) {
    var pts = state.model.samples(a, b, 48);
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var s = toScreen(pts[i]);
      if (i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
    }
    ctx.stroke();
  }

  var orbitInfo = '';

  function drawOverlay() {
    ctx.clearRect(0, 0, W, H);

    if (state.model.id === 0) {
      // ideal boundary
      var c = toScreen([0, 0]);
      ctx.strokeStyle = 'rgba(160,190,255,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(c[0], c[1], 1 / state.scale, 0, 2 * Math.PI);
      ctx.stroke();
    }

    if (state.showPoly) {
      ctx.strokeStyle = 'rgba(20,24,34,0.9)';
      ctx.lineWidth = 2;
      for (var i = 0; i < state.verts.length; i++) {
        strokeGeodesic(state.verts[i], state.verts[(i + 1) % state.verts.length]);
      }
      for (var j = 0; j < state.verts.length; j++) {
        var s = toScreen(state.verts[j]);
        ctx.beginPath();
        ctx.arc(s[0], s[1], 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#11141c';
        ctx.fill();
        ctx.stroke();
      }
    }

    orbitInfo = '';
    if (state.showOrbit && state.seed) {
      var o = HB.orbit(state.model, state.verts, kverts, state.seed, state.olen);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.25;
      for (var k = 0; k + 1 < o.points.length; k++) {
        strokeGeodesic(o.points[k], o.points[k + 1]);
      }
      for (var m = 0; m < o.points.length; m++) {
        var p = toScreen(o.points[m]);
        ctx.beginPath();
        ctx.arc(p[0], p[1], m === 0 ? 4.5 : 2.2, 0, 2 * Math.PI);
        ctx.fillStyle = m === 0 ? '#6ee7ff' : 'rgba(255,255,255,0.9)';
        ctx.fill();
      }
      var per = 0;
      for (var t = 1; t < o.points.length; t++) {
        if (state.model.dist(o.points[t], o.points[0]) < 1e-6) { per = t; break; }
      }
      orbitInfo = '  orbit: ' + (o.points.length - 1) + ' steps'
        + (per ? ', period ' + per : ', no return within ' + state.olen)
        + '  symbols ' + o.symbols.slice(0, 24).join('');
    }

    updateHud();
  }

  var cursor = [0, 0];
  function updateHud() {
    var z = cursor;
    var inside = state.model.valid(z);
    hud.textContent = 'z = ' + z[0].toFixed(4) + (z[1] < 0 ? ' - ' : ' + ')
      + Math.abs(z[1]).toFixed(4) + 'i'
      + (inside ? '   d(0,z) = ' + state.model.radius(z).toFixed(3) : '   (ideal exterior)')
      + orbitInfo;
  }

  /* --------------------------------------------------------- interaction */

  var drag = null;

  function hitVertex(px, py) {
    for (var i = 0; i < state.verts.length; i++) {
      var s = toScreen(state.verts[i]);
      if (Math.hypot(s[0] - px, s[1] - py) < 9) return i;
    }
    return -1;
  }

  function localPos(e) {
    var r = ov.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  ov.addEventListener('pointerdown', function (e) {
    var p = localPos(e);
    ov.setPointerCapture(e.pointerId);
    var vi = state.showPoly ? hitVertex(p[0], p[1]) : -1;
    drag = { mode: vi >= 0 ? 'vertex' : 'pan', vi: vi, start: p, moved: false,
             center0: state.center.slice() };
  });

  ov.addEventListener('pointermove', function (e) {
    var p = localPos(e);
    cursor = toDisk(p[0], p[1]);

    if (!drag) {
      ov.style.cursor = (state.showPoly && hitVertex(p[0], p[1]) >= 0) ? 'grab' : 'crosshair';
      updateHud();
      return;
    }
    if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) > 3) drag.moved = true;

    if (drag.mode === 'vertex') {
      state.verts[drag.vi] = state.model.clamp(toDisk(p[0], p[1]));
      rebuildTable();
    } else {
      state.center = [drag.center0[0] - (p[0] - drag.start[0]) * state.scale,
                      drag.center0[1] + (p[1] - drag.start[1]) * state.scale];
    }
    render();
  });

  function endDrag(e) {
    if (drag && !drag.moved && drag.mode === 'pan') {
      var p = localPos(e);
      var z = toDisk(p[0], p[1]);
      if (state.model.valid(z) && !HB.insideKlein(kverts, state.model.proj(z))) {
        state.seed = z;
      } else {
        state.seed = null;
      }
      render();
    }
    drag = null;
  }
  ov.addEventListener('pointerup', endDrag);
  ov.addEventListener('pointercancel', function () { drag = null; });

  ov.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = localPos(e);
    var before = toDisk(p[0], p[1]);
    var f = Math.exp(e.deltaY * 0.0012);
    state.scale = Math.min(0.05 * state.model.extent, Math.max(1e-7 * state.model.extent, state.scale * f));
    var after = toDisk(p[0], p[1]);
    state.center = [state.center[0] + before[0] - after[0],
                    state.center[1] + before[1] - after[1]];
    render();
  }, { passive: false });

  /* ------------------------------------------------------------ controls */

  function bind(id, labelId, apply, format) {
    var el = document.getElementById(id);
    var lab = labelId ? document.getElementById(labelId) : null;
    function upd() {
      var v = el.type === 'checkbox' ? el.checked : parseFloat(el.value);
      apply(v);
      if (lab) lab.textContent = format ? format(v) : v;
      render();
    }
    el.addEventListener('input', upd);
    upd();
    return el;
  }

  bind('sides', 'vSides', function (v) { state.sides = v; makeRegular(); });
  bind('radius', 'vRad', function (v) { state.radius = v; makeRegular(); }, function (v) { return v.toFixed(2); });
  bind('twist', 'vTwist', function (v) { state.twist = v * Math.PI / 180; makeRegular(); }, function (v) { return v + '\u00b0'; });
  bind('iters', 'vIters', function (v) { state.iters = v; });
  bind('step', 'vStep', function (v) { state.stepPick = v; });
  bind('eps', 'vEps', function (v) { state.eps = Math.pow(10, v); }, function (v) { return Math.pow(10, v).toExponential(1); });
  bind('hue', 'vHue', function (v) { state.hue = v; }, function (v) { return v.toFixed(3); });
  bind('cscale', 'vCScale', function (v) { state.cscale = v; }, function (v) { return v.toFixed(3); });
  bind('sat', 'vSat', function (v) { state.sat = v; }, function (v) { return v.toFixed(2); });
  bind('val', 'vVal', function (v) { state.val = v; }, function (v) { return v.toFixed(2); });
  bind('ss', 'vSS', function (v) { state.ss = v; }, function (v) { return v + '\u00d7' + v; });
  bind('olen', 'vOlen', function (v) { state.olen = v; });
  bind('showPoly', null, function (v) { state.showPoly = v; });
  bind('showOrbit', null, function (v) { state.showOrbit = v; });

  var modeSel = document.getElementById('mode');
  function syncModeRows() {
    document.getElementById('stepRow').classList.toggle('off', state.mode !== 4);
    document.getElementById('epsRow').classList.toggle('off', state.mode !== 2);
  }
  modeSel.addEventListener('change', function () {
    state.mode = parseInt(modeSel.value, 10);
    syncModeRows();
    render();
  });
  syncModeRows();

  document.getElementById('reshape').addEventListener('click', function () { makeRegular(); render(); });
  document.getElementById('clearOrbit').addEventListener('click', function () { state.seed = null; render(); });
  document.getElementById('resetView').addEventListener('click', function () { fitView(); render(); });
  document.getElementById('savePng').addEventListener('click', function () {
    draw();
    var out = document.createElement('canvas');
    out.width = glCanvas.width; out.height = glCanvas.height;
    var c2 = out.getContext('2d');
    c2.drawImage(glCanvas, 0, 0);
    c2.drawImage(ov, 0, 0);
    var a = document.createElement('a');
    a.download = 'hyperbolic-outer-billiards.png';
    a.href = out.toDataURL('image/png');
    a.click();
  });

  /* ---------------------------------------------------------------- tabs */

  var TEXT = {
    hyperbolic: ['Hyperbolic Outer Billiards',
      'Point reflection through the tangent vertex of a convex polygon in the '
      + 'Poincar\u00e9 disk. Every pixel is coloured by the fate of its orbit.'],
    euclidean: ['Euclidean Outer Billiards',
      'The classical map T(p) = 2v \u2212 p about the tangent vertex of a convex '
      + 'polygon in the plane. Every pixel is coloured by the fate of its orbit.']
  };

  function syncTableInputs() {
    var rr = state.model.radiusRange;
    var rad = document.getElementById('radius');
    rad.min = rr[0]; rad.max = rr[1]; rad.step = rr[2]; rad.value = state.radius;
    document.getElementById('vRad').textContent = state.radius.toFixed(2);
    document.getElementById('sides').value = state.sides;
    document.getElementById('vSides').textContent = state.sides;
    document.getElementById('twist').value = Math.round(state.twist * 180 / Math.PI);
    document.getElementById('vTwist').textContent = Math.round(state.twist * 180 / Math.PI) + '\u00b0';
    var t = TEXT[state.model.name];
    document.getElementById('title').textContent = t[0];
    document.getElementById('blurb').textContent = t[1];
  }

  function switchGeom(name) {
    if (state.model.name === name) return;
    saved[state.model.name] = {
      verts: state.verts.map(function (v) { return v.slice(); }),
      sides: state.sides, radius: state.radius, twist: state.twist,
      center: state.center.slice(), scale: state.scale, seed: state.seed
    };
    state.model = HB.MODELS[name];
    var s = saved[name];
    if (s) {
      state.verts = s.verts; state.sides = s.sides; state.radius = s.radius; state.twist = s.twist;
      state.center = s.center; state.scale = s.scale; state.seed = s.seed;
      rebuildTable();
    } else {
      state.radius = state.model.defaultRadius;
      state.seed = null;
      makeRegular();
      fitView();
    }
    syncTableInputs();
    render();
  }

  Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (b) {
        b.classList.toggle('active', b === btn);
      });
      switchGeom(btn.dataset.geom);
    });
  });

  window.addEventListener('resize', resize);

  /* --------------------------------------------------------------- start */

  makeRegular();
  syncTableInputs();
  resize();
  fitView();
  render();
})();
