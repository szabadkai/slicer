/**
 * Orientation panel — preset buttons + orient-all.
 */
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';

export function mountOrientationPanel(ctx: AppContext): void {
  const { viewer } = ctx;
  const panel = document.getElementById('orientation-panel');
  const orientAllBtn = document.getElementById('orient-all-btn');

  async function handleOrientation(preset: string): Promise<void> {
    const targets = [...viewer.selected];
    if (targets.length === 0) return;
    const originalIds = targets.map((o) => o.id);

    const { optimizeOrientationAsync } = await import('../../orientation') as {
      optimizeOrientationAsync: (geo: unknown, preset: string, onProgress: (f: number, t: string) => void) => Promise<unknown>;
    };

    ctx.showProgress(targets.length === 1 ? 'Optimizing orientation...' : 'Optimizing selected models...');

    let failureCount = 0;
    for (let i = 0; i < targets.length; i++) {
      const obj = targets[i];
      viewer.selectObject(obj.id);
      const geometry = viewer.getModelGeometry();
      if (!geometry) continue;

      ctx.updateProgress(i / targets.length,
        targets.length === 1 ? 'Optimizing orientation...' : `Orienting model ${i + 1} / ${targets.length}`);

      try {
        const quaternion = await optimizeOrientationAsync(geometry, preset, (fraction, text) => {
          const overall = (i + fraction) / targets.length;
          ctx.updateProgress(overall,
            targets.length === 1 ? text : `Orienting model ${i + 1} / ${targets.length}`);
        });
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

  listen(orientAllBtn, 'click', () => handleOrientation('fastest'));
}
