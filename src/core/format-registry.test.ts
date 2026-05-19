import { describe, it, expect } from 'vitest';
import { formatRegistry } from './format-registry';
import '../formats';

describe('FormatRegistry', () => {
  describe('importers', () => {
    it('finds STL importer by extension', () => {
      const imp = formatRegistry.getImporterForFile('model.stl');
      expect(imp).toBeDefined();
      expect(imp!.id).toBe('stl');
    });

    it('finds OBJ importer by extension', () => {
      const imp = formatRegistry.getImporterForFile('model.obj');
      expect(imp).toBeDefined();
      expect(imp!.id).toBe('obj');
    });

    it('finds 3MF importer by extension', () => {
      const imp = formatRegistry.getImporterForFile('model.3mf');
      expect(imp).toBeDefined();
      expect(imp!.id).toBe('3mf');
    });

    it('finds CAD importer for STEP files', () => {
      const imp = formatRegistry.getImporterForFile('part.step');
      expect(imp).toBeDefined();
      expect(imp!.id).toBe('cad');
    });

    it('finds CAD importer for STP files', () => {
      expect(formatRegistry.getImporterForFile('part.stp')?.id).toBe('cad');
    });

    it('finds CAD importer for IGES files', () => {
      expect(formatRegistry.getImporterForFile('part.iges')?.id).toBe('cad');
    });

    it('returns undefined for unknown extension', () => {
      expect(formatRegistry.getImporterForFile('image.png')).toBeUndefined();
    });

    it('is case-insensitive', () => {
      expect(formatRegistry.getImporterForFile('MODEL.STL')?.id).toBe('stl');
    });

    it('lists all supported import extensions', () => {
      const exts = formatRegistry.getSupportedImportExtensions();
      expect(exts).toContain('stl');
      expect(exts).toContain('obj');
      expect(exts).toContain('3mf');
      expect(exts).toContain('step');
      expect(exts).toContain('stp');
    });

    it('builds accept string for file input', () => {
      const accept = formatRegistry.getImporterAcceptString();
      expect(accept).toContain('.stl');
      expect(accept).toContain('.obj');
      expect(accept).toContain('.3mf');
      expect(accept).toContain('.step');
    });
  });

  describe('mesh exporters', () => {
    it('returns all mesh exporters', () => {
      const exporters = formatRegistry.getMeshExporters();
      const ids = exporters.map((e) => e.id);
      expect(ids).toContain('stl');
      expect(ids).toContain('obj');
      expect(ids).toContain('3mf');
    });
  });

  describe('slice exporters', () => {
    it('returns universally available exporters', () => {
      const printer = {
        name: 'Generic Printer',
        resolutionX: 1920,
        resolutionY: 1080,
        buildWidthMM: 120,
        buildDepthMM: 68,
        buildHeightMM: 150,
      };
      const exporters = formatRegistry.getSliceExporters(printer);
      const ids = exporters.map((e) => e.id);
      expect(ids).toContain('zip');
      expect(ids).toContain('ctb');
      expect(ids).toContain('sl1');
    });

    it('includes GOO for Elegoo printers', () => {
      const printer = {
        name: 'Elegoo Saturn 3',
        resolutionX: 11520,
        resolutionY: 5120,
        buildWidthMM: 218,
        buildDepthMM: 122,
        buildHeightMM: 260,
      };
      const exporters = formatRegistry.getSliceExporters(printer);
      const ids = exporters.map((e) => e.id);
      expect(ids).toContain('goo');
    });

    it('excludes GOO for non-Elegoo printers', () => {
      const printer = {
        name: 'Phrozen Sonic Mini',
        resolutionX: 1920,
        resolutionY: 1080,
        buildWidthMM: 120,
        buildDepthMM: 68,
        buildHeightMM: 130,
      };
      const exporters = formatRegistry.getSliceExporters(printer);
      const ids = exporters.map((e) => e.id);
      expect(ids).not.toContain('goo');
    });
  });
});
