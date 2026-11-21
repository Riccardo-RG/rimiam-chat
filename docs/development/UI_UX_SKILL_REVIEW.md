# UI UX Pro Max — bounded Web assessment

Reviewed **2026-11-17 (Europe/Rome)**. Decision: use selected guidance as a
read-only reference for the current Web increment. Do not install the skill or
its CLI, execute its scripts, add dependencies, or create another design system.
This assessment does not authorize a broad redesign, native changes, services,
backend changes, deployment, or GitHub mutations.

## Source and provenance

Source: [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill).
The inspected files were served from **`main`; this review is not revision-pinned**.
GitHub exposed [release v2.15.0](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/releases/tag/v2.15.0)
at abbreviated commit `a38d04c`, and historical commit
[`7f69fed6a2717900085f1bc3b263721f8ba025e2`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/commit/7f69fed6a2717900085f1bc3b263721f8ba025e2).
The historical Codex template has different catalog counts from the inspected
`main` template; neither revision is asserted to identify all reviewed content.
A future installation would require selecting and reviewing a fixed revision.

## Inspected upstream entry points

- [Claude SKILL.md](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/ui-ux-pro-max/SKILL.md)
  and [generated skill template](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/src/ui-ux-pro-max/templates/base/skill-content.md): workflow, scope, persistence.
- [Codex template](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/src/ui-ux-pro-max/templates/platforms/codex.json),
  [init.ts](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/cli/src/commands/init.ts),
  [template.ts](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/cli/src/utils/template.ts),
  and [package.json](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/cli/package.json): installation and dependencies.
- [search.py](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/src/ui-ux-pro-max/scripts/search.py),
  [core.py](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/src/ui-ux-pro-max/scripts/core.py),
  [design_system.py](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/src/ui-ux-pro-max/scripts/design_system.py),
  and [reasoning_contract.py](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/src/ui-ux-pro-max/scripts/reasoning_contract.py): search imports, data flow, rule parsing, write options.
- [Quick reference](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/src/ui-ux-pro-max/templates/base/quick-reference.md),
  [UX data](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/src/ui-ux-pro-max/data/ux-guidelines.csv),
  and [React data](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/src/ui-ux-pro-max/data/stacks/react.csv): applicability checks.

## Compatibility and safety findings

RIMIAM uses Next.js 16.3.4, React 19.2.8 and its existing CSS, without Tailwind or
shadcn dependencies. [Web tokens](../../src/app/ritmo.css), [brand direction](../design/BRAND.md)
and [product experience](PRODUCT_DESIGN.md) remain authoritative. The actual skill
supports focused domain/stack guidance and requires detecting the existing stack.
Its recommendations do not supersede repository rules or product semantics.

The inspected Codex installer targets `.agents/skills/ui-ux-pro-max/`, or the
corresponding directory under the user's home for a global install. It also copies
bundled sibling skills; its implementation describes seven skills in total.
The CLI declares `chalk`, `commander`, `ora` and `prompts` runtime dependencies.
These installation effects are unnecessary for this bounded increment.

The inspected Python search imports use the standard library and local modules;
catalog lookup reads local CSVs and the decision parser accepts a closed grammar.
No network dependency was observed in that inspected search path. This is a
targeted source assessment, **not a complete security audit or execution test**.
`--persist` and `--preview` write files; `--force` permits replacement. The CLI
also has a legacy GitHub-release download path. None was invoked for this review.

Guidance needs filtering: the quick reference mixes Web/native concerns and
contains non-English operating text. Its generic target-size and animation
shortcuts should not become universal requirements. The UX dataset distinguishes
platform contexts more carefully. No upstream instructions are vendored here.

## Selected guidance for the current Web work

- Keep keyboard focus visible, unobscured and correctly restored after overlays.
- Show the current navigation location; keep controls usable without hover.
- Associate field labels and errors; retain real pending, failure and success states.
- Check long text, chips and badges at narrow widths and browser zoom.
- Check composer/navigation overlap, content reflow and readable line lengths.
- Preserve Light/Dark/System presentation, semantic tokens and reduced-motion support.
- Keep React effects clean and list identities stable; optimize measured problems.

Apply these checks only to verified Web issues, using existing components and
commands. No generated `design-system/MASTER.md`, font/library migration, mobile
alignment, new product requirements or speculative refactor follows from this review.
Repository checks and browser evidence must establish the actual outcome; reading
the skill or its published test claims does not establish RIMIAM acceptance.
