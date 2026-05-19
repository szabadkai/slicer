import { describe, it, expect } from 'vitest';
import { threemfImporter } from './threemf-importer';
import JSZip from 'jszip';

async function make3mfBuffer(modelXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`,
  );
  const rels = zip.folder('_rels');
  rels!.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`,
  );
  const modelFolder = zip.folder('3D');
  modelFolder!.file('3dmodel.model', modelXml);
  const blob = await zip.generateAsync({ type: 'arraybuffer' });
  return blob;
}

const SINGLE_TRIANGLE_MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="1" y="0" z="0"/>
          <vertex x="0" y="1" z="0"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;

const TWO_TRIANGLE_MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="1" y="0" z="0"/>
          <vertex x="1" y="1" z="0"/>
          <vertex x="0" y="1" z="0"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
          <triangle v1="0" v2="2" v3="3"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;

describe('threemfImporter', () => {
  it('has correct metadata', () => {
    expect(threemfImporter.id).toBe('3mf');
    expect(threemfImporter.extensions).toEqual(['3mf']);
  });

  it('parses a single triangle', async () => {
    const buffer = await make3mfBuffer(SINGLE_TRIANGLE_MODEL);
    const result = await threemfImporter.parse(buffer, 'test.3mf');
    expect(result.triangleCount).toBe(1);
    expect(result.positions.length).toBe(9);
    expect(result.normals.length).toBe(9);
    // Vertex positions
    expect(result.positions[0]).toBe(0);
    expect(result.positions[3]).toBe(1);
    expect(result.positions[7]).toBe(1);
  });

  it('parses two triangles (quad)', async () => {
    const buffer = await make3mfBuffer(TWO_TRIANGLE_MODEL);
    const result = await threemfImporter.parse(buffer, 'test.3mf');
    expect(result.triangleCount).toBe(2);
    expect(result.positions.length).toBe(18);
  });

  it('computes face normals', async () => {
    const buffer = await make3mfBuffer(SINGLE_TRIANGLE_MODEL);
    const result = await threemfImporter.parse(buffer, 'test.3mf');
    // Triangle in XY plane, normal should point in +Z or -Z
    expect(Math.abs(result.normals[2])).toBeCloseTo(1, 5);
  });

  it('throws on missing model file', async () => {
    const zip = new JSZip();
    zip.file('other.txt', 'hello');
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });
    await expect(threemfImporter.parse(buffer, 'bad.3mf')).rejects.toThrow(
      'missing 3D/3dmodel.model',
    );
  });

  it('throws on empty mesh', async () => {
    const emptyModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1" type="model"><mesh><vertices/><triangles/></mesh></object></resources>
  <build><item objectid="1"/></build>
</model>`;
    const buffer = await make3mfBuffer(emptyModel);
    await expect(threemfImporter.parse(buffer, 'empty.3mf')).rejects.toThrow('no mesh data');
  });
});
