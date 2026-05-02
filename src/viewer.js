import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { computeMeshVolume } from './volume.js';
import { DEFAULT_RESIN_MATERIAL_ID, RESIN_MATERIALS } from './materials.js';

const DEFAULT_RESIN_MATERIAL = RESIN_MATERIALS.find(m => m.id === DEFAULT_RESIN_MATERIAL_ID) || RESIN_MATERIALS[0];
const STATIC_PIXEL_RATIO_CAP = 1.5;
const INTERACTIVE_PIXEL_RATIO_CAP = 1.25;

export function createResinMaterial(preset = DEFAULT_RESIN_MATERIAL) {
  const isTransparent = preset.opacity < 1;
  return new THREE.MeshPhysicalMaterial({
    color: preset.color,
    roughness: preset.roughness,
    metalness: preset.metalness,
    transparent: isTransparent,
    opacity: preset.opacity,
    depthWrite: preset.opacity >= 0.55,
    transmission: preset.transmission,
    thickness: preset.transmission > 0 ? 0.8 : 0,
    ior: preset.ior,
  });
}

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.objects = [];
    this.selected = [];
    this.activePlate = { objects: this.objects, selectedIds: [] };
    this.plates = [this.activePlate];
    this.printer = null;
    this.gridGroup = null;
    this.undoStack = [];
    this.clipboard = [];
    this.MAX_UNDO = 30;
    this.defaultMaterialPreset = DEFAULT_RESIN_MATERIAL;
    this.selectionPivot = new THREE.Object3D();
    this.multiTransformState = null;
    this.transformSupportState = null;
    this.facePickMode = false;
    this.significantFaceHighlights = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f2f5);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      stencil: false,
      powerPreference: 'low-power',
    });
    this.renderPixelRatio = 0;
    this._setRenderPixelRatio(STATIC_PIXEL_RATIO_CAP);
    this.renderer.sortObjects = true;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.camera.position.set(100, 100, 100);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener('start', () => {
      this.isUserInteracting = true;
      this._setRenderPixelRatio(INTERACTIVE_PIXEL_RATIO_CAP);
      this.requestRender();
    });
    this.controls.addEventListener('end', () => {
      this.isUserInteracting = false;
      this._setRenderPixelRatio(STATIC_PIXEL_RATIO_CAP);
      this.requestRender();
    });
    this.controls.addEventListener('change', () => this.requestRender());

    this.transformControl = new TransformControls(this.camera, canvas);
    this.scene.add(this.selectionPivot);
    this.transformControl.addEventListener('change', () => {
      this._applyMultiTransformDelta();
      this._syncSupportsDuringHorizontalTranslation();
      this.requestRender();
    });
    this.transformControl.addEventListener('dragging-changed', (event) => {
      if (event.value) {
        this._beginMultiTransform();
        this._beginTransformSupportSync();
      }
      this.controls.enabled = !event.value;
      this.isUserInteracting = event.value;
      this._setRenderPixelRatio(event.value ? INTERACTIVE_PIXEL_RATIO_CAP : STATIC_PIXEL_RATIO_CAP);
      this.requestRender();
    });
    this.transformControl.addEventListener('mouseUp', () => {
      const preserveSupports = this._canPreserveSupportsAfterHorizontalTranslation();
      this._bakeTransform({ preserveSupports });
      this.transformSupportState = null;
      this._reassignObjectsToPlates();
    });
    this.scene.add(this.transformControl.getHelper());

    this.raycaster = new THREE.Raycaster();
    this.pointerDown = new THREE.Vector2();
    this.renderRequested = false;
    this.isUserInteracting = false;
    this.fpsElement = document.getElementById('fps-counter');
    this.fpsFrames = 0;
    this.fpsWindowStart = performance.now();
    this.fpsIdleTimer = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.pointerDown.set(e.clientX, e.clientY);
      this.requestRender();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      const dist = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
      if (dist < 5 && !this.transformControl.dragging) {
        this._onClick(e);
      }
      this.requestRender();
    });
    this.canvas.addEventListener('mesh-changed', () => this.requestRender());
    this.canvas.addEventListener('selection-changed', () => {
      this._saveActivePlateSelection();
      this.requestRender();
    });
    this.canvas.addEventListener('material-changed', () => this.requestRender());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.requestRender();
    });

    this._setupLights();
    this._setupGrid();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this.requestRender();
  }

  _setObjectSceneVisible(obj, visible) {
    const sceneObjects = [obj.mesh, obj.supportsMesh].filter(Boolean);
    sceneObjects.forEach(mesh => {
      if (visible && !mesh.parent) {
        this.scene.add(mesh);
      } else if (!visible && mesh.parent === this.scene) {
        this.scene.remove(mesh);
      }
    });
  }

  _saveActivePlateSelection() {
    if (!this.activePlate) return;
    this.activePlate.selectedIds = this.selected.map(obj => obj.id);
  }

  setActivePlate(plate) {
    if (!plate || plate === this.activePlate) return;
    this._saveActivePlateSelection();
    this.transformControl.detach();

    this.activePlate = plate;
    this.objects = plate.objects;
    const selectedIds = new Set(plate.selectedIds || []);
    this.selected = this.objects.filter(obj => selectedIds.has(obj.id));
    this._attachTransformControls();
    this._updateSelectionVisuals();
    this._setupGrid();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('plate-changed', { detail: { plate } }));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed', { detail: { preserveSlice: true } }));
    this.requestRender();
  }

  bindInitialPlate(plate) {
    this.activePlate = plate;
    this.plates = [plate];
    this.objects = plate.objects;
    this.selected = [];
    this._setupGrid();
  }

  setPlates(plates) {
    this.plates = plates;
    this._setupGrid();
    plates.forEach(plate => {
      plate.objects.forEach(obj => this._setObjectSceneVisible(obj, true));
    });
    this._updateSelectionVisuals();
  }

  frameAllPlates() {
    if (!this.printer || !this.plates?.length) return;
    const bounds = new THREE.Box3();
    const halfW = this.printer.buildWidthMM / 2;
    const halfD = this.printer.buildDepthMM / 2;
    this.plates.forEach(plate => {
      bounds.expandByPoint(new THREE.Vector3((plate.originX || 0) - halfW, 0, (plate.originZ || 0) - halfD));
      bounds.expandByPoint(new THREE.Vector3((plate.originX || 0) + halfW, this.printer.buildHeightMM, (plate.originZ || 0) + halfD));
    });
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bounds.getCenter(center);
    bounds.getSize(size);
    const maxDim = Math.max(size.x, size.z, size.y);
    this.camera.position.set(center.x + maxDim * 0.75, Math.max(maxDim * 0.7, this.printer.buildHeightMM), center.z + maxDim * 0.75);
    this.controls.target.copy(center);
    this.controls.update();
    this.requestRender();
  }

  getAllObjects() {
    return this.plates.flatMap(plate => plate.objects);
  }

  getPlateForObject(objectId) {
    return this.plates.find(plate => plate.objects.some(obj => obj.id === objectId)) || null;
  }

  getActivePlateOrigin() {
    return new THREE.Vector3(this.activePlate?.originX || 0, 0, this.activePlate?.originZ || 0);
  }

  duplicateObjectsForPlate(objects = this.objects) {
    return objects.map(source => {
      const mesh = new THREE.Mesh(source.mesh.geometry.clone(), source.mesh.material.clone());
      mesh.position.copy(source.mesh.position);
      mesh.rotation.copy(source.mesh.rotation);
      mesh.scale.copy(source.mesh.scale);
      const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      mesh.userData.id = id;
      mesh.updateMatrixWorld(true);

      let supportsMesh = null;
      if (source.supportsMesh) {
        supportsMesh = new THREE.Mesh(source.supportsMesh.geometry.clone(), source.supportsMesh.material.clone());
        supportsMesh.position.copy(source.supportsMesh.position);
        supportsMesh.rotation.copy(source.supportsMesh.rotation);
        supportsMesh.scale.copy(source.supportsMesh.scale);
        supportsMesh.updateMatrixWorld(true);
      }

      return {
        id,
        mesh,
        supportsMesh,
        elevation: source.elevation,
        materialPreset: source.materialPreset || DEFAULT_RESIN_MATERIAL,
      };
    });
  }

  moveSelectedToPlate(targetPlate, { selectMoved = true } = {}) {
    if (!targetPlate || targetPlate === this.activePlate || this.selected.length === 0) return [];
    this._saveUndoState();
    const movingIds = new Set(this.selected.map(obj => obj.id));
    const moving = this.objects.filter(obj => movingIds.has(obj.id));
    this.objects = this.objects.filter(obj => !movingIds.has(obj.id));
    this.activePlate.objects = this.objects;
    this.activePlate.selectedIds = [];
    const dx = (targetPlate.originX || 0) - (this.activePlate.originX || 0);
    const dz = (targetPlate.originZ || 0) - (this.activePlate.originZ || 0);
    moving.forEach(obj => {
      obj.mesh.position.x += dx;
      obj.mesh.position.z += dz;
      if (obj.supportsMesh) {
        obj.supportsMesh.position.x += dx;
        obj.supportsMesh.position.z += dz;
      }
    });
    targetPlate.objects.push(...moving);
    targetPlate.selectedIds = selectMoved ? moving.map(obj => obj.id) : [];
    this.selected = [];
    this.transformControl.detach();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    return moving;
  }

  replaceActiveObjects(objects) {
    this.transformControl.detach();
    this.objects.forEach(obj => this._setObjectSceneVisible(obj, false));
    this.objects = objects;
    this.activePlate.objects = objects;
    this.selected = [];
    this.activePlate.selectedIds = [];
    this.objects.forEach(obj => this._setObjectSceneVisible(obj, true));
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    this.requestRender();
  }

  _onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera({x, y}, this.camera);
    const meshes = this.getAllObjects().map(o => o.mesh);
    const intersects = this.raycaster.intersectObjects(meshes, false);

    const multi = e.shiftKey || e.ctrlKey || e.metaKey;

    if (intersects.length > 0) {
      const hit = intersects[0];
      const id = hit.object.userData.id;
      const hitPlate = this.getPlateForObject(id);
      if (hitPlate && hitPlate !== this.activePlate) {
        this.setActivePlate(hitPlate);
      }
      if (this.facePickMode) {
        this.selectObject(id);
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
        if (normal.dot(this.raycaster.ray.direction) > 0) {
          normal.multiplyScalar(-1);
        }
        const point = hit.point.clone();
        this.canvas.dispatchEvent(new CustomEvent('protected-face-picked', {
          detail: { objectId: id, point, normal },
        }));
        this.setFacePickMode(false);
        return;
      }
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

  setFacePickMode(enabled) {
    this.facePickMode = enabled;
    this.canvas.classList.toggle('face-pick-mode', enabled);
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

  selectObjects(ids) {
    const idSet = new Set(ids);
    this.selected = this.objects.filter(o => idSet.has(o.id));
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
    } else if (this.selected.length > 1) {
      this._positionSelectionPivot();
      this.transformControl.attach(this.selectionPivot);
      if (!this.transformControl.getMode()) {
        this.transformControl.setMode('translate');
      }
    } else {
      this.transformControl.detach();
    }
  }

  _getSelectionBounds() {
    const bounds = new THREE.Box3();
    this.selected.forEach(sel => {
      sel.mesh.geometry.computeBoundingBox();
      sel.mesh.updateMatrixWorld(true);
      bounds.union(sel.mesh.geometry.boundingBox.clone().applyMatrix4(sel.mesh.matrixWorld));
    });
    return bounds;
  }

  _positionSelectionPivot() {
    if (this.selected.length <= 1) return;
    const center = new THREE.Vector3();
    this._getSelectionBounds().getCenter(center);
    this.selectionPivot.position.copy(center);
    this.selectionPivot.rotation.set(0, 0, 0);
    this.selectionPivot.scale.set(1, 1, 1);
    this.selectionPivot.updateMatrixWorld(true);
  }

  _beginMultiTransform() {
    if (this.selected.length <= 1) {
      this.multiTransformState = null;
      return;
    }
    this.selectionPivot.updateMatrixWorld(true);
    this.multiTransformState = {
      pivotMatrix: this.selectionPivot.matrixWorld.clone(),
      objectMatrices: this.selected.map(sel => {
        sel.mesh.updateMatrixWorld(true);
        return {
          sel,
          matrix: sel.mesh.matrixWorld.clone(),
        };
      }),
    };
  }

  _applyMultiTransformDelta() {
    if (!this.multiTransformState || this.selected.length <= 1 || !this.transformControl.dragging) return;

    this.selectionPivot.updateMatrixWorld(true);
    const inverseStart = this.multiTransformState.pivotMatrix.clone().invert();
    const delta = this.selectionPivot.matrixWorld.clone().multiply(inverseStart);
    this._applyMatrixToSelection(delta, this.multiTransformState.objectMatrices);

    this.canvas.dispatchEvent(new CustomEvent('mesh-transforming'));
  }

  _applyMatrixToSelection(delta, objectMatrices = null) {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const targets = objectMatrices || this.selected.map(sel => {
      sel.mesh.updateMatrixWorld(true);
      return { sel, matrix: sel.mesh.matrixWorld.clone() };
    });

    targets.forEach(({ sel, matrix }) => {
      const nextMatrix = delta.clone().multiply(matrix);
      nextMatrix.decompose(position, quaternion, scale);
      sel.mesh.position.copy(position);
      sel.mesh.quaternion.copy(quaternion);
      sel.mesh.scale.copy(scale);
      sel.mesh.updateMatrixWorld(true);
    });
  }

  _beginTransformSupportSync() {
    if (this.transformControl.getMode?.() !== 'translate') {
      this.transformSupportState = null;
      return;
    }

    const items = this.selected
      .filter(sel => sel.supportsMesh)
      .map(sel => ({
        sel,
        meshPosition: sel.mesh.position.clone(),
        supportPosition: sel.supportsMesh.position.clone(),
      }));

    this.transformSupportState = items.length > 0 ? { items } : null;
  }

  _syncSupportsDuringHorizontalTranslation() {
    if (!this.transformSupportState || !this.transformControl.dragging) return;

    this.transformSupportState.items.forEach(({ sel, meshPosition, supportPosition }) => {
      if (!sel.supportsMesh) return;
      const dx = sel.mesh.position.x - meshPosition.x;
      const dz = sel.mesh.position.z - meshPosition.z;
      sel.supportsMesh.position.x = supportPosition.x + dx;
      sel.supportsMesh.position.z = supportPosition.z + dz;
    });
  }

  _canPreserveSupportsAfterHorizontalTranslation() {
    if (!this.transformSupportState || this.transformControl.getMode?.() !== 'translate') return false;
    const EPSILON = 1e-6;
    return this.transformSupportState.items.every(({ sel, meshPosition }) =>
      Math.abs(sel.mesh.position.y - meshPosition.y) <= EPSILON
    );
  }

  getSelectionWorldSize() {
    if (this.selected.length === 0) return null;
    const size = new THREE.Vector3();
    this._getSelectionBounds().getSize(size);
    return size;
  }

  getSelectionWorldCenter() {
    if (this.selected.length === 0) return null;
    const center = new THREE.Vector3();
    this._getSelectionBounds().getCenter(center);
    return center;
  }

  translateSelectionTo(position) {
    if (this.selected.length === 0) return;
    const currentCenter = this.selected.length > 1 ? this.getSelectionWorldCenter() : null;
    const currentPosition = this.selected.length === 1 ? this.selected[0].mesh.position : currentCenter;
    const supportMoves = this.selected
      .filter(sel => sel.supportsMesh)
      .map(sel => ({
        sel,
        dx: position.x - currentPosition.x,
        dz: position.z - currentPosition.z,
      }));
    const preserveSupports = Math.abs(position.y - currentPosition.y) <= 1e-6;
    if (this.selected.length === 1) {
      this.selected[0].mesh.position.copy(position);
    } else {
      const delta = new THREE.Matrix4().makeTranslation(
        position.x - currentCenter.x,
        position.y - currentCenter.y,
        position.z - currentCenter.z,
      );
      this._applyMatrixToSelection(delta);
    }
    if (preserveSupports) {
      supportMoves.forEach(({ sel, dx, dz }) => {
        if (!sel.supportsMesh) return;
        sel.supportsMesh.position.x += dx;
        sel.supportsMesh.position.z += dz;
      });
    }
    this._bakeTransform({ preserveSupports });
  }

  scaleSelectionBy(scale) {
    if (this.selected.length === 0) return;
    if (this.selected.length === 1) {
      this.selected[0].mesh.scale.set(scale.x, scale.y, scale.z);
    } else {
      const center = this.getSelectionWorldCenter();
      const delta = new THREE.Matrix4()
        .makeTranslation(center.x, center.y, center.z)
        .multiply(new THREE.Matrix4().makeScale(scale.x, scale.y, scale.z))
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
      this._applyMatrixToSelection(delta);
    }
    this._bakeTransform();
  }

  rotateSelectionBy(rotation) {
    if (this.selected.length === 0) return;
    if (this.selected.length === 1) {
      this.selected[0].mesh.rotation.copy(rotation);
    } else {
      const center = this.getSelectionWorldCenter();
      const delta = new THREE.Matrix4()
        .makeTranslation(center.x, center.y, center.z)
        .multiply(new THREE.Matrix4().makeRotationFromEuler(rotation))
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
      this._applyMatrixToSelection(delta);
    }
    this._bakeTransform();
  }

  _moveMeshOriginToBoundsMin(mesh) {
    mesh.geometry.computeBoundingBox();
    const min = mesh.geometry.boundingBox.min.clone();
    if (min.lengthSq() === 0) return;

    mesh.geometry.translate(-min.x, -min.y, -min.z);
    mesh.position.add(min);
    mesh.geometry.computeBoundingBox();
    mesh.updateMatrixWorld(true);
  }

  _updateSelectionVisuals() {
    const selectedIds = new Set(this.selected.map(o => o.id));
    this.getAllObjects().forEach(o => {
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

  getActiveMaterialPreset() {
    const obj = this.selected[0] || this.objects[0];
    return obj?.materialPreset || this.defaultMaterialPreset || DEFAULT_RESIN_MATERIAL;
  }

  setDefaultMaterialPreset(preset) {
    if (preset) this.defaultMaterialPreset = preset;
  }

  setMaterialPreset(preset, target = 'selection') {
    if (!preset) return;
    const targets = target === 'all' || this.selected.length === 0 ? this.objects : this.selected;
    targets.forEach(obj => {
      const previousMaterial = obj.mesh.material;
      obj.mesh.material = createResinMaterial(preset);
      obj.materialPreset = preset;
      previousMaterial?.dispose?.();
    });
    this._updateSelectionVisuals();
    this.canvas.dispatchEvent(new CustomEvent('material-changed', { detail: { preset, target } }));
  }

  setPrinter(spec) {
    this.printer = spec;
    this._setupGrid();

    if (this.objects.length === 0) {
      const maxDim = Math.max(spec.buildWidthMM, spec.buildHeightMM, spec.buildDepthMM);
      this.camera.position.set(maxDim * 0.8, maxDim * 0.8, maxDim * 0.8);
        this.controls.target.set(this.activePlate?.originX || 0, spec.buildHeightMM / 2, this.activePlate?.originZ || 0);
      this.controls.update();
    }
    this.requestRender();
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
    this.buildVolumeEdges = [];
    const plates = this.plates?.length ? this.plates : [this.activePlate];

    plates.forEach(plate => {
      const originX = plate.originX || 0;
      const originZ = plate.originZ || 0;

      const plateThickness = 1;
      const plateGeo = new THREE.BoxGeometry(w, plateThickness, d);
      const isActive = plate === this.activePlate;
      const plateMat = new THREE.MeshPhongMaterial({
        color: isActive ? 0xffffff : 0xf7f8fa,
        specular: 0x111111,
        shininess: 5,
      });
      const plateMesh = new THREE.Mesh(plateGeo, plateMat);
      plateMesh.position.set(originX, -plateThickness / 2, originZ);
      this.gridGroup.add(plateMesh);

      const lines = [];
      const colors = [];
      const colorMajor = new THREE.Color(isActive ? 0x555555 : 0x8a8f96);
      const colorMinor = new THREE.Color(isActive ? 0xcccccc : 0xd9dde2);

      const halfW = w / 2;
      const halfD = d / 2;

      for (let x = -Math.floor(halfW); x <= Math.floor(halfW); x++) {
        lines.push(originX + x, 0, originZ - halfD, originX + x, 0, originZ + halfD);
        const isMajor = (x % 10 === 0);
        colors.push(
          (isMajor ? colorMajor.r : colorMinor.r), (isMajor ? colorMajor.g : colorMinor.g), (isMajor ? colorMajor.b : colorMinor.b),
          (isMajor ? colorMajor.r : colorMinor.r), (isMajor ? colorMajor.g : colorMinor.g), (isMajor ? colorMajor.b : colorMinor.b)
        );
      }

      for (let z = -Math.floor(halfD); z <= Math.floor(halfD); z++) {
        lines.push(originX - halfW, 0, originZ + z, originX + halfW, 0, originZ + z);
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

      const gridMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: isActive ? 0.7 : 0.45 });
      const gridLines = new THREE.LineSegments(gridGeo, gridMat);
      this.gridGroup.add(gridLines);

      const volGeo = new THREE.BoxGeometry(w, h, d);
      volGeo.translate(0, h / 2, 0);

      const volMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: isActive ? 0.1 : 0.04, depthWrite: false });
      const volMesh = new THREE.Mesh(volGeo, volMat);
      volMesh.position.set(originX, 0, originZ);
      this.gridGroup.add(volMesh);

      const edges = new THREE.EdgesGeometry(volGeo);
      const volLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
        color: isActive ? 0x0070f3 : 0x888888,
        transparent: true,
        opacity: isActive ? 0.7 : 0.3,
      }));
      volLines.position.set(originX, 0, originZ);
      this.gridGroup.add(volLines);
      this.buildVolumeEdges.push({ plate, lines: volLines });

      // Add plate number
      const plateIndex = plates.indexOf(plate);
      const numberMesh = this._createPlateNumberMesh(plateIndex + 1, isActive, Math.min(w, d) * 0.25);
      numberMesh.position.set(originX, 0.06, originZ);
      this.gridGroup.add(numberMesh);
    });
    this.requestRender();
  }

  _createPlateNumberMesh(number, isActive, size) {
    const canvas = document.createElement('canvas');
    const texSize = 256;
    canvas.width = texSize;
    canvas.height = texSize;
    const ctx = canvas.getContext('2d');

    // Transparent background
    ctx.clearRect(0, 0, texSize, texSize);

    ctx.fillStyle = isActive ? '#0070f3' : '#888888';
    ctx.font = 'bold 180px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), texSize / 2, texSize / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; // Lay flat on build plate
    mesh.renderOrder = 10;
    return mesh;
  }

  _resize() {
    const container = this.canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  _setRenderPixelRatio(maxPixelRatio) {
    const nextPixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    if (nextPixelRatio === this.renderPixelRatio) return;
    this.renderPixelRatio = nextPixelRatio;
    this.renderer.setPixelRatio(nextPixelRatio);
    if (this.canvas.parentElement && this.camera) {
      this._resize();
    }
  }

  requestRender() {
    if (this.renderRequested || document.hidden) return;
    this.renderRequested = true;
    requestAnimationFrame(() => this._render());
  }

  _render() {
    this.renderRequested = false;
    const now = performance.now();
    const cameraMoved = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._updateFps(now);
    if (this.isUserInteracting || cameraMoved) {
      this.requestRender();
    }
  }

  _updateFps(now) {
    if (!this.fpsElement) return;

    this.fpsFrames += 1;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 250) {
      const fps = Math.round((this.fpsFrames * 1000) / elapsed);
      this.fpsElement.textContent = `${fps} FPS`;
      this.fpsFrames = 0;
      this.fpsWindowStart = now;
    }

    clearTimeout(this.fpsIdleTimer);
    this.fpsIdleTimer = setTimeout(() => {
      this.fpsFrames = 0;
      this.fpsWindowStart = performance.now();
      this.fpsElement.textContent = 'Idle';
    }, 500);
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
        const origin = this.getActivePlateOrigin();
        this.camera.position.set(origin.x + maxDim, maxDim * 0.8, origin.z + maxDim);
        this.controls.target.set(origin.x, size.y / 2, origin.z);
        this.controls.update();
    }
  }

  _addModelRaw(geometry, material, elevation) {
    const preset = this.defaultMaterialPreset || DEFAULT_RESIN_MATERIAL;
    if (!material) {
      material = createResinMaterial(preset);
    }
    const mesh = new THREE.Mesh(geometry, material);
    const id = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    mesh.userData.id = id;
    this.scene.add(mesh);
    const obj = { id, mesh, supportsMesh: null, elevation, materialPreset: preset };
    this.objects.push(obj);
    return obj;
  }

  addModel(geometry, elevation = 5) {
    const obj = this._addModelRaw(geometry, null, elevation);
    this._moveMeshOriginToBoundsMin(obj.mesh);
    const origin = this.getActivePlateOrigin();
    obj.mesh.position.x += origin.x;
    obj.mesh.position.z += origin.z;
    obj.mesh.updateMatrixWorld(true);
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
    this.activePlate.objects = this.objects;
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
    this.activePlate.objects = this.objects;
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
      const newObj = this._addModelRaw(sel.mesh.geometry.clone(), sel.mesh.material.clone(), sel.elevation);
      newObj.materialPreset = sel.materialPreset || DEFAULT_RESIN_MATERIAL;
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

    const originX = this.activePlate?.originX || 0;
    const originZ = this.activePlate?.originZ || 0;
    const halfW = this.printer.buildWidthMM / 2;
    const halfD = this.printer.buildDepthMM / 2;
    const maxH = this.printer.buildHeightMM;

    const inBounds = (
      bb.min.x >= originX - halfW && bb.max.x <= originX + halfW &&
      bb.min.z >= originZ - halfD && bb.max.z <= originZ + halfD &&
      bb.max.y <= maxH
    );

    return { inBounds };
  }

  updateBoundsWarning() {
    if (!this.buildVolumeEdges) return;
    const { inBounds } = this.checkBounds();
    this.buildVolumeEdges.forEach(({ plate, lines }) => {
      const active = plate === this.activePlate;
      lines.material.color.setHex(active && !inBounds ? 0xff4444 : active ? 0x0070f3 : 0x888888);
      lines.material.opacity = active && !inBounds ? 0.8 : active ? 0.7 : 0.3;
    });
    this.requestRender();
  }

  getModelGeometry() {
    if (this.selected.length !== 1) return null;
    const mesh = this.selected[0].mesh;
    const geometry = mesh.geometry.clone();
    mesh.updateMatrixWorld(true);
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.translate(-(this.activePlate?.originX || 0), 0, -(this.activePlate?.originZ || 0));
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
      o.mesh.updateMatrixWorld(true);
      g.applyMatrix4(o.mesh.matrixWorld);
      g.translate(-(this.activePlate?.originX || 0), 0, -(this.activePlate?.originZ || 0));
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
        o.supportsMesh.updateMatrixWorld(true);
        g.applyMatrix4(o.supportsMesh.matrixWorld);
        g.translate(-(this.activePlate?.originX || 0), 0, -(this.activePlate?.originZ || 0));
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
    mesh.position.set(this.activePlate?.originX || 0, 0, this.activePlate?.originZ || 0);
    this.selected[0].supportsMesh = mesh;
    this.selected[0]._cachedLocalSupportVolume = undefined;
    this.scene.add(mesh);
    this.requestRender();
  }

  highlightSignificantFaces(significantFaces) {
    // Remove any existing highlight meshes
    this.clearSignificantFaceHighlights();

    if (significantFaces.length === 0 || this.selected.length === 0) return;

    const mesh = this.selected[0].mesh;
    mesh.updateMatrixWorld(true);
    const matrixWorld = mesh.matrixWorld.clone();

    // Create highlight for the largest significant face
    const topFace = significantFaces[0];
    const faceNormal = topFace.normal.clone().applyMatrix4(matrixWorld).normalize();

    // Find the centroid of triangles with this normal
    const positions = mesh.geometry.attributes.position;
    const tolerance = 0.85;
    let centroidX = 0, centroidY = 0, centroidZ = 0;
    let triangleCount = 0;

    for (let i = 0; i < positions.count; i += 3) {
      const v0 = new THREE.Vector3().fromBufferAttribute(positions, i);
      const v1 = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
      const v2 = new THREE.Vector3().fromBufferAttribute(positions, i + 2);

      const edge1 = new THREE.Vector3().subVectors(v1, v0);
      const edge2 = new THREE.Vector3().subVectors(v2, v0);
      const faceN = new THREE.Vector3().crossVectors(edge1, edge2).normalize();

      if (faceN.dot(topFace.normal) > tolerance) {
        centroidX += v0.x + v1.x + v2.x;
        centroidY += v0.y + v1.y + v2.y;
        centroidZ += v0.z + v1.z + v2.z;
        triangleCount += 3;
      }
    }

    if (triangleCount === 0) return;

    centroidX /= triangleCount;
    centroidY /= triangleCount;
    centroidZ /= triangleCount;

    const worldCentroid = new THREE.Vector3(centroidX, centroidY, centroidZ).applyMatrix4(matrixWorld);
    const worldNormal = faceNormal.clone().normalize();

    // Create arrow indicator at the centroid pointing outward
    const arrowLength = 30;
    const arrowGeometry = new THREE.ConeGeometry(4, arrowLength, 8);
    const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8 });
    const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);

    // Orient arrow to point along the normal
    const up = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, worldNormal);
    arrow.setRotationFromQuaternion(quaternion);
    arrow.position.copy(worldCentroid).addScaledVector(worldNormal, arrowLength / 2 + 2);

    this.scene.add(arrow);
    this.significantFaceHighlights = [arrow];
    this.requestRender();
  }

  clearSignificantFaceHighlights() {
    if (this.significantFaceHighlights) {
      this.significantFaceHighlights.forEach(mesh => {
        if (mesh.parent === this.scene) {
          this.scene.remove(mesh);
        }
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      });
      this.significantFaceHighlights = null;
    }
    this.requestRender();
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
    this.requestRender();
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
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  applyRotation(quaternion) {
    if (this.selected.length !== 1) return;
    const sel = this.selected[0];
    sel.mesh.geometry.applyQuaternion(quaternion);
    sel.mesh.geometry.computeBoundingBox();
    const min = sel.mesh.geometry.boundingBox.min.clone();
    sel.mesh.geometry.translate(-min.x, -min.y, -min.z);
    sel.mesh.geometry.computeBoundingBox();
    sel.mesh.position.x += min.x;
    sel.mesh.position.z += min.z;
    sel.mesh.position.y = sel.elevation;
    sel.mesh.updateMatrixWorld(true);

    this.clearSupports();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  setTransformMode(mode) {
    if (!mode) {
       this.transformControl.detach();
    } else {
       if (this.selected.length > 0) {
           this._attachTransformControls();
           this.transformControl.setMode(mode);
       } else if (this.objects.length > 0 && this.selected.length === 0) {
           this.selectObject(this.objects[0].id);
           this.transformControl.setMode(mode);
       }
    }
    this.requestRender();
  }

  _bakeTransform({ preserveSupports = false } = {}) {
    if (this.selected.length === 0) return;
    this.multiTransformState = null;

    this.selected.forEach(sel => {
      const smesh = sel.mesh;
      smesh.updateMatrix();
      smesh.geometry.applyMatrix4(smesh.matrix);
      smesh.position.set(0, 0, 0);
      smesh.rotation.set(0, 0, 0);
      smesh.scale.set(1, 1, 1);
      smesh.updateMatrix();
      smesh.geometry.computeBoundingBox();
      this._moveMeshOriginToBoundsMin(smesh);
      sel._cachedLocalVolume = undefined;
    });

    if (this.selected.length > 1) {
      this._positionSelectionPivot();
    }

    if (!preserveSupports) {
      this.clearSupports();
    }
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  _reassignObjectsToPlates() {
    if (this.selected.length === 0 || !this.plates || this.plates.length <= 1) return;

    const spec = this.printer;
    if (!spec) return;

    const buildWidth = spec.buildWidthMM;
    const buildDepth = spec.buildDepthMM;
    const halfW = buildWidth / 2;
    const halfD = buildDepth / 2;

    let movedToPlate = null;
    this.selected.forEach(sel => {
      const pos = sel.mesh.position;
      const currentPlate = this.getPlateForObject(sel.id);

      // Find which plate this object's center is closest to
      let bestPlate = null;
      let bestDist = Infinity;
      let inAnyBounds = false;

      for (const plate of this.plates) {
        const originX = plate.originX || 0;
        const originZ = plate.originZ || 0;

        // Check if the object's position is within this plate's bounds
        if (pos.x >= originX - halfW && pos.x <= originX + halfW &&
            pos.z >= originZ - halfD && pos.z <= originZ + halfD) {
          inAnyBounds = true;
          // Object is within this plate's bounds
          const dist = Math.hypot(pos.x - originX, pos.z - originZ);
          if (dist < bestDist) {
            bestDist = dist;
            bestPlate = plate;
          }
        }
      }

      // If no plate bounds contain the object, find the closest plate
      if (!bestPlate) {
        for (const plate of this.plates) {
          const originX = plate.originX || 0;
          const originZ = plate.originZ || 0;
          const dist = Math.hypot(pos.x - originX, pos.z - originZ);
          if (dist < bestDist) {
            bestDist = dist;
            bestPlate = plate;
          }
        }
      }

      // If we found a different plate, move the object
      if (bestPlate && bestPlate !== currentPlate) {
        this._moveObjectToPlate(sel, bestPlate);
        movedToPlate = bestPlate;
      }
    });

    if (movedToPlate) {
      this.setActivePlate(movedToPlate);
      this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    } else {
      this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    }
  }

  _moveObjectToPlate(obj, targetPlate) {
    // Remove from current plate
    const currentPlate = this.getPlateForObject(obj.id);
    if (!currentPlate || currentPlate === targetPlate) return;

    const idx = currentPlate.objects.indexOf(obj);
    if (idx !== -1) {
      currentPlate.objects.splice(idx, 1);
    }

    // Position is already in world coordinates - don't adjust
    // Just add to target plate
    targetPlate.objects.push(obj);

    // Clear slice data from both plates
    currentPlate.slicedLayers = null;
    currentPlate.slicedVolumes = null;
    currentPlate.dirty = true;
    targetPlate.slicedLayers = null;
    targetPlate.slicedVolumes = null;
    targetPlate.dirty = true;
  }

  _saveUndoState() {
    const snapshot = this.objects.map(o => ({
      geometry: o.mesh.geometry.clone(),
      material: o.mesh.material.clone(),
      materialPreset: o.materialPreset,
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
    this.activePlate.objects = this.objects;
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
      this.objects.push({ id, mesh, supportsMesh: null, elevation: s.elevation, materialPreset: s.materialPreset || DEFAULT_RESIN_MATERIAL });
    });

    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
  }

  copySelected() {
    if (this.selected.length === 0) return;
    this.clipboard = this.selected.map(sel => ({
      geometry: sel.mesh.geometry.clone(),
      material: sel.mesh.material.clone(),
      materialPreset: sel.materialPreset,
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
      obj.materialPreset = item.materialPreset || DEFAULT_RESIN_MATERIAL;
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

  autoArrange(padding = 5, elevation = 10) {
    if (!this.printer || this.objects.length === 0) return false;
    this._saveUndoState();

    // Include padding on all sides
    const usableWidth = this.printer.buildWidthMM - padding * 2;
    const usableDepth = this.printer.buildDepthMM - padding * 2;
    if (usableWidth <= 0 || usableDepth <= 0) return false;

    const originX = this.activePlate?.originX || 0;
    const originZ = this.activePlate?.originZ || 0;

    // Collect objects with their bounding boxes (including supports)
    const items = this.objects.map(obj => {
      obj.mesh.geometry.computeBoundingBox();
      obj.mesh.updateMatrixWorld(true);

      // Start with model bounding box
      const box = obj.mesh.geometry.boundingBox.clone().applyMatrix4(obj.mesh.matrixWorld);

      // Expand to include supports if present
      if (obj.supportsMesh && obj.supportsMesh.geometry) {
        obj.supportsMesh.geometry.computeBoundingBox();
        obj.supportsMesh.updateMatrixWorld(true);
        const supportsBox = obj.supportsMesh.geometry.boundingBox.clone().applyMatrix4(obj.supportsMesh.matrixWorld);
        box.expandByPoint(supportsBox.min);
        box.expandByPoint(supportsBox.max);
      }

      // Expand to include base pan if present (add 2mm margin for pan lip)
      if (obj.materialPreset?.basePanEnabled) {
        const panMargin = (obj.materialPreset.basePanMargin || 4) + 2;
        const panThickness = obj.materialPreset.basePanThickness || 0.8;
        box.expandByPoint(new THREE.Vector3(box.min.x - panMargin, box.min.y - panThickness, box.min.z - panMargin));
        box.expandByPoint(new THREE.Vector3(box.max.x + panMargin, box.max.y, box.max.z + panMargin));
      }

      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      return {
        obj,
        box,
        center,
        width: size.x,
        depth: size.z,
      };
    });

    // MaxRects bin packing algorithm
    // Free rectangles initially: the entire usable area
    let freeRects = [{ x: 0, y: 0, width: usableWidth, height: usableDepth }];
    const placements = [];

    // Sort items by max dimension (largest first) for better packing
    items.sort((a, b) => Math.max(b.depth, b.width) - Math.max(a.depth, a.width));

    for (const item of items) {
      if (item.width > usableWidth || item.depth > usableDepth) {
        // Item doesn't fit on plate at all
        console.warn(`Object ${item.obj.id} doesn't fit: ${item.width}x${item.depth} > ${usableWidth}x${usableDepth}`);
        continue;
      }

      // Find the best free rectangle for this item (Best Short Side Fit)
      let bestRect = null;
      let bestShortSideFit = Infinity;
      let bestLongSideFit = Infinity;

      for (const rect of freeRects) {
        // Try placing item normally
        if (item.width <= rect.width && item.depth <= rect.height) {
          const leftoverH = rect.width - item.width;
          const leftoverV = rect.height - item.depth;
          const shortSideFit = Math.min(leftoverH, leftoverV);
          const longSideFit = Math.max(leftoverH, leftoverV);

          if (shortSideFit < bestShortSideFit ||
              (shortSideFit === bestShortSideFit && longSideFit < bestLongSideFit)) {
            bestRect = { rect, rotated: false, leftoverH, leftoverV };
            bestShortSideFit = shortSideFit;
            bestLongSideFit = longSideFit;
          }
        }

        // Try rotating 90 degrees
        if (item.depth <= rect.width && item.width <= rect.height) {
          const leftoverH = rect.width - item.depth;
          const leftoverV = rect.height - item.width;
          const shortSideFit = Math.min(leftoverH, leftoverV);
          const longSideFit = Math.max(leftoverH, leftoverV);

          if (shortSideFit < bestShortSideFit ||
              (shortSideFit === bestShortSideFit && longSideFit < bestLongSideFit)) {
            bestRect = { rect, rotated: true, leftoverH, leftoverV };
            bestShortSideFit = shortSideFit;
            bestLongSideFit = longSideFit;
          }
        }
      }

      if (!bestRect) {
        // No space found for this item
        continue;
      }

      const { rect, rotated, leftoverH, leftoverV } = bestRect;
      const placeWidth = rotated ? item.depth : item.width;
      const placeDepth = rotated ? item.width : item.depth;

      // Place the item
      placements.push({
        item,
        x: rect.x + placeWidth / 2,
        z: rect.y + placeDepth / 2,
      });

      // Split the free rectangle into up to 2 new rectangles
      // (MaxRects - split remaining space)
      const newRects = [];

      // Right split
      if (leftoverH > 0) {
        newRects.push({
          x: rect.x + placeWidth,
          y: rect.y,
          width: leftoverH,
          height: placeDepth
        });
      }

      // Bottom split
      if (leftoverV > 0) {
        newRects.push({
          x: rect.x,
          y: rect.y + placeDepth,
          width: rect.width,
          height: leftoverV
        });
      }

      // Remove the used rectangle
      freeRects = freeRects.filter(r => r !== rect);

      // Add new rectangles and prune
      freeRects.push(...newRects);
      freeRects = this._pruneFreeRects(freeRects);
    }

    if (placements.length === 0) return false;

    // Calculate bounding box of all placements to center them on plate
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const { item, x, z } of placements) {
      const halfW = item.width / 2;
      const halfD = item.depth / 2;
      minX = Math.min(minX, x - halfW);
      maxX = Math.max(maxX, x + halfW);
      minZ = Math.min(minZ, z - halfD);
      maxZ = Math.max(maxZ, z + halfD);
    }

    const contentWidth = maxX - minX;
    const contentDepth = maxZ - minZ;

    // Calculate centering offset - center content within usable area
    const offsetX = (usableWidth - contentWidth) / 2;
    const offsetZ = (usableDepth - contentDepth) / 2;

    // Apply placements with centering
    for (const { item, x, z } of placements) {
      // Final position: plate origin + placement position + centering offset
      // Note: x, z are already in local plate coordinates (0 to usableWidth/Depth)
      const targetX = originX + x + offsetX - usableWidth / 2;
      const targetZ = originZ + z + offsetZ - usableDepth / 2;

      const dx = targetX - item.center.x;
      const dy = elevation - item.box.min.y;
      const dz = targetZ - item.center.z;

      item.obj.mesh.position.x += dx;
      item.obj.mesh.position.y += dy;
      item.obj.mesh.position.z += dz;
      item.obj.elevation = elevation;
      item.obj.mesh.updateMatrixWorld(true);

      if (item.obj.supportsMesh) {
        if (Math.abs(dy) <= 1e-6) {
          item.obj.supportsMesh.position.x += dx;
          item.obj.supportsMesh.position.z += dz;
        } else {
          this.scene.remove(item.obj.supportsMesh);
          item.obj.supportsMesh.geometry.dispose();
          item.obj.supportsMesh.material.dispose();
          item.obj.supportsMesh = null;
          item.obj._cachedLocalSupportVolume = undefined;
        }
      }
    }

    if (this.selected.length > 1) {
      this._positionSelectionPivot();
    } else {
      this._attachTransformControls();
    }
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    return true;
  }

  _pruneFreeRects(freeRects) {
    // Remove rectangles that are contained within others
    const result = [];
    for (let i = 0; i < freeRects.length; i++) {
      let isContained = false;
      for (let j = 0; j < freeRects.length; j++) {
        if (i !== j && this._isContainedIn(freeRects[i], freeRects[j])) {
          isContained = true;
          break;
        }
      }
      if (!isContained) {
        result.push(freeRects[i]);
      }
    }
    return result;
  }

  _isContainedIn(a, b) {
    return a.x >= b.x && a.y >= b.y &&
           a.x + a.width <= b.x + b.width &&
           a.y + a.height <= b.y + b.height;
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

    const originX = this.activePlate?.originX || 0;
    const originZ = this.activePlate?.originZ || 0;
    const startX = originX - totalW / 2 + itemW / 2;
    const startZ = originZ - totalD / 2 + itemD / 2;

    const sourceElevation = sel.elevation;
    const sharedMaterial = sel.mesh.material;
    const materialPreset = sel.materialPreset || DEFAULT_RESIN_MATERIAL;

    const sourceGeoTemplate = sourceGeo.clone();
    const sourceY = sourceElevation - sourceGeoTemplate.boundingBox.min.y;

    this.removeSelected();

    for (let i = 0; i < countX; i++) {
      for (let j = 0; j < countZ; j++) {
        const px = startX + i * itemW;
        const pz = startZ + j * itemD;

        const newObj = this._addModelRaw(sourceGeoTemplate.clone(), sharedMaterial.clone(), sourceElevation);
        newObj.materialPreset = materialPreset;
        newObj.mesh.position.set(px - size.x / 2, sourceY, pz - size.z / 2);
        newObj.mesh.updateMatrixWorld();
      }
    }

    this.clearSelection();
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    return true;
  }

  distributeAcrossPlates(plates, padding = 5, elevation = 10) {
    // Distribute ALL objects across ALL plates using MaxRects bin packing
    if (!plates || plates.length === 0) return false;
    if (!this.printer) return false;

    const usableWidth = this.printer.buildWidthMM - padding * 2;
    const usableDepth = this.printer.buildDepthMM - padding * 2;
    if (usableWidth <= 0 || usableDepth <= 0) return false;

    this._saveUndoState();
    let allFitted = true;

    // Collect all objects from all plates (including supports and base pan)
    const allObjects = [];
    plates.forEach(plate => {
      plate.objects.forEach(obj => {
        obj.mesh.geometry.computeBoundingBox();
        obj.mesh.updateMatrixWorld(true);

        // Start with model bounding box
        const box = obj.mesh.geometry.boundingBox.clone().applyMatrix4(obj.mesh.matrixWorld);

        // Expand to include supports if present
        if (obj.supportsMesh && obj.supportsMesh.geometry) {
          obj.supportsMesh.geometry.computeBoundingBox();
          obj.supportsMesh.updateMatrixWorld(true);
          const supportsBox = obj.supportsMesh.geometry.boundingBox.clone().applyMatrix4(obj.supportsMesh.matrixWorld);
          box.expandByPoint(supportsBox.min);
          box.expandByPoint(supportsBox.max);
        }

        // Expand to include base pan if present
        if (obj.materialPreset?.basePanEnabled) {
          const panMargin = (obj.materialPreset.basePanMargin || 4) + 2;
          const panThickness = obj.materialPreset.basePanThickness || 0.8;
          box.expandByPoint(new THREE.Vector3(box.min.x - panMargin, box.min.y - panThickness, box.min.z - panMargin));
          box.expandByPoint(new THREE.Vector3(box.max.x + panMargin, box.max.y, box.max.z + panMargin));
        }

        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);
        allObjects.push({
          obj,
          sourcePlate: plate,
          width: size.x,
          depth: size.z,
          box,
          center
        });
      });
    });

    if (allObjects.length === 0) return true;

    // Sort by size (largest first)
    allObjects.sort((a, b) => Math.max(b.depth, b.width) - Math.max(a.depth, a.width));

    // Initialize free rectangles for each plate
    const platePacking = {};
    plates.forEach(plate => {
      platePacking[plate.id] = {
        plate,
        freeRects: [{ x: 0, y: 0, width: usableWidth, height: usableDepth }],
        placements: []
      };
    });

    // Track which objects have been moved to which plates
    const objectPlacements = new Map();

    // Place each object using MaxRects on the best fitting plate
    for (const item of allObjects) {
      if (item.width > usableWidth || item.depth > usableDepth) {
        allFitted = false;
        continue;
      }

      let bestPlateId = null;
      let bestRect = null;
      let bestScore = Infinity;

      // Find the best plate and best position
      for (const plateId of Object.keys(platePacking)) {
        const packing = platePacking[plateId];
        const rect = this._findBestRect(item, packing.freeRects);
        if (rect) {
          // Score by area used (lower is better) + prefer less used plates
          const usedArea = packing.placements.reduce((sum, p) => sum + p.width * p.depth, 0);
          const score = usedArea + rect.score * 0.001;
          if (score < bestScore) {
            bestScore = score;
            bestPlateId = plateId;
            bestRect = rect;
          }
        }
      }

      if (!bestPlateId) {
        allFitted = false;
        continue;
      }

      const packing = platePacking[bestPlateId];
      const { rect } = bestRect;
      const placeWidth = item.width;
      const placeDepth = item.depth;

      // Place the object
      packing.placements.push({
        item,
        x: rect.x + placeWidth / 2,
        z: rect.y + placeDepth / 2,
        width: placeWidth,
        depth: placeDepth
      });

      // Update free rectangles
      const newRects = [];
      if (rect.width - placeWidth > 0) {
        newRects.push({
          x: rect.x + placeWidth,
          y: rect.y,
          width: rect.width - placeWidth,
          height: placeDepth
        });
      }
      if (rect.height - placeDepth > 0) {
        newRects.push({
          x: rect.x,
          y: rect.y + placeDepth,
          width: rect.width,
          height: rect.height - placeDepth
        });
      }
      packing.freeRects = packing.freeRects.filter(r => r !== rect);
      packing.freeRects.push(...newRects);
      packing.freeRects = this._pruneFreeRects(packing.freeRects);

      objectPlacements.set(item, { plateId: bestPlateId, x: rect.x, z: rect.y, width: placeWidth, depth: placeDepth });
    }

    // Apply all placements
    for (const [item, placement] of objectPlacements) {
      const packing = platePacking[placement.plateId];
      const plate = packing.plate;
      const originX = plate.originX || 0;
      const originZ = plate.originZ || 0;

      // Center the placement on the plate
      const placementBounds = this._getPlacementBounds(packing.placements);
      const offsetX = (usableWidth - placementBounds.width) / 2 - placementBounds.minX;
      const offsetZ = (usableDepth - placementBounds.depth) / 2 - placementBounds.minZ;

      const targetX = originX + placement.x + offsetX;
      const targetZ = originZ + placement.z + offsetZ;
      const dx = targetX - item.center.x;
      const dy = elevation - item.box.min.y;
      const dz = targetZ - item.center.z;

      item.obj.mesh.position.x += dx;
      item.obj.mesh.position.y += dy;
      item.obj.mesh.position.z += dz;
      item.obj.elevation = elevation;
      item.obj.mesh.updateMatrixWorld(true);

      if (item.obj.supportsMesh) {
        if (Math.abs(dy) <= 1e-6) {
          item.obj.supportsMesh.position.x += dx;
          item.obj.supportsMesh.position.z += dz;
        } else {
          this.scene.remove(item.obj.supportsMesh);
          item.obj.supportsMesh.geometry.dispose();
          item.obj.supportsMesh.material.dispose();
          item.obj.supportsMesh = null;
          item.obj._cachedLocalSupportVolume = undefined;
        }
      }

      // If object was on a different plate, move it to new plate
      if (item.sourcePlate.id !== plate.id) {
        const srcIdx = item.sourcePlate.objects.indexOf(item.obj);
        if (srcIdx !== -1) {
          item.sourcePlate.objects.splice(srcIdx, 1);
        }
        plate.objects.push(item.obj);
      }

    }

    // Update active plate objects reference
    this.objects = this.activePlate.objects;

    this.clearSelection();
    this.canvas.dispatchEvent(new CustomEvent('selection-changed'));
    this.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
    return allFitted;
  }

  _findBestRect(item, freeRects) {
    let bestRect = null;
    let bestScore = Infinity;

    for (const rect of freeRects) {
      // Try normal orientation
      if (item.width <= rect.width && item.depth <= rect.height) {
        const leftoverH = rect.width - item.width;
        const leftoverV = rect.height - item.depth;
        const shortSide = Math.min(leftoverH, leftoverV);
        const score = shortSide * 0.001 + (rect.width * rect.height);
        if (score < bestScore) {
          bestScore = score;
          bestRect = { rect, score };
        }
      }
    }

    return bestRect;
  }

  _getPlacementBounds(placements) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of placements) {
      minX = Math.min(minX, p.x - p.width / 2);
      maxX = Math.max(maxX, p.x + p.width / 2);
      minZ = Math.min(minZ, p.z - p.depth / 2);
      maxZ = Math.max(maxZ, p.z + p.depth / 2);
    }
    return {
      minX: minX === Infinity ? 0 : minX,
      minZ: minZ === Infinity ? 0 : minZ,
      width: maxX - minX,
      depth: maxZ - minZ
    };
  }

  // --- Significant Face Visualization ---
  _significantFaceMarkers = [];

  addSignificantFaceMarker(centroid, normal, area, color, index, options = {}) {
    const arrowDir = normal.clone().normalize();
    const markerSize = options.size ?? THREE.MathUtils.clamp(Math.sqrt(Math.max(area, 1)) * 0.22, 2.5, 9);
    const surfaceOffset = options.surfaceOffset ?? THREE.MathUtils.clamp(markerSize * 0.16, 0.35, 1.2);
    const arrowLength = options.arrowLength ?? markerSize * 2.2;
    const markerOrigin = centroid.clone().addScaledVector(arrowDir, surfaceOffset);

    const markerGroup = new THREE.Group();
    markerGroup.position.copy(markerOrigin);

    const ringGeometry = new THREE.RingGeometry(markerSize * 0.42, markerSize * 0.62, 36);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), arrowDir);
    ring.renderOrder = 1000;
    markerGroup.add(ring);

    const dotGeometry = new THREE.SphereGeometry(markerSize * 0.14, 16, 8);
    const dotMaterial = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
    });
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    dot.renderOrder = 1001;
    markerGroup.add(dot);

    const arrow = new THREE.ArrowHelper(
      arrowDir,
      arrowDir.clone().multiplyScalar(markerSize * 0.45),
      arrowLength,
      color,
      markerSize * 0.55,
      markerSize * 0.34
    );
    arrow.cone.material.depthTest = false;
    arrow.cone.material.depthWrite = false;
    arrow.line.material.depthTest = false;
    arrow.line.material.depthWrite = false;
    arrow.cone.renderOrder = 1002;
    arrow.line.renderOrder = 1002;
    markerGroup.add(arrow);

    if (options.showLabel !== false) {
      const labelCanvas = document.createElement('canvas');
      const ctx = labelCanvas.getContext('2d');
      labelCanvas.width = 64;
      labelCanvas.height = 64;
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.font = 'bold 48px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(index.toString(), 32, 32);

      const labelTexture = new THREE.CanvasTexture(labelCanvas);
      const labelMaterial = new THREE.SpriteMaterial({
        map: labelTexture,
        depthTest: false,
        depthWrite: false,
      });
      const label = new THREE.Sprite(labelMaterial);
      label.scale.set(markerSize * 0.55, markerSize * 0.55, 1);
      label.position.copy(arrowDir.clone().multiplyScalar(arrowLength + markerSize * 0.65));
      label.renderOrder = 1003;
      markerGroup.add(label);
    }

    // Store reference for cleanup
    markerGroup.userData = { centroid: centroid.clone(), normal: arrowDir.clone(), area };

    this.scene.add(markerGroup);
    this._significantFaceMarkers.push(markerGroup);
  }

  clearSignificantFaceMarkers() {
    for (const marker of this._significantFaceMarkers) {
      this.scene.remove(marker);
      marker.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
    }
    this._significantFaceMarkers = [];
  }

  highlightSignificantFaces(significantFaces) {
    // This method kept for backward compatibility but we use addSignificantFaceMarker now
    const colors = [0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3, 0xf38181, 0xaa96da];
    significantFaces.forEach((face, index) => {
      this.addSignificantFaceMarker(face.centroid, face.normal, face.area, colors[index % colors.length], index + 1);
    });
  }
}
