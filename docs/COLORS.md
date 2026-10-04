# Colors

## Intent

Use a quiet light workspace surface with high-contrast ink, neutral cards, and restrained semantic accents. Piggybudget uses the same foundation tokens for finance views and may add semantic states for balances, income, spending, and budget health.

## Tokens

Tokens live in `apps/web/src/styles.css` and map to shadcn semantic names:

| Token              | Use                                      |
| ------------------ | ---------------------------------------- |
| `background`       | App canvas and page background           |
| `foreground`       | Primary text and icons                   |
| `card`             | Panels, cards, and elevated surfaces     |
| `muted`            | Secondary surfaces and inactive controls |
| `muted-foreground` | Supporting copy and metadata             |
| `primary`          | Primary action and selected navigation   |
| `border`           | Dividers and field outlines              |
| `destructive`      | Destructive actions and error states     |

## Semantic accents

- Blue: active work and informational states.
- Green: healthy status and positive budget variance.
- Violet: people, teams, and collaboration.
- Rose: high attention and destructive finance states.
- Amber: review, warning, and pending states.
- Sky: secondary informational states.

Prefer semantic tokens over raw colors. Add a new token only when an existing semantic role cannot express the state.
