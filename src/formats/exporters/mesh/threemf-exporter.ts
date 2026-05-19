import type { MeshExporter, GeometryLike } from '@core/format-registry';

export const threemfMeshExporter: MeshExporter = {
  id: '3mf',
  name: '3MF',
  extension: '3mf',
  async export(geometries: GeometryLike[]): Promise<Blob> {
    const { exportMeshToBlob } = await import('../../../exporter');
    return exportMeshToBlob(geometries, '3mf');
  },
};
