# Bidirectional Auto-Population

Obsidian plugin. Watches frontmatter for `supersedes` properties and automatically populates the reverse.

When file A gets `supersedes: "[[B]]"`:
1. File B gets `superseded_by: "[[A]]"`
2. File B gets `status: superseded`
3. A Notice confirms the update

No loops: the plugin watches `supersedes` and writes `superseded_by`. It never re-triggers itself.

If file B is already superseded by a different file, the plugin warns and does not overwrite.

## Settings

- Enable/disable auto-population (default: on)
- Confirm before update toggle (default: off)

## Build

```bash
npm install
npm run build
```

Outputs to the vault plugin folder defined in `esbuild.config.mjs`.
