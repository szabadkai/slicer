// ─── Paint tool logic extracted from ViewerCore ──────────────
// All functions take the viewer core instance as first parameter.

import * as THREE from 'three';
import type { ViewerCore, SceneObject } from './viewer-core';

const MAX_SHADER_PAINT_STROKES = 64;

export function setPaintToolEnabled(core: ViewerCore, enabled: boolean): void {
  core.paintToolEnabled = enabled;
  core.canvas.classList.toggle('paint-mode', enabled);
  core.controls.enabled = !enabled || !core.isPainting;
  if (!enabled) hidePaintPreview(core);
}

export function setPaintBrush(
  core: ViewerCore,
  brush: {
    radiusMM?: number;
    color?: number;
    density?: number;
    depthMM?: number;
    bumpStrength?: number;
    pattern?: number;
    patternScaleMM?: number;
  },
): void {
  core.paintBrush = {
    radiusMM: brush.radiusMM ?? core.paintBrush.radiusMM,
    color: brush.color ?? core.paintBrush.color,
    density: brush.density ?? core.paintBrush.density,
    depthMM: brush.depthMM ?? core.paintBrush.depthMM,
    bumpStrength: brush.bumpStrength ?? core.paintBrush.bumpStrength,
    pattern: brush.pattern ?? core.paintBrush.pattern,
    patternScaleMM: brush.patternScaleMM ?? core.paintBrush.patternScaleMM,
  };
  if (core.paintPreview) {
    core.paintPreview.scale.setScalar(core.paintBrush.radiusMM);
    (core.paintPreview.material as THREE.MeshBasicMaterial).color.setHex(core.paintBrush.color);
  }
}

export function undoPaintStroke(core: ViewerCore): void {
  const target =
    core.selected[0] ??
    core.paintTarget ??
    core.objects.find((o) => (o.paintStrokes?.length ?? 0) > 0);
  if (!target?.paintStrokes?.length) return;
  target.paintStrokes.pop();
  syncPaintMaterial(core, target);
  core.canvas.dispatchEvent(new CustomEvent('paint-changed', { detail: { objectId: target.id } }));
  core.requestRender();
}

export function clearPaint(core: ViewerCore): void {
  const targets = core.selected.length > 0 ? core.selected : core.objects;
  for (const target of targets) {
    target.paintStrokes = [];
    syncPaintMaterial(core, target);
  }
  core.canvas.dispatchEvent(new CustomEvent('paint-changed'));
  core.requestRender();
}

export function getPaintStrokeCount(core: ViewerCore): number {
  const targets = core.selected.length > 0 ? core.selected : core.objects;
  return targets.reduce((count, target) => count + (target.paintStrokes?.length ?? 0), 0);
}

export function getPaintSliceMarks(
  core: ViewerCore,
): Array<{ x: number; y: number; z: number; radiusMM: number; depthMM: number }> {
  const marks: Array<{ x: number; y: number; z: number; radiusMM: number; depthMM: number }> = [];
  for (const obj of core.objects) {
    if (!obj.paintStrokes?.length) continue;
    obj.mesh.updateMatrixWorld(true);
    for (const stroke of obj.paintStrokes) {
      const point = new THREE.Vector3(
        stroke.localPoint[0],
        stroke.localPoint[1],
        stroke.localPoint[2],
      ).applyMatrix4(obj.mesh.matrixWorld);
      marks.push({
        x: point.x,
        y: point.y,
        z: point.z,
        radiusMM: stroke.radiusMM,
        depthMM: stroke.depthMM ?? 0.5,
      });
    }
  }
  return marks;
}

export function getPaintTextureConfig(core: ViewerCore): {
  strength: number;
  pattern: number;
  patternScaleMM: number;
} {
  return {
    strength: core.paintBrush.density,
    pattern: core.paintBrush.pattern,
    patternScaleMM: core.paintBrush.patternScaleMM,
  };
}

export function handlePaintPointerDown(core: ViewerCore, e: PointerEvent): void {
  if (!core.paintToolEnabled || e.button !== 0) return;
  const hit = paintHitFromEvent(core, e);
  if (!hit) return;
  e.preventDefault();
  core.isPainting = true;
  core.controls.enabled = false;
  core.paintTarget = hit.object;
  core.lastPaintPoint = null;
  stampPaint(core, hit);
}

export function handlePaintPointerMove(core: ViewerCore, e: PointerEvent): void {
  if (!core.paintToolEnabled) return;
  const hit = paintHitFromEvent(core, e);
  if (!hit) {
    hidePaintPreview(core);
    return;
  }
  showPaintPreview(core, hit);
  if (core.isPainting) stampPaint(core, hit);
}

export function handlePaintPointerUp(core: ViewerCore): void {
  if (!core.isPainting) return;
  core.isPainting = false;
  core.lastPaintPoint = null;
  core.controls.enabled = !core.paintToolEnabled;
  core.canvas.dispatchEvent(
    new CustomEvent('paint-changed', { detail: { objectId: core.paintTarget?.id } }),
  );
}

export function handlePaintPointerLeave(core: ViewerCore): void {
  handlePaintPointerUp(core);
  hidePaintPreview(core);
}

export function paintHitFromEvent(
  core: ViewerCore,
  e: PointerEvent,
): {
  object: SceneObject;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  localPoint: THREE.Vector3;
} | null {
  const rect = core.canvas.getBoundingClientRect();
  core.raycaster.setFromCamera(
    new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    ),
    core.camera,
  );
  const targets = core.selected.length > 0 ? core.selected : core.objects;
  const meshes = targets.map((o) => o.mesh);
  const intersects = core.raycaster.intersectObjects(meshes, false);
  const hit = intersects[0];
  if (!hit?.face) return null;
  const object = targets.find((o) => o.mesh === hit.object);
  if (!object) return null;

  const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
  const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
  if (normal.dot(core.raycaster.ray.direction) > 0) normal.multiplyScalar(-1);
  const localPoint = hit.object.worldToLocal(hit.point.clone());
  return { object, point: hit.point.clone(), normal, localPoint };
}

function stampPaint(
  core: ViewerCore,
  hit: { object: SceneObject; localPoint: THREE.Vector3 },
): void {
  if (core.paintTarget && hit.object !== core.paintTarget) return;
  const spacing = Math.max(0.2, core.paintBrush.radiusMM * 0.35);
  if (core.lastPaintPoint && core.lastPaintPoint.distanceTo(hit.localPoint) < spacing) return;

  const strokes = hit.object.paintStrokes ?? [];
  strokes.push({
    localPoint: [hit.localPoint.x, hit.localPoint.y, hit.localPoint.z],
    radiusMM: core.paintBrush.radiusMM,
    color: core.paintBrush.color,
    density: core.paintBrush.density,
    depthMM: core.paintBrush.depthMM,
    bumpStrength: core.paintBrush.bumpStrength,
    pattern: core.paintBrush.pattern,
    patternScaleMM: core.paintBrush.patternScaleMM,
  });
  hit.object.paintStrokes = strokes.slice(-MAX_SHADER_PAINT_STROKES);
  core.lastPaintPoint = hit.localPoint.clone();
  syncPaintMaterial(core, hit.object);
  core.requestRender();
}

function showPaintPreview(
  core: ViewerCore,
  hit: { point: THREE.Vector3; normal: THREE.Vector3 },
): void {
  if (!core.paintPreview) {
    const geometry = new THREE.RingGeometry(0.92, 1, 64);
    const material = new THREE.MeshBasicMaterial({
      color: core.paintBrush.color,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    core.paintPreview = new THREE.Mesh(geometry, material);
    core.paintPreview.renderOrder = 1000;
    core.scene.add(core.paintPreview);
  }
  core.paintPreview.visible = true;
  core.paintPreview.position.copy(hit.point).addScaledVector(hit.normal, 0.08);
  core.paintPreview.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
  core.paintPreview.scale.setScalar(core.paintBrush.radiusMM);
}

export function hidePaintPreview(core: ViewerCore): void {
  if (core.paintPreview) core.paintPreview.visible = false;
}

export function syncPaintMaterial(_core: ViewerCore, obj: SceneObject): void {
  const material = obj.mesh.material as THREE.MeshPhysicalMaterial;
  if (!material.userData.paintEnabled) installPaintShader(material);
  const shader = material.userData.paintShader as
    | { uniforms?: Record<string, { value: unknown }> }
    | undefined;
  if (!shader?.uniforms) {
    material.needsUpdate = true;
    return;
  }

  const points = shader.uniforms.uPaintPoints.value as THREE.Vector4[];
  const colors = shader.uniforms.uPaintColors.value as THREE.Vector4[];
  const effects = shader.uniforms.uPaintEffects.value as THREE.Vector4[];
  const strokes = obj.paintStrokes ?? [];
  shader.uniforms.uPaintCount.value = Math.min(strokes.length, MAX_SHADER_PAINT_STROKES);
  for (let i = 0; i < MAX_SHADER_PAINT_STROKES; i++) {
    const stroke = strokes[i];
    if (!stroke) {
      points[i].set(0, 0, 0, 0);
      colors[i].set(0, 0, 0, 0);
      effects[i].set(0, 0, 0, 0);
      continue;
    }
    const color = new THREE.Color(stroke.color);
    points[i].set(
      stroke.localPoint[0],
      stroke.localPoint[1],
      stroke.localPoint[2],
      stroke.radiusMM,
    );
    colors[i].set(color.r, color.g, color.b, stroke.density ?? 0.8);
    effects[i].set(
      stroke.depthMM ?? 0.5,
      stroke.bumpStrength ?? 0.6,
      stroke.pattern ?? 0,
      stroke.patternScaleMM ?? 2,
    );
  }
}

export function installPaintShader(material: THREE.MeshPhysicalMaterial): void {
  material.userData.paintEnabled = true;
  material.customProgramCacheKey = () => 'slicelab-paint-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPaintCount = { value: 0 };
    shader.uniforms.uPaintPoints = {
      value: Array.from({ length: MAX_SHADER_PAINT_STROKES }, () => new THREE.Vector4()),
    };
    shader.uniforms.uPaintColors = {
      value: Array.from({ length: MAX_SHADER_PAINT_STROKES }, () => new THREE.Vector4()),
    };
    shader.uniforms.uPaintEffects = {
      value: Array.from({ length: MAX_SHADER_PAINT_STROKES }, () => new THREE.Vector4()),
    };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPaintLocalPosition;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvPaintLocalPosition = transformed;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vPaintLocalPosition;
uniform int uPaintCount;
uniform vec4 uPaintPoints[${MAX_SHADER_PAINT_STROKES}];
uniform vec4 uPaintColors[${MAX_SHADER_PAINT_STROKES}];
uniform vec4 uPaintEffects[${MAX_SHADER_PAINT_STROKES}];
float slHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float slNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = slHash(i);
  float b = slHash(i + vec2(1.0, 0.0));
  float c = slHash(i + vec2(0.0, 1.0));
  float d = slHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float slFbm(vec2 p) {
  float v = 0.0;
  v += 0.5 * slNoise(p);
  v += 0.25 * slNoise(p * 2.0 + vec2(17.0, 31.0));
  v += 0.125 * slNoise(p * 4.0 + vec2(53.0, 97.0));
  return v / 0.875;
}
float slicelabPaintHeight(vec3 localPosition) {
  float h = 0.0;
  for (int i = 0; i < ${MAX_SHADER_PAINT_STROKES}; i++) {
    if (i >= uPaintCount) break;
    vec4 brush = uPaintPoints[i];
    vec4 effect = uPaintEffects[i];
    float normalizedDistance = clamp(distance(localPosition, brush.xyz) / max(brush.w, 0.0001), 0.0, 1.0);
    float dome = 1.0 - smoothstep(0.0, 1.0, normalizedDistance);
    vec2 patternPosition = localPosition.xz / max(effect.w, 0.001);
    float carbonA = step(0.5, fract((patternPosition.x + patternPosition.y) * 0.5));
    float carbonB = step(0.5, fract((patternPosition.x - patternPosition.y) * 0.5));
    float carbon = mix(carbonA, carbonB, step(0.5, fract(patternPosition.y * 0.25)));
    float knurl = max(
      1.0 - smoothstep(0.04, 0.16, abs(fract(patternPosition.x + patternPosition.y) - 0.5)),
      1.0 - smoothstep(0.04, 0.16, abs(fract(patternPosition.x - patternPosition.y) - 0.5))
    );
    float ribbed = 1.0 - smoothstep(0.08, 0.22, abs(fract(patternPosition.x) - 0.5));
    float noise = slFbm(patternPosition * 3.0);
    float bumpsDist = length(fract(patternPosition) - 0.5);
    float bumps = 1.0 - smoothstep(0.0, 0.35, bumpsDist);
    float patterned = 1.0;
    patterned = mix(patterned, carbon, step(0.5, effect.z) * (1.0 - step(1.5, effect.z)));
    patterned = mix(patterned, knurl, step(1.5, effect.z) * (1.0 - step(2.5, effect.z)));
    patterned = mix(patterned, ribbed, step(2.5, effect.z) * (1.0 - step(3.5, effect.z)));
    patterned = mix(patterned, noise, step(3.5, effect.z) * (1.0 - step(4.5, effect.z)));
    patterned = mix(patterned, bumps, step(4.5, effect.z) * (1.0 - step(5.5, effect.z)));
    h = max(h, dome * patterned * effect.x * effect.y * uPaintColors[i].a);
  }
  return h;
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
float paintHeight = slicelabPaintHeight(vPaintLocalPosition);
vec3 paintDx = dFdx(vPaintLocalPosition);
vec3 paintDy = dFdy(vPaintLocalPosition);
float paintHeightDx = dFdx(paintHeight);
float paintHeightDy = dFdy(paintHeight);
normal = normalize(normal - paintHeightDx * normalize(cross(paintDy, normal)) + paintHeightDy * normalize(cross(paintDx, normal)));`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float totalMask = 0.0;
  vec3 paintRGB = vec3(0.0);
  for (int i = 0; i < ${MAX_SHADER_PAINT_STROKES}; i++) {
    if (i >= uPaintCount) break;
    vec4 brush = uPaintPoints[i];
    float distToBrush = distance(vPaintLocalPosition, brush.xyz);
    vec4 effect = uPaintEffects[i];
    vec2 patternPosition = vPaintLocalPosition.xz / max(effect.w, 0.001);
    float carbonA = step(0.5, fract((patternPosition.x + patternPosition.y) * 0.5));
    float carbonB = step(0.5, fract((patternPosition.x - patternPosition.y) * 0.5));
    float carbon = mix(carbonA, carbonB, step(0.5, fract(patternPosition.y * 0.25)));
    float knurl = max(
      1.0 - smoothstep(0.04, 0.16, abs(fract(patternPosition.x + patternPosition.y) - 0.5)),
      1.0 - smoothstep(0.04, 0.16, abs(fract(patternPosition.x - patternPosition.y) - 0.5))
    );
    float ribbed = 1.0 - smoothstep(0.08, 0.22, abs(fract(patternPosition.x) - 0.5));
    float noise = slFbm(patternPosition * 3.0);
    float bumpsDist = length(fract(patternPosition) - 0.5);
    float bumps = 1.0 - smoothstep(0.0, 0.35, bumpsDist);
    float patterned = 1.0;
    patterned = mix(patterned, carbon, step(0.5, effect.z) * (1.0 - step(1.5, effect.z)));
    patterned = mix(patterned, knurl, step(1.5, effect.z) * (1.0 - step(2.5, effect.z)));
    patterned = mix(patterned, ribbed, step(2.5, effect.z) * (1.0 - step(3.5, effect.z)));
    patterned = mix(patterned, noise, step(3.5, effect.z) * (1.0 - step(4.5, effect.z)));
    patterned = mix(patterned, bumps, step(4.5, effect.z) * (1.0 - step(5.5, effect.z)));
    float paintMask = smoothstep(brush.w, brush.w * 0.65, distToBrush) * uPaintColors[i].a * mix(0.35, 1.0, patterned);
    paintRGB = mix(paintRGB, uPaintColors[i].rgb, step(totalMask, paintMask));
    totalMask = max(totalMask, paintMask);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, paintRGB, totalMask);
}`,
      );
    material.userData.paintShader = shader;
  };
}
