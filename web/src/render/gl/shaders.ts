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

uniform mat3 u_h;
uniform vec2 u_cam;
uniform float u_camX;
uniform vec2 u_viewport;
uniform vec2 u_tile;
uniform float u_dpr;
uniform highp sampler2D u_visible;
uniform highp isampler2D u_entries;

flat out int v_type;
flat out vec4 v_color;
out vec2 v_local;
flat out vec4 v_a;
flat out vec4 v_b;
flat out ivec4 v_tex;

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
  int type = int(i_meta & 255u);
  int slot = int(i_meta >> 8u);
  v_type = type;
  v_color = i_color;
  v_local = vec2(0.0);
  v_a = vec4(0.0);
  v_b = vec4(0.0);
  v_tex = ivec4(0);
  gl_Position = NOWHERE;
  if (type == 0) return;
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
    gl_Position = clip(corner == 0 ? p0 : corner == 1 ? p1 : p2);
    return;
  }

  if (type == 2 || type == 3) {
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
      v_a = vec4(len, hw, i_params.w, i_params.z);
      v_b = vec4(p, q);
      v_local = vec2(along, across);
      /* The dash phase at this segment's start, in device pixels, carried bit for bit. */
      v_tex = ivec4(floatBitsToInt(i_params.y * u_dpr), 0, 0, 0);
      gl_Position = clip(a + dir * along + n * across);
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
    if (row >= 0) {
      /* Path distance; past a joint it stops at the joint, past an open end it runs on so a round dot keeps its cap. */
      float phase = intBitsToFloat(v_tex.x);
      float s = phase + (hasPrev ? max(u, 0.0) : u);
      if (hasNext) s = min(s, phase + len);
      float lo = hasPrev ? -1e30 : phase;
      float hi = hasNext ? 1e30 : phase + len;
      bool joint = (u < 0.0 && hasPrev) || (u > len && hasNext);
      coverage = dashCoverage(row, s, joint ? self : abs(p.y), hw, (flags & 16) != 0, lo, hi);
    } else {
      /* A butt end cuts square; a round end or a joint is the distance to the segment. */
      bool square = (u < 0.0 && startButt) || (u > len && endButt);
      coverage = clamp(hw - (square ? abs(p.y) : self) + 0.5, 0.0, 1.0);
    }
    if (startButt) coverage *= clamp(u + 0.5, 0.0, 1.0);
    if (endButt) coverage *= clamp(len - u + 0.5, 0.0, 1.0);
  } else if (v_type == 3) {
    if (v_local.x < 0.0 || v_local.x > v_a.x) discard;
    coverage = clamp(0.5 - v_local.y, 0.0, 1.0) * paintMask(v_a.y);
  } else if (v_type == 4) {
    coverage = clamp(v_a.x - length(v_local) + 0.5, 0.0, 1.0);
  } else if (v_type == 5) {
    vec2 device = vec2(gl_FragCoord.x, u_viewport.y - gl_FragCoord.y);
    ivec2 texel = v_tex.xy + ivec2(floor(device - v_b.xy));
    o_color = texelFetch(u_atlas, ivec3(texel, v_tex.z), 0);
    return;
  }
  if (coverage <= 0.0) discard;
  o_color = v_color * coverage;
}
`;
