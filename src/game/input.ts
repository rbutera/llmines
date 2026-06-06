import { DAS_DELAY, DAS_REPEAT, SOFT_DROP_INTERVAL } from "./constants";

export type InputActions = {
  moveLeft: () => void;
  moveRight: () => void;
  softDrop: () => void;
  rotate: () => void;
  hardDrop: () => void;
};

type Action = keyof InputActions;

const KEY_MAP: Record<string, Action> = {
  h: "moveLeft",
  l: "moveRight",
  j: "softDrop",
  k: "rotate",
  " ": "hardDrop",
  ArrowLeft: "moveLeft",
  ArrowRight: "moveRight",
  ArrowDown: "softDrop",
  ArrowUp: "rotate",
};

/** Set of keys that use DAS (Delayed Auto Shift) for repeat. */
const LATERAL_ACTIONS: ReadonlySet<Action> = new Set(["moveLeft", "moveRight"]);

export class InputHandler {
  private actions: InputActions;
  private activeKeys = new Set<string>();
  private dasTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private repeatTimers = new Map<string, ReturnType<typeof setInterval>>();
  private enabled = true;

  constructor(actions: InputActions) {
    this.actions = actions;
  }

  attach(): void {
    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
  }

  detach(): void {
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
    this.clearAllTimers();
    this.activeKeys.clear();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clearAllTimers();
      this.activeKeys.clear();
    }
  }

  private boundKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
  private boundKeyUp = (e: KeyboardEvent): void => this.handleKeyUp(e);

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;

    const action = KEY_MAP[e.key];
    if (!action) return;

    e.preventDefault();

    // Ignore OS key-repeat events
    if (this.activeKeys.has(e.key)) return;
    this.activeKeys.add(e.key);

    // Fire immediately
    this.actions[action]();

    // Set up auto-repeat based on action type
    if (LATERAL_ACTIONS.has(action)) {
      // DAS: initial delay, then repeat
      const dasTimer = setTimeout(() => {
        this.actions[action]();
        const repeatTimer = setInterval(() => {
          this.actions[action]();
        }, DAS_REPEAT);
        this.repeatTimers.set(e.key, repeatTimer);
      }, DAS_DELAY);
      this.dasTimers.set(e.key, dasTimer);
    } else if (action === "softDrop") {
      // Soft drop: immediate repeat with no initial delay
      const repeatTimer = setInterval(() => {
        this.actions[action]();
      }, SOFT_DROP_INTERVAL);
      this.repeatTimers.set(e.key, repeatTimer);
    }
    // rotate and hardDrop: fire once only, no repeat
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const action = KEY_MAP[e.key];
    if (!action) return;

    this.activeKeys.delete(e.key);
    this.clearTimersForKey(e.key);
  }

  private clearTimersForKey(key: string): void {
    const dasTimer = this.dasTimers.get(key);
    if (dasTimer) {
      clearTimeout(dasTimer);
      this.dasTimers.delete(key);
    }
    const repeatTimer = this.repeatTimers.get(key);
    if (repeatTimer) {
      clearInterval(repeatTimer);
      this.repeatTimers.delete(key);
    }
  }

  private clearAllTimers(): void {
    for (const timer of this.dasTimers.values()) clearTimeout(timer);
    for (const timer of this.repeatTimers.values()) clearInterval(timer);
    this.dasTimers.clear();
    this.repeatTimers.clear();
  }
}
