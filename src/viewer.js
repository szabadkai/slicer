import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.modelMesh = null;
    this.supportsMesh = null;
    this.elevation = 5;
    this.printer = null;
    this.gridGroup = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe9ecef);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.camera.position.set(100, 100, 100);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.transformControl = new TransformControls(this.camera, canvas);
    this.transformControl.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !event.value;
    });
    this.transformControl.addEventListener('mouseUp', () => {
      this._bakeTransform();
    });
    this.scene.add(this.transformControl.getHelper());

    this._setupLights();
    this._setupGrid();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._animate();
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(50, 100, 50);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-50, 50, -50);
    this.scene.add(dir2);
  }

  setPrinter(spec) {
    this.printer = spec;
    this._setupGrid();
    
    if (!this.modelMesh) {
      const maxDim = Math.max(spec.buildWidthMM, spec.buildHeightMM, spec.buildDepthMM);
      this.camera.position.set(maxDim * 0.8, maxDim * 0.8, maxDim * 0.8);
      this.controls.target.set(0, spec.buildHeightMM / 2, 0);
      this.controls.update();
    }
  }

  _setupGrid() {
    if (this.gridGroup) {
      this.scene.remove(this.gridGroup);
      this.gridGroup.children.forEach(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      });
    }

    this.gridGroup = new THREE.Group();
    this.scene.add(this.gridGroup);

    if (!this.printer) return;

    const w = this.printer.buildWidthMM;
    const d = this.printer.buildDepthMM;
    const h = this.printer.buildHeightMM;

    // Solid Build Plate underneath (Y < 0)
    const plateThickness = 1;
    const plateGeo = new THREE.BoxGeometry(w, plateThickness, d);
    const plateMat = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x111111, shininess: 5 });
    const plateMesh = new THREE.Mesh(plateGeo, plateMat);
    plateMesh.position.y = -plateThickness / 2;
    this.gridGroup.add(plateMesh);

    // High resolution grid on top
    const lines = [];
    const colors = [];
    const colorMajor = new THREE.Color(0x666666);
    const colorMinor = new THREE.Color(0xcccccc);

    const halfW = w / 2;
    const halfD = d / 2;
    
    for (let x = -Math.floor(halfW); x <= Math.floor(halfW); x++) {
      lines.push(x, 0, -halfD, x, 0, halfD);
      const isMajor = (x % 10 === 0);
      colors.push(
        (isMajor ? colorMajor.r : colorMinor.r), (isMajor ? colorMajor.g : colorMinor.g), (isMajor ? colorMajor.b : colorMinor.b),
        (isMajor ? colorMajor.r : colorMinor.r), (isMajor ? colorMajor.g : colorMinor.g), (isMajor ? colorMajor.b : colorMinor.b)
      );
    }
    
    for (let z = -Math.floor(halfD); z <= Math.floor(halfD); z++) {
      lines.push(-halfW, 0, z, halfW, 0, z);
      const isMajor = (z % 10 === 0);
      colors.push(
        (isMajor ? colorMajor.r : colorMinor.r), (isMajor ? colorMajor.g : colorMinor.g), (isMajor ? colorMajor.b : colorMinor.b),
        (isMajor ? colorMajor.r : colorMinor.r), (isMajor ? colorMajor.g : colorMinor.g), (isMajor ? colorMajor.b : colorMinor.b)
      );
    }
    
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    gridGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    gridGeo.translate(0, 0.01, 0); // Offset to avoid Z-fighting
    
    const gridMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 });
    const gridLines = new THREE.LineSegments(gridGeo, gridMat);
    this.gridGroup.add(gridLines);

    // Build volume (Preform style)
    const volGeo = new THREE.BoxGeometry(w, h, d);
    volGeo.translate(0, h / 2, 0);
    
    // Transparent volume is usually not visible or very very faint
    const volMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false });
    const volMesh = new THREE.Mesh(volGeo, volMat);
    this.gridGroup.add(volMesh);
    
    const edges = new THREE.EdgesGeometry(volGeo);
    // Dark grey wires for the bounding box
    const volLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.4 }));
    this.gridGroup.add(volLines);
  }

  _resize() {
    const container = this.canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  loadSTL(buffer) {
    const loader = new STLLoader();
    const geometry = loader.parse(buffer);
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();

    // Center on build plate, sitting on Y = elevation
    const bb = geometry.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    geometry.translate(-center.x, -bb.min.y + this.elevation, -center.z);

    // Recompute after centering
    geometry.computeBoundingBox();

    this.setModelGeometry(geometry);
    
    // Fit camera
    const size = new THREE.Vector3();
    geometry.boundingBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    this.camera.position.set(maxDim, maxDim * 0.8, maxDim);
    this.controls.target.set(0, size.y / 2, 0);
    this.controls.update();

    return this.getModelInfo();
  }

  setModelGeometry(geometry) {
    if (this.modelMesh) {
      if (this.transformControl.object === this.modelMesh) {
        this.transformControl.detach();
      }
      this.scene.remove(this.modelMesh);
      this.modelMesh.geometry.dispose();
      this.modelMesh.material.dispose();
    }

    const material = new THREE.MeshPhongMaterial({
      color: 0x444444, // Preform dark grey
      specular: 0x222222,
      shininess: 30,
      flatShading: false,
    });

    this.modelMesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.modelMesh);

    this.clearSupports();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  getModelInfo() {
    if (!this.modelMesh) return null;
    const bb = this.modelMesh.geometry.boundingBox;
    const size = new THREE.Vector3();
    bb.getSize(size);
    let triCount = this.modelMesh.geometry.attributes.position.count / 3;
    if (this.modelMesh.isInstancedMesh) {
      triCount *= this.modelMesh.count;
    }
    return {
      triangles: triCount,
      width: size.x.toFixed(1),
      height: size.y.toFixed(1),
      depth: size.z.toFixed(1),
      boundingBox: bb,
    };
  }

  getModelGeometry() {
    return this.modelMesh ? this.modelMesh.geometry : null;
  }

  getModelMesh() {
    return this.modelMesh;
  }

  setSupports(supportGeometry) {
    this.clearSupports();
    const material = new THREE.MeshPhongMaterial({
      color: 0x777777,
      specular: 0x222222,
      shininess: 30,
      transparent: true,
      opacity: 0.8,
    });

    if (this.modelMesh && this.modelMesh.isInstancedMesh) {
      this.supportsMesh = new THREE.InstancedMesh(supportGeometry, material, this.modelMesh.count);
      this.supportsMesh.instanceMatrix.copy(this.modelMesh.instanceMatrix);
      this.supportsMesh.instanceMatrix.needsUpdate = true;
    } else {
      this.supportsMesh = new THREE.Mesh(supportGeometry, material);
    }

    this.scene.add(this.supportsMesh);
  }

  clearSupports() {
    if (this.supportsMesh) {
      this.scene.remove(this.supportsMesh);
      this.supportsMesh.geometry.dispose();
      this.supportsMesh.material.dispose();
      this.supportsMesh = null;
    }
  }

  getSupportsMesh() {
    return this.supportsMesh;
  }

  setElevation(elevation) {
    if (this.elevation === elevation) return;
    const deltaY = elevation - this.elevation;
    this.elevation = elevation;
    if (this.modelMesh) {
      this.modelMesh.geometry.translate(0, deltaY, 0);
      this.modelMesh.geometry.computeBoundingBox();
      this.clearSupports();
    }
  }

  applyRotation(quaternion) {
    if (!this.modelMesh) return;
    this.modelMesh.geometry.applyQuaternion(quaternion);
    // Re-center on build plate
    this.modelMesh.geometry.computeBoundingBox();
    const bb = this.modelMesh.geometry.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    this.modelMesh.geometry.translate(-center.x, -bb.min.y + this.elevation, -center.z);
    this.modelMesh.geometry.computeBoundingBox();
    
    this.clearSupports();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  setTransformMode(mode) {
    if (!mode) {
      this.transformControl.detach();
    } else {
      if (this.modelMesh) {
        this.transformControl.attach(this.modelMesh);
        this.transformControl.setMode(mode);
      }
    }
  }

  _bakeTransform() {
    if (!this.modelMesh) return;
    this.modelMesh.updateMatrix();
    this.modelMesh.geometry.applyMatrix4(this.modelMesh.matrix);
    this.modelMesh.position.set(0, 0, 0);
    this.modelMesh.rotation.set(0, 0, 0);
    this.modelMesh.scale.set(1, 1, 1);
    this.modelMesh.updateMatrix();
    this.modelMesh.geometry.computeBoundingBox();
    
    this.clearSupports();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  fillPlatform() {
    if (!this.modelMesh || this.modelMesh.isInstancedMesh) return false;
    const geo = this.modelMesh.geometry;
    geo.computeBoundingBox();
    
    // Bounds of the model
    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    
    // Printer bed bounds
    const maxW = this.printer ? this.printer.buildWidthMM : 130;
    const maxD = this.printer ? this.printer.buildDepthMM : 80;
    
    const padding = 2; // 2mm padding between models
    const itemW = size.x + padding;
    const itemD = size.z + padding;
    
    const countX = Math.floor(maxW / itemW);
    const countZ = Math.floor(maxD / itemD);
    
    if (countX <= 1 && countZ <= 1) {
      // It's too big to duplicate, cannot fill
      return false;
    }
    
    const totalCount = countX * countZ;
    
    // Calculate start offset to center the grid
    const totalW = countX * itemW - padding;
    const totalD = countZ * itemD - padding;
    
    const startX = -totalW / 2 + itemW / 2;
    const startZ = -totalD / 2 + itemD / 2;
    
    // Align geometry to exactly 0,0 for X and Z temporarily:
    const center = new THREE.Vector3();
    geo.boundingBox.getCenter(center);
    geo.translate(-center.x, 0, -center.z);
    geo.computeBoundingBox();

    const material = this.modelMesh.material;
    const instancedMesh = new THREE.InstancedMesh(geo, material, totalCount);
    
    const dummy = new THREE.Object3D();
    let idx = 0;
    
    for (let i = 0; i < countX; i++) {
      for (let j = 0; j < countZ; j++) {
        const px = startX + i * itemW;
        const pz = startZ + j * itemD;
        
        dummy.position.set(px, 0, pz);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(idx++, dummy.matrix);
      }
    }
    
    instancedMesh.instanceMatrix.needsUpdate = true;
    
    if (this.transformControl.object === this.modelMesh) {
      this.transformControl.detach();
    }
    this.scene.remove(this.modelMesh);
    
    this.modelMesh = instancedMesh;
    this.scene.add(this.modelMesh);
    
    this.clearSupports();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    return true;
  }
}
