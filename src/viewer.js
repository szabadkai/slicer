import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { computeMeshVolume } from './volume.js';

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.objects = [];
    this.selected = [];
    this.printer = null;
    this.gridGroup = null;
    this.undoStack = [];
    this.clipboard = [];
    this.MAX_UNDO = 30;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f2f5);

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

    this.raycaster = new THREE.Raycaster();
    this.pointerDown = new THREE.Vector2();
    this.canvas.addEventListener('pointerdown', (e) => {
      this.pointerDown.set(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const dist = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
      if (dist < 5 && !this.transformControl.dragging) {
        this._onClick(e);
      }
    });

    this._setupLights();
    this._setupGrid();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._animate();
  }

  _onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera({x, y}, this.camera);
    const meshes = this.objects.map(o => o.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, false);

    const multi = e.shiftKey || e.ctrlKey || e.metaKey;

    if (intersects.length > 0) {
      const id = intersects[0].object.userData.id;
      if (multi) {
        this.toggleSelection(id);
      } else {
        this.selectObject(id);
      }
    } else {
      if (!multi) {
        this.clearSelection();
      }
    }
  }

  clearSelection() {
    this.selected = [];
    this._attachTransformControls();
    this._updateSelectionVisuals();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  }

  toggleSelection(id) {
    const idx = this.selected.findIndex(o => o.id === id);
    if (idx !== -1) {
      this.selected.splice(idx, 1);
    } else {
      const obj = this.objects.find(o => o.id === id);
      if (obj) this.selected.push(obj);
    }
    this._attachTransformControls();
    this._updateSelectionVisuals();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  }

  selectObject(id) {
    if (!id) {
      this.clearSelection();
      return;
    }
    const obj = this.objects.find(o => o.id === id);
    if (obj) {
      this.selected = [obj];
    } else {
      this.selected = [];
    }
    this._attachTransformControls();
    this._updateSelectionVisuals();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  }

  selectAll() {
    this.selected = [...this.objects];
    this._attachTransformControls();
    this._updateSelectionVisuals();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
  }

  _attachTransformControls() {
    if (this.selected.length === 1) {
      this.transformControl.attach(this.selected[0].mesh);
      if (!this.transformControl.getMode()) {
        this.transformControl.setMode('translate');
      }
    } else {
      this.transformControl.detach();
    }
  }

  _recenterMeshOrigin(mesh) {
    mesh.geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    mesh.geometry.boundingBox.getCenter(center);
    if (center.lengthSq() === 0) return;

    mesh.geometry.translate(-center.x, -center.y, -center.z);
    mesh.position.add(center);
    mesh.geometry.computeBoundingBox();
    mesh.updateMatrixWorld(true);
  }

  _updateSelectionVisuals() {
    const selectedIds = new Set(this.selected.map(o => o.id));
    this.objects.forEach(o => {
      if (selectedIds.has(o.id)) {
         o.mesh.material.emissive.setHex(0x333333);
      } else {
         o.mesh.material.emissive.setHex(0x000000);
      }
    });
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
    
    if (this.objects.length === 0) {
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

    const plateThickness = 1;
    const plateGeo = new THREE.BoxGeometry(w, plateThickness, d);
    const plateMat = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x111111, shininess: 5 });
    const plateMesh = new THREE.Mesh(plateGeo, plateMat);
    plateMesh.position.y = -plateThickness / 2;
    this.gridGroup.add(plateMesh);

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
    gridGeo.translate(0, 0.01, 0);
    
    const gridMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7 });
    const gridLines = new THREE.LineSegments(gridGeo, gridMat);
    this.gridGroup.add(gridLines);

    const volGeo = new THREE.BoxGeometry(w, h, d);
    volGeo.translate(0, h / 2, 0);
    
    const volMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false });
    const volMesh = new THREE.Mesh(volGeo, volMat);
    this.gridGroup.add(volMesh);
    
    const edges = new THREE.EdgesGeometry(volGeo);
    const volLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.4 }));
    this.gridGroup.add(volLines);
    this.buildVolumeEdges = volLines;
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

  loadSTL(buffer, scale = 1) {
    const loader = new STLLoader();
    const geometry = loader.parse(buffer);
    if (scale !== 1) {
      geometry.scale(scale, scale, scale);
    }
    geometry.computeBoundingBox();
    geometry.computeVertexNormals();

    const defaultElevation = 5;
    const bb = geometry.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    geometry.translate(-center.x, -bb.min.y + defaultElevation, -center.z);
    geometry.computeBoundingBox();

    this.addModel(geometry, defaultElevation);

    if (this.objects.length === 1) {
        const size = new THREE.Vector3();
        geometry.boundingBox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z);
        this.camera.position.set(maxDim, maxDim * 0.8, maxDim);
        this.controls.target.set(0, size.y / 2, 0);
        this.controls.update();
    }
  }

  _addModelRaw(geometry, material, elevation) {
    if (!material) {
      material = new THREE.MeshPhongMaterial({
        color: 0x4a90d9,
        specular: 0x222222,
        shininess: 30,
        flatShading: false,
      });
    }
    const mesh = new THREE.Mesh(geometry, material);
    const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    mesh.userData.id = id;
    this.scene.add(mesh);
    const obj = { id, mesh, supportsMesh: null, elevation };
    this.objects.push(obj);
    return obj;
  }

  addModel(geometry, elevation = 5) {
    const obj = this._addModelRaw(geometry, null, elevation);
    this._recenterMeshOrigin(obj.mesh);
    this.selectObject(obj.id);
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    return obj;
  }

  removeSelected() {
    if (this.selected.length === 0) return;
    this._saveUndoState();
    this.transformControl.detach();
    const selectedIds = new Set(this.selected.map(s => s.id));
    this.objects.forEach(o => {
      if (selectedIds.has(o.id)) {
        this.scene.remove(o.mesh);
        o.mesh.geometry.dispose();
        o.mesh.material.dispose();
        if (o.supportsMesh) {
          this.scene.remove(o.supportsMesh);
          o.supportsMesh.geometry.dispose();
          o.supportsMesh.material.dispose();
        }
      }
    });
    this.objects = this.objects.filter(o => !selectedIds.has(o.id));
    this.selected = [];
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  clearPlate() {
    if (this.objects.length === 0) return;
    this._saveUndoState();
    this.transformControl.detach();
    this.objects.forEach(o => {
      this.scene.remove(o.mesh);
      o.mesh.geometry.dispose();
      o.mesh.material.dispose();
      if (o.supportsMesh) {
        this.scene.remove(o.supportsMesh);
        o.supportsMesh.geometry.dispose();
        o.supportsMesh.material.dispose();
      }
    });
    this.objects = [];
    this.selected = [];
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  duplicateSelected() {
    if (this.selected.length === 0) return;
    this._saveUndoState();
    this._bakeTransform();
    
    const newSelected = [];
    this.selected.forEach(sel => {
      const newObj = this._addModelRaw(sel.mesh.geometry, sel.mesh.material, sel.elevation);
      newObj.mesh.position.copy(sel.mesh.position);
      newObj.mesh.position.x += 10;
      newObj.mesh.position.z += 10;
      newObj.mesh.updateMatrixWorld();
      newSelected.push(newObj);
    });
    this.selected = newSelected;
    this._attachTransformControls();
    this._updateSelectionVisuals();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  getOverallInfo() {
    if (this.objects.length === 0) return null;
    let tris = 0;
    let modelVolume = 0;
    let supportVolume = 0;
    const bb = new THREE.Box3();
    this.objects.forEach(o => {
        tris += o.mesh.geometry.attributes.position.count / 3;
        o.mesh.updateMatrixWorld();
        const obb = o.mesh.geometry.boundingBox.clone();
        obb.applyMatrix4(o.mesh.matrixWorld);
        bb.union(obb);

        // Cache local-space mesh volume per object; multiply by det(world) so
        // translation/rotation are free, and only re-traverse triangles when
        // geometry changes (e.g. on _bakeTransform, which clears the cache).
        if (o._cachedLocalVolume === undefined) {
          o._cachedLocalVolume = computeMeshVolume(o.mesh.geometry);
        }
        modelVolume += o._cachedLocalVolume * Math.abs(o.mesh.matrixWorld.determinant());

        if (o.supportsMesh) {
          if (o._cachedLocalSupportVolume === undefined) {
            o._cachedLocalSupportVolume = computeMeshVolume(o.supportsMesh.geometry);
          }
          o.supportsMesh.updateMatrixWorld();
          supportVolume += o._cachedLocalSupportVolume * Math.abs(o.supportsMesh.matrixWorld.determinant());
        }
    });
    const size = new THREE.Vector3();
    bb.getSize(size);
    return {
        triangles: tris,
        width: size.x.toFixed(1),
        height: size.y.toFixed(1),
        depth: size.z.toFixed(1),
        count: this.objects.length,
        modelVolume,    // mm³
        supportVolume,  // mm³
    };
  }

  checkBounds() {
    if (!this.printer || this.objects.length === 0) return { inBounds: true };

    const bb = new THREE.Box3();
    this.objects.forEach(o => {
      o.mesh.updateMatrixWorld();
      const obb = o.mesh.geometry.boundingBox.clone();
      obb.applyMatrix4(o.mesh.matrixWorld);
      bb.union(obb);
    });

    const halfW = this.printer.buildWidthMM / 2;
    const halfD = this.printer.buildDepthMM / 2;
    const maxH = this.printer.buildHeightMM;

    const inBounds = (
      bb.min.x >= -halfW && bb.max.x <= halfW &&
      bb.min.z >= -halfD && bb.max.z <= halfD &&
      bb.max.y <= maxH
    );

    return { inBounds };
  }

  updateBoundsWarning() {
    if (!this.buildVolumeEdges) return;
    const { inBounds } = this.checkBounds();
    this.buildVolumeEdges.material.color.setHex(inBounds ? 0x888888 : 0xff4444);
    this.buildVolumeEdges.material.opacity = inBounds ? 0.4 : 0.8;
  }

  getModelGeometry() {
    if (this.selected.length !== 1) return null;
    const mesh = this.selected[0].mesh;
    const geometry = mesh.geometry.clone();
    mesh.updateMatrix();
    geometry.applyMatrix4(mesh.matrix);
    geometry.computeBoundingBox();
    return geometry;
  }

  getModelMesh() {
    return this.selected.length === 1 ? this.selected[0].mesh : null;
  }

  getMergedModelGeometry() {
    if (this.objects.length === 0) return null;
    const geos = [];
    this.objects.forEach(o => {
      const g = o.mesh.geometry.clone();
      o.mesh.updateMatrix();
      g.applyMatrix4(o.mesh.matrix);
      geos.push(g);
    });
    if(geos.length === 1) return geos[0];
    return BufferGeometryUtils.mergeGeometries(geos, false);
  }

  getMergedSupportGeometry() {
    const geos = [];
    this.objects.forEach(o => {
      if (o.supportsMesh) {
        const g = o.supportsMesh.geometry.clone();
        o.supportsMesh.updateMatrix();
        g.applyMatrix4(o.supportsMesh.matrix);
        geos.push(g);
      }
    });
    if(geos.length === 0) return null;
    if(geos.length === 1) return geos[0];
    return BufferGeometryUtils.mergeGeometries(geos, false);
  }

  setSupports(supportGeometry) {
    if (this.selected.length !== 1) return;
    this.clearSupports();
    const material = new THREE.MeshPhongMaterial({
      color: 0x9b59b6,
      specular: 0x222222,
      shininess: 30,
      transparent: true,
      opacity: 0.55,
    });

    const mesh = new THREE.Mesh(supportGeometry, material);
    this.selected[0].supportsMesh = mesh;
    this.selected[0]._cachedLocalSupportVolume = undefined;
    this.scene.add(mesh);
  }

  clearSupports() {
    this.selected.forEach(sel => {
      if (sel.supportsMesh) {
        this.scene.remove(sel.supportsMesh);
        sel.supportsMesh.geometry.dispose();
        sel.supportsMesh.material.dispose();
        sel.supportsMesh = null;
      }
      sel._cachedLocalSupportVolume = undefined;
    });
  }

  getSupportsMesh() {
    return this.selected.length === 1 ? this.selected[0].supportsMesh : null;
  }

  setElevation(elevation) {
    if (this.selected.length === 0) return;
    this.selected.forEach(sel => {
        if (sel.elevation === elevation) return;
        sel.elevation = elevation;
        sel.mesh.geometry.computeBoundingBox();
        sel.mesh.position.y = elevation - sel.mesh.geometry.boundingBox.min.y;
        sel.mesh.updateMatrixWorld(true);
    });
    this.clearSupports();
  }

  applyRotation(quaternion) {
    if (this.selected.length !== 1) return;
    const sel = this.selected[0];
    sel.mesh.geometry.applyQuaternion(quaternion);
    sel.mesh.geometry.computeBoundingBox();
    const bb = sel.mesh.geometry.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    sel.mesh.geometry.translate(-center.x, -center.y, -center.z);
    sel.mesh.geometry.computeBoundingBox();
    sel.mesh.position.x += center.x;
    sel.mesh.position.z += center.z;
    sel.mesh.position.y = sel.elevation - sel.mesh.geometry.boundingBox.min.y;
    sel.mesh.updateMatrixWorld(true);
    
    this.clearSupports();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  setTransformMode(mode) {
    if (!mode) {
       this.transformControl.detach();
    } else {
       if (this.selected.length === 1) {
           this.transformControl.attach(this.selected[0].mesh);
           this.transformControl.setMode(mode);
       } else if (this.objects.length > 0 && this.selected.length === 0) {
           this.selectObject(this.objects[0].id);
           this.transformControl.setMode(mode);
       }
    }
  }

  _bakeTransform() {
    if (this.selected.length !== 1) return;
    const sel = this.selected[0];
    const smesh = sel.mesh;
    smesh.updateMatrix();
    smesh.geometry.applyMatrix4(smesh.matrix);
    smesh.position.set(0, 0, 0);
    smesh.rotation.set(0, 0, 0);
    smesh.scale.set(1, 1, 1);
    smesh.updateMatrix();
    smesh.geometry.computeBoundingBox();
    this._recenterMeshOrigin(smesh);
    sel._cachedLocalVolume = undefined;

    this.clearSupports();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  _saveUndoState() {
    const snapshot = this.objects.map(o => ({
      geometry: o.mesh.geometry.clone(),
      material: o.mesh.material.clone(),
      position: o.mesh.position.clone(),
      rotation: o.mesh.rotation.clone(),
      scale: o.mesh.scale.clone(),
      elevation: o.elevation,
    }));
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.MAX_UNDO) {
      this.undoStack.shift();
    }
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const snapshot = this.undoStack.pop();

    // Clear current scene
    this.transformControl.detach();
    this.objects.forEach(o => {
      this.scene.remove(o.mesh);
      o.mesh.geometry.dispose();
      o.mesh.material.dispose();
      if (o.supportsMesh) {
        this.scene.remove(o.supportsMesh);
        o.supportsMesh.geometry.dispose();
        o.supportsMesh.material.dispose();
      }
    });
    this.objects = [];
    this.selected = [];

    // Restore from snapshot
    snapshot.forEach(s => {
      const mesh = new THREE.Mesh(s.geometry, s.material);
      mesh.position.copy(s.position);
      mesh.rotation.copy(s.rotation);
      mesh.scale.copy(s.scale);
      const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      mesh.userData.id = id;
      this.scene.add(mesh);
      this.objects.push({ id, mesh, supportsMesh: null, elevation: s.elevation });
    });

    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  copySelected() {
    if (this.selected.length === 0) return;
    this.clipboard = this.selected.map(sel => ({
      geometry: sel.mesh.geometry.clone(),
      material: sel.mesh.material.clone(),
      position: sel.mesh.position.clone(),
      elevation: sel.elevation,
    }));
  }

  paste() {
    if (this.clipboard.length === 0) return;
    this._saveUndoState();
    const newSelected = [];
    this.clipboard.forEach(item => {
      const geo = item.geometry.clone();
      const mat = item.material.clone();
      const obj = this._addModelRaw(geo, mat, item.elevation);
      obj.mesh.position.copy(item.position);
      obj.mesh.position.x += 10;
      obj.mesh.position.z += 10;
      obj.mesh.updateMatrixWorld();
      newSelected.push(obj);
    });
    this.selected = newSelected;
    this._attachTransformControls();
    this._updateSelectionVisuals();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  fillPlatform() {
    if (this.selected.length !== 1 || !this.printer) return false;
    this._saveUndoState();
    this._bakeTransform();

    const sel = this.selected[0];
    const sourceGeo = sel.mesh.geometry;
    sourceGeo.computeBoundingBox();
    const size = new THREE.Vector3();
    sourceGeo.boundingBox.getSize(size);

    const maxW = this.printer.buildWidthMM;
    const maxD = this.printer.buildDepthMM;
    
    const padding = 2;
    const itemW = size.x + padding;
    const itemD = size.z + padding;
    
    const countX = Math.floor(maxW / itemW);
    const countZ = Math.floor(maxD / itemD);
    
    if (countX <= 1 && countZ <= 1) {
      return false;
    }
    
    const totalW = countX * itemW - padding;
    const totalD = countZ * itemD - padding;
    
    const startX = -totalW / 2 + itemW / 2;
    const startZ = -totalD / 2 + itemD / 2;
    
    const center = new THREE.Vector3();
    sourceGeo.boundingBox.getCenter(center);
    
    // Instead of translating the source geometry, we leave it untouched
    // and reposition all models via `mesh.position` during cloning loop.
    const sourceElevation = sel.elevation;
    const sharedMaterial = sel.mesh.material;
    
    // Keep internal transform centering identical to what we had before replacing.
    sourceGeo.translate(-center.x, 0, -center.z);
    sourceGeo.computeBoundingBox();
    
    this.removeSelected();
    
    for (let i = 0; i < countX; i++) {
      for (let j = 0; j < countZ; j++) {
        const px = startX + i * itemW;
        const pz = startZ + j * itemD;
        
        const newObj = this._addModelRaw(sourceGeo, sharedMaterial, sourceElevation);
        newObj.mesh.position.set(px, 0, pz);
        newObj.mesh.updateMatrixWorld();
      }
    }
    
    this.clearSelection();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    return true;
  }
}
