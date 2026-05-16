/* eslint-disable no-restricted-imports */
import * as THREE from 'three';
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';
import {
  getSupportStructure,
  updateSupportStructureNodePosition,
  updateSupportStructureNodeRadius,
  updateSupportStructureRadii,
  type SupportStructure,
} from './pillar-store';

type HandleKind = 'tip' | 'branch' | 'trunk' | 'base';

interface SelectedStructure {
  modelId: string;
  structureId: string;
}

interface SelectedHandle {
  nodeId: string;
  kind: HandleKind;
}

interface JunctionDrag {
  modelId: string;
  structureId: string;
  nodeId: string;
  startClientY: number;
  startNodeY: number;
}

interface ViewerWithScene {
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  plates?: Array<{ objects?: Array<{ id: string; supportsMesh?: THREE.Mesh | null }> }>;
  rebuildSupportsFromStore(modelId: string): void;
  requestRender(): void;
}

export interface SupportEditGizmoController {
  show(modelId: string, structureId: string, screenX: number, screenY: number): void;
  hide(): void;
}

export function mountSupportEditGizmo(
  ctx: AppContext,
  callbacks: {
    refreshOverhangOverlay(): void;
  },
): SupportEditGizmoController {
  const viewer = ctx.viewer as unknown as ViewerWithScene;
  let selectedStructure: SelectedStructure | null = null;
  let selectedHandle: SelectedHandle | null = null;
  let gizmoUndoSaved = false;
  let selectedHandleGroup: THREE.Group | null = null;
  let junctionDrag: JunctionDrag | null = null;
  const supportEditGizmo = createSupportEditGizmo();

  function createSupportEditGizmo(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'support-edit-gizmo';
    el.hidden = true;
    el.innerHTML = `
      <div class="support-edit-gizmo-header">
        <strong>Branch Support</strong>
        <button type="button" class="support-edit-gizmo-close" aria-label="Close">×</button>
      </div>
      <div class="support-edit-gizmo-context" data-role="context">All branch parts</div>
      <label>Tip <input type="range" data-field="tipRadius" min="0.05" max="2" step="0.05"><span data-value="tipRadius"></span></label>
      <label>Branch <input type="range" data-field="branchRadius" min="0.05" max="3" step="0.05"><span data-value="branchRadius"></span></label>
      <label>Trunk <input type="range" data-field="trunkRadius" min="0.05" max="4" step="0.05"><span data-value="trunkRadius"></span></label>
      <label>Base <input type="range" data-field="baseRadius" min="0.1" max="8" step="0.1"><span data-value="baseRadius"></span></label>
      <label>Height <input type="range" data-field="nodeHeight" min="0" max="10" step="0.25"><span data-value="nodeHeight"></span></label>
    `;
    document.body.appendChild(el);
    listen(el.querySelector('.support-edit-gizmo-close'), 'click', hide);
    for (const input of Array.from(el.querySelectorAll<HTMLInputElement>('input[type="range"]'))) {
      listen(input, 'pointerdown', saveGizmoUndoOnce);
      listen(input, 'input', () => handleGizmoInput(input));
    }
    return el;
  }

  function saveGizmoUndoOnce(): void {
    if (!selectedStructure || gizmoUndoSaved) return;
    document.dispatchEvent(
      new CustomEvent('pillar-edit-undo-save', {
        detail: { modelId: selectedStructure.modelId },
      }),
    );
    gizmoUndoSaved = true;
  }

  function handleGizmoInput(input: HTMLInputElement): void {
    if (!selectedStructure) return;
    const field = input.dataset.field as
      | keyof Parameters<typeof updateSupportStructureRadii>[2]
      | 'nodeHeight';
    applySupportGizmoValue(field, parseFloat(input.value));
    viewer.rebuildSupportsFromStore(selectedStructure.modelId);
    refreshSupportStructureHandles();
    syncSupportEditGizmoValues();
    ctx.clearActivePlateSlice();
    ctx.updateEstimate();
    ctx.scheduleProjectAutosave();
    callbacks.refreshOverhangOverlay();
  }

  function show(modelId: string, structureId: string, screenX: number, screenY: number): void {
    selectedStructure = { modelId, structureId };
    selectedHandle = null;
    gizmoUndoSaved = false;
    supportEditGizmo.hidden = false;
    supportEditGizmo.style.left = `${Math.min(screenX + 14, window.innerWidth - 260)}px`;
    supportEditGizmo.style.top = `${Math.min(screenY + 14, window.innerHeight - 260)}px`;
    refreshSupportStructureHandles();
    syncSupportEditGizmoValues();
  }

  function hide(): void {
    selectedStructure = null;
    selectedHandle = null;
    gizmoUndoSaved = false;
    junctionDrag = null;
    supportEditGizmo.hidden = true;
    viewer.canvas.classList.remove('support-node-dragging');
    clearSupportStructureHandles();
  }

  function clearSupportStructureHandles(): void {
    if (!selectedHandleGroup) return;
    viewer.scene.remove(selectedHandleGroup);
    selectedHandleGroup.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose?.();
    });
    selectedHandleGroup = null;
    viewer.requestRender();
  }

  function refreshSupportStructureHandles(): void {
    clearSupportStructureHandles();
    if (!selectedStructure) return;
    const structure = getSupportStructure(selectedStructure.modelId, selectedStructure.structureId);
    if (!structure) return;
    selectedHandleGroup = new THREE.Group();
    selectedHandleGroup.name = 'selected-support-structure-handles';
    const origin = getSupportMeshOrigin(selectedStructure.modelId);
    selectedHandleGroup.position.set(origin.x, 0, origin.z);
    for (const node of structure.nodes) {
      addHandleForNode(node);
    }
    viewer.scene.add(selectedHandleGroup);
    viewer.requestRender();
  }

  function addHandleForNode(node: SupportStructure['nodes'][number]): void {
    if (!selectedHandleGroup) return;
    const radius = node.kind === 'base' ? 0.9 : node.kind === 'branch' ? 0.65 : 0.45;
    const hitRadius = Math.max(radius * 2.8, 2.2);
    const selected = selectedHandle?.nodeId === node.id;
    const color = selected
      ? 0xffffff
      : node.kind === 'tip'
        ? 0x00d1ff
        : node.kind === 'branch'
          ? 0xffd166
          : 0x66e26f;
    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(selected ? radius * 1.35 : radius, 16, 10),
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
      }),
    );
    configureHandle(handle, node);
    selectedHandleGroup.add(handle);

    const hitTarget = new THREE.Mesh(
      new THREE.SphereGeometry(hitRadius, 16, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0,
      }),
    );
    configureHandle(hitTarget, node);
    selectedHandleGroup.add(hitTarget);
  }

  function configureHandle(handle: THREE.Mesh, node: SupportStructure['nodes'][number]): void {
    handle.userData.supportHandleNodeId = node.id;
    handle.userData.supportHandleKind = node.kind;
    handle.position.set(node.position.x, node.position.y, node.position.z);
    handle.renderOrder = node.kind === 'tip' ? 1300 : 1299;
  }

  function getSupportMeshOrigin(modelId: string): { x: number; z: number } {
    for (const plate of viewer.plates ?? []) {
      for (const obj of plate.objects ?? []) {
        if (obj.id === modelId && obj.supportsMesh) {
          return { x: obj.supportsMesh.position.x, z: obj.supportsMesh.position.z };
        }
      }
    }
    return { x: 0, z: 0 };
  }

  function syncSupportEditGizmoValues(): void {
    if (!selectedStructure) return;
    const structure = getSupportStructure(selectedStructure.modelId, selectedStructure.structureId);
    if (!structure) {
      hide();
      return;
    }
    const values = getStructureRadiusValues(structure);
    const selectedNode = selectedHandle
      ? structure.nodes.find((node) => node.id === selectedHandle?.nodeId)
      : null;
    const heightInput = supportEditGizmo.querySelector<HTMLInputElement>(
      'input[data-field="nodeHeight"]',
    );
    if (heightInput && selectedNode) {
      const ys = structure.nodes.map((node) => node.position.y);
      heightInput.min = Math.max(0, Math.min(...ys) - 20).toFixed(2);
      heightInput.max = (Math.max(...ys) + 20).toFixed(2);
    }
    syncSupportEditGizmoContext(structure);
    for (const [field, value] of Object.entries({
      ...values,
      nodeHeight: selectedNode?.position.y ?? 0,
    })) {
      const input = supportEditGizmo.querySelector<HTMLInputElement>(
        `input[data-field="${field}"]`,
      );
      const label = supportEditGizmo.querySelector<HTMLElement>(`[data-value="${field}"]`);
      if (input) input.value = value.toFixed(2);
      if (label) label.textContent = value.toFixed(2);
    }
  }

  function syncSupportEditGizmoContext(structure: SupportStructure): void {
    const context = supportEditGizmo.querySelector<HTMLElement>('[data-role="context"]');
    const selectedNode = selectedHandle
      ? structure.nodes.find((node) => node.id === selectedHandle?.nodeId)
      : null;
    if (context)
      context.textContent = selectedNode ? contextForNode(selectedNode.kind) : 'All branch parts';
    const enabledFields = new Set<string>(
      !selectedNode
        ? ['tipRadius', 'branchRadius', 'trunkRadius', 'baseRadius']
        : selectedNode.kind === 'tip'
          ? ['tipRadius']
          : selectedNode.kind === 'branch'
            ? ['branchRadius', 'trunkRadius', 'nodeHeight']
            : ['baseRadius', 'trunkRadius'],
    );
    for (const input of Array.from(
      supportEditGizmo.querySelectorAll<HTMLInputElement>('input[type="range"]'),
    )) {
      const enabled = enabledFields.has(input.dataset.field ?? '');
      input.disabled = !enabled;
      input.closest('label')?.classList.toggle('disabled', !enabled);
    }
  }

  function contextForNode(kind: HandleKind): string {
    if (kind === 'tip') return 'Selected touchpoint';
    if (kind === 'branch') return 'Selected branch junction';
    return 'Selected base';
  }

  function applySupportGizmoValue(
    field: keyof Parameters<typeof updateSupportStructureRadii>[2] | 'nodeHeight',
    value: number,
  ): void {
    if (!selectedStructure) return;
    if (!selectedHandle) {
      if (field === 'nodeHeight') return;
      updateSupportStructureRadii(selectedStructure.modelId, selectedStructure.structureId, {
        [field]: value,
      });
      return;
    }
    applySelectedHandleValue(field, value);
  }

  function applySelectedHandleValue(
    field: keyof Parameters<typeof updateSupportStructureRadii>[2] | 'nodeHeight',
    value: number,
  ): void {
    if (!selectedStructure || !selectedHandle) return;
    if (field === 'nodeHeight' && selectedHandle.kind === 'branch') {
      updateSupportStructureNodePosition(
        selectedStructure.modelId,
        selectedStructure.structureId,
        selectedHandle.nodeId,
        { y: value },
      );
      return;
    }
    if (
      (field === 'tipRadius' && selectedHandle.kind === 'tip') ||
      (field === 'branchRadius' && selectedHandle.kind === 'branch') ||
      (field === 'baseRadius' && selectedHandle.kind === 'base')
    ) {
      updateSupportStructureNodeRadius(
        selectedStructure.modelId,
        selectedStructure.structureId,
        selectedHandle.nodeId,
        value,
      );
      return;
    }
    if (
      field === 'trunkRadius' &&
      (selectedHandle.kind === 'branch' || selectedHandle.kind === 'base')
    ) {
      updateSupportStructureRadii(selectedStructure.modelId, selectedStructure.structureId, {
        trunkRadius: value,
      });
    }
  }

  function getStructureRadiusValues(structure: SupportStructure): {
    tipRadius: number;
    branchRadius: number;
    trunkRadius: number;
    baseRadius: number;
  } {
    const selectedNode = selectedHandle
      ? structure.nodes.find((node) => node.id === selectedHandle?.nodeId)
      : null;
    const tip =
      selectedNode?.kind === 'tip'
        ? selectedNode.radius
        : (structure.nodes.find((node) => node.kind === 'tip')?.radius ?? 0.2);
    const branch =
      selectedNode?.kind === 'branch'
        ? selectedNode.radius
        : (structure.nodes.find((node) => node.kind === 'branch')?.radius ?? tip);
    const base =
      selectedNode?.kind === 'base'
        ? selectedNode.radius
        : (structure.nodes.find((node) => node.kind === 'base')?.radius ?? branch * 2);
    return {
      tipRadius: tip,
      branchRadius: branch,
      trunkRadius: trunkRadius(structure, branch),
      baseRadius: base,
    };
  }

  function trunkRadius(structure: SupportStructure, fallback: number): number {
    const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
    return (
      structure.edges.find((edge) => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        return (
          (from?.kind === 'branch' && to?.kind === 'base') ||
          (from?.kind === 'base' && to?.kind === 'branch')
        );
      })?.radius ?? fallback
    );
  }

  function handleSupportHandlePointerDown(e: PointerEvent): void {
    if (ctx.getActiveToolPanel() !== 'supports' || !selectedStructure || !selectedHandleGroup) {
      return;
    }
    const rect = viewer.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, viewer.camera);
    const hits = raycaster.intersectObjects(selectedHandleGroup.children, false);
    if (hits.length === 0) return;
    const hit = hits[0].object;
    const nodeId = hit.userData.supportHandleNodeId as string | undefined;
    const kind = hit.userData.supportHandleKind as HandleKind | undefined;
    if (!nodeId || !kind) return;
    selectedHandle = { nodeId, kind };
    refreshSupportStructureHandles();
    syncSupportEditGizmoValues();
    if (kind === 'branch') beginJunctionDrag(e, nodeId);
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function beginJunctionDrag(e: PointerEvent, nodeId: string): void {
    if (!selectedStructure) return;
    const structure = getSupportStructure(selectedStructure.modelId, selectedStructure.structureId);
    const node = structure?.nodes.find((n) => n.id === nodeId);
    if (!node || node.kind !== 'branch') return;
    saveGizmoUndoOnce();
    junctionDrag = {
      modelId: selectedStructure.modelId,
      structureId: selectedStructure.structureId,
      nodeId,
      startClientY: e.clientY,
      startNodeY: node.position.y,
    };
    viewer.canvas.setPointerCapture?.(e.pointerId);
    viewer.canvas.classList.add('support-node-dragging');
  }

  function handleSupportHandlePointerMove(e: PointerEvent): void {
    if (!junctionDrag) return;
    const dy = junctionDrag.startClientY - e.clientY;
    const nextY = Math.max(0, junctionDrag.startNodeY + dy * 0.08);
    updateSupportStructureNodePosition(
      junctionDrag.modelId,
      junctionDrag.structureId,
      junctionDrag.nodeId,
      { y: nextY },
    );
    viewer.rebuildSupportsFromStore(junctionDrag.modelId);
    refreshSupportStructureHandles();
    syncSupportEditGizmoValues();
    ctx.clearActivePlateSlice();
    ctx.updateEstimate();
    callbacks.refreshOverhangOverlay();
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function endJunctionDrag(e: PointerEvent): void {
    if (!junctionDrag) return;
    junctionDrag = null;
    viewer.canvas.releasePointerCapture?.(e.pointerId);
    viewer.canvas.classList.remove('support-node-dragging');
    ctx.scheduleProjectAutosave();
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  viewer.canvas.addEventListener('pointerdown', handleSupportHandlePointerDown, true);
  viewer.canvas.addEventListener('pointermove', handleSupportHandlePointerMove, true);
  viewer.canvas.addEventListener('pointerup', endJunctionDrag, true);
  viewer.canvas.addEventListener('pointercancel', endJunctionDrag, true);

  return { show, hide };
}
