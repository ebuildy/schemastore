<!-- .github/copilot-instructions.md -->

# Schemastore — AI agent instructions (concise)

This file gives targeted, actionable guidance for an AI coding agent (Copilot-style) working on the SchemaStore repository. Keep suggestions minimal, deterministic, and respect existing patterns.

1. Big picture (short)

- Purpose: a large collection of JSON schemas (src/schemas/json) plus an API/catalog (src/api/json) and static site templates (src/\*.cshtml). The repo produces the schemastore website and the published JSON artifacts.
- Primary language: JSON schemas and Node.js scripts (ESM). JavaScript entrypoint: `cli.js` and scripts in `scripts/`.

2. Key directories and files

- `src/schemas/json/` — canonical collection of JSON schema files (one file per schema). Use these as the source-of-truth.
- `src/api/json/catalog.json` — master catalog that references many schemas; changing a schema may require updating `catalog.json` if fileMatch/url entries should be added/changed.
- `src/` top-level cshtml files — static site templates rendered by the site build.
- `cli.js` — Node entrypoint used for checks and site build flows. Many developer scripts call `node ./cli.js`.
- `scripts/` — helper scripts (e.g., `dirty_repository_check.sh`, `build-xregistry.js`). Follow existing patterns when adding new scripts.
- `package.json` — contains useful npm scripts: `npm run build` (lint + `node ./cli.js check` + dirty repo check). Node >= 18 required.

3. Common workflows & commands

- Run checks locally (recommended):
  - node ./cli.js check
  - npm run eslint (or `npm run eslint:fix` to auto-fix cli.js)
  - npm run prettier:fix to format files
- Full build (what CI expects):
  - npm run build (runs eslint, `node ./cli.js check` and `./scripts/dirty_repository_check.sh`)
- When editing a schema file: keep formatting minimal and run `npm run prettier:fix` and `node ./cli.js check` to validate schema correctness.

4. Project-specific conventions and patterns

- File-per-schema: add new schemas under `src/schemas/json` with descriptive file names and a top-level `$id` matching `https://json.schemastore.org/<file-name>` when appropriate.
- Catalog updates: If a schema should be discoverable by filename patterns, add an entry to `src/api/json/catalog.json` (follow existing objects in that array; include `name`, `description`, `fileMatch`, `url`).
- Avoid reformatting unrelated files; keep diffs minimal. The repo enforces formatting via Prettier and CI.
- Node scripts are ESM (package.json `type: module`). Use modern JS imports if adding new scripts.

5. Integration points & external dependencies

- The catalog references many external URLs in `src/api/json/catalog.json`. Changes to local schema `$id` or published URL may require updating remote references.
- Site build and publishing uses repository scripts and may call `build-xregistry.js` and other helpers in `scripts/` — examine those before modifying publishing behavior.

6. Examples & snippets from this repo

- Add a schema: copy the shape of `src/schemas/json/template.json` and ensure `required`/`$schema`/`$id` fields match the repo's style.
- Update catalog: find the pattern at `src/api/json/catalog.json` (array of objects). Example object shape:

  {
  "name": "Example",
  "description": "Brief description",
  "fileMatch": ["example.json", "example.yml"],
  "url": "https://www.schemastore.org/example.json"
  }

7. Linting, typecheck & quick validation

- Run eslint only targets `cli.js` in package.json. Use `npm run typecheck` to run TypeScript checks against jsconfig.json.
- Use `node ./cli.js check` to run the repository's internal validation (checks schemas and catalog consistency).

8. Safety & change guidance for AI agents

- Make minimal, well-scoped changes. Prefer adding new files or small edits to single schemas.
- When adding or modifying catalog entries, preserve array ordering and follow the existing alphabetical/notional grouping.
- Do not change build scripts or CI logic without explicit human review.

9. Where to look for context

- `README.md` and `CONTRIBUTING.md` for contribution conventions.
- `package.json` for scripts and Node engine requirement.
- `scripts/` and `cli.js` for the actual validation/build steps performed by CI.

If any part of these instructions is unclear or you'd like specific examples (e.g., add new schema + catalog entry flow), tell me what area to expand and I'll iterate.
