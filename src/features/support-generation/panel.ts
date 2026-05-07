/**
 * Support generation panel — controls + generate/clear handlers.
 */
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';
import {
  getIntentBuffer,
  appearanceReliabilityBalance,
  cleanupMaterialBalance,
} from '@features/surface-intent/store';
import type { IntentSupportParams } from '@features/surface-intent/engine-types';
import {
  findNearestPillar,
  inspectPillar,
  clearInspection,
  clearStoredPillars,
} from './explanation-inspector';
import { overhangOverlayVisible } from './store';

export function mountSupportPanel(ctx: AppContext): void {
  const { viewer } = ctx;

  // Input refs
  const overhangAngle = document.getElementById('overhang-angle') as HTMLInputElement | null;
  const overhangAngleVal = document.getElementById('overhang-angle-val');
  const autoDensity = document.getElementById('auto-density') as HTMLInputElement | null;
  const supportDensity = document.getElementById('support-density') as HTMLInputElement | null;
  const supportDensityVal = document.getElementById('support-density-val');
  const supportDensityGroup = document.getElementById('support-density-group');
  const tipDiameter = document.getElementById('tip-diameter') as HTMLInputElement | null;
  const tipDiameterGroup = document.getElementById('tip-diameter-group');
  const supportThickness = document.getElementById('support-thickness') as HTMLInputElement | null;
  const supportThicknessGroup = document.getElementById('support-thickness-group');
  const autoThickness = document.getElementById('auto-thickness') as HTMLInputElement | null;
  const supportScope = document.getElementById('support-scope') as HTMLInputElement | null;
  const supportApproach = document.getElementById('support-approach') as HTMLInputElement | null;
  const supportMaxAngle = document.getElementById('support-max-angle') as HTMLInputElement | null;
  const supportClearance = document.getElementById('support-clearance') as HTMLInputElement | null;
  const supportMaxOffset = document.getElementById('support-max-offset') as HTMLInputElement | null;
  const crossBracing = document.getElementById('cross-bracing') as HTMLInputElement | null;
  const basePanEnabled = document.getElementById('base-pan-enabled') as HTMLInputElement | null;
  const basePanOptions = document.getElementById('base-pan-options');
  const basePanMargin = document.getElementById('base-pan-margin') as HTMLInputElement | null;
  const basePanThickness = document.getElementById('base-pan-thickness') as HTMLInputElement | null;
  const basePanLipWidth = document.getElementById('base-pan-lip-width') as HTMLInputElement | null;
  const basePanLipHeight = document.getElementById(
    'base-pan-lip-height',
  ) as HTMLInputElement | null;
  const generateBtn = document.getElementById('generate-supports-btn');
  const clearBtn = document.getElementById('clear-supports-btn');
  const supportAllBtn = document.getElementById('support-all-btn');
  const zElevation = document.getElementById('z-elevation') as HTMLInputElement | null;
  const showOverhangsCb = document.getElementById('show-overhangs-cb') as HTMLInputElement | null;

  function refreshOverhangOverlay(): void {
    if (!overhangOverlayVisible.value) {
      viewer.clearOverhangOverlay();
      return;
    }
    if (viewer.selected.length !== 1) {
      viewer.clearOverhangOverlay();
      return;
    }
    const obj = viewer.selected[0];

    // Collect existing support contact points from supportsMesh
    const contacts: Array<{ x: number; y: number; z: number }> = [];
    const mesh = (
      obj as unknown as {
        supportsMesh: {
          geometry: {
            attributes: {
              position: {
                count: number;
                getX(i: number): number;
                getY(i: number): number;
                getZ(i: number): number;
              };
            };
          };
        } | null;
      }
    ).supportsMesh;
    if (mesh) {
      const pos = mesh.geometry.attributes.position;
      // Sample every 18th vertex (6 segments × 3 verts per pillar ring) as rough contacts
      for (let i = 0; i < pos.count; i += 18) {
        contacts.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
      }
    }

    const angleDeg = parseFloat(overhangAngle?.value ?? '30');
    viewer.showOverhangOverlay(obj.id, contacts, { angleDeg });
  }

  function syncUi(): void {
    if (overhangAngleVal && overhangAngle) overhangAngleVal.textContent = overhangAngle.value + '°';
    if (supportDensityVal && supportDensity) supportDensityVal.textContent = supportDensity.value;
    const autoD = autoDensity?.checked;
    if (supportDensity) supportDensity.disabled = !!autoD;
    setGroupOpacity(supportDensityGroup, !autoD);
    const autoT = autoThickness?.checked;
    if (tipDiameter) tipDiameter.disabled = !!autoT;
    if (supportThickness) supportThickness.disabled = !!autoT;
    setGroupOpacity(tipDiameterGroup, !autoT);
    setGroupOpacity(supportThicknessGroup, !autoT);
    const panEnabled = basePanEnabled?.checked;
    [basePanMargin, basePanThickness, basePanLipWidth, basePanLipHeight].forEach((el) => {
      if (el) el.disabled = !panEnabled;
    });
    if (basePanOptions) {
      basePanOptions.style.opacity = panEnabled ? '1' : '0.5';
      basePanOptions.style.pointerEvents = panEnabled ? 'auto' : 'none';
    }
  }

  function setGroupOpacity(el: HTMLElement | null, enabled: boolean): void {
    if (!el) return;
    el.style.opacity = enabled ? '1' : '0.5';
    el.style.pointerEvents = enabled ? 'auto' : 'none';
  }

  function getSupportOptions(
    onProgress: (fraction: number, text: string) => void,
    modelId?: string,
  ): Record<string, unknown> {
    const intentBuffer = modelId ? getIntentBuffer(modelId) : undefined;
    const intentParams: IntentSupportParams | undefined = intentBuffer
      ? {
          intentBuffer,
          appearanceReliabilityBalance: appearanceReliabilityBalance.value,
          cleanupMaterialBalance: cleanupMaterialBalance.value,
        }
      : undefined;

    return {
      overhangAngle: parseFloat(overhangAngle?.value ?? '30'),
      density: parseFloat(supportDensity?.value ?? '50'),
      autoDensity: autoDensity?.checked ?? true,
      tipDiameter: parseFloat(tipDiameter?.value ?? '0.4'),
      supportThickness: parseFloat(supportThickness?.value ?? '1'),
      autoThickness: autoThickness?.checked ?? true,
      supportScope: supportScope?.value ?? 'selection',
      approachMode: supportApproach?.value ?? 'direct',
      maxPillarAngle: parseFloat(supportMaxAngle?.value ?? '45'),
      modelClearance: parseFloat(supportClearance?.value ?? '0.3'),
      maxContactOffset: parseFloat(supportMaxOffset?.value ?? '5'),
      crossBracing: crossBracing?.checked ?? false,
      basePanEnabled: basePanEnabled?.checked ?? false,
      basePanMargin: parseFloat(basePanMargin?.value ?? '2'),
      basePanThickness: parseFloat(basePanThickness?.value ?? '2'),
      basePanLipWidth: parseFloat(basePanLipWidth?.value ?? '1'),
      basePanLipHeight: parseFloat(basePanLipHeight?.value ?? '0.5'),
      onProgress,
      intentParams,
    };
  }

  async function handleGenerate(): Promise<void> {
    const targets = [...viewer.selected];
    if (targets.length === 0) return;
    const originalIds = targets.map((o) => o.id);

    // Dynamic import of legacy supports module
    const { generateSupports } = (await import('../../supports')) as unknown as {
      generateSupports: (
        geo: unknown,
        opts: Record<string, unknown>,
      ) => Promise<{ attributes: { position: { count: number } } }>;
    };

    ctx.showProgress(
      targets.length === 1
        ? 'Generating supports...'
        : 'Generating supports for selected models...',
    );
    await new Promise((r) => setTimeout(r, 50));

    let failureCount = 0;
    for (let i = 0; i < targets.length; i++) {
      const obj = targets[i];
      viewer.selectObject(obj.id);
      const geometry = viewer.getModelGeometry();
      if (!geometry) continue;

      ctx.updateProgress(
        i / targets.length,
        targets.length === 1
          ? 'Generating supports...'
          : `Supporting model ${i + 1} / ${targets.length}`,
      );

      try {
        const supportGeo = await generateSupports(
          geometry,
          getSupportOptions((fraction, text) => {
            const overall = (i + fraction) / targets.length;
            ctx.updateProgress(
              overall,
              targets.length === 1 ? text : `Supporting model ${i + 1} / ${targets.length}`,
            );
          }, obj.id),
        );
        if (supportGeo.attributes.position?.count > 0) {
          viewer.setSupports(supportGeo);
        } else {
          viewer.clearSupports();
        }
      } catch (error) {
        failureCount += 1;
        console.error(`Failed to generate supports for model ${i + 1}`, error);
      }
    }

    viewer.selectObjects(originalIds);
    ctx.showToolPanel('supports');
    ctx.clearActivePlateSlice();
    ctx.updateEstimate();
    ctx.scheduleProjectAutosave();
    if (failureCount > 0) {
      alert(
        `Failed to generate supports for ${failureCount} model${failureCount === 1 ? '' : 's'}.`,
      );
    } else {
      document.dispatchEvent(new CustomEvent('supports-generated'));
    }
    ctx.hideProgress();
    refreshOverhangOverlay();
  }

  // Wire events
  listen(overhangAngle, 'input', syncUi);
  listen(supportDensity, 'input', syncUi);
  listen(autoDensity, 'change', syncUi);
  listen(autoThickness, 'change', syncUi);
  listen(basePanEnabled, 'change', syncUi);
  listen(generateBtn, 'click', () => {
    handleGenerate();
  });
  listen(supportAllBtn, 'click', () => {
    handleGenerate();
  });
  listen(clearBtn, 'click', () => {
    viewer.clearSupports();
    for (const obj of viewer.objects ?? []) clearStoredPillars(obj.id);
    clearInspection();
    ctx.updateEstimate();
    ctx.scheduleProjectAutosave();
    refreshOverhangOverlay();
  });

  // Wire support-click → explanation popup
  const canvas = document.getElementById('viewer-canvas');
  listen(canvas, 'support-clicked', ((
    e: CustomEvent<{ x: number; y: number; z: number; screenX: number; screenY: number }>,
  ) => {
    const { x, y, z, screenX, screenY } = e.detail;
    const match = findNearestPillar(x, y, z);
    if (match) {
      inspectPillar(match.pillar, match.explanation, screenX, screenY);
    } else {
      clearInspection();
    }
  }) as EventListener);
  listen(zElevation, 'change', () => {
    viewer.setElevation(parseFloat(zElevation?.value ?? '0'));
    ctx.clearActivePlateSlice();
    ctx.updateEstimate();
  });

  // Wire overhang overlay toggle
  listen(showOverhangsCb, 'change', () => {
    overhangOverlayVisible.value = showOverhangsCb?.checked ?? false;
    refreshOverhangOverlay();
  });

  // Refresh overlay after manual support placement
  document.addEventListener('manual-support-placed', () => {
    refreshOverhangOverlay();
  });

  // Refresh overlay on overhang angle change
  listen(overhangAngle, 'input', () => {
    refreshOverhangOverlay();
  });

  // Clear overlay on panel switch
  document.addEventListener('tool-panel-changed', () => {
    viewer.clearOverhangOverlay();
  });

  syncUi();
}
