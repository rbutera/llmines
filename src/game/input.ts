import type { LuminesEngine } from "./engine";

export interface InputActions {
  onLeft(): void;
  onRight(): void;
  onSoftDrop(): void;
  onRotate(): void;
  onHardDrop(): void;
}

/**
 * Maps vim keys (and arrow aliases) to engine ops.
 *   h / ArrowLeft  -> left
 *   l / ArrowRight -> right
 *   j / ArrowDown  -> soft drop
 *   k / ArrowUp    -> rotate
 *   space          -> hard drop
 * Returns a detach function.
 */
export function attachKeyboard(
  target: Window | HTMLElement,
  actions: InputActions,
): () => void {
  const handler = (ev: KeyboardEvent) => {
    let handled = true;
    switch (ev.key) {
      case "h":
      case "ArrowLeft":
        actions.onLeft();
        break;
      case "l":
      case "ArrowRight":
        actions.onRight();
        break;
      case "j":
      case "ArrowDown":
        actions.onSoftDrop();
        break;
      case "k":
      case "ArrowUp":
        actions.onRotate();
        break;
      case " ":
      case "Spacebar":
        actions.onHardDrop();
        break;
      default:
        handled = false;
    }
    if (handled) ev.preventDefault();
  };
  (target as Window).addEventListener("keydown", handler as EventListener);
  return () =>
    (target as Window).removeEventListener("keydown", handler as EventListener);
}

export function engineActions(engine: LuminesEngine): InputActions {
  return {
    onLeft: () => engine.moveLeft(),
    onRight: () => engine.moveRight(),
    onSoftDrop: () => engine.softDrop(),
    onRotate: () => engine.rotate(),
    onHardDrop: () => engine.hardDrop(),
  };
}
