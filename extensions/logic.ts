/**
 * Everything the question dialog decides, kept free of TUI imports so it can be
 * unit tested on its own. The extension only translates keypresses into the
 * `Action` vocabulary below and draws the resulting state.
 */

export interface Option {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header: string;
  options: Option[];
  multiple?: boolean;
}

/** Each answer is the list of option labels the user picked (empty = skipped). */
export type Answer = string[];

export const CUSTOM_LABEL = "Type your own answer";

export type DisplayOption = Option & { isCustom?: boolean };

/** Options shown in the UI: the model's options plus the always-on custom entry. */
export function displayOptions(q: Question): DisplayOption[] {
  return [...q.options, { label: CUSTOM_LABEL, isCustom: true }];
}

/** Answers the user typed themselves, i.e. the ones no option offered. */
export function typedAnswers(q: Question, answer: Answer): string[] {
  return answer.filter((a) => !q.options.some((o) => o.label === a));
}

/** The sentence opencode feeds back to the model after the user answers. */
export function formatAnswers(questions: readonly Question[], answers: readonly Answer[]): string {
  const formatted = questions
    .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
    .join(", ");
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`;
}

// --- Dialog state machine -------------------------------------------------

/** What a keypress means, once the extension has matched it. */
export type Action =
  | "up"
  | "down"
  | "select"
  | "toggle"
  | "nextTab"
  | "prevTab"
  | "cancel"
  | "closeEditor";

/** What the extension must do besides redrawing. */
export type Effect = "submit" | "cancel" | "openEditor";

export interface State {
  /** Index of the current question, or `questions.length` for the submit tab. */
  tab: number;
  optionIndex: number;
  editing: boolean;
  answers: Answer[];
}

export interface Step {
  state: State;
  effect?: Effect;
}

export function initialState(questions: readonly Question[]): State {
  return { tab: 0, optionIndex: 0, editing: false, answers: questions.map(() => []) };
}

/** A lone question needs no tab bar and no submit tab: answering it is submitting. */
const hasTabs = (questions: readonly Question[]) => questions.length > 1;
const submitTabOf = (questions: readonly Question[]) => questions.length;

/** Move to the next question, or finish when there is nothing left to ask. */
function advance(questions: readonly Question[], state: State): Step {
  if (!hasTabs(questions)) return { state, effect: "submit" };
  return {
    state: {
      ...state,
      tab: Math.min(state.tab + 1, submitTabOf(questions)),
      optionIndex: 0,
      editing: false,
    },
  };
}

/**
 * Record `label` for the current question: multi-select toggles it and stays
 * put, single-select replaces the answer and moves on.
 */
export function applyPick(questions: readonly Question[], state: State, label: string): Step {
  const q = questions[state.tab];
  if (!q) return { state };

  const answers = state.answers.map((a) => [...a]);
  if (q.multiple) {
    const current = answers[state.tab];
    const at = current.indexOf(label);
    if (at >= 0) current.splice(at, 1);
    else current.push(label);
    return { state: { ...state, answers, editing: false } };
  }

  answers[state.tab] = [label];
  return advance(questions, { ...state, answers, editing: false });
}

/** Apply the text the user typed into the custom-answer editor. */
export function applyTyped(questions: readonly Question[], state: State, text: string): Step {
  const trimmed = text.trim();
  if (!trimmed) return { state: { ...state, editing: false } };
  return applyPick(questions, state, trimmed);
}

export function reduce(questions: readonly Question[], state: State, action: Action): Step {
  const submitTab = submitTabOf(questions);

  if (action === "cancel") return { state, effect: "cancel" };
  if (action === "closeEditor") return { state: { ...state, editing: false } };

  if (action === "nextTab" || action === "prevTab") {
    if (!hasTabs(questions)) return { state };
    const count = submitTab + 1;
    const delta = action === "nextTab" ? 1 : count - 1;
    return {
      state: { ...state, tab: (state.tab + delta) % count, optionIndex: 0, editing: false },
    };
  }

  if (state.tab === submitTab) {
    return action === "select" ? { state, effect: "submit" } : { state };
  }

  const q = questions[state.tab];
  const options = displayOptions(q);

  if (action === "up")
    return { state: { ...state, optionIndex: Math.max(0, state.optionIndex - 1) } };
  if (action === "down") {
    return {
      state: { ...state, optionIndex: Math.min(options.length - 1, state.optionIndex + 1) },
    };
  }

  const option = options[state.optionIndex];

  if (action === "toggle") {
    if (option.isCustom) return { state: { ...state, editing: true }, effect: "openEditor" };
    if (!q.multiple) return { state };
    return applyPick(questions, state, option.label);
  }

  // action === "select"
  if (option.isCustom) return { state: { ...state, editing: true }, effect: "openEditor" };
  if (q.multiple) {
    // Confirming with nothing ticked takes the highlighted option, so Enter
    // always answers something.
    const picked =
      state.answers[state.tab].length === 0
        ? applyPick(questions, state, option.label).state
        : state;
    return advance(questions, picked);
  }
  return applyPick(questions, state, option.label);
}
