(function () {
  'use strict';

  var MAXV = SHADERS.MAXV;

  /* ---------------------------------------------------------------- state */

  var state = {
    model: HB.MODELS.hyperbolic,
    verts: [],
    sides: 5,
    radius: HB.MODELS.hyperbolic.defaultRadius,
    twist: 0,
    preset: 'regular',
    kiteA: 0.382,
    iters: 300,
    hypPan: true,
    autoRefine: false,
    mode: 1,
    stepPick: 1,
    eps: 1e-6,
    hue: 0,
    cscale: 0.15,
    sat: 0.72,
    val: 1.0,
    glow: 0.35,
    glowW: 0.02,
    shade: 0.55,
    shadeScale: 0.12,
    ss: 2,
    target: 64,
    olen: 60,
    showPoly: true,
    showOrbit: true,
    seed: null,
    center: [0, 0],
    scale: 1 / 300,
    cam: HB.matIdentity(),
    deep: false,
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

  var deepProg = gl.createProgram();
  gl.attachShader(deepProg, compile(gl.VERTEX_SHADER, SHADERS.VERT));
  gl.attachShader(deepProg, compile(gl.FRAGMENT_SHADER, SHADERS.FRAG_DEEP));
  gl.bindAttribLocation(deepProg, 0, 'aPos');
  gl.linkProgram(deepProg);
  if (!gl.getProgramParameter(deepProg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(deepProg));

  var present = gl.createProgram();
  gl.attachShader(present, compile(gl.VERTEX_SHADER, SHADERS.VERT));
  gl.attachShader(present, compile(gl.FRAGMENT_SHADER, SHADERS.PRESENT));
  gl.bindAttribLocation(present, 0, 'aPos');
  gl.linkProgram(present);
  if (!gl.getProgramParameter(present, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(present));
  var P = {
    uAcc: gl.getUniformLocation(present, 'uAcc'),
    uPasses: gl.getUniformLocation(present, 'uPasses')
  };

  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  var U = {}, UD = {};
  var UNIFORMS = ['uKVerts', 'uKVertsLo', 'uHVerts', 'uHVertsLo', 'uN', 'uGeom', 'uIters', 'uMode',
    'uStepPick', 'uSS', 'uCenter', 'uCenterLo', 'uScale',
    'uResolution', 'uHueShift',
    'uCScale', 'uSat', 'uVal', 'uEps', 'uJitter', 'uGlow', 'uGlowW', 'uShade', 'uShadeScale',
    'uBg', 'uTable'];
  UNIFORMS.forEach(function (n) {
    U[n] = gl.getUniformLocation(prog, n);
    UD[n] = gl.getUniformLocation(deepProg, n);
  });

  // float32 starts misclassifying cells once a pixel spans less than about 1e-6
  var DEEP_THRESHOLD = 2e-6;

  /* --------------------------------------------------------- table layout */

  var kverts = [];
  var hverts = [];
  var viewVerts = [];   // vertices after the camera transform; what is drawn and iterated

  function rebuildTable() {
    // orient counter-clockwise so the tangency and inside tests agree
    if (HB.signedAreaKlein(state.verts.map(state.model.proj)) < 0) state.verts.reverse();

    if (state.model.id === 0) {
      // the camera is applied on the hyperboloid and Klein coordinates are read off
      // directly; going via Poincare would reintroduce the 1-|z| cancellation past d ~ 10
      hverts = state.verts.map(function (v) {
        return HB.matApply(state.cam, state.model.lift(v));
      });
      kverts = hverts.map(function (X) { return [X[0] / X[2], X[1] / X[2]]; });
      viewVerts = hverts.map(HB.fromHyp);
    } else {
      viewVerts = state.verts;
      kverts = viewVerts.map(state.model.proj);
      hverts = viewVerts.map(state.model.lift);
    }

    state.convex = HB.isConvexKlein(kverts);
    warn.classList.toggle('hidden', state.convex);
  }

  /* Screen point -> vertex in the untransformed table frame. */
  function toTableFrame(z) {
    if (state.model.id !== 0) return z;
    return HB.fromHyp(HB.matApply(HB.matInverse(state.cam), state.model.lift(z)));
  }

  function makeRegular() {
    state.verts = HB.regularPolygon(state.model, state.sides, state.radius, Math.PI / 2 + state.twist);
    rebuildTable();
  }

  /*
   * Table presets beyond the regular n-gon. Raw shapes are defined in a fixed frame and then
   * normalised to a unit circumradius about their centroid, so the existing radius slider
   * scales them exactly like it scales a regular polygon.
   */
  var PRESET_SHAPES = {
    // Schwartz's kite family K(A): for a dense set of irrational A satisfying a Diophantine
    // condition, outer billiards on this quadrilateral has unbounded orbits. The default value
    // is the golden-ratio parameter A = 1/phi^2 that Schwartz calls the Penrose kite.
    kite: function (A) { return [[-1, 0], [0, -A], [1, 0], [0, 1]]; }
  };

  function normalizeShape(raw) {
    var cx = 0, cy = 0, i;
    for (i = 0; i < raw.length; i++) { cx += raw[i][0]; cy += raw[i][1]; }
    cx /= raw.length; cy /= raw.length;
    var centered = raw.map(function (p) { return [p[0] - cx, p[1] - cy]; });
    var maxR = 0;
    centered.forEach(function (p) { maxR = Math.max(maxR, Math.hypot(p[0], p[1])); });
    return centered.map(function (p) { return [p[0] / maxR, p[1] / maxR]; });
  }

  function applyPreset() {
    if (state.preset === 'regular') { makeRegular(); return; }
    var norm = normalizeShape(PRESET_SHAPES.kite(state.kiteA));
    var s = state.model.circumradius(state.radius);
    state.verts = norm.map(function (p) { return [p[0] * s, p[1] * s]; });
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
    allocAccum();
    render();
  }

  function fitView() {
    state.center = [0, 0];
    state.scale = state.model.extent / (0.5 * Math.min(W, H));
    state.cam = HB.matIdentity();
    rebuildTable();
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

  /*
   * Cells can be far finer than a pixel, so one sample per pixel is pure aliasing.
   * Each frame adds one jitter-offset pass into a float accumulation buffer and the
   * image converges; any parameter change restarts it.
   */
  var accTex = null, accFbo = null, passes = 0, queued = false;
  var canAccumulate = !!gl.getExtension('EXT_color_buffer_float');

  function allocAccum() {
    if (!canAccumulate) return;
    if (accTex) { gl.deleteTexture(accTex); gl.deleteFramebuffer(accFbo); }
    accTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, accTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, glCanvas.width, glCanvas.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    accFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, accFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function samplesPerPixel() { return passes * state.ss * state.ss; }

  /* Restart the accumulation; call after anything that changes the image. */
  function render() {
    passes = 0;
    schedule();
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; draw(); });
  }

  function draw() {
    var n = Math.min(state.verts.length, MAXV);
    var flatK = new Float32Array(MAXV * 2), flatKLo = new Float32Array(MAXV * 2);
    var flatH = new Float32Array(MAXV * 3), flatHLo = new Float32Array(MAXV * 3);
    for (var i = 0; i < n; i++) {
      for (var a = 0; a < 2; a++) {
        var hi = Math.fround(kverts[i][a]);
        flatK[2 * i + a] = hi; flatKLo[2 * i + a] = kverts[i][a] - hi;
      }
      for (var b = 0; b < 3; b++) {
        var hh = Math.fround(hverts[i][b]);
        flatH[3 * i + b] = hh; flatHLo[3 * i + b] = hverts[i][b] - hh;
      }
    }
    var cx = Math.fround(state.center[0]), cy = Math.fround(state.center[1]);

    state.deep = state.scale < DEEP_THRESHOLD;
    var p = state.deep ? deepProg : prog;
    var L = state.deep ? UD : U;

    var first = passes === 0;
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.useProgram(p);
    gl.bindVertexArray(vao);
    gl.uniform2fv(L.uKVerts, flatK);
    gl.uniform2fv(L.uKVertsLo, flatKLo);
    gl.uniform3fv(L.uHVerts, flatH);
    gl.uniform3fv(L.uHVertsLo, flatHLo);
    gl.uniform1i(L.uN, n);
    gl.uniform1i(L.uGeom, state.model.id);
    gl.uniform1i(L.uIters, state.iters);
    gl.uniform1i(L.uMode, state.mode);
    gl.uniform1i(L.uStepPick, state.stepPick);
    gl.uniform1i(L.uSS, state.ss);
    gl.uniform2f(L.uCenter, cx, cy);
    gl.uniform2f(L.uCenterLo, state.center[0] - cx, state.center[1] - cy);
    gl.uniform1f(L.uScale, state.scale / dpr);
    gl.uniform2f(L.uResolution, glCanvas.width, glCanvas.height);
    gl.uniform1f(L.uHueShift, state.hue);
    gl.uniform1f(L.uCScale, state.cscale);
    gl.uniform1f(L.uSat, state.sat);
    gl.uniform1f(L.uVal, state.val);
    gl.uniform1f(L.uEps, state.eps);
    gl.uniform1f(L.uGlow, state.glow);
    gl.uniform1f(L.uGlowW, state.glowW);
    gl.uniform1f(L.uShade, state.shade);
    gl.uniform1f(L.uShadeScale, state.shadeScale);
    gl.uniform3f(L.uBg, 0.039, 0.047, 0.071);
    gl.uniform3f(L.uTable, 0.93, 0.95, 1.0);
    gl.uniform2f(L.uJitter, first ? 0.5 : Math.random(), first ? 0.5 : Math.random());

    if (!canAccumulate) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      passes = 1;
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, accFbo);
      if (first) { gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      passes++;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(present);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, accTex);
      gl.uniform1i(P.uAcc, 0);
      gl.uniform1f(P.uPasses, passes);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    if (first) drawOverlay(); else updateHud();
    if (samplesPerPixel() < state.target) { schedule(); return; }
    if (state.autoRefine) refine();
  }

  /*
   * Deeper orbits subdivide cells, so raising the iteration count is what reveals finer
   * structure. Hues are keyed to the colour-depth prefix and so stay fixed while this runs.
   * Stops once a level changes the image by less than a quantisation step.
   */
  var REFINE_STEP = 1.6, REFINE_MAX = 1000;
  var lastFrame = null;

  function refine() {
    if (state.iters >= REFINE_MAX) return;

    // centred sample of the resolved image; the accumulation buffer holds unnormalised floats
    var w = Math.max(1, glCanvas.width >> 1), h = Math.max(1, glCanvas.height >> 1);
    var buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    while (gl.getError() !== gl.NO_ERROR) { /* drain */ }
    gl.readPixels(w >> 1, h >> 1, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    var readable = gl.getError() === gl.NO_ERROR;

    if (readable && lastFrame && lastFrame.length === buf.length) {
      var diff = 0;
      for (var i = 0; i < buf.length; i += 4) {
        diff += Math.abs(buf[i] - lastFrame[i]) + Math.abs(buf[i + 1] - lastFrame[i + 1])
              + Math.abs(buf[i + 2] - lastFrame[i + 2]);
      }
      if (diff / (buf.length / 4) < 1.0) { lastFrame = buf; return; }
    }
    lastFrame = readable ? buf : null;

    state.iters = Math.min(REFINE_MAX, Math.ceil(state.iters * REFINE_STEP));
    var el = document.getElementById('iters');
    el.value = state.iters;
    document.getElementById('vIters').textContent = state.iters;
    render();
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
      for (var i = 0; i < viewVerts.length; i++) {
        strokeGeodesic(viewVerts[i], viewVerts[(i + 1) % viewVerts.length]);
      }
      for (var j = 0; j < viewVerts.length; j++) {
        var s = toScreen(viewVerts[j]);
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
      var o = HB.orbit(state.model, hverts, kverts, state.seed, state.olen);
      var pts = o.points.map(state.model.unproj);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.25;
      for (var k = 0; k + 1 < pts.length; k++) {
        strokeGeodesic(pts[k], pts[k + 1]);
      }
      for (var m = 0; m < pts.length; m++) {
        var p = toScreen(pts[m]);
        ctx.beginPath();
        ctx.arc(p[0], p[1], m === 0 ? 4.5 : 2.2, 0, 2 * Math.PI);
        ctx.fillStyle = m === 0 ? '#6ee7ff' : 'rgba(255,255,255,0.9)';
        ctx.fill();
      }
      var per = 0;
      for (var t = 1; t < o.points.length; t++) {
        if (state.model.kdist(o.points[t], o.points[0]) < 1e-6) { per = t; break; }
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
    var inDisk = state.model.valid(z);
    var spp = samplesPerPixel();
    hud.textContent = 'z = ' + z[0].toFixed(4) + (z[1] < 0 ? ' - ' : ' + ')
      + Math.abs(z[1]).toFixed(4) + 'i'
      + (inDisk ? '   d(0,z) = ' + state.model.radius(z).toFixed(3) : '   (ideal exterior)')
      + '   zoom ' + (state.model.extent / (0.5 * Math.min(W, H)) / state.scale).toExponential(1)
      + (state.deep ? ' (deep)' : '')
      + (state.model.id === 0 && HB.matTravel(state.cam) > 0.005
          ? '   travelled ' + HB.matTravel(state.cam).toFixed(2) : '')
      + '   ' + spp + (spp < state.target ? '/' + state.target : '') + ' spp'
      + orbitInfo;
  }

  /* --------------------------------------------------------- interaction */

  var drag = null;

  function hitVertex(px, py) {
    for (var i = 0; i < viewVerts.length; i++) {
      var s = toScreen(viewVerts[i]);
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
    drag = { mode: vi >= 0 ? 'vertex' : 'pan', vi: vi, start: p, prev: p, moved: false,
             center0: state.center.slice() };
  });

  /* Drags the scene along the geodesic from a to b, so the grabbed point follows the cursor. */
  var MAX_TRAVEL = 15;   // past this the camera entries outgrow float64, see matOrthonormalize

  function panHyperbolic(a, b) {
    var lift = state.model.lift;
    if (!state.model.valid(a) || !state.model.valid(b)) return;
    var T = HB.translation(lift(a), lift(b));
    var next = HB.matOrthonormalize(HB.matMul(T, state.cam));
    if (HB.matTravel(next) > MAX_TRAVEL && HB.matTravel(next) > HB.matTravel(state.cam)) return;
    state.cam = next;
    if (state.seed) state.seed = HB.fromHyp(HB.matApply(T, lift(state.seed)));
    rebuildTable();
  }

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
      viewVerts[drag.vi] = state.model.clamp(toDisk(p[0], p[1]));
      state.verts[drag.vi] = toTableFrame(viewVerts[drag.vi]);
      rebuildTable();
    } else if (state.model.id === 0 && state.hypPan) {
      panHyperbolic(toDisk(drag.prev[0], drag.prev[1]), toDisk(p[0], p[1]));
    } else {
      state.center = [drag.center0[0] - (p[0] - drag.start[0]) * state.scale,
                      drag.center0[1] + (p[1] - drag.start[1]) * state.scale];
    }
    drag.prev = p;
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
    state.scale = Math.min(0.05 * state.model.extent, Math.max(1e-13 * state.model.extent, state.scale * f));
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

  bind('sides', 'vSides', function (v) { state.sides = v; applyPreset(); });
  bind('radius', 'vRad', function (v) { state.radius = v; applyPreset(); }, function (v) { return v.toFixed(2); });
  bind('twist', 'vTwist', function (v) { state.twist = v * Math.PI / 180; applyPreset(); }, function (v) { return v + '\u00b0'; });
  bind('kiteA', 'vKiteA', function (v) { state.kiteA = v; applyPreset(); }, function (v) { return v.toFixed(3); });
  bind('iters', 'vIters', function (v) { state.iters = v; });
  bind('hypPan', null, function (v) { state.hypPan = v; });
  bind('autoRefine', null, function (v) { state.autoRefine = v; lastFrame = null; });
  bind('step', 'vStep', function (v) { state.stepPick = v; });
  bind('eps', 'vEps', function (v) { state.eps = Math.pow(10, v); }, function (v) { return Math.pow(10, v).toExponential(1); });
  bind('hue', 'vHue', function (v) { state.hue = v; }, function (v) { return v.toFixed(3); });
  bind('cscale', 'vCScale', function (v) { state.cscale = v; }, function (v) { return v.toFixed(3); });
  bind('sat', 'vSat', function (v) { state.sat = v; }, function (v) { return v.toFixed(2); });
  bind('val', 'vVal', function (v) { state.val = v; }, function (v) { return v.toFixed(2); });
  bind('glow', 'vGlow', function (v) { state.glow = v; }, function (v) { return v.toFixed(2); });
  bind('shade', 'vShade', function (v) { state.shade = v; }, function (v) { return v.toFixed(2); });
  bind('shadeScale', 'vShadeScale', function (v) { state.shadeScale = v; },
       function (v) { return v.toFixed(3); });
  bind('glowW', 'vGlowW', function (v) { state.glowW = v; }, function (v) { return v.toFixed(3); });
  bind('ss', 'vSS', function (v) { state.ss = v; }, function (v) { return v + '\u00d7' + v; });
  bind('target', 'vTarget', function (v) { state.target = Math.pow(2, v); },
       function (v) { return String(Math.pow(2, v)); });
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

  document.getElementById('reshape').addEventListener('click', function () {
    state.preset = 'regular';
    document.getElementById('preset').value = 'regular';
    syncPresetRows();
    makeRegular();
    render();
  });
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
    document.getElementById('preset').value = state.preset;
    document.getElementById('kiteA').value = state.kiteA;
    document.getElementById('vKiteA').textContent = state.kiteA.toFixed(3);
    syncPresetRows();
    var t = TEXT[state.model.name];
    document.getElementById('title').textContent = t[0];
    document.getElementById('blurb').textContent = t[1];
  }

  var PRESET_HINTS = {
    regular: 'Drag the white vertex handles to deform the table.',
    kite: 'Schwartz\u2019s kite family K(A): vertices (\u22121,0), (0,\u2212A), (1,0), (0,1). '
        + 'For a dense set of irrational A satisfying a Diophantine condition \u2014 including '
        + 'the golden-ratio value here, the Penrose kite \u2014 outer billiards has unbounded orbits.'
  };

  function syncPresetRows() {
    var p = state.preset;
    document.getElementById('sidesRow').classList.toggle('off', p !== 'regular');
    document.getElementById('twistRow').classList.toggle('off', p !== 'regular');
    document.getElementById('kiteRow').classList.toggle('off', p !== 'kite');
    document.getElementById('radiusLabel').firstChild.textContent = p === 'regular' ? 'Circumradius ' : 'Size ';
    document.getElementById('presetHint').textContent = PRESET_HINTS[p];
  }

  document.getElementById('preset').addEventListener('change', function (e) {
    state.preset = e.target.value;
    syncPresetRows();
    applyPreset();
    render();
  });
  syncPresetRows();

  function switchGeom(name) {
    if (state.model.name === name) return;
    saved[state.model.name] = {
      verts: state.verts.map(function (v) { return v.slice(); }),
      sides: state.sides, radius: state.radius, twist: state.twist,
      preset: state.preset, kiteA: state.kiteA,
      center: state.center.slice(), scale: state.scale, seed: state.seed,
      cam: state.cam.slice()
    };
    state.model = HB.MODELS[name];
    var s = saved[name];
    if (s) {
      state.verts = s.verts; state.sides = s.sides; state.radius = s.radius; state.twist = s.twist;
      state.preset = s.preset; state.kiteA = s.kiteA;
      state.center = s.center; state.scale = s.scale; state.seed = s.seed;
      state.cam = s.cam;
      rebuildTable();
    } else {
      state.radius = state.model.defaultRadius;
      state.preset = 'regular';
      state.seed = null;
      state.cam = HB.matIdentity();
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
