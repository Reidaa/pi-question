# pi-question

opencode's v2 `question` tool, ported to pi. The model can stop mid-run and ask
you something instead of guessing.

## Install

```bash
pi install git:github.com/Reidaa/pi-question
```

## Tool

The model calls `question` with one or more questions:

| Field      | Meaning                                  |
| ---------- | ---------------------------------------- |
| `question` | The complete question                    |
| `header`   | Very short tab label (max 30 chars)      |
| `options`  | `{ label, description }` choices         |
| `multiple` | Allow selecting more than one (optional) |

A "Type your own answer" option is always added, so the model should not invent
catch-all options. Answers go back as lists of the chosen labels, exactly like
opencode: `User has answered your questions: "Which runtime?"="Bun". ...`

## Keys

| Key           | Action                                           |
| ------------- | ------------------------------------------------ |
| `↑` `↓`       | Move between options                             |
| `Enter`       | Select (or confirm the question when `multiple`) |
| `Space`       | Toggle an option when `multiple`                 |
| `Tab` `←` `→` | Move between questions and the Submit tab        |
| `Esc`         | Reject the questions                             |

## Develop

```bash
npm run fmt        # oxfmt
npm run lint       # oxlint
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run check      # all four, format verified not rewritten
```

`extensions/question.ts` only maps keys to actions and draws state. Every
decision lives in `extensions/logic.ts` as a pure reducer, which is what the
tests drive.
