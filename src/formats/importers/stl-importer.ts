import type { FormatImporter } from '@core/format-registry';
import { parseStl } from '@features/model-io/load';

export const stlImporter: FormatImporter = {
  id: 'stl',
  name: 'STL (Stereolithography)',
  extensions: ['stl'],
  async parse(buffer: ArrayBuffer): Promise<ReturnType<typeof parseStl>> {
    return parseStl(buffer);
  },
};
