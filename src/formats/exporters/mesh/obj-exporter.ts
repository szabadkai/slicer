import type { MeshExporter, GeometryLike } from '@core/format-registry';

export const objMeshExporter: MeshExporter = {
  id: 'obj',
  name: 'OBJ (Wavefront)',
  extension: 'obj',
  async export(geometries: GeometryLike[]): Promise<Blob> {
    const { exportMeshToBlob } = await import('../../../exporter');
    return exportMeshToBlob(geometries, 'obj');
  },
};
