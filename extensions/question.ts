/**
 * question - opencode's v2 question tool, ported to pi.
 *
 * The model sends one or more questions, each with a short `header`, a full
 * `question`, labelled options and an optional `multiple` flag. The user picks
 * with the keyboard; a "Type your own answer" option is always available.
 * Answers go back to the model as lists of the chosen labels.
 *
 * This file only maps keys to actions and draws state. Every decision lives in
 * ./logic.ts, where it is unit tested.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  type Action,
  type Answer,
  applyTyped,
  CUSTOM_LABEL,
  displayOptions,
  formatAnswers,
  initialState,
  type Question,
  reduce,
  type Step,
  typedAnswers,
} from "./logic.ts";

/** Tab labels get this much room; anything longer would wreck the tab bar. */
const HEADER_WIDTH = 30;

const OptionSchema = Type.Object({
  label: Type.String({ description: "Display text (1-5 words, concise)" }),
  description: Type.String({ description: "Explanation of choice" }),
});

const QuestionSchema = Type.Object({
  question: Type.String({ description: "Complete question" }),
  header: Type.String({
    maxLength: HEADER_WIDTH,
    description: `Very short label (max ${HEADER_WIDTH} chars)`,
  }),
  options: Type.Array(OptionSchema, { description: "Available choices" }),
  multiple: Type.Optional(Type.Boolean({ description: "Allow selecting multiple choices" })),
});

const Params = Type.Object({
  questions: Type.Array(QuestionSchema, { description: "Questions to ask" }),
});

const DESCRIPTION = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- A "${CUSTOM_LABEL}" option is added automatically; don't include "Other" or catch-all options
- Answers are returned as arrays of labels; set \`multiple: true\` to allow selecting more than one
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`;

/** What the TUI hands back, and what we store for re-rendering the tool result. */
interface Details {
  questions: Question[];
  answers: Answer[];
  cancelled: boolean;
}

/** Translate a raw keypress into the vocabulary the reducer understands. */
function toAction(data: string): Action | undefined {
  if (matchesKey(data, Key.escape)) return "cancel";
  if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) return "nextTab";
  if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) return "prevTab";
  if (matchesKey(data, Key.up)) return "up";
  if (matchesKey(data, Key.down)) return "down";
  if (matchesKey(data, Key.enter)) return "select";
  if (matchesKey(data, Key.space)) return "toggle";
  return undefined;
}

export default function question(pi: ExtensionAPI) {
  pi.registerTool({
    name: "question",
    label: "Question",
    description: DESCRIPTION,
    parameters: Params,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const questions = params.questions as Question[];
      const fail = (message: string) => ({
        content: [{ type: "text" as const, text: message }],
        details: { questions, answers: [], cancelled: true } satisfies Details,
      });

      if (ctx.mode !== "tui") return fail("Error: cannot ask questions in non-interactive mode");
      if (questions.length === 0) return fail("Error: no questions provided");
      if (signal?.aborted) return fail("User rejected the questions");

      const result = await ctx.ui.custom<Details>((tui, theme, _kb, done) => {
        const submitTab = questions.length; // only reachable when there are 2+ questions
        let state = initialState(questions);
        let finished = false;
        let cachedLines: string[] | undefined;

        const editorTheme: EditorTheme = {
          borderColor: (s) => theme.fg("accent", s),
          selectList: {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          },
        };
        const editor = new Editor(tui, editorTheme);

        const refresh = () => {
          cachedLines = undefined;
          tui.requestRender();
        };

        /** Close the dialog once, whoever gets there first. */
        function finish(cancelled: boolean) {
          if (finished) return;
          finished = true;
          done({ questions, answers: state.answers, cancelled });
        }

        function apply(step: Step) {
          state = step.state;
          if (step.effect === "submit") return finish(false);
          if (step.effect === "cancel") return finish(true);
          if (step.effect === "openEditor") editor.setText("");
          refresh();
        }

        // The turn can be aborted while the dialog is open (Esc on the spinner).
        const onAbort = () => finish(true);
        signal?.addEventListener("abort", onAbort, { once: true });

        editor.onSubmit = (value) => {
          editor.setText("");
          apply(applyTyped(questions, state, value));
        };

        function handleInput(data: string) {
          if (state.editing) {
            if (matchesKey(data, Key.escape)) {
              editor.setText("");
              apply(reduce(questions, state, "closeEditor"));
              return;
            }
            editor.handleInput(data);
            refresh();
            return;
          }

          const action = toAction(data);
          if (action) apply(reduce(questions, state, action));
        }

        function render(width: number): string[] {
          if (cachedLines) return cachedLines;
          const lines: string[] = [];
          const w = Math.max(1, width);

          function add(prefix: string, text: string) {
            const prefixWidth = visibleWidth(prefix);
            if (prefixWidth >= w) {
              lines.push(...wrapTextWithAnsi(prefix + text, w));
              return;
            }
            const wrapped = wrapTextWithAnsi(text, w - prefixWidth);
            const cont = " ".repeat(prefixWidth);
            wrapped.forEach((line, i) => lines.push(`${i === 0 ? prefix : cont}${line}`));
          }

          lines.push(theme.fg("accent", "─".repeat(w)));

          if (questions.length > 1) {
            const tabs = questions.map((q, i) => {
              const answered = state.answers[i].length > 0;
              const text = ` ${answered ? "■" : "□"} ${truncateToWidth(q.header, HEADER_WIDTH)} `;
              if (i === state.tab) return theme.bg("selectedBg", theme.fg("text", text));
              return theme.fg(answered ? "success" : "muted", text);
            });
            const anyAnswered = state.answers.some((a) => a.length > 0);
            const submit = " ✓ Submit ";
            tabs.push(
              state.tab === submitTab
                ? theme.bg("selectedBg", theme.fg("text", submit))
                : theme.fg(anyAnswered ? "success" : "dim", submit),
            );
            add(" ", `← ${tabs.join(" ")} →`);
            lines.push("");
          }

          if (state.tab === submitTab) {
            add(" ", theme.fg("accent", theme.bold("Ready to submit")));
            lines.push("");
            questions.forEach((q, i) => {
              const answer = state.answers[i];
              const value = answer.length ? answer.join(", ") : theme.fg("dim", "Unanswered");
              const label = truncateToWidth(q.header, HEADER_WIDTH);
              add(" ", `${theme.fg("muted", `${label}: `)}${theme.fg("text", value)}`);
            });
            lines.push("");
            add(" ", theme.fg("dim", "Tab/←→ navigate • Enter submit • Esc cancel"));
            lines.push(theme.fg("accent", "─".repeat(w)));
            cachedLines = lines;
            return lines;
          }

          const q = questions[state.tab];
          const answer = state.answers[state.tab];
          add(" ", theme.fg("text", q.question));
          lines.push("");

          displayOptions(q).forEach((opt, i) => {
            const focused = i === state.optionIndex;
            const checked = answer.includes(opt.label);
            const marker = q.multiple && !opt.isCustom ? (checked ? "[x] " : "[ ] ") : `${i + 1}. `;
            const color =
              focused || (opt.isCustom && state.editing) ? "accent" : checked ? "success" : "text";
            add(
              focused ? theme.fg("accent", "> ") : "  ",
              theme.fg(color, marker + opt.label + (opt.isCustom && state.editing ? " ✎" : "")),
            );
            if (opt.description) add("     ", theme.fg("muted", opt.description));
          });

          // Answers the user typed match no option row, so list them separately.
          for (const typed of typedAnswers(q, answer)) {
            add("  ", theme.fg("success", `[x] ${typed}`));
          }

          if (state.editing) {
            lines.push("");
            add(" ", theme.fg("muted", "Your answer:"));
            for (const line of editor.render(Math.max(1, w - 2))) lines.push(` ${line}`);
          }

          lines.push("");
          add(
            " ",
            theme.fg(
              "dim",
              state.editing
                ? "Enter to submit • Esc to go back"
                : q.multiple
                  ? "↑↓ navigate • Space toggle • Enter confirm • Esc cancel"
                  : "↑↓ navigate • Enter select • Esc cancel",
            ),
          );
          lines.push(theme.fg("accent", "─".repeat(w)));

          cachedLines = lines;
          return lines;
        }

        return {
          render,
          invalidate: () => {
            cachedLines = undefined;
          },
          handleInput,
          dispose: () => signal?.removeEventListener("abort", onAbort),
        };
      });

      if (result.cancelled) {
        return {
          content: [{ type: "text" as const, text: "User rejected the questions" }],
          details: result,
        };
      }
      return {
        content: [{ type: "text" as const, text: formatAnswers(questions, result.answers) }],
        details: result,
      };
    },

    renderCall(args, theme) {
      const qs = (args.questions ?? []) as Question[];
      const headers = qs.map((q) => truncateToWidth(q.header, HEADER_WIDTH)).join(", ");
      return new Text(
        theme.fg("toolTitle", theme.bold("question ")) +
          theme.fg("muted", `${qs.length} question${qs.length === 1 ? "" : "s"}`) +
          (headers ? theme.fg("dim", ` (${headers})`) : ""),
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as Details | undefined;
      if (!details) return new Text("", 0, 0);
      if (details.cancelled) return new Text(theme.fg("warning", "Rejected"), 0, 0);
      const lines = details.questions.map((q, i) => {
        const answer = details.answers[i];
        const label = theme.fg("muted", `${truncateToWidth(q.header, HEADER_WIDTH)}: `);
        return answer?.length
          ? `${theme.fg("success", "✓ ")}${label}${theme.fg("accent", answer.join(", "))}`
          : `${theme.fg("dim", "· ")}${label}${theme.fg("dim", "Unanswered")}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
