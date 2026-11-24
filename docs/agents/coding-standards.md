# Coding standards

Pedantic on purpose: agents write most of the code. Set up by the `setup-coding-standards` skill.

## Commands

| Command                   | What it does                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run check`           | Every `check:*` gate, in parallel. One line per gate; fails if any gate fails. CI runs it.         |
| `npm run fix`             | Every `fix:*` auto-fixer (oxlint safe fixes, ruff fixes, Prettier, ruff format), then `check`.     |
| `npm run baseline:update` | `check`, but each baseline shrinks to what is left after your fixes. Commit the `.baseline/` diff. |
| `npm run check:<gate>`    | One gate: `format types lint css md dead spell py pytypes editor`.                                 |

The pre-commit hook (lefthook) formats the staged files and runs `check:types` and `check:lint` (about 10 s). The commit-msg hook enforces a subject of 72 characters or fewer and a body of 3 lines or fewer (trailers excluded).

## Gates

| Gate      | Tool and config                                                      | Baseline                      |
| --------- | -------------------------------------------------------------------- | ----------------------------- |
| `format`  | Prettier (`.prettierrc.json`), ruff format (Python)                  | none                          |
| `types`   | TypeScript 7 `tsc`, every strict flag (`tsconfig.json`)              | `.baseline/tsc.json`          |
| `lint`    | oxlint, type-aware, all categories (`.oxlintrc.json`)                | `.baseline/oxlint.json`       |
| `css`     | stylelint, `stylelint-config-standard` (`.stylelintrc.json`)         | `.baseline/stylelint.json`    |
| `md`      | markdownlint-cli2 (`.markdownlint-cli2.jsonc`)                       | `.baseline/markdownlint.json` |
| `dead`    | knip: unused files, exports, types, dependencies                     | `.baseline/knip.json`         |
| `spell`   | cspell (`cspell.json`, project words in `project-words.txt`)         | `.baseline/cspell.json`       |
| `py`      | ruff, all rules (`pyproject.toml`)                                   | `.baseline/ruff.json`         |
| `pytypes` | basedpyright, mode `all` (`pyproject.toml`)                          | `.basedpyright/baseline.json` |
| `editor`  | editorconfig-checker (`.editorconfig`, `.editorconfig-checker.json`) | none                          |

Secrets: gitleaks runs in CI on the full history. Import cycles: oxlint `import/no-cycle`. Layer rules: `src/architecture.test.ts`.

## Baselines

A `.baseline/*.json` file counts the violations per file and rule that existed when the gate was set up (`ratchet.mjs` in the skill folder). The gate fails when:

- a file gets a violation its count does not cover (new code is clean), or
- a count went down and the baseline still has the old number (run `npm run baseline:update` and commit it).

So a baseline only shrinks. The burn-down tickets fix it slice by slice. Never raise a count by hand.

An inline suppression is allowed when the rule is wrong for that line. It must give a reason: `// oxlint-disable-next-line <rule> -- <why>`, `# noqa: <code>  # <why>`.

## Rule exceptions

oxlint runs every category. These rules are off, each for a reason:

| Rules                                                                                                                                                                                                                                                                                       | Why                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `no-magic-numbers`                                                                                                                                                                                                                                                                          | The game is tuning numbers: costs, rates, sizes. Named constants for each would hide them.                   |
| `no-bitwise`                                                                                                                                                                                                                                                                                | The CPU, GPU and memory simulations are bit-level by design.                                                 |
| `id-length`, `one-var`, `sort-keys`, `sort-vars`, `sort-imports`, `capitalized-comments`, `no-inline-comments`, `func-style`, `func-names`, `no-ternary`, `no-plusplus`, `no-continue`, `init-declarations`, `no-undefined`, `no-void`, `no-underscore-dangle`, `max-statements`, `new-cap` | Taste rules with no defect behind them; `max-statements` overlaps `complexity` and `max-lines-per-function`. |
| `import/no-named-export` vs `import/prefer-default-export`, `group-exports`, `exports-last`                                                                                                                                                                                                 | Contradict each other; the repo uses named exports.                                                          |
| `import/no-relative-parent-imports`, `import/no-namespace`, `import/no-nodejs-modules`                                                                                                                                                                                                      | Relative imports, `import * as THREE` and Node in tools are the idiom here.                                  |
| `oxc/no-optional-chaining`, `no-async-await`, `no-rest-spread-properties`, `no-this-in-exported-function`                                                                                                                                                                                   | Compatibility rules for old runtimes; the target is ES2024.                                                  |
| `unicorn/no-null`, `unicorn/filename-case`, `unicorn/number-literal-case`, duplicates of `no-negated-condition` and `no-nested-ternary`                                                                                                                                                     | DOM and Preact use `null`; file names are camelCase; Prettier owns literal case; one copy of each rule.      |
| `typescript/prefer-readonly-parameter-types`, `explicit-function-return-type`, `explicit-member-accessibility`, `parameter-properties`                                                                                                                                                      | Noise; `explicit-module-boundary-types` keeps exported signatures typed.                                     |
| `react/react-in-jsx-scope`, `no-unknown-property`, `jsx-no-literals`, `jsx-filename-extension`, `no-multi-comp`, `jsx-max-depth`, `jsx-handler-names`, `function-component-definition`                                                                                                      | Preact with the automatic JSX runtime (`class` is a valid attribute); the rest is taste.                     |
| `promise/avoid-new`                                                                                                                                                                                                                                                                         | Wrapping callback APIs needs `new Promise`.                                                                  |
| `vitest/*`: `prefer-expect-assertions`, `require-test-timeout`, `require-hook`, `no-hooks`, `max-expects`, padding rules, title-case rules, `require-top-level-describe`, `no-importing-vitest-globals`, `prefer-to-be-truthy`/`falsy`, `prefer-called-times`                               | Taste, or the opposite of a rule that stays on (`prefer-strict-boolean-matchers`, `prefer-called-once`).     |
| `eslint/require-await`                                                                                                                                                                                                                                                                      | Duplicate of `typescript/require-await`.                                                                     |

Overrides: test files skip the length limits; `tools/`, `e2e/` and config files may use `console`, `process.exit` and `await` in loops.
