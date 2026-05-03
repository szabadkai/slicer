/**
 * Simple bottom-left bin-packing for arranging models on a build plate.
 * Places bounding boxes in rows, left to right, advancing Y when a row fills.
 */

export interface BoundingBox {
  id: string;
  width: number;
  depth: number;
}

export interface PlacedBox {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  overflow?: boolean;
}

export interface ArrangeResult {
  placed: PlacedBox[];
  overflow: string[];
}

const PADDING_MM = 3;

export function arrangeModels(
  boxes: BoundingBox[],
  buildWidthMM: number,
  buildDepthMM: number,
): ArrangeResult {
  // Sort by depth descending for better row packing
  const sorted = [...boxes].sort((a, b) => b.depth - a.depth);

  const placed: PlacedBox[] = [];
  const overflow: string[] = [];
  const overflowBoxes: BoundingBox[] = [];

  let cursorX = 0;
  let cursorZ = 0;
  let rowHeight = 0;

  for (const box of sorted) {
    // Check if model fits on the plate at all
    if (box.width > buildWidthMM || box.depth > buildDepthMM) {
      overflow.push(box.id);
      overflowBoxes.push(box);
      continue;
    }

    // Try to place in current row
    if (cursorX + box.width > buildWidthMM) {
      // Move to next row
      cursorX = 0;
      cursorZ += rowHeight + PADDING_MM;
      rowHeight = 0;
    }

    // Check if fits in depth
    if (cursorZ + box.depth > buildDepthMM) {
      overflow.push(box.id);
      overflowBoxes.push(box);
      continue;
    }

    placed.push({
      id: box.id,
      x: cursorX,
      z: cursorZ,
      width: box.width,
      depth: box.depth,
    });

    cursorX += box.width + PADDING_MM;
    rowHeight = Math.max(rowHeight, box.depth);
  }

  // Place overflow models outside the build volume (+X side), packed with BLF rows
  if (overflowBoxes.length > 0) {
    let ofCursorX = 0;
    let ofCursorZ = 0;
    let ofRowHeight = 0;
    const startX = buildWidthMM + PADDING_MM;

    for (const box of overflowBoxes) {
      if (ofCursorX + box.width > buildWidthMM * 4) {
        ofCursorX = 0;
        ofCursorZ += ofRowHeight + PADDING_MM;
        ofRowHeight = 0;
      }

      placed.push({
        id: box.id,
        x: startX + ofCursorX,
        z: ofCursorZ,
        width: box.width,
        depth: box.depth,
        overflow: true,
      });

      ofCursorX += box.width + PADDING_MM;
      ofRowHeight = Math.max(ofRowHeight, box.depth);
    }
  }

  return { placed, overflow };
}

export function hasOverlap(boxes: PlacedBox[]): boolean {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.z < b.z + b.depth &&
        a.z + a.depth > b.z
      ) {
        return true;
      }
    }
  }
  return false;
}
