import type { InputAction } from "./controller";

/**
 * Vim-style controls (with optional arrow aliases):
 *   h / ArrowLeft  -> move left
 *   l / ArrowRight -> move right
 *   j / ArrowDown  -> soft drop
 *   k / ArrowUp    -> rotate
 *   space          -> hard drop
 */
export function keyToAction(e: KeyboardEvent): InputAction | null {
  switch (e.key) {
    case "h":
    case "H":
    case "ArrowLeft":
      return "left";
    case "l":
    case "L":
    case "ArrowRight":
      return "right";
    case "j":
    case "J":
    case "ArrowDown":
      return "softDrop";
    case "k":
    case "K":
    case "ArrowUp":
      return "rotate";
    case " ":
    case "Spacebar":
      return "hardDrop";
    default:
      return null;
  }
}
