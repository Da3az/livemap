import type { FillPattern } from "@/model/types";
import { drawTile } from "../patterns";
import type { GlCamera } from "./camera";
import { DashRegistry, type ImageRegistry } from "./images";
import { BYTES, type PrimBuffer } from "./prims";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders";

/** What one frame draws: the buffers in draw order, and the tables they refer to. */
export interface DrawList {
  /** Bumped when buffers are added, removed or reordered. */
  structure: number;
  buffers: readonly PrimBuffer[];
  images: ImageRegistry;
  dashes: DashRegistry;
  /** One byte per visibility slot: 255 drawn, 0 not. */
  visible: Uint8Array;
  visibleVersion: number;
}

export interface DrawTarget {
  camera: GlCamera;
  /** The origin instance offsets are relative to. */
  base: { x: number; y: number };
  /** Device pixels per CSS pixel. */
  pixelRatio: number;
  /** Size of what is drawn into, in device pixels. */
  viewport: { width: number; height: number };
  /** Where that target sits in the whole image, in device pixels (image export draws in tiles). */
  tile: { x: number; y: number };
  /** The pattern origin, in CSS pixels, already reduced modulo the tile. */
  patternOrigin: { x: number; y: number };
}

const PATTERNS: Exclude<FillPattern, "none">[] = ["hatch", "cross", "dots"];
const VISIBLE_WIDTH = 4096;
const ENTRY_WIDTH = 1024;
const UNITS = { visible: 0, entries: 1, atlas: 2, patterns: 3, dash: 4 } as const;
/** Atlas layers kept before the atlas is rebuilt with only what is drawn. */
const ATLAS_BUDGET = 4;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`Feature shader failed to compile: ${gl.getShaderInfoLog(shader) ?? ""}`);
  }
  return shader;
}

interface Placement {
  offset: number;
  capacity: number;
  version: number;
}

/**
 * The GPU half of the feature renderer for one WebGL2 context: one program,
 * one instance buffer laid out in draw order with room for each buffer to
 * grow, and the small textures the shaders read (visibility, dash patterns,
 * fill patterns, the image atlas and its index). Owns nothing on the CPU
 * side, so a new context after a loss simply uploads everything again.
 */
export class GpuScene {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly instances: WebGLBuffer;
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly textures: { visible: WebGLTexture; entries: WebGLTexture; atlas: WebGLTexture | null; patterns: WebGLTexture | null; dash: WebGLTexture };

  private capacityInstances = 0;
  private totalInstances = 0;
  private structure = -1;
  private readonly placed = new Map<PrimBuffer, Placement>();
  private visibleVersion = -1;
  private visibleRows = 0;
  private dashVersion = -1;
  private patternRatio = 0;

  /* The atlas: shelves on layers of one texture array. */
  private atlasSize: number;
  private atlasLayers = 0;
  private atlasRegistry: ImageRegistry | null = null;
  private readonly resident = new Map<number, { x: number; y: number; layer: number }>();
  private shelf = { layer: 0, x: 0, y: 0, height: 0 };
  private entryRows = 0;
  private entryData = new Int32Array(0);
  private entriesDirty = false;
  private scratch: HTMLCanvasElement | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const program = gl.createProgram();
    const vao = gl.createVertexArray();
    const instances = gl.createBuffer();
    if (!program || !vao || !instances) throw new Error("WebGL could not allocate the feature renderer");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Feature program failed to link: ${gl.getProgramInfoLog(program) ?? ""}`);
    }
    this.program = program;
    this.vao = vao;
    this.instances = instances;
    for (const name of ["u_h", "u_cam", "u_camX", "u_viewport", "u_tile", "u_dpr", "u_visible", "u_entries", "u_patternOrigin", "u_atlas", "u_patterns", "u_dash"]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    const texture = () => {
      const t = gl.createTexture();
      if (!t) throw new Error("WebGL could not allocate a texture");
      return t;
    };
    this.textures = { visible: texture(), entries: texture(), atlas: null, patterns: null, dash: texture() };
    this.atlasSize = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);

    const saved = this.saveState();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    const float = (location: number, size: number, offset: number) => {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, BYTES, offset);
      gl.vertexAttribDivisor(location, 1);
    };
    float(0, 4, 0);
    float(1, 4, 16);
    float(2, 4, 32);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, BYTES, 48);
    gl.vertexAttribDivisor(3, 1);
    float(4, 1, 52);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribIPointer(5, 1, gl.UNSIGNED_INT, BYTES, 56);
    gl.vertexAttribDivisor(5, 1);
    this.restoreState(saved);
  }

  /** Frees everything. Safe on a lost context. */
  dispose(): void {
    const { gl } = this;
    if (gl.isContextLost()) return;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.instances);
    for (const texture of Object.values(this.textures)) if (texture) gl.deleteTexture(texture);
  }

  /* ------------------------------------------------------------------ state */

  /** Everything this class changes, so the map's own renderer finds the context as it left it. */
  private saveState() {
    const { gl } = this;
    const active = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const units: { two: WebGLTexture | null; array: WebGLTexture | null }[] = [];
    for (let unit = 0; unit <= UNITS.dash; unit++) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      units.push({ two: gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null, array: gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY) as WebGLTexture | null });
    }
    gl.activeTexture(active);
    return {
      active,
      units,
      program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
      vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null,
      arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null,
      blend: gl.isEnabled(gl.BLEND),
      blendSrcRgb: gl.getParameter(gl.BLEND_SRC_RGB) as number,
      blendDstRgb: gl.getParameter(gl.BLEND_DST_RGB) as number,
      blendSrcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA) as number,
      blendDstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA) as number,
      blendEqRgb: gl.getParameter(gl.BLEND_EQUATION_RGB) as number,
      blendEqAlpha: gl.getParameter(gl.BLEND_EQUATION_ALPHA) as number,
      depth: gl.isEnabled(gl.DEPTH_TEST),
      stencil: gl.isEnabled(gl.STENCIL_TEST),
      cull: gl.isEnabled(gl.CULL_FACE),
      scissor: gl.isEnabled(gl.SCISSOR_TEST),
      unpackPremultiply: gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL) as boolean,
      unpackFlip: gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL) as boolean,
      unpackAlignment: gl.getParameter(gl.UNPACK_ALIGNMENT) as number,
    };
  }

  private restoreState(state: ReturnType<GpuScene["saveState"]>): void {
    const { gl } = this;
    state.units.forEach((unit, index) => {
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, unit.two);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, unit.array);
    });
    gl.activeTexture(state.active);
    gl.useProgram(state.program);
    gl.bindVertexArray(state.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
    if (state.blend) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    gl.blendFuncSeparate(state.blendSrcRgb, state.blendDstRgb, state.blendSrcAlpha, state.blendDstAlpha);
    gl.blendEquationSeparate(state.blendEqRgb, state.blendEqAlpha);
    if (state.depth) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    if (state.stencil) gl.enable(gl.STENCIL_TEST);
    else gl.disable(gl.STENCIL_TEST);
    if (state.cull) gl.enable(gl.CULL_FACE);
    else gl.disable(gl.CULL_FACE);
    if (state.scissor) gl.enable(gl.SCISSOR_TEST);
    else gl.disable(gl.SCISSOR_TEST);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, state.unpackPremultiply);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, state.unpackFlip);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, state.unpackAlignment);
  }

  /* ---------------------------------------------------------------- uploads */

  /** Typed-array uploads must not be premultiplied or flipped (an integer texture cannot be). */
  private plainUnpack(alignment: number): void {
    const { gl } = this;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment);
  }

  private uploadInstances(list: DrawList): void {
    const { gl } = this;
    let fits = list.structure === this.structure;
    if (fits) {
      for (const buffer of list.buffers) {
        const place = this.placed.get(buffer);
        if (!place || buffer.count > place.capacity) {
          fits = false;
          break;
        }
      }
    }
    if (!fits) {
      /* Lay every buffer out again, each with room to grow, and upload the lot. */
      this.placed.clear();
      let offset = 0;
      for (const buffer of list.buffers) {
        const capacity = buffer.count === 0 ? 0 : buffer.count + Math.ceil(buffer.count / 4) + 4;
        this.placed.set(buffer, { offset, capacity, version: buffer.version });
        offset += capacity;
      }
      this.totalInstances = offset;
      const bytes = new Uint8Array(Math.max(1, offset) * BYTES);
      for (const buffer of list.buffers) {
        const place = this.placed.get(buffer);
        if (place && buffer.count > 0) bytes.set(buffer.bytes(), place.offset * BYTES);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
      if (offset > this.capacityInstances || offset < this.capacityInstances / 4) {
        this.capacityInstances = offset;
        gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
      } else {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes);
      }
      this.structure = list.structure;
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    for (const buffer of list.buffers) {
      const place = this.placed.get(buffer);
      if (!place || place.version === buffer.version) continue;
      /* The tail beyond the new count is cleared to empty instances. */
      const bytes = new Uint8Array(place.capacity * BYTES);
      bytes.set(buffer.bytes());
      gl.bufferSubData(gl.ARRAY_BUFFER, place.offset * BYTES, bytes);
      place.version = buffer.version;
    }
  }

  private uploadVisible(list: DrawList): void {
    if (list.visibleVersion === this.visibleVersion && this.visibleRows > 0) return;
    const { gl } = this;
    const rows = Math.max(1, Math.ceil(list.visible.length / VISIBLE_WIDTH));
    const data = new Uint8Array(rows * VISIBLE_WIDTH);
    data.set(list.visible);
    gl.activeTexture(gl.TEXTURE0 + UNITS.visible);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.visible);
    this.plainUnpack(1);
    if (rows !== this.visibleRows) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, VISIBLE_WIDTH, rows, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.visibleRows = rows;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, VISIBLE_WIDTH, rows, gl.RED, gl.UNSIGNED_BYTE, data);
    }
    this.visibleVersion = list.visibleVersion;
  }

  private uploadDashes(dashes: DashRegistry): void {
    if (dashes.version === this.dashVersion) return;
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0 + UNITS.dash);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.dash);
    this.plainUnpack(4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, DashRegistry.WIDTH, dashes.height, 0, gl.RED, gl.FLOAT, dashes.data.subarray(0, DashRegistry.WIDTH * dashes.height));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.dashVersion = dashes.version;
  }

  /** The fill pattern tiles as white masks, drawn by the same code as the legend's swatches, at this pixel ratio. */
  private uploadPatterns(pixelRatio: number): void {
    if (this.patternRatio === pixelRatio && this.textures.patterns) return;
    const { gl } = this;
    if (this.textures.patterns) gl.deleteTexture(this.textures.patterns);
    const tiles = PATTERNS.map((pattern) => drawTile(pattern, "#ffffff", pixelRatio));
    const size = tiles[0]?.width ?? 8;
    const texture = gl.createTexture();
    this.textures.patterns = texture;
    gl.activeTexture(gl.TEXTURE0 + UNITS.patterns);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size, size, tiles.length);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    tiles.forEach((tile, layer) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, tile));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.patternRatio = pixelRatio;
  }

  private allocateAtlas(layers: number): void {
    const { gl } = this;
    if (this.textures.atlas) gl.deleteTexture(this.textures.atlas);
    const texture = gl.createTexture();
    this.textures.atlas = texture;
    gl.activeTexture(gl.TEXTURE0 + UNITS.atlas);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, this.atlasSize, this.atlasSize, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.atlasLayers = layers;
    this.resident.clear();
    this.shelf = { layer: 0, x: 0, y: 0, height: 0 };
    this.entryData.fill(0);
    this.entriesDirty = true;
  }

  /** A free rectangle on the shelves, or null when every layer is full. */
  private reserve(width: number, height: number): { x: number; y: number; layer: number } | null {
    const size = this.atlasSize;
    const w = width + 1;
    const h = height + 1;
    if (w > size || h > size) return null;
    const shelf = this.shelf;
    if (shelf.x + w > size) {
      shelf.y += shelf.height;
      shelf.x = 0;
      shelf.height = 0;
    }
    if (shelf.y + h > size) {
      shelf.layer++;
      shelf.x = 0;
      shelf.y = 0;
      shelf.height = 0;
    }
    if (shelf.layer >= this.atlasLayers) return null;
    const at = { x: shelf.x, y: shelf.y, layer: shelf.layer };
    shelf.x += w;
    shelf.height = Math.max(shelf.height, h);
    return at;
  }

  private rasterise(entryId: number, registry: ImageRegistry, at: { x: number; y: number; layer: number }): void {
    const entry = registry.get(entryId);
    if (!entry) return;
    const { gl } = this;
    const canvas = (this.scratch ??= document.createElement("canvas"));
    canvas.width = entry.width;
    canvas.height = entry.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    entry.draw(context);
    gl.activeTexture(gl.TEXTURE0 + UNITS.atlas);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textures.atlas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, at.x, at.y, at.layer, entry.width, entry.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    this.resident.set(entryId, at);
    const o = entryId * 8;
    if (o + 8 > this.entryData.length) {
      const next = new Int32Array(Math.max(o + 8, this.entryData.length * 2, ENTRY_WIDTH * 4));
      next.set(this.entryData);
      this.entryData = next;
    }
    this.entryData.set([at.x, at.y, entry.width, entry.height, at.layer, entry.originX, entry.originY, Math.round(entry.phaseX * 256) + Math.round(entry.phaseY * 256) * 1024], o);
    this.entriesDirty = true;
  }

  /** Makes every image the buffers refer to resident, rebuilding the atlas with only those when it is full. */
  private uploadImages(list: DrawList): void {
    if (list.images !== this.atlasRegistry) {
      this.atlasRegistry = list.images;
      this.allocateAtlas(Math.max(1, this.atlasLayers));
    }
    const wanted = new Set<number>();
    for (const buffer of list.buffers) for (const id of buffer.images) wanted.add(id);
    const missing = [...wanted].filter((id) => !this.resident.has(id));
    if (missing.length > 0) {
      let failed = false;
      for (const id of missing) {
        const entry = list.images.get(id);
        if (!entry) continue;
        const at = this.reserve(entry.width, entry.height);
        if (!at) {
          failed = true;
          break;
        }
        this.rasterise(id, list.images, at);
      }
      if (failed) {
        /* Start again with only what is drawn now, on as many layers as that needs. */
        let area = 0;
        for (const id of wanted) {
          const entry = list.images.get(id);
          if (entry) area += (entry.width + 1) * (entry.height + 1);
        }
        const layers = Math.min(Math.max(ATLAS_BUDGET, this.atlasLayers), Math.max(1, Math.ceil((area * 1.3) / (this.atlasSize * this.atlasSize))) + 1);
        this.allocateAtlas(Math.max(layers, Math.ceil((area * 1.3) / (this.atlasSize * this.atlasSize))));
        for (const id of wanted) {
          const entry = list.images.get(id);
          const at = entry ? this.reserve(entry.width, entry.height) : null;
          if (entry && at) this.rasterise(id, list.images, at);
        }
      }
    }
    if (this.entriesDirty) {
      const { gl } = this;
      const rows = Math.max(1, Math.ceil(this.entryData.length / 4 / ENTRY_WIDTH));
      const data = new Int32Array(rows * ENTRY_WIDTH * 4);
      data.set(this.entryData.subarray(0, Math.min(this.entryData.length, data.length)));
      gl.activeTexture(gl.TEXTURE0 + UNITS.entries);
      gl.bindTexture(gl.TEXTURE_2D, this.textures.entries);
      this.plainUnpack(4);
      if (rows !== this.entryRows) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32I, ENTRY_WIDTH, rows, 0, gl.RGBA_INTEGER, gl.INT, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        this.entryRows = rows;
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ENTRY_WIDTH, rows, gl.RGBA_INTEGER, gl.INT, data);
      }
      this.entriesDirty = false;
    }
  }

  /* ------------------------------------------------------------------- draw */

  /** Uploads what changed and draws every instance, in order, in one call. The context is left as it was found. */
  draw(list: DrawList, target: DrawTarget): void {
    const { gl } = this;
    if (gl.isContextLost()) return;
    const saved = this.saveState();
    try {
      gl.bindVertexArray(null);
      this.uploadInstances(list);
      this.uploadVisible(list);
      this.uploadDashes(list.dashes);
      this.uploadPatterns(target.pixelRatio);
      this.uploadImages(list);
      if (this.totalInstances === 0) return;

      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      const u = this.uniforms;
      const { camera } = target;
      const h = camera.h;
      /* GLSL matrices are column-major. */
      gl.uniformMatrix3fv(u.u_h ?? null, false, [h[0]!, h[3]!, h[6]!, h[1]!, h[4]!, h[7]!, h[2]!, h[5]!, h[8]!]);
      gl.uniform2f(u.u_cam ?? null, camera.origin.x - target.base.x, camera.origin.y - target.base.y);
      gl.uniform1f(u.u_camX ?? null, camera.origin.x);
      gl.uniform2f(u.u_viewport ?? null, target.viewport.width, target.viewport.height);
      gl.uniform2f(u.u_tile ?? null, target.tile.x, target.tile.y);
      gl.uniform1f(u.u_dpr ?? null, target.pixelRatio);
      gl.uniform2f(u.u_patternOrigin ?? null, target.patternOrigin.x, target.patternOrigin.y);
      const bind = (unit: number, kind: number, texture: WebGLTexture | null, name: string) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(kind, texture);
        gl.uniform1i(u[name] ?? null, unit);
      };
      bind(UNITS.visible, gl.TEXTURE_2D, this.textures.visible, "u_visible");
      bind(UNITS.entries, gl.TEXTURE_2D, this.textures.entries, "u_entries");
      bind(UNITS.atlas, gl.TEXTURE_2D_ARRAY, this.textures.atlas, "u_atlas");
      bind(UNITS.patterns, gl.TEXTURE_2D_ARRAY, this.textures.patterns, "u_patterns");
      bind(UNITS.dash, gl.TEXTURE_2D, this.textures.dash, "u_dash");

      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.totalInstances);
    } finally {
      this.restoreState(saved);
    }
  }
}
