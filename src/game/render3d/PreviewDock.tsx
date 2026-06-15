"use client";

import { PREVIEW_DEPTH, type GeneratedPiece } from "../core";
import type { BoardPalette } from "../skins/skins";
import type { VisualSettings } from "./settings";
import { Cube } from "./Cube";
import { BOARD_H, BOARD_W, CELL } from "./layout";

/**
 * In-canvas next-piece preview dock. Renders the next `PREVIEW_DEPTH` queued
 * pieces (from `RenderState.queue`) as small 3D mini-blocks stacked vertically
 * in a gutter just OUTSIDE the well to the top-left, matching Lumines (top-left,
 * topmost = next to drop). Uses the SAME `Cube` bright/dark materials as the
 * board so the preview reads identically.
 *
 * The stage is widened (a gutter to the left) by the host; this component lays
 * the previews out in that gutter's world space. Pure render — `queue` is an
 * already-additive render-only field.
 */

/** Same bright/dark mapping the board uses (block colour A = 0 = bright). */
function isBright(cell: 0 | 1): boolean {
  return cell === 0;
}

/**
 * FIX A regression seam: the bright/dark verdict for a preview SLOT, by its local
 * row/col within the 2x2 piece (r=0 top, r=1 bottom; c=0 left, c=1 right). This is
 * the EXACT mapping the dock renders (`cells[r][c]`), exported pure so a test can
 * lock it to the board's active-piece mapping (Scene3D `setActive` reads
 * `cells[r][c]` for the same r,c) and guarantee no per-slot colour swap — every
 * preview slot shows the TRUE colour of its queued piece's cell at that position.
 */
export function previewSlotIsBright(
  cells: GeneratedPiece["cells"],
  r: 0 | 1,
  c: 0 | 1,
): boolean {
  return isBright(cells[r][c]);
}

/** World-space gutter geometry (to the LEFT of the well). */
export const PREVIEW_SCALE = 0.42; // mini-cube size relative to a board cell
const PREVIEW_CELL = CELL * PREVIEW_SCALE;
/** Left edge of the well in world x. */
const WELL_LEFT = -BOARD_W / 2;
/** Gutter width reserved to the left of the well, in world units. */
export const PREVIEW_GUTTER = CELL * 2.4;
/** Centre x of a preview piece (a 2-wide cluster) in the gutter. */
const PREVIEW_X = WELL_LEFT - PREVIEW_GUTTER + PREVIEW_CELL;
/** Top y where the first (next) preview sits. */
const PREVIEW_TOP_Y = BOARD_H / 2 - PREVIEW_CELL;
/** Vertical spacing between stacked previews. */
const PREVIEW_STEP_Y = PREVIEW_CELL * 2 + CELL * 0.45;

export function PreviewDock({
  queue,
  settings,
  skinId,
  palette,
}: {
  queue: GeneratedPiece[];
  settings: VisualSettings;
  /** Active skin id — so the preview's cell shapes match the board's per-skin
      motif (sphere/X for skin1, diamond/ring for skin2). */
  skinId?: string;
  /** Active skin's board palette — so the preview's bright/dark cell colours
      match the board (e.g. skin 2 green/red), not the default neon palette. */
  palette?: BoardPalette;
}) {
  // Show the next PREVIEW_DEPTH pieces (the queue head spawns next).
  const shown = queue.slice(0, PREVIEW_DEPTH);

  return (
    <group>
      {shown.map((gp, idx) => {
        const baseY = PREVIEW_TOP_Y - idx * PREVIEW_STEP_Y;
        const cells = gp.cells;
        // 2x2 cluster: render four mini cubes at half-cell spacing.
        const slots: { r: 0 | 1; c: 0 | 1 }[] = [
          { r: 0, c: 0 },
          { r: 0, c: 1 },
          { r: 1, c: 0 },
          { r: 1, c: 1 },
        ];
        return (
          <group key={`preview-${idx}`} scale={[PREVIEW_SCALE, PREVIEW_SCALE, PREVIEW_SCALE]}>
            {slots.map(({ r, c }) => {
              const x = PREVIEW_X / PREVIEW_SCALE + (c === 0 ? -CELL / 2 : CELL / 2);
              const y = baseY / PREVIEW_SCALE + (r === 0 ? CELL / 2 : -CELL / 2);
              return (
                <Cube
                  key={`p-${idx}-${r}-${c}`}
                  position={[x, y, 0]}
                  col={c}
                  cols={2}
                  bright={previewSlotIsBright(cells, r, c)}
                  settings={settings}
                  // Match the board's per-skin cell shape so the preview reads as
                  // the same world (sphere/X for skin1, diamond/ring for skin2).
                  skinId={skinId}
                  // Match the board's per-skin cell COLOURS (e.g. skin 2 green/
                  // red) so the preview never falls back to the neon palette.
                  palette={palette}
                  // No beat breathe / heat on previews — keep them calm reference.
                  noBeat
                  // Flat 2D: previews are plain squares, no per-column shear/tilt.
                  flat
                  // Boost the bright read so colour-0 reads light (not faint/dark)
                  // in the calm preview — fixes the "preview colours look inverted".
                  preview
                />
              );
            })}
          </group>
        );
      })}
    </group>
  );
}
