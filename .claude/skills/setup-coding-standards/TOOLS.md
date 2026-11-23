# Tools by language and concern

Strictest preset first. "Baseline" is how existing violations are recorded so only new ones fail.

## TypeScript and JavaScript

| Concern | Tool and preset | Baseline |
| --- | --- | --- |
| Types | `tsc --noEmit` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`, `noUnusedParameters`, `allowUnreachableCode: false`, `allowUnusedLabels: false`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`, `isolatedModules`, `forceConsistentCasingInFileNames`. Plain JS files: `checkJs` through a second tsconfig. | None in tsc: flags with errors become tickets. |
| Lint | ESLint flat config: `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` (typed, `projectService`), `@eslint/js` recommended, `eslint-plugin-unicorn` recommended, `@eslint-community/eslint-plugin-eslint-comments` recommended + `require-description` + `no-unlimited-disable`, `eslint-plugin-regexp` recommended. JSX: `eslint-plugin-jsx-a11y` strict, `eslint-plugin-react-hooks` (also for Preact hooks). Core limits: `complexity`, `max-depth`, `max-lines`, `max-lines-per-function`, `max-params`, `no-console`, `eqeqeq`, `curly`. Disable only rules the formatter owns. | ESLint bulk suppressions: `eslint --suppress-all` writes `eslint-suppressions.json`; `--prune-suppressions` after fixes. The default run fails on unused suppressions. |
| Format | Prettier (also formats JSON, YAML, Markdown, CSS, HTML). Biome is the faster all-in-one when typed lint rules are not needed. | Never: format once. |
| Dead code | `knip`: unused files, exports, types, dependencies. | `ignore` entries in `knip.json`, each with a reason; or tickets. |
| Architecture | `dependency-cruiser`: `no-circular`, `no-orphans`, `not-to-unresolvable`, `no-duplicate-dep-types`, plus the repo's layer rules. | `depcruise --output-type baseline` to `.dependency-cruiser-known-violations.json`, passed with `--ignore-known`. |
| Tests | Coverage thresholds in the test runner (Vitest: `coverage.thresholds` with `autoUpdate: true` ratchets the floor up). | The current numbers are the floor. |
| Dependencies | `npm audit --audit-level=high` (or the package manager's equivalent). | `audit-ci` allowlist with reasons. |

## Python

| Concern | Tool and preset | Baseline |
| --- | --- | --- |
| Lint | `ruff check` with `select = ["ALL"]`; ignore only formatter conflicts (`COM812`, `ISC001`) and one of each docstring pair (`D203`/`D211`, `D212`/`D213`). | `ruff check --add-noqa` writes inline `# noqa`; `RUF100` flags them once unused. |
| Format | `ruff format`. | Never. |
| Types | `basedpyright` with `typeCheckingMode = "all"` (or `mypy --strict`). | `basedpyright --writebaseline` (`.basedpyright/baseline.json`); mypy: `mypy-baseline`. |
| Dependencies | `pip-audit`. | Ignore list with reasons. |

## Other languages

| Language | Lint | Format | Baseline |
| --- | --- | --- | --- |
| CSS / SCSS | `stylelint` + `stylelint-config-standard` (`-scss`) | Prettier | Inline disables with reasons, or fix now (usually few). |
| Markdown | `markdownlint-cli2` default rules (line length off when prose wraps freely) | Prettier | `.markdownlint-cli2.jsonc` ignores per file, or fix now. |
| HTML | `html-validate` recommended | Prettier | Fix now. |
| YAML | `yamllint` strict; GitHub workflows: `actionlint` | Prettier | Fix now. |
| Shell | `shellcheck` (all optional checks) | `shfmt` | Inline `# shellcheck disable=` with reason. |
| Dockerfile | `hadolint` | none | Inline ignores with reason. |
| Go | `golangci-lint` with most linters enabled | `gofumpt` | `--new-from-rev` against the setup commit. |
| Rust | `cargo clippy -- -D warnings -W clippy::pedantic -W clippy::nursery` | `rustfmt` | `#[allow]` with reason, or `--new-from-rev`-style CI diff. |
| C# | .NET analyzers `AnalysisMode=All`, `TreatWarningsAsErrors`, `Nullable=enable` | `dotnet format` | `.editorconfig` severities per rule. |
| Java / Kotlin | Error Prone + NullAway / `detekt` | Spotless (google-java-format / ktlint) | Tool baseline files (`detekt-baseline.xml`). |
| GLSL / WGSL | `glslangValidator` / `naga` validation | `clang-format` (GLSL) | Fix now. |

## Cross-cutting

| Concern | Tool | Notes |
| --- | --- | --- |
| Editor basics | `.editorconfig` (charset, final newline, trim whitespace, indent, EOL); `.gitattributes` `* text=auto eol=lf` | Checked by `editorconfig-checker`. |
| Spelling | `cspell` over code, docs and commit messages | Baseline: seed a project word list from today's unknown words, then review it. |
| Secrets | `gitleaks` (pre-commit on staged, CI on full history) | Binary outside npm; `.gitleaksignore` for known false positives. |
| Commit messages | `commitlint` (subject length and form the repo's agent docs ask for) | Hook `commit-msg`. |
| Git hooks | `lefthook` (cross-platform, parallel, staged-file globs) | Installed by the package manager's `prepare` script. |
| Links in docs | `lychee` (offline mode for relative links) | CI only. |
