import type { FormatImporter } from '@core/format-registry';
import type { ParsedGeometry } from '@features/model-io/load';

export const cadImporter: FormatImporter = {
  id: 'cad',
  name: 'CAD (STEP / IGES / BREP)',
  extensions: ['step', 'stp', 'iges', 'igs', 'brep'],
  async parse(buffer: ArrayBuffer, filename: string): Promise<ParsedGeometry> {
    const { parseCadFile } = await import('@features/model-io/cad-loader');
    return parseCadFile(buffer, filename);
  },
};
