/**
 * Preferences — load/save/apply preferences + project autosave.
 */
import type { AppContext, ProjectState, PrinterSpec } from '@core/types';
import type { LegacyPlate } from '@core/legacy-types';
import { RESIN_MATERIALS } from '@features/material-and-printer-profiles/materials';
import { setInputValue, setInputChecked, listen } from './utils';

const PREFS_KEY = 'slicelab.preferences.v1';
const PREFS_VERSION = 1;

interface Preferences {
  version: number;
  selectedPrinterKey: string;
  selectedMaterialId: string;
  activeToolPanel: string;
  sidebarCollapsed: boolean;
  sliceSettings: Record<string, string>;
  supportSettings: Record<string, string | boolean>;
  camera?: { position: number[]; quaternion: number[]; target: number[] };
}

export function mountPreferences(
  ctx: AppContext,
  project: ProjectState,
  PRINTERS: Record<string, PrinterSpec>,
  applyPrinter: (key: string, opts?: { resetSlice?: boolean }) => void,
  selectedPrinterKey: () => string,
  setSelectedMaterialId: (id: string) => void,
  _getActivePlate: () => LegacyPlate,
  getActiveToolPanel: () => string,
  showToolPanel: (name: string) => void,
): { scheduleSavePreferences: () => void; scheduleProjectAutosave: () => void } {
  let prefsReady = false;
  let prefTimer: ReturnType<typeof setTimeout> | null = null;
  let autosaveReady = false;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  // Load
  function loadPrefs(): Preferences | null {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<Preferences>;
      return parsed.version === PREFS_VERSION ? (parsed as Preferences) : null;
    } catch {
      return null;
    }
  }

  // Collect current state
  function collectPrefs(): Preferences {
    const sidebar = document.getElementById('sidebar');
    return {
      version: PREFS_VERSION,
      selectedPrinterKey: selectedPrinterKey(),
      selectedMaterialId: ctx.viewer.getActiveMaterialPreset()?.id ?? 'siraya-fast-navy-grey',
      activeToolPanel: getActiveToolPanel(),
      sidebarCollapsed: !!sidebar?.classList.contains('collapsed'),
      sliceSettings: collectInputValues([
        'layer-height', 'normal-exposure', 'bottom-layers',
        'bottom-exposure', 'lift-height', 'lift-speed',
      ]),
      supportSettings: collectSupportSettings(),
    };
  }

  function collectInputValues(ids: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const id of ids) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) result[id] = el.value;
    }
    return result;
  }

  function collectSupportSettings(): Record<string, string | boolean> {
    const result: Record<string, string | boolean> = {};
    const inputs = [
      'overhang-angle', 'support-density', 'tip-diameter',
      'support-thickness', 'support-scope', 'support-approach',
      'support-max-angle', 'support-clearance', 'support-max-offset',
      'base-pan-margin', 'base-pan-thickness', 'base-pan-lip-width', 'base-pan-lip-height',
    ];
    for (const id of inputs) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) result[id] = el.value;
    }
    const checks = ['auto-density', 'auto-thickness', 'cross-bracing', 'base-pan-enabled'];
    for (const id of checks) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) result[id] = el.checked;
    }
    return result;
  }

  // Save
  function savePrefs(): void {
    if (!prefsReady) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(collectPrefs()));
    } catch {
      console.warn('Could not save preferences');
    }
  }

  function scheduleSavePreferences(): void {
    if (!prefsReady) return;
    if (prefTimer) clearTimeout(prefTimer);
    prefTimer = setTimeout(savePrefs, 250);
  }

  function scheduleProjectAutosave(): void {
    if (!autosaveReady) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      import('../../project-store').then((mod) => {
        const { saveAutosavedProject } = mod;
        const plates = project.plates.map((plate) => ({
          id: plate.id,
          name: plate.name,
          objects: ctx.viewer.serializeObjects(plate.objects),
          originX: plate.originX,
          originZ: plate.originZ,
        }));
        saveAutosavedProject({
          version: 2,
          app: 'SliceLab',
          selectedPrinterKey: selectedPrinterKey(),
          activePlateId: project.activePlateId,
          plates,
        }).catch(() => {});
      }).catch(() => {});
    }, 900);
  }

  // Apply saved prefs
  function applyPrefs(prefs: Preferences | null): void {
    if (!prefs) return;
    if (PRINTERS[prefs.selectedPrinterKey]) {
      applyPrinter(prefs.selectedPrinterKey, { resetSlice: false });
    }
    if (RESIN_MATERIALS.some((m) => m.id === prefs.selectedMaterialId)) {
      setSelectedMaterialId(prefs.selectedMaterialId);
    }
    // Apply slice settings
    if (prefs.sliceSettings) {
      for (const [id, val] of Object.entries(prefs.sliceSettings)) {
        setInputValue(document.getElementById(id) as HTMLInputElement | null, val);
      }
    }
    // Apply support settings
    if (prefs.supportSettings) {
      for (const [id, val] of Object.entries(prefs.supportSettings)) {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (typeof val === 'boolean') {
          setInputChecked(el, val);
        } else {
          setInputValue(el, val);
        }
      }
    }
    if (prefs.sidebarCollapsed) {
      document.getElementById('sidebar')?.classList.add('collapsed');
    }
    if (prefs.activeToolPanel) {
      showToolPanel(prefs.activeToolPanel);
    }
  }

  // Register input listeners for persistence
  const persistedIds = [
    'layer-height', 'normal-exposure', 'bottom-layers', 'bottom-exposure', 'lift-height', 'lift-speed',
    'overhang-angle', 'auto-density', 'support-density', 'tip-diameter', 'support-thickness', 'auto-thickness',
    'support-scope', 'support-approach', 'support-max-angle', 'support-clearance', 'support-max-offset',
    'cross-bracing', 'base-pan-enabled', 'base-pan-margin', 'base-pan-thickness', 'base-pan-lip-width', 'base-pan-lip-height',
  ];
  for (const id of persistedIds) {
    const el = document.getElementById(id);
    listen(el, 'input', scheduleSavePreferences);
    listen(el, 'change', scheduleSavePreferences);
  }
  window.addEventListener('beforeunload', savePrefs);

  // Load and apply saved preferences
  const saved = loadPrefs();
  applyPrefs(saved);
  prefsReady = true;
  autosaveReady = true;

  return { scheduleSavePreferences, scheduleProjectAutosave };
}
