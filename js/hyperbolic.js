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

  function cmul(a, b) { return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]; }

  function cdiv(a, b) {
    var d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  }

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

  function hypDist(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    var na = 1 - a[0] * a[0] - a[1] * a[1];
    var nb = 1 - b[0] * b[0] - b[1] * b[1];
    return Math.acosh(1 + 2 * (dx * dx + dy * dy) / (na * nb));
  }

  /*
   * Rotation by pi about v (the hyperbolic "point reflection"):
   *   T(z) = (2v - (1+|v|^2) z) / ((1+|v|^2) - 2 conj(v) z)
   */
  function reflectPoint(z, v) {
    var s = 1 + v[0] * v[0] + v[1] * v[1];
    var num = [2 * v[0] - s * z[0], 2 * v[1] - s * z[1]];
    var c = cmul([v[0], -v[1]], z);
    var den = [s - 2 * c[0], -2 * c[1]];
    return cdiv(num, den);
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

  /* One step of the outer billiard map; returns null when z is inside the table. */
  function step(model, verts, kverts, z) {
    var kp = model.proj(z);
    if (insideKlein(kverts, kp)) return null;
    var i = supportVertex(kverts, kp);
    return { vertex: i, next: model.map(z, verts[i]) };
  }

  function orbit(model, verts, kverts, z0, count) {
    var pts = [z0.slice()], syms = [], z = z0.slice();
    for (var k = 0; k < count; k++) {
      var s = step(model, verts, kverts, z);
      if (!s) break;
      z = s.next;
      if (!isFinite(z[0]) || !isFinite(z[1]) || !model.valid(z)) break;
      syms.push(s.vertex);
      pts.push(z.slice());
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
      defaultRadius: 1.2,
      radiusRange: [0.1, 4, 0.01],
      proj: toKlein,
      map: reflectPoint,
      dist: hypDist,
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
      map: function (z, v) { return [2 * v[0] - z[0], 2 * v[1] - z[1]]; },
      dist: function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); },
      radius: function (z) { return Math.hypot(z[0], z[1]); },
      samples: function (a, b) { return [a, b]; },
      circumradius: function (r) { return r; },
      valid: function (z) { return Math.abs(z[0]) < 1e6 && Math.abs(z[1]) < 1e6; },
      clamp: function (z) { return z; }
    }
  };

  return {
    MODELS: MODELS,
    cmul: cmul, cdiv: cdiv,
    toKlein: toKlein, fromKlein: fromKlein,
    hypRadius: hypRadius, euclidRadius: euclidRadius, hypDist: hypDist,
    reflectPoint: reflectPoint, supportVertex: supportVertex,
    insideKlein: insideKlein, signedAreaKlein: signedAreaKlein, isConvexKlein: isConvexKlein,
    regularPolygon: regularPolygon, step: step, orbit: orbit
  };
})();
