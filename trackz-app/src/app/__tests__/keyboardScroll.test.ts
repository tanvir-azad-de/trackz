import { describe, expect, it } from "vitest";
import { createKeyboardScrollGuard, raisesKeyboard } from "@/app/keyboardScroll";

function fakePort(startY = 0) {
  const calls: [number, number][] = [];
  let y = startY;
  return {
    calls,
    setY(v: number) {
      y = v;
    },
    port: {
      scrollX: () => 0,
      scrollY: () => y,
      scrollTo: (sx: number, sy: number) => {
        calls.push([sx, sy]);
        y = sy;
      },
    },
  };
}

const amount = { tagName: "INPUT", type: "text" };
const note = { tagName: "TEXTAREA" };
const saveButton = { tagName: "BUTTON" };

describe("raisesKeyboard", () => {
  it("is true for text-like inputs and textareas, false for buttons/checkboxes/selects", () => {
    expect(raisesKeyboard(amount)).toBe(true);
    expect(raisesKeyboard({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(raisesKeyboard({ tagName: "INPUT" })).toBe(true);
    expect(raisesKeyboard(note)).toBe(true);
    expect(raisesKeyboard({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(raisesKeyboard({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(raisesKeyboard({ tagName: "SELECT" })).toBe(false);
    expect(raisesKeyboard(saveButton)).toBe(false);
    expect(raisesKeyboard(null)).toBe(false);
  });
});

describe("createKeyboardScrollGuard", () => {
  it("restores the pre-keyboard scroll when Done blurs the field (relatedTarget null)", () => {
    const f = fakePort(0);
    const guard = createKeyboardScrollGuard(f.port);
    guard.focusIn(amount);
    f.setY(260); // iOS shifts the page for the keyboard
    guard.focusOut(null);
    expect(f.calls).toEqual([[0, 0]]);
  });

  it("restores even when scrollY already reads the saved value (offset in the visual viewport)", () => {
    const f = fakePort(0);
    const guard = createKeyboardScrollGuard(f.port);
    guard.focusIn(amount);
    guard.focusOut(null);
    expect(f.calls).toEqual([[0, 0]]);
  });

  it("keeps the FIRST position across input -> input focus moves", () => {
    const f = fakePort(120);
    const guard = createKeyboardScrollGuard(f.port);
    guard.focusIn(amount);
    f.setY(380);
    guard.focusOut(note);
    guard.focusIn(note);
    expect(f.calls).toEqual([]);
    guard.focusOut(saveButton);
    expect(f.calls).toEqual([[0, 120]]);
  });

  it("repeats the restore once on the next viewport resize, then stops", () => {
    const f = fakePort(40);
    const guard = createKeyboardScrollGuard(f.port);
    guard.focusIn(amount);
    f.setY(300);
    guard.focusOut(null);
    guard.viewportResized();
    guard.viewportResized();
    expect(f.calls).toEqual([
      [0, 40],
      [0, 40],
    ]);
  });

  it("does nothing for focus that never raised a keyboard", () => {
    const f = fakePort(0);
    const guard = createKeyboardScrollGuard(f.port);
    guard.focusIn(saveButton);
    guard.focusOut(null);
    guard.viewportResized();
    expect(f.calls).toEqual([]);
  });

  it("does not restore on the resize caused by the keyboard OPENING", () => {
    const f = fakePort(0);
    const guard = createKeyboardScrollGuard(f.port);
    guard.focusIn(amount);
    guard.viewportResized();
    expect(f.calls).toEqual([]);
  });

  it("drops the pending resize restore once a field takes focus again", () => {
    const f = fakePort(0);
    const guard = createKeyboardScrollGuard(f.port);
    guard.focusIn(amount);
    f.setY(260);
    guard.focusOut(null);
    guard.focusIn(note); // tapped another field before the keyboard finished closing
    f.setY(260);
    guard.viewportResized();
    expect(f.calls).toEqual([[0, 0]]);
  });
});
