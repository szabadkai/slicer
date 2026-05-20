/**
 * One-Click Prepare — orient, arrange, and support all models in one action.
 */
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';
import { DEFAULT_OVERHANG_PARAMS } from '@features/support-generation/detect';

function readInput(id: string, fallback: string): string {
  return (document.getElementById(id) as HTMLInputElement | null)?.value ?? fallback;
}

function readChecked(id: string, fallback: boolean): boolean {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? el.checked : fallback;
}

function readSupportOptions(
  onProgress: (fraction: number, text: string) => void,
): Record<string, unknown> {
  return {
    overhangAngle: parseFloat(
      readInput('overhang-angle', String(DEFAULT_OVERHANG_PARAMS.angleDeg)),
    ),
    density: parseFloat(readInput('support-density', '50')),
    autoDensity: readChecked('auto-density', true),
    tipDiameter: parseFloat(readInput('tip-diameter', '0.4')),
    supportThickness: parseFloat(readInput('support-thickness', '1')),
    autoThickness: readChecked('auto-thickness', true),
    supportScope: readInput('support-scope', 'selection'),
    approachMode: readInput('support-approach', 'direct'),
    maxPillarAngle: parseFloat(readInput('support-max-angle', '45')),
    modelClearance: parseFloat(readInput('support-clearance', '0.3')),
    maxContactOffset: parseFloat(readInput('support-max-offset', '5')),
    crossBracing: readChecked('cross-bracing', false),
    baseBracingEnabled: readChecked('base-bracing-enabled', false),
    basePanEnabled: readChecked('base-pan-enabled', false),
    basePanMargin: parseFloat(readInput('base-pan-margin', '2')),
    basePanThickness: parseFloat(readInput('base-pan-thickness', '2')),
    basePanLipWidth: parseFloat(readInput('base-pan-lip-width', '1')),
    basePanLipHeight: parseFloat(readInput('base-pan-lip-height', '0.5')),
    sphericalConnection: readChecked('spherical-connection', false),
    sphereConnectionDiameter: parseFloat(readInput('sphere-connection-diameter', '0.3')),
    detectMinima: readChecked('detect-minima', true),
    detectStabilization: readChecked('detect-stabilization', true),
    detectReinforcements: readChecked('detect-reinforcements', false),
    stabilizationDensity: parseInt(readInput('stabilization-density', '4'), 10),
    reinforcementThreshold: parseFloat(readInput('reinforcement-threshold', '2.0')),
    bridgeSupports: readChecked('bridge-supports', false),
    maxBridgeSearchRadius: parseFloat(readInput('bridge-search-radius', '30')),
    experimentalBranchingSupports: readChecked('experimental-branching-supports', false),
    branchClusterRadius: parseFloat(readInput('branch-cluster-radius', '10')),
    branchMaxTips: parseInt(readInput('branch-max-tips', '5'), 10),
    onProgress,
  };
}

export function mountOneClickPreparePanel(ctx: AppContext): void {
  const { viewer } = ctx;
  const btn = document.getElementById('one-click-prepare-btn') as HTMLButtonElement | null;
  let running = false;

  function updateButtonState(): void {
    if (!btn) return;
    btn.disabled = running || viewer.objects.length === 0;
  }

  listen(viewer.canvas, 'mesh-changed', updateButtonState);
  listen(viewer.canvas, 'selection-changed', updateButtonState);
  updateButtonState();

  async function runOneClickPrepare(): Promise<void> {
    if (running || viewer.objects.length === 0) return;
    running = true;
    updateButtonState();

    viewer.selectAll();
    const targets = [...viewer.selected];
    if (targets.length === 0) {
      running = false;
      updateButtonState();
      return;
    }
    const originalIds = targets.map((o) => o.id);
    const single = targets.length === 1;

    ctx.showProgress('Preparing models...');
    await new Promise((r) => setTimeout(r, 50));

    let orientFails = 0;
    let supportFails = 0;

    // ── Phase 1: Orient (progress 0.0 → 0.5) ──────────────────
    try {
      const { optimizeOrientationAsync } = await import('../../orientation');

      for (let i = 0; i < targets.length; i++) {
        const obj = targets[i];
        viewer.selectObject(obj.id);
        const geometry = viewer.getModelGeometry();
        if (!geometry) continue;

        ctx.updateProgress(
          (i * 0.5) / targets.length,
          single ? 'Orienting model...' : `Orienting model ${i + 1} / ${targets.length}`,
        );

        try {
          const quat = await optimizeOrientationAsync(
            geometry as Parameters<typeof optimizeOrientationAsync>[0],
            'least-support',
            (fraction) => {
              const overall = ((i + fraction) * 0.5) / targets.length;
              ctx.updateProgress(
                overall,
                single ? 'Orienting model...' : `Orienting model ${i + 1} / ${targets.length}`,
              );
            },
          );
          viewer.applyRotation(quat);
        } catch (err) {
          orientFails++;
          console.error(`Failed to orient model ${i + 1}`, err);
        }
      }
    } catch (err) {
      orientFails = targets.length;
      console.error('Failed to load orientation module', err);
    }

    // ── Phase 2: Arrange (progress 0.5 → 0.55) ────────────────
    ctx.updateProgress(0.5, 'Arranging models on build plate...');
    viewer.selectObjects(originalIds);
    viewer.autoArrange();
    await new Promise((r) => setTimeout(r, 50));

    // ── Phase 3: Support (progress 0.55 → 1.0) ────────────────
    try {
      const { generateSupports } = await import('../../supports');
      const { replaceAutoPillars, replaceAutoSupportStructures, updatePillarSettings } =
        await import('../support-generation/pillar-store');

      for (let i = 0; i < targets.length; i++) {
        const obj = targets[i];
        viewer.selectObject(obj.id);
        const geometry = viewer.getModelGeometry();
        if (!geometry) continue;

        ctx.updateProgress(
          0.55 + (i * 0.45) / targets.length,
          single ? 'Generating supports...' : `Supporting model ${i + 1} / ${targets.length}`,
        );

        try {
          const result = await generateSupports(
            geometry as Parameters<typeof generateSupports>[0],
            readSupportOptions((fraction) => {
              const overall = 0.55 + ((i + fraction) * 0.45) / targets.length;
              ctx.updateProgress(
                overall,
                single ? 'Generating supports...' : `Supporting model ${i + 1} / ${targets.length}`,
              );
            }) as Parameters<typeof generateSupports>[1],
          );

          document.dispatchEvent(
            new CustomEvent('pillar-edit-undo-save', { detail: { modelId: obj.id } }),
          );
          replaceAutoPillars(obj.id, result.pillars);
          replaceAutoSupportStructures(obj.id, result.supportStructures ?? []);
          updatePillarSettings(obj.id, result.settings);
          viewer.rebuildSupportsFromStore(obj.id);
        } catch (err) {
          supportFails++;
          console.error(`Failed to generate supports for model ${i + 1}`, err);
        }
      }
    } catch (err) {
      supportFails = targets.length;
      console.error('Failed to load supports module', err);
    }

    // ── Finalize ───────────────────────────────────────────────
    viewer.selectObjects(originalIds);
    ctx.showToolPanel('supports');
    ctx.clearActivePlateSlice();
    ctx.updateEstimate();
    ctx.scheduleProjectAutosave();
    ctx.hideProgress();

    const totalFails = orientFails + supportFails;
    if (totalFails > 0) {
      const parts: string[] = [];
      if (orientFails > 0) parts.push(`orient ${orientFails} model${orientFails > 1 ? 's' : ''}`);
      if (supportFails > 0)
        parts.push(`generate supports for ${supportFails} model${supportFails > 1 ? 's' : ''}`);
      alert(`Failed to ${parts.join(' and ')}.`);
    } else {
      document.dispatchEvent(new CustomEvent('supports-generated'));
    }

    running = false;
    updateButtonState();
  }

  listen(btn, 'click', runOneClickPrepare);
  document.addEventListener('one-click-prepare', runOneClickPrepare);
}
