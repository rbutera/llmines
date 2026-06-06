/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InputHandler, type InputActions } from "../input";

function createMockActions(): InputActions {
  return {
    moveLeft: vi.fn(),
    moveRight: vi.fn(),
    softDrop: vi.fn(),
    rotate: vi.fn(),
    hardDrop: vi.fn(),
  };
}

function keyDown(key: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

function keyUp(key: string): void {
  window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
}

describe("InputHandler", () => {
  let actions: InputActions;
  let handler: InputHandler;

  beforeEach(() => {
    vi.useFakeTimers();
    actions = createMockActions();
    handler = new InputHandler(actions);
    handler.attach();
  });

  afterEach(() => {
    handler.detach();
    vi.useRealTimers();
  });

  describe("key mapping", () => {
    it("maps 'h' to moveLeft", () => {
      keyDown("h");
      expect(actions.moveLeft).toHaveBeenCalledOnce();
    });

    it("maps 'l' to moveRight", () => {
      keyDown("l");
      expect(actions.moveRight).toHaveBeenCalledOnce();
    });

    it("maps 'j' to softDrop", () => {
      keyDown("j");
      expect(actions.softDrop).toHaveBeenCalledOnce();
    });

    it("maps 'k' to rotate", () => {
      keyDown("k");
      expect(actions.rotate).toHaveBeenCalledOnce();
    });

    it("maps space to hardDrop", () => {
      keyDown(" ");
      expect(actions.hardDrop).toHaveBeenCalledOnce();
    });

    it("maps ArrowLeft to moveLeft", () => {
      keyDown("ArrowLeft");
      expect(actions.moveLeft).toHaveBeenCalledOnce();
    });

    it("maps ArrowRight to moveRight", () => {
      keyDown("ArrowRight");
      expect(actions.moveRight).toHaveBeenCalledOnce();
    });

    it("maps ArrowDown to softDrop", () => {
      keyDown("ArrowDown");
      expect(actions.softDrop).toHaveBeenCalledOnce();
    });

    it("maps ArrowUp to rotate", () => {
      keyDown("ArrowUp");
      expect(actions.rotate).toHaveBeenCalledOnce();
    });

    it("ignores unmapped keys", () => {
      keyDown("x");
      expect(actions.moveLeft).not.toHaveBeenCalled();
      expect(actions.moveRight).not.toHaveBeenCalled();
      expect(actions.softDrop).not.toHaveBeenCalled();
      expect(actions.rotate).not.toHaveBeenCalled();
      expect(actions.hardDrop).not.toHaveBeenCalled();
    });
  });

  describe("DAS for lateral keys", () => {
    it("fires moveLeft immediately then repeats after DAS_DELAY at DAS_REPEAT interval", () => {
      keyDown("h");
      expect(actions.moveLeft).toHaveBeenCalledTimes(1);

      // Before DAS_DELAY: no repeat yet
      vi.advanceTimersByTime(232);
      expect(actions.moveLeft).toHaveBeenCalledTimes(1);

      // At DAS_DELAY (233ms): fires once more
      vi.advanceTimersByTime(1);
      expect(actions.moveLeft).toHaveBeenCalledTimes(2);

      // After one DAS_REPEAT interval (133ms)
      vi.advanceTimersByTime(133);
      expect(actions.moveLeft).toHaveBeenCalledTimes(3);

      // After another DAS_REPEAT interval
      vi.advanceTimersByTime(133);
      expect(actions.moveLeft).toHaveBeenCalledTimes(4);
    });

    it("stops DAS repeat on keyup", () => {
      keyDown("l");
      expect(actions.moveRight).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(233);
      expect(actions.moveRight).toHaveBeenCalledTimes(2);

      keyUp("l");

      vi.advanceTimersByTime(500);
      expect(actions.moveRight).toHaveBeenCalledTimes(2);
    });

    it("works with ArrowLeft the same as h", () => {
      keyDown("ArrowLeft");
      expect(actions.moveLeft).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(233);
      expect(actions.moveLeft).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(133);
      expect(actions.moveLeft).toHaveBeenCalledTimes(3);
    });
  });

  describe("soft drop repeat", () => {
    it("fires immediately and repeats at 50ms with no initial delay", () => {
      keyDown("j");
      expect(actions.softDrop).toHaveBeenCalledTimes(1);

      // After 50ms: first repeat
      vi.advanceTimersByTime(50);
      expect(actions.softDrop).toHaveBeenCalledTimes(2);

      // After another 50ms: second repeat
      vi.advanceTimersByTime(50);
      expect(actions.softDrop).toHaveBeenCalledTimes(3);
    });

    it("stops repeat on keyup", () => {
      keyDown("j");
      vi.advanceTimersByTime(100);
      expect(actions.softDrop).toHaveBeenCalledTimes(3); // immediate + 2 repeats

      keyUp("j");
      vi.advanceTimersByTime(200);
      expect(actions.softDrop).toHaveBeenCalledTimes(3);
    });
  });

  describe("rotate and hard drop fire once only", () => {
    it("rotate does not repeat when held", () => {
      keyDown("k");
      expect(actions.rotate).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(actions.rotate).toHaveBeenCalledTimes(1);
    });

    it("hard drop does not repeat when held", () => {
      keyDown(" ");
      expect(actions.hardDrop).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1000);
      expect(actions.hardDrop).toHaveBeenCalledTimes(1);
    });
  });

  describe("setEnabled", () => {
    it("ignores all inputs when disabled", () => {
      handler.setEnabled(false);

      keyDown("h");
      keyDown("l");
      keyDown("j");
      keyDown("k");
      keyDown(" ");

      expect(actions.moveLeft).not.toHaveBeenCalled();
      expect(actions.moveRight).not.toHaveBeenCalled();
      expect(actions.softDrop).not.toHaveBeenCalled();
      expect(actions.rotate).not.toHaveBeenCalled();
      expect(actions.hardDrop).not.toHaveBeenCalled();
    });

    it("stops active repeats when disabled", () => {
      keyDown("h");
      expect(actions.moveLeft).toHaveBeenCalledTimes(1);

      handler.setEnabled(false);

      vi.advanceTimersByTime(1000);
      expect(actions.moveLeft).toHaveBeenCalledTimes(1);
    });

    it("resumes accepting input when re-enabled", () => {
      handler.setEnabled(false);
      handler.setEnabled(true);

      keyDown("h");
      expect(actions.moveLeft).toHaveBeenCalledOnce();
    });
  });

  describe("attach/detach", () => {
    it("does not receive events after detach", () => {
      handler.detach();

      keyDown("h");
      expect(actions.moveLeft).not.toHaveBeenCalled();
    });

    it("clears all timers on detach", () => {
      keyDown("h");
      expect(actions.moveLeft).toHaveBeenCalledTimes(1);

      handler.detach();

      vi.advanceTimersByTime(1000);
      expect(actions.moveLeft).toHaveBeenCalledTimes(1);
    });

    it("receives events after re-attach", () => {
      handler.detach();
      handler.attach();

      keyDown("l");
      expect(actions.moveRight).toHaveBeenCalledOnce();
    });
  });

  describe("OS key-repeat suppression", () => {
    it("ignores repeated keydown events for the same key", () => {
      keyDown("h");
      keyDown("h"); // OS repeat — should be ignored
      keyDown("h"); // OS repeat — should be ignored

      expect(actions.moveLeft).toHaveBeenCalledTimes(1);
    });
  });

  describe("preventDefault on game keys", () => {
    it("prevents default on mapped keys", () => {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });
      const preventSpy = vi.spyOn(event, "preventDefault");
      window.dispatchEvent(event);
      expect(preventSpy).toHaveBeenCalled();
    });
  });
});
