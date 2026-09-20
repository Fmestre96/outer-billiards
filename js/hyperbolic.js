/*
 * Geometry helpers for outer billiards in two models.
 *
 * Hyperbolic: points live in the Poincare disk (complex numbers |z| < 1).
 *   Geodesics are straight chords in the Klein disk, so every convexity /
 *   tangency question is answered after converting to Klein coordinates.
 * Euclidean: points are plain plane coordinates and the Klein projection is the
 *   identity, so the same convexity / tangency code applies unchanged.
 */
var HB = (function () {
  'use strict';

  function toKlein(z) {
    var s = 1 + z[0] * z[0] + z[1] * z[1];
    return [2 * z[0] / s, 2 * z[1] / s];
  }

  function fromKlein(k) {
    var q = k[0] * k[0] + k[1] * k[1];
    var s = 1 + Math.sqrt(Math.max(0, 1 - q));
    return [k[0] / s, k[1] / s];
  }

  /* Hyperbolic distance from the origin, and the inverse. */
  function hypRadius(z) { return 2 * Math.atanh(Math.min(0.999999999, Math.hypot(z[0], z[1]))); }
  function euclidRadius(r) { return Math.tanh(r / 2); }

  /*
   * The outer billiard map is the point reflection through v (rotation by pi):
   *   T(z) = (2v - (1+|v|^2) z) / ((1+|v|^2) - 2 conj(v) z)
   * but iterating that in Poincare coordinates is hopeless: escaping orbits gain about
   * 0.7 in hyperbolic radius per step, so 1-|z| underflows after ~50 steps even in double
   * precision. On the hyperboloid the same map is the linear Lorentz map
   *   X -> -(X + 2<X,V>V),   <V,V> = -1,
   * which is division-free. Carried projectively as (k, 1) it keeps the Klein coordinates
   * bounded and stays accurate indefinitely.
   */
  function lift(z) {
    var r2 = z[0] * z[0] + z[1] * z[1], d = 1 - r2;
    return [2 * z[0] / d, 2 * z[1] / d, (1 + r2) / d];
  }

  function lorentzStep(k, V) {
    var a = k[0] * V[0] + k[1] * V[1] - V[2];
    var x = -(k[0] + 2 * a * V[0]);
    var y = -(k[1] + 2 * a * V[1]);
    var w = -(1 + 2 * a * V[2]);
    return [x / w, y / w];
  }

  function cross(ax, ay, bx, by) { return ax * by - ay * bx; }

  /* Index of the vertex whose geodesic through kp keeps the whole table on the left. */
  function supportVertex(kverts, kp) {
    var best = 0;
    for (var j = 1; j < kverts.length; j++) {
      var a = kverts[best], b = kverts[j];
      if (cross(a[0] - kp[0], a[1] - kp[1], b[0] - kp[0], b[1] - kp[1]) < 0) best = j;
    }
    return best;
  }

  function insideKlein(kverts, kp) {
    var n = kverts.length;
    for (var j = 0; j < n; j++) {
      var a = kverts[j], b = kverts[(j + 1) % n];
      if (cross(b[0] - a[0], b[1] - a[1], kp[0] - a[0], kp[1] - a[1]) < 0) return false;
    }
    return true;
  }

  function signedAreaKlein(kverts) {
    var s = 0, n = kverts.length;
    for (var j = 0; j < n; j++) {
      var a = kverts[j], b = kverts[(j + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  function isConvexKlein(kverts) {
    var n = kverts.length;
    for (var j = 0; j < n; j++) {
      var a = kverts[j], b = kverts[(j + 1) % n], c = kverts[(j + 2) % n];
      if (cross(b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]) <= 0) return false;
    }
    return true;
  }

  function regularPolygon(model, n, circumradius, twistRad) {
    var r = model.circumradius(circumradius);
    var out = [];
    for (var j = 0; j < n; j++) {
      var t = twistRad + 2 * Math.PI * j / n;
      out.push([r * Math.cos(t), r * Math.sin(t)]);
    }
    return out;
  }

  /* One step of the outer billiard map; returns null when k is inside the table. */
  function step(model, hverts, kverts, k) {
    if (insideKlein(kverts, k)) return null;
    var i = supportVertex(kverts, k);
    return { vertex: i, next: model.stepK(k, hverts[i]) };
  }

  /* Traced in Klein coordinates, which is also what the overlay needs for straight edges. */
  function orbit(model, hverts, kverts, z0, count) {
    var k = model.proj(z0), pts = [k.slice()], syms = [];
    for (var j = 0; j < count; j++) {
      var s = step(model, hverts, kverts, k);
      if (!s) break;
      k = s.next;
      if (!isFinite(k[0]) || !isFinite(k[1])) break;
      syms.push(s.vertex);
      pts.push(k.slice());
    }
    return { points: pts, symbols: syms };
  }

  /* Samples along the geodesic from a to b: a straight segment in Klein coords. */
  function hypSamples(a, b, n) {
    var ka = toKlein(a), kb = toKlein(b), out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      out.push(fromKlein([ka[0] + (kb[0] - ka[0]) * t, ka[1] + (kb[1] - ka[1]) * t]));
    }
    return out;
  }

  var MODELS = {
    hyperbolic: {
      id: 0,
      name: 'hyperbolic',
      title: 'Poincar\u00e9 disk',
      extent: 1.087,
      // large tables make every orbit escape at once, leaving only a flat fan;
      // a small table is locally almost Euclidean and keeps the rich structure
      defaultRadius: 0.4,
      radiusRange: [0.05, 4, 0.01],
      proj: toKlein,
      unproj: fromKlein,
      lift: lift,
      stepK: lorentzStep,
      kdist: function (a, b) {
        var na = Math.max(1 - a[0] * a[0] - a[1] * a[1], 1e-300);
        var nb = Math.max(1 - b[0] * b[0] - b[1] * b[1], 1e-300);
        return Math.acosh(Math.max(1, (1 - a[0] * b[0] - a[1] * b[1]) / Math.sqrt(na * nb)));
      },
      radius: hypRadius,
      samples: hypSamples,
      circumradius: euclidRadius,
      valid: function (z) { return z[0] * z[0] + z[1] * z[1] < 1; },
      clamp: function (z) {
        var q = Math.hypot(z[0], z[1]);
        return q > 0.9985 ? [z[0] / q * 0.9985, z[1] / q * 0.9985] : z;
      }
    },
    euclidean: {
      id: 1,
      name: 'euclidean',
      title: 'Euclidean plane',
      extent: 6,
      defaultRadius: 1,
      radiusRange: [0.05, 4, 0.01],
      proj: function (z) { return z; },
      unproj: function (k) { return k; },
      lift: function (z) { return [z[0], z[1], 0]; },
      stepK: function (k, V) { return [2 * V[0] - k[0], 2 * V[1] - k[1]]; },
      kdist: function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); },
      radius: function (z) { return Math.hypot(z[0], z[1]); },
      samples: function (a, b) { return [a, b]; },
      circumradius: function (r) { return r; },
      valid: function (z) { return Math.abs(z[0]) < 1e6 && Math.abs(z[1]) < 1e6; },
      clamp: function (z) { return z; }
    }
  };

  return {
    MODELS: MODELS,
    toKlein: toKlein, fromKlein: fromKlein,
    hypRadius: hypRadius, euclidRadius: euclidRadius,
    supportVertex: supportVertex,
    insideKlein: insideKlein, signedAreaKlein: signedAreaKlein, isConvexKlein: isConvexKlein,
    regularPolygon: regularPolygon, orbit: orbit
  };
})();
