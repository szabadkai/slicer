/**
 * Orientation panel — preset buttons, custom weights, orient-all.
 */
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';
import { getIntentBuffer } from '@features/surface-intent/store';
import type { IntentBuffer } from '@features/surface-intent/types';
import type { CustomOrientWeights } from '../../orientation';

export function mountOrientationPanel(ctx: AppContext): void {
  const { viewer } = ctx;
  const panel = document.getElementById('orientation-panel');
  const orientAllBtn = document.getElementById('orient-all-btn');
  const customBtn = document.getElementById('orient-custom-btn');

  // Weight sliders
  const wHeight = document.getElementById('orient-w-height') as HTMLInputElement | null;
  const wHeightVal = document.getElementById('orient-w-height-val');
  const wOverhang = document.getElementById('orient-w-overhang') as HTMLInputElement | null;
  const wOverhangVal = document.getElementById('orient-w-overhang-val');
  const wStaircase = document.getElementById('orient-w-staircase') as HTMLInputElement | null;
  const wStaircaseVal = document.getElementById('orient-w-staircase-val');
  const wFlat = document.getElementById('orient-w-flat') as HTMLInputElement | null;
  const wFlatVal = document.getElementById('orient-w-flat-val');

  function syncWeightLabels(): void {
    if (wHeightVal && wHeight) wHeightVal.textContent = wHeight.value;
    if (wOverhangVal && wOverhang) wOverhangVal.textContent = wOverhang.value;
    if (wStaircaseVal && wStaircase) wStaircaseVal.textContent = wStaircase.value;
    if (wFlatVal && wFlat) wFlatVal.textContent = wFlat.value;
  }

  listen(wHeight, 'input', syncWeightLabels);
  listen(wOverhang, 'input', syncWeightLabels);
  listen(wStaircase, 'input', syncWeightLabels);
  listen(wFlat, 'input', syncWeightLabels);

  async function handleOrientation(
    preset: string,
    customWeights?: CustomOrientWeights,
  ): Promise<void> {
    const targets = [...viewer.selected];
    if (targets.length === 0) return;
    const originalIds = targets.map((o) => o.id);

    const orientModule = (await import('../../orientation')) as {
      optimizeOrientationAsync: (
        geo: unknown,
        preset: string,
        onProgress: (f: number, t: string) => void,
        intentBuffer?: IntentBuffer,
      ) => Promise<unknown>;
      findOptimalOrientation: (
        geo: unknown,
        preset: string,
        customWeights?: CustomOrientWeights,
      ) => unknown;
    };

    ctx.showProgress(
      targets.length === 1 ? 'Optimizing orientation...' : 'Optimizing selected models...',
    );

    let failureCount = 0;
    for (let i = 0; i < targets.length; i++) {
      const obj = targets[i];
      viewer.selectObject(obj.id);
      const geometry = viewer.getModelGeometry();
      if (!geometry) continue;

      ctx.updateProgress(
        i / targets.length,
        targets.length === 1
          ? 'Optimizing orientation...'
          : `Orienting model ${i + 1} / ${targets.length}`,
      );

      try {
        let quaternion: unknown;
        if (customWeights) {
          quaternion = orientModule.findOptimalOrientation(
            geometry,
            'least-support',
            customWeights,
          );
        } else {
          const intentBuf = getIntentBuffer(obj.id);
          quaternion = await orientModule.optimizeOrientationAsync(
            geometry,
            preset,
            (fraction, text) => {
              const overall = (i + fraction) / targets.length;
              ctx.updateProgress(
                overall,
                targets.length === 1 ? text : `Orienting model ${i + 1} / ${targets.length}`,
              );
            },
            intentBuf,
          );
        }
        viewer.applyRotation(quaternion);
      } catch (error) {
        failureCount += 1;
        console.error(`Failed to orient model ${i + 1}`, error);
      }
    }

    viewer.selectObjects(originalIds);
    ctx.showToolPanel('orient');
    if (failureCount > 0) {
      alert(`Failed to orient ${failureCount} model${failureCount === 1 ? '' : 's'}.`);
    } else {
      document.dispatchEvent(new CustomEvent('orient-complete'));
    }
    ctx.hideProgress();
  }

  // Wire preset buttons
  panel?.querySelectorAll<HTMLElement>('[data-preset]').forEach((btn) => {
    listen(btn, 'click', () => {
      const preset = btn.dataset.preset;
      if (preset) handleOrientation(preset);
    });
  });

  listen(orientAllBtn, 'click', () => {
    // Select all objects on the plate before orienting
    if (viewer.objects.length > 0) {
      viewer.selectAll();
    }
    handleOrientation('fastest');
  });

  listen(customBtn, 'click', () => {
    const weights: CustomOrientWeights = {
      height: parseFloat(wHeight?.value ?? '0.1'),
      overhang: parseFloat(wOverhang?.value ?? '0.6'),
      staircase: parseFloat(wStaircase?.value ?? '0.1'),
      flatBottom: parseFloat(wFlat?.value ?? '0.2'),
    };
    handleOrientation('least-support', weights);
  });
}
