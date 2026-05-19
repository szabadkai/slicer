import { formatRegistry } from '@core/format-registry';

// ─── Importers ─────────────────────────────────────────────
import { stlImporter } from './importers/stl-importer';
import { objImporter } from './importers/obj-importer';
import { threemfImporter } from './importers/threemf-importer';
import { cadImporter } from './importers/cad-importer';

formatRegistry.registerImporter(stlImporter);
formatRegistry.registerImporter(objImporter);
formatRegistry.registerImporter(threemfImporter);
formatRegistry.registerImporter(cadImporter);

// ─── Mesh exporters ────────────────────────────────────────
import { stlMeshExporter } from './exporters/mesh/stl-exporter';
import { objMeshExporter } from './exporters/mesh/obj-exporter';
import { threemfMeshExporter } from './exporters/mesh/threemf-exporter';

formatRegistry.registerMeshExporter(stlMeshExporter);
formatRegistry.registerMeshExporter(objMeshExporter);
formatRegistry.registerMeshExporter(threemfMeshExporter);

// ─── Slice exporters ───────────────────────────────────────
import { zipSliceExporter } from './exporters/slice/zip-slice-exporter';
import { gooSliceExporter } from './exporters/slice/goo-slice-exporter';
import { ctbSliceExporter } from './exporters/slice/ctb-slice-exporter';
import { sl1SliceExporter } from './exporters/slice/sl1-slice-exporter';

formatRegistry.registerSliceExporter(zipSliceExporter);
formatRegistry.registerSliceExporter(gooSliceExporter);
formatRegistry.registerSliceExporter(ctbSliceExporter);
formatRegistry.registerSliceExporter(sl1SliceExporter);
