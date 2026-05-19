import type { MeshExporter, GeometryLike } from '@core/format-registry';

export const stlMeshExporter: MeshExporter = {
  id: 'stl',
  name: 'STL (Binary)',
  extension: 'stl',
  async export(geometries: GeometryLike[]): Promise<Blob> {
    const { exportMeshToBlob } = await import('../../../exporter');
    return exportMeshToBlob(geometries, 'stl');
  },
};
