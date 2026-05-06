/**
 * Health panel — analyze, auto-repair, support heatmap.
 */
import type { AppContext } from '@core/types';
import { listen, escapeHtml } from '@features/app-shell/utils';

// Lazy-load legacy modules
type InspectorModule = {
  ModelInspector: new (
    geo: unknown,
    opts: Record<string, unknown>,
  ) => {
    runFullInspection(): HealthReport;
  };
  IssueTypes: Record<string, { id: string }>;
};
type RepairerModule = {
  ModelRepairer: new (geo: unknown) => {
    autoRepair(): { success: boolean; geometry?: unknown; message: string };
  };
};

interface HealthReport {
  issues: Array<{
    id: string;
    severity: string;
    description: string;
    impact: string;
    locations?: Float32Array;
    occurrences?: Array<{ label?: string; locations?: number[] }>;
  }>;
  overallHealth: string;
  getHealthScore(): number;
}

const AUTOFIX_IDS = new Set(['inverted-normals', 'duplicate-vertices', 'degenerate-triangles']);

export function mountHealthPanel(ctx: AppContext): void {
  const { viewer } = ctx;
  const analyzeBtn = document.getElementById('health-analyze-btn') as HTMLButtonElement | null;
  const repairBtn = document.getElementById('health-autorepair-btn') as HTMLButtonElement | null;
  const heatmapBtn = document.getElementById(
    'health-support-heatmap-btn',
  ) as HTMLButtonElement | null;
  const thicknessBtn = document.getElementById(
    'health-thickness-heatmap-btn',
  ) as HTMLButtonElement | null;
  const scoreValue = document.getElementById('health-score-value');
  const scoreLabel = document.getElementById('health-score-label');
  const scoreArc = document.getElementById('health-score-arc');
  const scoreSvg = document.querySelector('.health-score-svg') as HTMLElement | null;
  const issuesEl = document.getElementById('health-issues');
  let heatmapVisible = false;
  let thicknessHeatmapVisible = false;

  let lastReport: HealthReport | null = null;
  let lastTarget: { type: string; objectId: string | null } | null = null;

  function updateState(): void {
    const hasObjs = viewer.objects.length > 0;
    const hasSingle = viewer.selected.length === 1;
    if (analyzeBtn) {
      analyzeBtn.disabled = !hasObjs;
      analyzeBtn.textContent = hasSingle ? 'Analyze Selected' : 'Analyze Plate';
    }
    const fixable = lastReport?.issues.filter((i) => AUTOFIX_IDS.has(i.id)) ?? [];
    const matchesSel =
      hasSingle &&
      lastTarget?.type === 'selection' &&
      lastTarget.objectId === viewer.selected[0].id;
    if (repairBtn) repairBtn.disabled = !matchesSel || fixable.length === 0;
    if (heatmapBtn) {
      heatmapBtn.disabled = !hasObjs;
      heatmapBtn.textContent = heatmapVisible ? 'Hide Support Heatmap' : 'Show Support Heatmap';
    }
    if (thicknessBtn) {
      thicknessBtn.disabled = !hasObjs;
      thicknessBtn.textContent = thicknessHeatmapVisible
        ? 'Hide Thickness Heatmap'
        : 'Show Thickness Heatmap';
    }
  }

  async function runAnalysis(): Promise<void> {
    if (viewer.objects.length === 0) return;
    const hasSingle = viewer.selected.length === 1;

    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = 'Analyzing...';
    }
    if (scoreValue) scoreValue.textContent = '...';
    if (scoreLabel) scoreLabel.textContent = 'Analyzing model...';
    scoreSvg?.classList.add('health-analyzing');

    await new Promise((r) => setTimeout(r, 50));

    try {
      const geometry = hasSingle ? viewer.getModelGeometry() : viewer.getMergedModelGeometry();
      if (!geometry) throw new Error('No geometry available');

      const { ModelInspector } = (await import('../../inspector')) as InspectorModule;
      const inspector = new ModelInspector(geometry, {
        printerSpec: viewer.printer,
        thinFeatureThreshold: 0.3,
        overhangAngle: 45,
      });
      const report = inspector.runFullInspection();
      lastReport = report;
      lastTarget = hasSingle
        ? { type: 'selection', objectId: viewer.selected[0].id }
        : { type: 'plate', objectId: null };

      displayReport(report);
    } catch (error) {
      console.error('Health analysis failed:', error);
      lastReport = null;
      lastTarget = null;
      if (scoreValue) scoreValue.textContent = 'Err';
      if (scoreLabel) scoreLabel.textContent = 'Analysis failed';
      if (issuesEl)
        issuesEl.innerHTML =
          '<div class="health-empty-state">Analysis failed. Please try again.</div>';
    } finally {
      scoreSvg?.classList.remove('health-analyzing');
      updateState();
    }
  }

  function displayReport(report: HealthReport): void {
    const score = report.getHealthScore();
    if (scoreValue) scoreValue.textContent = `${score}%`;
    if (scoreLabel)
      scoreLabel.textContent =
        report.overallHealth.charAt(0).toUpperCase() + report.overallHealth.slice(1);
    if (scoreArc) scoreArc.setAttribute('stroke-dasharray', `${score}, 100`);
    if (scoreSvg) {
      scoreSvg.setAttribute('class', 'health-score-svg health-' + report.overallHealth);
    }
    if (scoreValue) scoreValue.className = 'health-score-value health-' + report.overallHealth;

    if (!issuesEl) return;
    if (report.issues.length === 0) {
      issuesEl.innerHTML =
        '<div class="health-empty-state" style="background: #dcfce7; color: #166534;">✓ No issues found. Model is ready to print.</div>';
      return;
    }

    const errors = report.issues.filter((i) => i.severity === 'error');
    const warnings = report.issues.filter((i) => i.severity === 'warning');
    const infos = report.issues.filter((i) => i.severity === 'info');
    let html = '';
    if (errors.length > 0) html += renderGroup('Errors', errors, 'error', true);
    if (warnings.length > 0)
      html += renderGroup('Warnings', warnings, 'warning', errors.length === 0);
    if (infos.length > 0) html += renderGroup('Info', infos, 'info', false);
    issuesEl.innerHTML = html;

    // Event delegation for expand/collapse (inline onclick blocked by CSP)
    issuesEl.querySelectorAll('.health-issue-group-header').forEach((header) => {
      header.addEventListener('click', () => {
        header.parentElement?.classList.toggle('expanded');
      });
    });
  }

  function renderGroup(
    title: string,
    issues: HealthReport['issues'],
    cls: string,
    expanded: boolean,
  ): string {
    const expandedCls = expanded ? ' expanded' : '';
    return `
      <div class="health-issue-group ${cls}${expandedCls}">
        <div class="health-issue-group-header">
          <span class="health-issue-group-chevron">${expanded ? '▾' : '▸'}</span>
          <span>${escapeHtml(title)}</span>
          <span class="health-issue-group-count">${issues.length}</span>
        </div>
        <div class="health-issue-list">
          ${issues
            .map((iss) => {
              const autofix = AUTOFIX_IDS.has(iss.id)
                ? '<span class="autofix-badge">Auto-fix</span>'
                : '';
              return `<div class="health-issue-item"><div class="health-issue-item-title">${escapeHtml(iss.description)}${autofix}</div><div class="health-issue-item-desc">${escapeHtml(iss.impact)}</div></div>`;
            })
            .join('')}
        </div>
      </div>`;
  }

  async function runRepair(): Promise<void> {
    if (viewer.selected.length !== 1) {
      alert('Please select one model to repair.');
      return;
    }
    if (
      !lastReport ||
      lastTarget?.type !== 'selection' ||
      lastTarget.objectId !== viewer.selected[0].id
    ) {
      alert('Please analyze the selected model first.');
      return;
    }
    const fixable = lastReport.issues.filter((i) => AUTOFIX_IDS.has(i.id));
    if (fixable.length === 0) {
      alert('No auto-fixable issues found.');
      return;
    }
    if (
      !confirm(
        `Auto-repair will fix:\n${fixable.map((i) => '• ' + i.description).join('\n')}\n\nContinue?`,
      )
    )
      return;

    if (repairBtn) {
      repairBtn.disabled = true;
      repairBtn.textContent = 'Repairing...';
    }

    try {
      const sel = viewer.selected[0];
      const geo = (sel.mesh.geometry as { clone(): unknown }).clone();
      if (!geo) throw new Error('No geometry');

      const { ModelRepairer } = (await import('../../repairer')) as RepairerModule;
      const repairer = new ModelRepairer(geo);
      const result = repairer.autoRepair();

      if (result.success && result.geometry) {
        viewer._saveUndoState?.();
        (sel.mesh.geometry as { dispose(): void }).dispose();
        sel.mesh.geometry = result.geometry;
        (sel.mesh.geometry as { computeBoundingBox(): void }).computeBoundingBox();
        (sel.mesh.geometry as { computeVertexNormals(): void }).computeVertexNormals();
        sel._cachedLocalVolume = undefined;
        viewer.clearSupports();
        sel.mesh.updateMatrixWorld(true);
        viewer.canvas.dispatchEvent(new CustomEvent('mesh-changed'));
        lastReport = null;
        alert(`Repair completed:\n${result.message}`);
        await runAnalysis();
      } else {
        alert('Repair failed: ' + (result.message || 'Unknown error'));
      }
    } catch (error) {
      console.error('Auto-repair failed:', error);
      alert('Repair failed: ' + (error instanceof Error ? error.message : 'unknown'));
    } finally {
      if (repairBtn) repairBtn.textContent = 'Auto-Repair';
      updateState();
    }
  }

  function toggleHeatmap(): void {
    if (heatmapVisible) {
      viewer.clearSupportHeatmap?.();
      heatmapVisible = false;
    } else {
      const targets = viewer.selected.length > 0 ? viewer.selected : viewer.objects;
      if (targets.length === 0) return;
      const result = viewer.buildSupportHeatmapGeometry?.(targets, 30);
      if (!result || result.triangleCount === 0) {
        alert('No support-heavy overhang areas found for the current orientation.');
        return;
      }
      viewer.showSupportHeatmap?.(result);
      heatmapVisible = true;
    }
    updateState();
  }

  function toggleThicknessHeatmap(): void {
    if (thicknessHeatmapVisible) {
      viewer.clearThicknessHeatmap?.();
      thicknessHeatmapVisible = false;
    } else {
      const targets = viewer.selected.length > 0 ? viewer.selected : viewer.objects;
      if (targets.length === 0) return;
      const result = viewer.buildThicknessHeatmapGeometry?.(targets, 0.5, 4);
      if (!result || !result.geometry) {
        alert('Could not compute wall thickness for this model.');
        return;
      }
      viewer.showThicknessHeatmap?.(result);
      thicknessHeatmapVisible = true;
    }
    updateState();
  }

  listen(analyzeBtn, 'click', () => {
    runAnalysis();
  });
  listen(repairBtn, 'click', () => {
    runRepair();
  });
  listen(heatmapBtn, 'click', () => {
    toggleHeatmap();
  });
  listen(thicknessBtn, 'click', () => {
    toggleThicknessHeatmap();
  });
  listen(viewer.canvas, 'selection-changed', updateState);
  listen(viewer.canvas, 'mesh-changed', () => {
    lastReport = null;
    lastTarget = null;
    edgeHighlightVisible = false;
    if (edgeHighlightBtn) edgeHighlightBtn.textContent = 'Show Non-Manifold Edges';
    viewer.clearEdgeHighlight?.();
    if (heatmapVisible) {
      viewer.clearSupportHeatmap?.();
      heatmapVisible = false;
    }
    if (thicknessHeatmapVisible) {
      viewer.clearThicknessHeatmap?.();
      thicknessHeatmapVisible = false;
    }
    updateState();
  });

  // ─── Non-manifold edge highlighting ─────────────────────────────
  const edgeHighlightBtn = document.getElementById(
    'health-edge-highlight-btn',
  ) as HTMLButtonElement | null;
  let edgeHighlightVisible = false;

  listen(edgeHighlightBtn, 'click', () => {
    if (edgeHighlightVisible) {
      viewer.clearEdgeHighlight?.();
      edgeHighlightVisible = false;
      if (edgeHighlightBtn) edgeHighlightBtn.textContent = 'Show Non-Manifold Edges';
      return;
    }
    if (!lastReport) return;
    const nonManifold = lastReport.issues.find(
      (i) => i.id === 'non-manifold-edges' || i.id === 'open-edges',
    );
    if (!nonManifold?.locations) {
      alert('No non-manifold edges detected. Run analysis first.');
      return;
    }
    viewer.showEdgeHighlight?.(nonManifold.locations);
    edgeHighlightVisible = true;
    if (edgeHighlightBtn) edgeHighlightBtn.textContent = 'Hide Non-Manifold Edges';
  });

  updateState();
}
