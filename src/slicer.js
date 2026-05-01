import * as THREE from 'three';

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

// Common printer specs
export const PRINTERS = {
  'photon-mono': {
    name: 'Anycubic Photon Mono',
    resolutionX: 2560,
    resolutionY: 1620,
    buildWidthMM: 130,
    buildDepthMM: 80,
    buildHeightMM: 165,
  },
  'mars-3': {
    name: 'Elegoo Mars 3',
    resolutionX: 4098,
    resolutionY: 2560,
    buildWidthMM: 143,
    buildDepthMM: 89.6,
    buildHeightMM: 175,
  },
  'saturn-2': {
    name: 'Elegoo Saturn 2',
    resolutionX: 7680,
    resolutionY: 4320,
    buildWidthMM: 218.88,
    buildDepthMM: 123.12,
    buildHeightMM: 250,
  },
  'sonic-mini-8k': {
    name: 'Phrozen Sonic Mini 8K',
    resolutionX: 7500,
    resolutionY: 3300,
    buildWidthMM: 165,
    buildDepthMM: 72,
    buildHeightMM: 180,
  }
};

export class Slicer {
  constructor() {
    this.printer = PRINTERS['photon-mono'];
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.printer.resolutionX;
    this.canvas.height = this.printer.resolutionY;
    this.gl = this.canvas.getContext('webgl', {
      stencil: true,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    if (!this.gl) throw new Error('WebGL not available');
    this._initShaders();
  }

  _initShaders() {
    const gl = this.gl;

    // Shader for rendering the mesh (passes 1 & 2)
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

    // Shader for the fullscreen quad (pass 3)
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

    // Fullscreen quad
    const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  }

  _createProgram(gl, vsSrc, fsSrc) {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error('VS: ' + gl.getShaderInfoLog(vs));
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error('FS: ' + gl.getShaderInfoLog(fs));
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Link: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  /**
   * Upload mesh geometry to GPU buffers.
   * Accepts Three.js BufferGeometry (position attribute required).
   * Optionally merges support geometry.
   */
  uploadGeometry(geometry, supportsGeometry = null) {
    const gl = this.gl;

    // Collect all positions
    const positions = [];
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }

    if (supportsGeometry) {
      const spos = supportsGeometry.attributes.position;
      for (let i = 0; i < spos.count; i++) {
        positions.push(spos.getX(i), spos.getY(i), spos.getZ(i));
      }
    }

    const data = new Float32Array(positions);
    this.vertexCount = data.length / 3;

    if (this.meshBuffer) gl.deleteBuffer(this.meshBuffer);
    this.meshBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    // Compute bounds, ensuring we slice from Z=0
    let minY = 0, maxY = 0;
    for (let i = 1; i < data.length; i += 3) {
      if (data[i] < minY) minY = data[i];
      if (data[i] > maxY) maxY = data[i];
    }
    this.minY = minY;
    this.maxY = maxY;
  }

  setPrinter(printerKey) {
    if (PRINTERS[printerKey]) {
      this.printer = PRINTERS[printerKey];
      this.canvas.width = this.printer.resolutionX;
      this.canvas.height = this.printer.resolutionY;

      // We might need to adjust viewport if gl is already bound to a size
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  setInstances(count, buffer) {
    this.instanceCount = count;
    this.instanceMatrix = buffer;
  }

  /**
   * Slice the uploaded geometry into layer images.
   *
   * @param {number} layerHeightMM
   * @param {Function} onProgress (current, total)
   * @param {{collect?: boolean, onLayer?: (pixels: Uint8Array, index: number) => void}} [options]
   *   When `collect` is false, the per-layer buffer is reused and not retained;
   *   the caller must consume `pixels` synchronously inside `onLayer`. This is
   *   required for streaming consumers (e.g. volume measurement) to avoid
   *   allocating gigabytes of layer data on tall jobs.
   * @returns {Promise<Uint8Array[]|null>} Array of layer buffers when collecting; null otherwise.
   */
  async slice(layerHeightMM, onProgress, options = {}) {
    const { collect = true, onLayer = null } = options;
    const gl = this.gl;
    const totalHeight = this.maxY - this.minY;
    const layerCount = Math.ceil(totalHeight / layerHeightMM);
    const layers = collect ? [] : null;
    const pixelByteCount = this.printer.resolutionX * this.printer.resolutionY * 4;
    // Reused scratch buffer when not collecting — saves ~16-130 MB per layer.
    const reusable = collect ? null : new Uint8Array(pixelByteCount);

    // Orthographic projection matching printer build area
    const halfW = this.printer.buildWidthMM / 2;
    const halfD = this.printer.buildDepthMM / 2;
    // Ortho: left, right, bottom, top, near, far
    const projection = this._ortho(-halfW, halfW, -halfD, halfD, -500, 500);

    for (let i = 0; i < layerCount; i++) {
      const z = this.minY + (i + 0.5) * layerHeightMM;
      this._renderSlice(projection, z, layerHeightMM);

      const pixels = collect ? new Uint8Array(pixelByteCount) : reusable;
      gl.readPixels(0, 0, this.printer.resolutionX, this.printer.resolutionY, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (collect) layers.push(pixels);
      if (onLayer) onLayer(pixels, i);

      if (onProgress) {
        onProgress(i + 1, layerCount);
      }

      // Yield to UI every 10 layers
      if (i % 10 === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    return layers;
  }

  _renderSlice(projection, sliceY, layerHeight) {
    const gl = this.gl;
    const w = this.printer.resolutionX;
    const h = this.printer.resolutionY;
    gl.viewport(0, 0, w, h);

    // Clear
    gl.clearColor(0, 0, 0, 1);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // Stencil buffer slicing approach (Formlabs):
    // Look down from above (along -Y). Map model Y to eye -Z.
    // The near clipping plane clips at the slice height.
    // All geometry ABOVE the slice plane passes through.
    // Front faces increment stencil, back faces decrement.
    // Net stencil != 0 means the point is inside the model at that Z.
    //
    // OpenGL ortho maps eye-space z in [-far, -near] to NDC.
    // With Z_eye = -Y_model, model.y=sliceY -> eye.z=-sliceY.
    // Setting near=sliceY, far=maxY+1 makes visible range
    // eye.z in [-(maxY+1), -sliceY], i.e. model.y in [sliceY, maxY+1].
    const modelView = this._modelViewForSlice();

    const near = sliceY;
    const far = this.maxY + 1;
    const halfW = this.printer.buildWidthMM / 2;
    const halfD = this.printer.buildDepthMM / 2;
    const proj = this._ortho(-halfW, halfW, -halfD, halfD, near, far);

    // --- Pass 1: Front faces, increment stencil ---
    // Note: The MV matrix includes a reflection (Z_eye = -Y_model) which
    // flips triangle winding. So we swap cull faces: FRONT = original front.
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    gl.colorMask(false, false, false, false);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);

    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT); // render original front faces (swapped due to reflection)

    this._drawMesh(proj, modelView);

    // --- Pass 2: Back faces, decrement stencil ---
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.DECR);
    gl.cullFace(gl.BACK); // render original back faces (swapped due to reflection)

    this._drawMesh(proj, modelView);

    // --- Pass 3: Draw white where stencil != 0 ---
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

  _drawMesh(projection, modelView) {
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
      const baseMV = new THREE.Matrix4().fromArray(modelView);
      const instMat = new THREE.Matrix4();
      const finalMV = new THREE.Matrix4();
      
      for (let i = 0; i < this.instanceCount; i++) {
        instMat.fromArray(this.instanceMatrix, i * 16);
        finalMV.multiplyMatrices(baseMV, instMat);
        gl.uniformMatrix4fv(uMV, false, finalMV.elements);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
      }
    } else {
      gl.uniformMatrix4fv(uMV, false, modelView);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    }
  }

  /**
   * Create model-view matrix that maps:
   * X -> X (left/right on printer)
   * Z -> Y (front/back on printer, up in screen)
   * Y -> Z (height, into screen / view direction)
   * Then translate so sliceY sits at Z=0
   */
  _modelViewForSlice() {
    // Transform model coordinates to eye coordinates:
    //   X_eye = X_model     (left/right on printer)
    //   Y_eye = Z_model     (front/back on printer → screen Y)
    //   Z_eye = -Y_model    (height → depth, negated for GL convention)
    //
    // GL looks down -Z. Ortho(near, far) shows eye z in [-far, -near].
    // With Z_eye = -Y_model, the projection's near/far directly clip by Y_model.
    //
    // Column-major for WebGL:
    //   col0 (X_model): X_eye=1, Y_eye=0, Z_eye=0
    //   col1 (Y_model): X_eye=0, Y_eye=0, Z_eye=-1
    //   col2 (Z_model): X_eye=0, Y_eye=1, Z_eye=0
    //   col3: no translation needed (clipping via projection near/far)
    return new Float32Array([
      1, 0,  0, 0,
      0, 0, -1, 0,
      0, 1,  0, 0,
      0, 0,  0, 1,
    ]);
  }

  /**
   * Column-major orthographic projection matrix.
   */
  _ortho(left, right, bottom, top, near, far) {
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

  getLayerCount(layerHeightMM) {
    const totalHeight = this.maxY - this.minY; // typically minY is 0
    return Math.ceil(totalHeight / layerHeightMM);
  }

  getPrinterSpec() {
    return this.printer;
  }
}
