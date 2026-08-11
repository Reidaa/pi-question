import { expect, test } from "vitest";
import { CUSTOM_LABEL, displayOptions, formatAnswers, typedAnswers } from "../extensions/logic.ts";

test("a custom answer option is always appended", () => {
  const opts = displayOptions({
    question: "q",
    header: "h",
    options: [{ label: "A", description: "a" }],
  });
  expect(opts.map((o) => o.label)).toEqual(["A", CUSTOM_LABEL]);
  expect(opts[1].isCustom).toBe(true);
});

test("typed answers are separated from the offered options so they stay visible", () => {
  const q = { question: "q", header: "h", options: [{ label: "A", description: "a" }] };
  expect(typedAnswers(q, ["A", "something I typed"])).toEqual(["something I typed"]);
});

test("answers are formatted the way opencode reports them to the model", () => {
  const questions = [
    { question: "Which stack?", header: "Stack", options: [] },
    { question: "Deploy now?", header: "Deploy", options: [] },
  ];
  expect(formatAnswers(questions, [["Bun", "Node"], []])).toBe(
    'User has answered your questions: "Which stack?"="Bun, Node", "Deploy now?"="Unanswered". ' +
      "You can now continue with the user's answers in mind.",
  );
});
