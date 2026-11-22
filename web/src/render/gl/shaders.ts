/**
 * One program draws every primitive (see prims.ts). The vertex shader builds
 * each instance's quad in device pixels; the fragment shader computes
 * coverage analytically, which is the anti-aliasing (MapLibre's context has
 * none). All lengths in the fragment shader are device pixels.
 */

export const VERTEX_SHADER = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec4 i_ab;
layout(location = 1) in vec4 i_extra;
layout(location = 2) in vec4 i_params;
layout(location = 3) in vec4 i_color;
layout(location = 4) in float i_wrap;
layout(location = 5) in uint i_meta;
layout(location = 6) in float i_aux;

uniform mat3 u_h;
uniform vec2 u_cam;
uniform float u_camX;
uniform vec2 u_viewport;
uniform vec2 u_tile;
uniform float u_dpr;
uniform highp sampler2D u_visible;
uniform highp isampler2D u_entries;
uniform highp sampler2D u_features;
/* CSS pixels per mercator unit, and whether the camera is pitched (then u_scale is not used). */
uniform float u_scale;
uniform float u_pitched;

flat out int v_type;
flat out vec4 v_color;
out vec2 v_local;
flat out vec4 v_a;
flat out vec4 v_b;
flat out ivec4 v_tex;
flat out vec4 v_c;

const vec4 NOWHERE = vec4(-4.0, -4.0, 0.0, 1.0);

float g_wrap;

vec3 project(vec2 rel) {
  return u_h * vec3(rel - u_cam + vec2(g_wrap, 0.0), 1.0);
}

bool toDevice(vec3 h, out vec2 device) {
  if (h.z <= 1e-9) return false;
  device = h.xy / h.z * u_dpr - u_tile;
  return true;
}

vec4 clip(vec2 device) {
  return vec4(device.x / u_viewport.x * 2.0 - 1.0, 1.0 - device.y / u_viewport.y * 2.0, 0.0, 1.0);
}

void main() {
  int type = int(i_meta & 15u);
  int mode = int(i_meta & 48u);
  int slot = int(i_meta >> 8u);
  v_type = type;
  v_c = vec4(0.0);
  v_color = i_color;
  v_local = vec2(0.0);
  v_a = vec4(0.0);
  v_b = vec4(0.0);
  v_tex = ivec4(0);
  gl_Position = NOWHERE;
  if (type == 0) return;
  /* Built for the other kind of camera (see PrimMode). */
  if ((mode == 16 && u_pitched > 0.5) || (mode == 32 && u_pitched < 0.5)) return;
  if (texelFetch(u_visible, ivec2(slot & 4095, slot >> 12), 0).r < 0.5) return;

  g_wrap = floor(u_camX - i_wrap + 0.5);
  int corner = gl_VertexID;
  vec2 c = vec2(float(corner & 1), float(corner >> 1));

  if (type == 1) {
    vec2 p0;
    vec2 p1;
    vec2 p2;
    if (!toDevice(project(i_ab.xy), p0) || !toDevice(project(i_ab.zw), p1) || !toDevice(project(i_extra.xy), p2)) return;
    v_a = vec4(p0, p1);
    v_b = vec4(p2, i_params.x, i_params.y);
    vec2 at = corner == 0 ? p0 : corner == 1 ? p1 : p2;
    if (int(i_params.y) == 7) {
      /*
       * Every edge is on the outline: grow the triangle by one and a half
       * pixels so it carries its own anti-aliased edge (the fragment shader
       * ramps coverage across each edge), instead of three fringes.
       */
      vec2 q[3] = vec2[3](p0, p1, p2);
      int k = corner == 3 ? 2 : corner;
      vec2 v = q[k];
      vec2 prev = q[(k + 2) % 3];
      vec2 next = q[(k + 1) % 3];
      vec2 centre = (p0 + p1 + p2) / 3.0;
      vec2 e1 = normalize(v - prev + vec2(1e-9));
      vec2 e2 = normalize(next - v + vec2(1e-9));
      vec2 n1 = vec2(-e1.y, e1.x);
      vec2 n2 = vec2(-e2.y, e2.x);
      if (dot(n1, centre - v) > 0.0) n1 = -n1;
      if (dot(n2, centre - v) > 0.0) n2 = -n2;
      float denominator = max(1.0 + dot(n1, n2), 0.05);
      vec2 offset = (n1 + n2) / denominator * 1.5;
      float reach = length(offset);
      at = v + (reach > 6.0 ? offset * (6.0 / reach) : offset);
    }
    gl_Position = clip(at);
    return;
  }

  if (type == 7) {
    /* An arrowhead: tip fixed, length and direction for this zoom from the arrow's values. */
    vec4 values = texelFetch(u_features, ivec2((slot * 2) & 4095, (slot * 2) >> 12), 0);
    vec4 directions = texelFetch(u_features, ivec2((slot * 2 + 1) & 4095, (slot * 2 + 1) >> 12), 0);
    float headLength = values.z * u_dpr;
    if (headLength < 1e-3) return;
    vec2 tip;
    if (!toDevice(project(i_ab.xy), tip)) return;
    vec2 travel = i_params.x < 0.5 ? directions.xy : directions.zw;
    vec2 ahead;
    if (!toDevice(project(i_ab.xy + travel / u_scale), ahead)) return;
    vec2 dir = normalize(ahead - tip + vec2(1e-12));
    vec2 n = vec2(-dir.y, dir.x);
    float halfWidth = headLength * 0.55;
    float ext = u_dpr + 1.5;
    float along = c.x < 0.5 ? -(headLength + ext) : ext;
    float across = c.y < 0.5 ? -(halfWidth + ext) : halfWidth + ext;
    v_local = vec2(along, across);
    v_a = vec4(headLength, halfWidth, i_params.y, 0.0);
    gl_Position = clip(tip + dir * along + n * across);
    return;
  }

  if (type == 2 || type == 3 || type == 6) {
    vec2 a;
    vec2 b;
    if (!toDevice(project(i_ab.xy), a) || !toDevice(project(i_ab.zw), b)) return;
    vec2 d = b - a;
    float len = length(d);
    vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
    vec2 n = vec2(-dir.y, dir.x);
    float along;
    float across;
    if (type == 2) {
      float hw = i_params.x * u_dpr;
      int flags = int(i_params.w);
      float ext = hw + 1.5;
      float startExt = (flags & 4) != 0 && (flags & 1) == 0 ? 1.5 : ext;
      float endExt = (flags & 8) != 0 && (flags & 2) == 0 ? 1.5 : ext;
      along = c.x < 0.5 ? -startExt : len + endExt;
      across = c.y < 0.5 ? -ext : ext;
      vec2 p = vec2(0.0);
      vec2 q = vec2(len, 0.0);
      vec2 pd;
      if ((flags & 1) != 0 && toDevice(project(i_ab.xy + i_extra.xy), pd)) p = vec2(dot(pd - a, dir), dot(pd - a, n));
      vec2 qd;
      if ((flags & 2) != 0 && toDevice(project(i_ab.zw + i_extra.zw), qd)) q = vec2(dot(qd - a, dir), dot(qd - a, n));
      /*
       * Path distances in device pixels: where this segment starts, where the
       * dash pattern starts, and the stretch of path that is drawn. The start
       * is either the phase the CPU computed for this view or, without pitch,
       * the cumulative mercator distance times this zoom's scale.
       */
      float start = (flags & 32) != 0 ? i_aux * u_scale * u_dpr : i_params.y * u_dpr;
      float origin = 0.0;
      float lo = (flags & 1) != 0 ? -1e30 : start;
      float hi = (flags & 2) != 0 ? 1e30 : start + len;
      if ((flags & 64) != 0) {
        vec4 trim = texelFetch(u_features, ivec2((slot * 2) & 4095, (slot * 2) >> 12), 0);
        lo = trim.x * u_dpr;
        hi = trim.y * u_dpr;
        origin = lo;
      }
      v_a = vec4(len, hw, i_params.w, i_params.z);
      v_b = vec4(p, q);
      v_c = vec4(start, origin, lo, hi);
      v_local = vec2(along, across);
      gl_Position = clip(a + dir * along + n * across);
      return;
    }
    if (type == 6) {
      /* Teeth stand on the left of travel as the screen shows it (side +1), or the right. */
      float size = i_params.x * u_dpr;
      float side = sign(i_params.z);
      vec2 outward = -side * n;
      along = c.x < 0.5 ? -size : len + size;
      across = c.y < 0.5 ? -(u_dpr + 1.5) : size + u_dpr + 1.5;
      v_local = vec2(along, across);
      v_a = vec4(len, size, max(4.0, i_params.y) * u_dpr, i_params.w);
      v_b = vec4(i_aux * u_scale * u_dpr, abs(i_params.z) > 1.5 ? 1.0 : 0.0, 0.0, 0.0);
      gl_Position = clip(a + dir * along + outward * across);
      return;
    }
    /* A fringe: from the edge outwards on one side, one and a half pixels wide. */
    along = c.x < 0.5 ? 0.0 : len;
    across = c.y < 0.5 ? 0.0 : 1.5;
    v_local = vec2(along, across);
    v_a = vec4(len, i_params.y, 0.0, 0.0);
    gl_Position = clip(a + dir * along + n * i_params.x * across);
    return;
  }

  if (type == 4) {
    vec2 centre;
    if (!toDevice(project(i_ab.xy), centre)) return;
    float r = i_params.x * u_dpr;
    float ext = r + 1.5;
    v_local = (c * 2.0 - 1.0) * ext;
    v_a = vec4(r, 0.0, 0.0, 0.0);
    gl_Position = clip(centre + v_local);
    return;
  }

  if (type == 5) {
    vec2 anchor;
    if (!toDevice(project(i_ab.xy), anchor)) return;
    int entry = int(i_params.x);
    ivec2 at = ivec2((entry * 2) & 1023, (entry * 2) >> 10);
    ivec4 rect = texelFetch(u_entries, at, 0);
    ivec4 more = texelFetch(u_entries, at + ivec2(1, 0), 0);
    if (rect.z <= 0) return;
    /* Whole device pixels, so the browser's rasterised text is copied one to one. */
    vec2 phase = vec2(float(more.w % 1024), float(more.w / 1024)) / 256.0;
    vec2 origin = floor(anchor + u_tile - phase + 0.5) - u_tile + vec2(more.yz);
    vec2 corner2 = origin + c * vec2(rect.zw);
    v_tex = ivec4(rect.xy, more.x, 0);
    v_b = vec4(origin, 0.0, 0.0);
    gl_Position = clip(corner2);
  }
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

flat in int v_type;
flat in vec4 v_color;
in vec2 v_local;
flat in vec4 v_a;
flat in vec4 v_b;
flat in ivec4 v_tex;
flat in vec4 v_c;

uniform vec2 u_viewport;
uniform vec2 u_tile;
uniform float u_dpr;
uniform vec2 u_patternOrigin;
uniform highp sampler2DArray u_atlas;
uniform highp sampler2DArray u_patterns;
uniform highp sampler2D u_dash;

out vec4 o_color;

/* Distance to segment s0-s1, with the exact endpoint when the nearest point is one. */
float segmentDistance(vec2 p, vec2 s0, vec2 s1) {
  vec2 d = s1 - s0;
  float l2 = dot(d, d);
  float t = l2 > 0.0 ? dot(p - s0, d) / l2 : 0.0;
  if (t <= 0.0) return length(p - s0);
  if (t >= 1.0) return length(p - s1);
  return length(p - (s0 + d * t));
}

/* Signed distance to a triangle, negative inside. */
float triangleDistance(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0;
  vec2 e1 = p2 - p1;
  vec2 e2 = p0 - p2;
  vec2 v0 = p - p0;
  vec2 v1 = p - p1;
  vec2 v2 = p - p2;
  vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float orientation = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(q0, q0), orientation * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), orientation * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(q2, q2), orientation * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

float paintMask(float paint) {
  if (paint < 0.5) return 1.0;
  vec2 device = vec2(gl_FragCoord.x, u_viewport.y - gl_FragCoord.y) + u_tile;
  vec2 uv = (device / u_dpr - u_patternOrigin) / 8.0;
  return texture(u_patterns, vec3(uv, paint - 1.0)).a;
}

/*
 * Coverage of a dashed stroke at path distance s, "across" from the centre
 * line (at a joint, the distance to the joint, so joins stay round). Dashes are clipped to the path, [lo, hi]: one that would start past
 * the end is not drawn, and one the end cuts keeps its cap there.
 */
float dashCoverage(int row, float s, float across, float hw, bool round, float lo, float hi) {
  int count = int(texelFetch(u_dash, ivec2(0, row), 0).r);
  float period = texelFetch(u_dash, ivec2(1, row), 0).r * u_dpr;
  if (count < 2 || period <= 0.0) return clamp(hw - across + 0.5, 0.0, 1.0);
  float base = floor(s / period) * period;
  float best = 0.0;
  float start = 0.0;
  for (int index = 0; index < 62; index += 2) {
    if (index >= count) break;
    float on = texelFetch(u_dash, ivec2(2 + index, row), 0).r * u_dpr;
    float off = texelFetch(u_dash, ivec2(3 + index, row), 0).r * u_dpr;
    for (int k = -1; k <= 1; k++) {
      float a = base + start + float(k) * period;
      if (a < lo - 1e-3 || a > hi + 1e-3) continue;
      float b = min(a + on, hi);
      float c;
      if (round) {
        float outside = max(max(a - s, s - b), 0.0);
        c = clamp(hw - length(vec2(outside, across)) + 0.5, 0.0, 1.0);
      } else {
        if (b - a < 1e-4) continue;
        float inside = min(s - a, b - s);
        c = clamp(hw - across + 0.5, 0.0, 1.0) * clamp(inside + 0.5, 0.0, 1.0);
      }
      best = max(best, c);
    }
    start += on + off;
  }
  return best;
}

void main() {
  float coverage = 1.0;
  if (v_type == 1) {
    int outline = int(v_b.w);
    if (outline != 0) {
      vec2 device = vec2(gl_FragCoord.x, u_viewport.y - gl_FragCoord.y);
      vec2 q[3] = vec2[3](v_a.xy, v_a.zw, v_b.xy);
      float inside = 1e6;
      for (int edge = 0; edge < 3; edge++) {
        if ((outline & (1 << edge)) == 0) continue;
        vec2 e0 = q[edge];
        vec2 e1 = q[(edge + 1) % 3];
        vec2 opposite = q[(edge + 2) % 3];
        vec2 d = e1 - e0;
        float len = length(d);
        if (len < 1e-6) continue;
        vec2 n = vec2(-d.y, d.x) / len;
        if (dot(opposite - e0, n) < 0.0) n = -n;
        inside = min(inside, dot(device - e0, n));
      }
      coverage = clamp(0.5 + inside, 0.0, 1.0);
    }
    coverage *= paintMask(v_b.z);
  } else if (v_type == 2) {
    float len = v_a.x;
    float hw = v_a.y;
    int flags = int(v_a.z);
    int row = int(v_a.w);
    bool hasPrev = (flags & 1) != 0;
    bool hasNext = (flags & 2) != 0;
    vec2 p = v_local;
    float u = p.x;
    /* Beyond a joint the next segment owns the pixel. */
    if (hasNext && u > len) discard;
    float self = segmentDistance(p, vec2(0.0), vec2(len, 0.0));
    if (hasPrev && segmentDistance(p, v_b.xy, vec2(0.0)) < self - 1e-3) discard;
    if (hasNext && segmentDistance(p, vec2(len, 0.0), v_b.zw) < self - 1e-3) discard;
    bool startButt = !hasPrev && (flags & 4) != 0;
    bool endButt = !hasNext && (flags & 8) != 0;
    float start = v_c.x;
    float origin = v_c.y;
    float lo = v_c.z;
    float hi = v_c.w;
    if (row >= 0) {
      /* Path distance; past a joint it stops at the joint, past an open end it runs on so a round dot keeps its cap. */
      float s = start + (hasPrev ? max(u, 0.0) : u);
      if (hasNext) s = min(s, start + len);
      bool joint = (u < 0.0 && hasPrev) || (u > len && hasNext);
      coverage = dashCoverage(row, s - origin, joint ? self : abs(p.y), hw, (flags & 16) != 0, lo - origin, hi - origin);
    } else {
      /* A butt end cuts square; a round end or a joint is the distance to the segment. */
      bool square = (u < 0.0 && startButt) || (u > len && endButt);
      coverage = clamp(hw - (square ? abs(p.y) : self) + 0.5, 0.0, 1.0);
      if ((flags & 64) != 0) {
        /* Cut square where the shaft meets its heads. */
        float s = start + u;
        coverage *= clamp(s - lo + 0.5, 0.0, 1.0) * clamp(hi - s + 0.5, 0.0, 1.0);
      }
    }
    if (startButt) coverage *= clamp(u + 0.5, 0.0, 1.0);
    if (endButt) coverage *= clamp(len - u + 0.5, 0.0, 1.0);
  } else if (v_type == 3) {
    if (v_local.x < 0.0 || v_local.x > v_a.x) discard;
    coverage = clamp(0.5 - v_local.y, 0.0, 1.0) * paintMask(v_a.y);
  } else if (v_type == 6) {
    /* Teeth at a fixed spacing along the path, the stations that fall on this segment. */
    float len = v_a.x;
    float size = v_a.y;
    float spacing = v_a.z;
    bool casing = v_a.w > 0.5;
    bool semicircle = v_b.y > 0.5;
    float start = v_b.x;
    float s = start + v_local.x;
    float halfSize = size * 0.5;
    float reach = halfSize + u_dpr + 1.0;
    int first = int(floor((s - reach - spacing * 0.5) / spacing));
    float best = 0.0;
    for (int step = 0; step < 16; step++) {
      int k = first + step;
      float station = spacing * 0.5 + float(k) * spacing;
      if (station > s + reach) break;
      if (station < start || station >= start + len) continue;
      vec2 q = vec2(s - station, v_local.y);
      float d = semicircle ? max(length(q) - halfSize, -q.y) : triangleDistance(q, vec2(-halfSize, 0.0), vec2(0.0, size * 0.9), vec2(halfSize, 0.0));
      best = max(best, casing ? clamp(u_dpr + 0.5 - abs(d), 0.0, 1.0) : clamp(0.5 - d, 0.0, 1.0));
    }
    coverage = best;
  } else if (v_type == 7) {
    float headLength = v_a.x;
    float halfWidth = v_a.y;
    float d = triangleDistance(v_local, vec2(0.0), vec2(-headLength, halfWidth), vec2(-headLength, -halfWidth));
    coverage = v_a.z > 0.5 ? clamp(u_dpr + 0.5 - abs(d), 0.0, 1.0) : clamp(0.5 - d, 0.0, 1.0);
  } else if (v_type == 4) {
    coverage = clamp(v_a.x - length(v_local) + 0.5, 0.0, 1.0);
  } else if (v_type == 5) {
    vec2 device = vec2(gl_FragCoord.x, u_viewport.y - gl_FragCoord.y);
    ivec2 texel = v_tex.xy + ivec2(floor(device - v_b.xy));
    vec4 straight = texelFetch(u_atlas, ivec3(texel, v_tex.z), 0);
    o_color = vec4(straight.rgb * straight.a, straight.a);
    return;
  }
  if (coverage <= 0.0) discard;
  o_color = v_color * coverage;
}
`;
