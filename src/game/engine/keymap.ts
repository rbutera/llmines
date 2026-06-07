import type { InputAction } from "./controller";

/**
 * Three control schemes, all live at once:
 *   - Arrows: Left/Right/Down/Up
 *   - Vim:    h / l / j / k
 *   - ESDF:   s (left) / f (right) / d (soft drop) / e (rotate)
 *   - Space:  hard drop (all schemes)
 *
 * Letter matching is case-insensitive. ESDF has no dedicated hard-drop letter;
 * Space remains the hard-drop in every scheme.
 */
export function keyToAction(e: KeyboardEvent): InputAction | null {
  switch (e.key) {
    case "h":
    case "H":
    case "s":
    case "S":
    case "ArrowLeft":
      return "left";
    case "l":
    case "L":
    case "f":
    case "F":
    case "ArrowRight":
      return "right";
    case "j":
    case "J":
    case "d":
    case "D":
    case "ArrowDown":
      return "softDrop";
    case "k":
    case "K":
    case "e":
    case "E":
    case "ArrowUp":
      return "rotate";
    case " ":
    case "Spacebar":
      return "hardDrop";
    default:
      return null;
  }
}
