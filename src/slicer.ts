/**
 * GPU-accelerated slicer using WebGL stencil buffer.
 *
 * Algorithm (Formlabs hackathon-slicer approach):
 * For each layer Z, render the mesh with orthographic projection from above.
 * Use clipping to only include geometry at the current slice height.
 * Three-pass stencil trick:
 *   Pass 1: Render front faces, increment stencil on depth pass
 *   Pass 2: Render back faces, decrement stencil on depth pass
 *   Pass 3: Draw fullscreen quad, only where stencil != 0
 * Result: white pixels = inside model, black = outside
 */

import printersData from './data/printers.json';

export interface PrinterSpec {
  name: string;
  resolutionX: number;
  resolutionY: number;
  buildWidthMM: number;
  buildDepthMM: number;
  buildHeightMM: number;
  vendor?: string;
}

export const PRINTERS: Record<string, PrinterSpec> = printersData as Record<string, PrinterSpec>;

interface BufferAttribute {
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
  count: number;
}

interface GeometryLike {
  attributes?: {
    position?: BufferAttribute;
  };
  index?: { getX(index: number): number; count: number } | null;
}

interface DrawRange {
  start: number;
  count: number;
}

interface SliceOptions {
  collect?: boolean;
  onLayer?: (pixels: Uint8Array, index: number) => void;
}

type ProgressCallback = (current: number, total: number) => void;

// --- Column-major 4×4 matrix helpers (no THREE.js) ---

function mat4Multiply(a: Float32Array, b: Float32Array, out: Float32Array): Float32Array {
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

export class Slicer {
  printer: PrinterSpec;
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  meshProgram!: WebGLProgram;
  quadProgram!: WebGLProgram;
  quadBuffer!: WebGLBuffer;
  meshBuffer: WebGLBuffer | null = null;
  vertexCount = 0;
  drawRanges: DrawRange[] = [];
  minY = 0;
  maxY = 0;
  instanceCount = 0;
  instanceMatrix: Float32Array | null = null;
  private _mvScratch = new Float32Array(16);

  constructor() {
    this.printer = PRINTERS['photon-mono'];
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.printer.resolutionX;
    this.canvas.height = this.printer.resolutionY;
    const gl = this.canvas.getContext('webgl', {
      stencil: true,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!gl) throw new Error('WebGL not available');
    this.gl = gl;
    this._initShaders();
  }

  private _initShaders(): void {
    const gl = this.gl;

    const meshVS = `
      attribute vec3 aPosition;
      uniform mat4 uProjection;
      uniform mat4 uModelView;
      void main() {
        gl_Position = uProjection * uModelView * vec4(aPosition, 1.0);
      }
    `;
    const meshFS = `
      precision mediump float;
      void main() {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      }
    `;
    const quadVS = `
      attribute vec2 aPosition;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;
    const quadFS = `
      precision mediump float;
      void main() {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
      }
    `;

    this.meshProgram = this._createProgram(gl, meshVS, meshFS);
    this.quadProgram = this._createProgram(gl, quadVS, quadFS);

    const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const quadBuffer = gl.createBuffer();
    if (!quadBuffer) throw new Error('Failed to create WebGL buffer');
    this.quadBuffer = quadBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  }

  private _createProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    if (!vs) throw new Error('Failed to create vertex shader');
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error('VS: ' + gl.getShaderInfoLog(vs));
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fs) throw new Error('Failed to create fragment shader');
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error('FS: ' + gl.getShaderInfoLog(fs));
    }

    const prog = gl.createProgram();
    if (!prog) throw new Error('Failed to create WebGL program');
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  uploadGeometry(geometry: GeometryLike, supportsGeometry: GeometryLike | null = null): void {
    const gl = this.gl;
    const positions: number[] = [];
    const drawRanges: DrawRange[] = [];
    this._appendGeometryPositions(positions, drawRanges, geometry);
    this._appendGeometryPositions(positions, drawRanges, supportsGeometry);

    const data = new Float32Array(positions);
    this.vertexCount = data.length / 3;
    this.drawRanges = drawRanges.length > 0
      ? drawRanges
      : [{ start: 0, count: this.vertexCount }];

    if (this.meshBuffer) gl.deleteBuffer(this.meshBuffer);
    this.meshBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    let minY = 0;
    let maxY = 0;
    for (let i = 1; i < data.length; i += 3) {
      if (data[i] < minY) minY = data[i];
      if (data[i] > maxY) maxY = data[i];
    }
    this.minY = minY;
    this.maxY = maxY;
  }

  private _appendGeometryPositions(
    positions: number[],
    drawRanges: DrawRange[],
    geometry: GeometryLike | null,
  ): void {
    if (!geometry?.attributes?.position) return;

    const pos = geometry.attributes.position;
    const index = geometry.index;
    const components = this._findTriangleComponents(geometry);
    const appendVertex = (vertexIndex: number): void => {
      positions.push(pos.getX(vertexIndex), pos.getY(vertexIndex), pos.getZ(vertexIndex));
    };

    for (const component of components) {
      const start = positions.length / 3;
      for (const tri of component) {
        if (index) {
          appendVertex(index.getX(tri * 3));
          appendVertex(index.getX(tri * 3 + 1));
          appendVertex(index.getX(tri * 3 + 2));
        } else {
          appendVertex(tri * 3);
          appendVertex(tri * 3 + 1);
          appendVertex(tri * 3 + 2);
        }
      }
      const count = positions.length / 3 - start;
      if (count > 0) drawRanges.push({ start, count });
    }
  }

  private _findTriangleComponents(geometry: GeometryLike): number[][] {
    const pos = geometry.attributes.position;
    const index = geometry.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
    if (triCount === 0) return [];

    const parent = new Int32Array(triCount);
    const rank = new Uint8Array(triCount);
    for (let i = 0; i < triCount; i++) parent[i] = i;

    const find = (x: number): number => {
      let root = x;
      while (parent[root] !== root) root = parent[root];
      while (parent[x] !== x) {
        const next = parent[x];
        parent[x] = root;
        x = next;
      }
      return root;
    };

    const union = (a: number, b: number): void => {
      let rootA = find(a);
      let rootB = find(b);
      if (rootA === rootB) return;
      if (rank[rootA] < rank[rootB]) {
        const tmp = rootA; rootA = rootB; rootB = tmp;
      }
      parent[rootB] = rootA;
      if (rank[rootA] === rank[rootB]) rank[rootA]++;
    };

    // Use integer-based spatial hash instead of string keys to avoid GC pressure.
    // Encode quantized coordinates into a single BigInt key for Map lookup.
    const vertexToTriangle = new Map<bigint, number>();
    const vertexIndexForTriangle = (tri: number, corner: number): number =>
      index ? index.getX(tri * 3 + corner) : tri * 3 + corner;

    // Quantize to 0.01mm precision (1e5 units per mm) — fits in 21 bits per axis
    // Pack 3 coordinates into a single 64-bit integer: x | (y << 21) | (z << 42)
    const QUANT = 1e5;
    const OFFSET = 1048576; // 2^20 — shift to avoid negatives

    for (let tri = 0; tri < triCount; tri++) {
      for (let corner = 0; corner < 3; corner++) {
        const vi = vertexIndexForTriangle(tri, corner);
        const qx = (Math.round(pos.getX(vi) * QUANT) + OFFSET) | 0;
        const qy = (Math.round(pos.getY(vi) * QUANT) + OFFSET) | 0;
        const qz = (Math.round(pos.getZ(vi) * QUANT) + OFFSET) | 0;
        const key = BigInt(qx) | (BigInt(qy) << 21n) | (BigInt(qz) << 42n);
        const prev = vertexToTriangle.get(key);
        if (prev === undefined) {
          vertexToTriangle.set(key, tri);
        } else {
          union(tri, prev);
        }
      }
    }

    const byRoot = new Map<number, number[]>();
    for (let tri = 0; tri < triCount; tri++) {
      const root = find(tri);
      const comp = byRoot.get(root);
      if (comp) comp.push(tri);
      else byRoot.set(root, [tri]);
    }
    return [...byRoot.values()];
  }

  setPrinter(printerKey: string): void {
    if (PRINTERS[printerKey]) {
      this.printer = PRINTERS[printerKey];
      this.canvas.width = this.printer.resolutionX;
      this.canvas.height = this.printer.resolutionY;
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  setInstances(count: number, buffer: Float32Array): void {
    this.instanceCount = count;
    this.instanceMatrix = buffer;
  }

  async slice(
    layerHeightMM: number,
    onProgress?: ProgressCallback,
    options: SliceOptions = {},
  ): Promise<Uint8Array[] | null> {
    const { collect = true, onLayer } = options;
    const gl = this.gl;
    const totalHeight = this.maxY - this.minY;
    const layerCount = Math.ceil(totalHeight / layerHeightMM);
    const layers: Uint8Array[] | null = collect ? [] : null;
    const pixelByteCount = this.printer.resolutionX * this.printer.resolutionY * 4;
    const reusable = collect ? null : new Uint8Array(pixelByteCount);

    // Pre-allocate a single reusable promise resolver for yielding
    const yieldFrame = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

    for (let i = 0; i < layerCount; i++) {
      const z = this.minY + (i + 0.5) * layerHeightMM;
      this._renderSlice(z);

      const pixels = collect ? new Uint8Array(pixelByteCount) : reusable ?? new Uint8Array(pixelByteCount);
      gl.readPixels(
        0, 0, this.printer.resolutionX, this.printer.resolutionY,
        gl.RGBA, gl.UNSIGNED_BYTE, pixels,
      );
      if (collect && layers) layers.push(pixels);
      if (onLayer) onLayer(pixels, i);

      onProgress?.(i + 1, layerCount);

      // Yield every 5 layers to keep UI responsive without excessive microtask overhead
      if (i % 5 === 0) {
        await yieldFrame();
      }
    }

    return layers;
  }

  /**
   * Render a single layer on demand and return its pixel data.
   * Used for layer preview and streaming export without keeping all layers in RAM.
   */
  renderLayer(layerIndex: number, layerHeightMM: number, target?: Uint8Array): Uint8Array {
    const gl = this.gl;
    const pixelByteCount = this.printer.resolutionX * this.printer.resolutionY * 4;
    const pixels = target ?? new Uint8Array(pixelByteCount);
    const z = this.minY + (layerIndex + 0.5) * layerHeightMM;
    this._renderSlice(z);
    gl.readPixels(
      0, 0, this.printer.resolutionX, this.printer.resolutionY,
      gl.RGBA, gl.UNSIGNED_BYTE, pixels,
    );
    return pixels;
  }

  private _renderSlice(sliceY: number): void {
    const gl = this.gl;
    const w = this.printer.resolutionX;
    const h = this.printer.resolutionY;
    gl.viewport(0, 0, w, h);

    gl.clearColor(0, 0, 0, 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    const modelView = this._modelViewForSlice();
    const near = sliceY;
    const far = this.maxY + 1;
    const halfW = this.printer.buildWidthMM / 2;
    const halfD = this.printer.buildDepthMM / 2;
    const proj = this._ortho(-halfW, halfW, -halfD, halfD, near, far);

    const ranges = this.drawRanges.length > 0
      ? this.drawRanges
      : [{ start: 0, count: this.vertexCount }];

    // Single stencil pass for all components — INCR_WRAP/DECR_WRAP is additive,
    // so multiple disconnected shells accumulate correctly without per-range clears.
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR_WRAP);
    gl.colorMask(false, false, false, false);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);

    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    for (const range of ranges) {
      this._drawMesh(proj, modelView, range);
    }

    gl.stencilOp(gl.KEEP, gl.KEEP, gl.DECR_WRAP);
    gl.cullFace(gl.BACK);
    for (const range of ranges) {
      this._drawMesh(proj, modelView, range);
    }

    // Fullscreen quad pass — fill where stencil != 0
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

    gl.useProgram(this.quadProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    const qPos = gl.getAttribLocation(this.quadProgram, 'aPosition');
    gl.enableVertexAttribArray(qPos);
    gl.vertexAttribPointer(qPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.disable(gl.STENCIL_TEST);
    gl.depthMask(true);
  }

  private _drawMesh(projection: Float32Array, modelView: Float32Array, range: DrawRange): void {
    const gl = this.gl;
    gl.useProgram(this.meshProgram);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer);
    const aPos = gl.getAttribLocation(this.meshProgram, 'aPosition');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    const uProj = gl.getUniformLocation(this.meshProgram, 'uProjection');
    gl.uniformMatrix4fv(uProj, false, projection);

    const uMV = gl.getUniformLocation(this.meshProgram, 'uModelView');

    if (this.instanceCount > 0 && this.instanceMatrix) {
      for (let i = 0; i < this.instanceCount; i++) {
        const instMat = this.instanceMatrix.subarray(i * 16, (i + 1) * 16);
        mat4Multiply(modelView, instMat, this._mvScratch);
        gl.uniformMatrix4fv(uMV, false, this._mvScratch);
        gl.drawArrays(gl.TRIANGLES, range.start, range.count);
      }
    } else {
      gl.uniformMatrix4fv(uMV, false, modelView);
      gl.drawArrays(gl.TRIANGLES, range.start, range.count);
    }
  }

  private readonly _sliceModelView = new Float32Array([
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
  ]);

  private _modelViewForSlice(): Float32Array {
    return this._sliceModelView;
  }

  private _ortho(
    left: number, right: number, bottom: number, top: number,
    near: number, far: number,
  ): Float32Array {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    return new Float32Array([
      -2 * lr, 0, 0, 0,
      0, -2 * bt, 0, 0,
      0, 0, 2 * nf, 0,
      (left + right) * lr, (top + bottom) * bt, (near + far) * nf, 1,
    ]);
  }

  getLayerCount(layerHeightMM: number): number {
    const totalHeight = this.maxY - this.minY;
    return Math.ceil(totalHeight / layerHeightMM);
  }

  getPrinterSpec(): PrinterSpec {
    return this.printer;
  }
}
