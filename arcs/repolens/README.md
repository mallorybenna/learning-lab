# RepoLens

Supports the creation of an interactive, AI-annotated dependency map -- generated from a normalized graph for an TypeScript/Nx monorepo.

**Step 1**: Turn Nx's raw graph dump into a clean, [zod](https://zod.dev)-validated model (`nodes`, `edges`, `stats`,
plus per-project `fanIn`/`fanOut`)

```
Nx workspace ──nx graph──▶ tmp/raw-graph.json ──extract.ts + zod──▶ graph.json
```

A small **synthetic** `tmp/raw-graph.json` is included for refrence -- so you can run the whole
pipeline immediately — no real repo required, and nothing internal to leak.

**Next steps coming soon...**

## Setup

```bash
npm install
```

Requires Node 18+. Everything runs through [`tsx`](https://github.com/privatenumber/tsx);
no build step.

## Try it (using the bundled synthetic graph)

```bash
npm run extract
```

You should see:

```
✓ 22 projects (3 apps, 17 libs), 62 deps → graph.json
  hotspots (fan-in): shared-utils←14, ui-components←6, shared-types←5
```

Output: `graph.json` in the repo root. Open it — that's the normalized model.

---

## Using it on your own repo

There are three ways to get data into `tmp/raw-graph.json`, then one command to extract.

### 1) Generate the project graph from a real Nx workspace

Nx emits its entire dependency graph for free. From the root of **your** Nx repo:

```bash
npx nx graph --file=/absolute/path/to/repolens/tmp/raw-graph.json
```

That produces the raw input RepoLens consumes. Its shape (only the parts we read):

```jsonc
{
  "graph": {
    "nodes": {
      "my-app": { "name": "my-app", "type": "app",
                  "data": { "root": "apps/my-app", "tags": ["scope:foo"] } }
    },
    "dependencies": {
      "my-app": [{ "source": "my-app", "target": "my-lib", "type": "static" }]
    }
  }
}
```

> ⚠️ **Heads up on sensitive data.** A real `nx graph` dump leaks internal project
> names, directory layout, and your architecture's topology — no source code, but
> not nothing. Don't commit a real dump to a public repo. `tmp/` is the place for it;
> consider gitignoring it. The committed artifact is `graph.json`, built from the
> synthetic input.

### 2) Add data to the JSON by hand

No Nx repo? You can author `tmp/raw-graph.json` directly — it's just two maps. Add a
project under `graph.nodes`, then list its outgoing dependencies under
`graph.dependencies` (the key must match the node's name):

```jsonc
{
  "graph": {
    "nodes": {
      "billing": {
        "name": "billing",
        "type": "lib",                      // "app" | "lib" | "e2e"
        "data": { "root": "libs/billing", "tags": ["scope:payments"] }
      }
    },
    "dependencies": {
      "billing": [
        { "source": "billing", "target": "shared-utils", "type": "static" }
        // type: "static" | "dynamic" | "implicit"
      ]
    }
  }
}
```

The extractor is forgiving at the boundary: unknown `type` values fall back
(`app|lib|e2e`→`lib`, edge types→`static`), `tags` may be omitted, and dependency
edges pointing at non-existent projects (e.g. external `npm:*` packages) are dropped
and reported.

### 3) Run the extractor

```bash
npm run extract        # or: npx tsx src/extract.ts
```

It reads `tmp/raw-graph.json`, validates it with zod, and writes a normalized
`graph.json`:

```jsonc
{
  "generatedAt": "2026-06-09T12:00:00.000Z",
  "nodes": [
    { "id": "billing", "label": "billing", "type": "lib",
      "root": "libs/billing", "tags": ["scope:payments"],
      "fanIn": 0, "fanOut": 1 }
  ],
  "edges": [
    { "source": "billing", "target": "shared-utils", "type": "static" }
  ],
  "stats": { "nodeCount": 1, "edgeCount": 1, "appCount": 0, "libCount": 1 }
}
```

`fanIn` (how many projects depend on this one) and `fanOut` (how many it depends on)
are precomputed per node — high fan-in flags god-modules, the main risk signal a
healthy Nx graph surfaces.

That `graph.json` is what the later steps visualize.

## Project layout

```
repolens/
├── src/extract.ts        # schema-first model + Nx → graph.json transform
├── tmp/raw-graph.json    # input: synthetic Nx graph dump (swap in your own)
├── graph.json            # output: normalized, validated model (generated)
└── package.json          # `npm run extract`
```
