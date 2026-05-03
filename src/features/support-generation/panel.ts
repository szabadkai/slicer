/**
 * Support generation panel — controls + generate/clear handlers.
 */
import type { AppContext } from '@core/types';
import { listen } from '@features/app-shell/utils';

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
  const basePanLipHeight = document.getElementById('base-pan-lip-height') as HTMLInputElement | null;
  const generateBtn = document.getElementById('generate-supports-btn');
  const clearBtn = document.getElementById('clear-supports-btn');
  const supportAllBtn = document.getElementById('support-all-btn');
  const zElevation = document.getElementById('z-elevation') as HTMLInputElement | null;

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

  function getSupportOptions(onProgress: (fraction: number, text: string) => void): Record<string, unknown> {
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
    };
  }

  async function handleGenerate(): Promise<void> {
    const targets = [...viewer.selected];
    if (targets.length === 0) return;
    const originalIds = targets.map((o) => o.id);

    // Dynamic import of legacy supports module
    const { generateSupports } = await import('../../supports') as unknown as {
      generateSupports: (geo: unknown, opts: Record<string, unknown>) => Promise<{ attributes: { position: { count: number } } }>;
    };

    ctx.showProgress(targets.length === 1 ? 'Generating supports...' : 'Generating supports for selected models...');
    await new Promise((r) => setTimeout(r, 50));

    let failureCount = 0;
    for (let i = 0; i < targets.length; i++) {
      const obj = targets[i];
      viewer.selectObject(obj.id);
      const geometry = viewer.getModelGeometry();
      if (!geometry) continue;

      ctx.updateProgress(i / targets.length,
        targets.length === 1 ? 'Generating supports...' : `Supporting model ${i + 1} / ${targets.length}`);

      try {
        const supportGeo = await generateSupports(geometry, getSupportOptions((fraction, text) => {
          const overall = (i + fraction) / targets.length;
          ctx.updateProgress(overall,
            targets.length === 1 ? text : `Supporting model ${i + 1} / ${targets.length}`);
        }));
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
      alert(`Failed to generate supports for ${failureCount} model${failureCount === 1 ? '' : 's'}.`);
    }
    ctx.hideProgress();
  }

  // Wire events
  listen(overhangAngle, 'input', syncUi);
  listen(supportDensity, 'input', syncUi);
  listen(autoDensity, 'change', syncUi);
  listen(autoThickness, 'change', syncUi);
  listen(basePanEnabled, 'change', syncUi);
  listen(generateBtn, 'click', () => { handleGenerate(); });
  listen(supportAllBtn, 'click', () => { handleGenerate(); });
  listen(clearBtn, 'click', () => {
    viewer.clearSupports();
    ctx.updateEstimate();
    ctx.scheduleProjectAutosave();
  });
  listen(zElevation, 'change', () => {
    viewer.setElevation(parseFloat(zElevation?.value ?? '0'));
    ctx.clearActivePlateSlice();
    ctx.updateEstimate();
  });

  syncUi();
}
