# Systematic

An early experiment in delegating outcomes instead of orchestrating prompts.

Right now, Systematic is a small [Pi](https://pi.dev) extension. It observes
ordinary requests, tracks an outcome locally, records verification, and asks
for human judgment when needed. There is no `/systematic` command.

The direction is intentionally still open.

## Try it

```bash
bun install
bun run check
pi -e ./extensions/systematic.ts
```

Systematic stores local state in `.systematic/` inside the current project.
