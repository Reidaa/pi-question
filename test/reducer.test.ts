import { expect, test } from "vitest";
import {
  type Action,
  applyTyped,
  type Effect,
  initialState,
  type Question,
  reduce,
} from "../extensions/logic.ts";

const opt = (label: string) => ({ label, description: `about ${label}` });

const single: Question[] = [
  { question: "Runtime?", header: "Runtime", options: [opt("Bun"), opt("Node")] },
];
const multi: Question[] = [
  { question: "Runtime?", header: "Runtime", options: [opt("Bun"), opt("Node")] },
  { question: "Extras?", header: "Extras", options: [opt("Lint"), opt("Types")], multiple: true },
];

/** Replay a key sequence and return the final state plus the last effect. */
function play(questions: Question[], actions: Action[]) {
  let state = initialState(questions);
  let effect: Effect | undefined;
  for (const action of actions) {
    const step = reduce(questions, state, action);
    state = step.state;
    effect = step.effect;
  }
  return { state, effect };
}

test("one single-choice question submits as soon as it is answered", () => {
  const { state, effect } = play(single, ["down", "select"]);
  expect(effect).toBe("submit");
  expect(state.answers).toEqual([["Node"]]);
});

test("focus stays inside the option list at both ends", () => {
  expect(play(single, ["up", "up"]).state.optionIndex).toBe(0);
  // 2 options + the custom entry = 3 rows, so the last index is 2.
  expect(play(single, ["down", "down", "down", "down"]).state.optionIndex).toBe(2);
});

test("answering a question moves to the next one, then to the submit tab", () => {
  expect(play(multi, ["select"]).state.tab).toBe(1);
  expect(play(multi, ["select", "select"]).state.tab).toBe(2);
});

test("only the submit tab submits, and it ignores option keys", () => {
  const atSubmit = play(multi, ["select", "select"]);
  expect(atSubmit.effect).toBeUndefined();
  expect(reduce(multi, atSubmit.state, "down").effect).toBeUndefined();
  expect(reduce(multi, atSubmit.state, "select").effect).toBe("submit");
});

test("tabs wrap around in both directions", () => {
  // 2 questions + submit tab = 3 tabs.
  expect(play(multi, ["prevTab"]).state.tab).toBe(2);
  expect(play(multi, ["nextTab", "nextTab", "nextTab"]).state.tab).toBe(0);
  // A single question has no tab bar to move through.
  expect(play(single, ["nextTab"]).state.tab).toBe(0);
});

test("switching tabs resets the highlighted option", () => {
  expect(play(multi, ["down", "nextTab"]).state.optionIndex).toBe(0);
});

test("multi-select toggles on and off without leaving the question", () => {
  const on = play(multi, ["nextTab", "toggle"]);
  expect(on.state.answers[1]).toEqual(["Lint"]);
  expect(on.state.tab).toBe(1);
  expect(play(multi, ["nextTab", "toggle", "toggle"]).state.answers[1]).toEqual([]);
  expect(play(multi, ["nextTab", "toggle", "down", "toggle"]).state.answers[1]).toEqual([
    "Lint",
    "Types",
  ]);
});

test("confirming a multi-select question with nothing picked takes the highlighted option", () => {
  const { state } = play(multi, ["nextTab", "select"]);
  expect(state.answers[1]).toEqual(["Lint"]);
  expect(state.tab).toBe(2);
});

test("confirming a multi-select question keeps what was already toggled", () => {
  const { state } = play(multi, ["nextTab", "down", "toggle", "select"]);
  expect(state.answers[1]).toEqual(["Types"]);
});

test("space does nothing on single-choice questions or on the custom row", () => {
  expect(play(single, ["toggle"]).state.answers).toEqual([[]]);
  expect(play(multi, ["nextTab", "down", "down", "toggle"]).state.answers[1]).toEqual([]);
});

test("the custom row opens the editor instead of answering", () => {
  const { state, effect } = play(single, ["down", "down", "select"]);
  expect(effect).toBe("openEditor");
  expect(state.editing).toBe(true);
  expect(state.answers).toEqual([[]]);
});

test("typed text answers a single-choice question and submits", () => {
  const opened = play(single, ["down", "down", "select"]);
  const typed = applyTyped(single, opened.state, "Deno");
  expect(typed.effect).toBe("submit");
  expect(typed.state.editing).toBe(false);
  expect(typed.state.answers).toEqual([["Deno"]]);
});

test("empty typed text just closes the editor", () => {
  const opened = play(single, ["down", "down", "select"]);
  const typed = applyTyped(single, opened.state, "   ");
  expect(typed.effect).toBeUndefined();
  expect(typed.state.editing).toBe(false);
  expect(typed.state.answers).toEqual([[]]);
});

test("typed text adds to a multi-select question without leaving it", () => {
  const opened = play(multi, ["nextTab", "toggle", "down", "down", "select"]);
  const typed = applyTyped(multi, opened.state, "Docs");
  expect(typed.effect).toBeUndefined();
  expect(typed.state.tab).toBe(1);
  expect(typed.state.answers[1]).toEqual(["Lint", "Docs"]);
});

test("escape cancels from anywhere", () => {
  expect(play(single, ["cancel"]).effect).toBe("cancel");
  expect(play(multi, ["select", "select", "cancel"]).effect).toBe("cancel");
});

test("earlier answers are never mutated in place", () => {
  const start = initialState(multi);
  reduce(multi, start, "select");
  expect(start.answers).toEqual([[], []]);
});
