import { readFileSync, writeFileSync } from "node:fs"; // node builtin file system module
import { fileURLToPath } from "node:url"; // node builtin URL module
import { dirname, resolve } from "node:path"; // node builtin path module
import { z } from "zod"; // schema validation library

// 1. Data model for the graph 
// This is the shape everything else in the project speaks.

/* 
 * The Node schema defines the structure of a node in the graph.
 * A node == a project in the monorepo.
 */
export const Node = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["app", "lib", "e2e"]).catch("lib"),
  root: z.string(),
  tags: z.array(z.string()),
  fanIn: z.number(), // how many projects depend on this one  (high = a "god module")
  fanOut: z.number(), // how many projects this one depends on (high = an orchestrator)
});
export type Node = z.infer<typeof Node>;

/*
 * The Edge schema defines the structure of an edge in the graph.
 * An edge == a dependency between two projects.
 */
export const Edge = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(["static", "dynamic", "implicit"]).catch("static"),
});
export type Edge = z.infer<typeof Edge>;

/*
 * The Graph schema defines the structure of the graph.
 * A graph == a monorepo.
 */
export const Graph = z.object({
  generatedAt: z.string(),
  nodes: z.array(Node),
  edges: z.array(Edge),
  stats: z.object({
    nodeCount: z.number(),
    edgeCount: z.number(),
    appCount: z.number(),
    libCount: z.number(),
  }),
});
export type Graph = z.infer<typeof Graph>;

// 2. Data model for the raw graph
// This is the shape that Nx hands us.

/*
 * The RawNode schema defines the structure of a raw node in the graph.
 * A raw node == a project in the monorepo with only the necessary fields.
 */
const RawNode = z.object({
  name: z.string().optional(),
  type: z.string(), 
  data: z.object({
    root: z.string(),
    tags: z.array(z.string()).optional(),
  }),
});

/*
 * The RawEdge schema defines the structure of a raw edge in the graph.
 * A raw edge == a dependency between two projects with only the necessary fields.
 */
const RawEdge = z.object({
  source: z.string(),
  target: z.string(),
  type: z.string(),
});

/*
 * The RawGraph schema defines the structure of the raw graph.
 * A raw graph == a monorepo with only the necessary fields.
 */
const RawGraph = z.object({
  graph: z.object({
    nodes: z.record(z.string(), RawNode),
    dependencies: z.record(z.string(), z.array(RawEdge)),
  }),
});

// 3. Do the work: read the file, reshape it, check it, write it back out.

// Paths relative to the repo root.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rawPath = resolve(repoRoot, "tmp/raw-graph.json");
const outPath = resolve(repoRoot, "graph.json");

// Read and validate in one step. If the input doesn't look like an Nx graph, fail clearly
const raw = RawGraph.parse(JSON.parse(readFileSync(rawPath, "utf8")));

const nodeEntries = Object.entries(raw.graph.nodes);
const nodeIds = new Set(nodeEntries.map(([id]) => id));

// Nx groups dependencies by project and flattens them into one flat list of edges.
// Some targets point at external npm packages (like "npm:lodash") rather than projects in this repo — skip those, and keep a tally so we can mention it.
let droppedExternal = 0;
const edges: Edge[] = [];
for (const deps of Object.values(raw.graph.dependencies)) {
  for (const dep of deps) {
    if (!nodeIds.has(dep.target)) {
      droppedExternal++;
      continue;
    }
    edges.push(Edge.parse(dep));
  }
}

// Count connections per project: fanOut == arrows leaving, fanIn == arrows arriving.
const fanOut = new Map<string, number>();
const fanIn = new Map<string, number>();
for (const e of edges) {
  fanOut.set(e.source, (fanOut.get(e.source) ?? 0) + 1);
  fanIn.set(e.target, (fanIn.get(e.target) ?? 0) + 1);
}

// Turn each Nx node into a Node object.
const nodes: Node[] = nodeEntries.map(([id, n]) =>
  Node.parse({
    id,
    label: n.name ?? id,
    type: n.type, // anything unexpected becomes "lib" by default
    root: n.data.root,
    tags: n.data.tags ?? [],
    fanIn: fanIn.get(id) ?? 0,
    fanOut: fanOut.get(id) ?? 0,
  }),
);

// Count the number of apps and libs.
const appCount = nodes.filter((n) => n.type === "app").length;
const libCount = nodes.filter((n) => n.type === "lib").length;

// Create the graph object from the cleaned data.
const graph: Graph = Graph.parse({
  generatedAt: new Date().toISOString(),
  nodes,
  edges,
  stats: { nodeCount: nodes.length, edgeCount: edges.length, appCount, libCount },
});

// Write the graph object to the output file.
writeFileSync(outPath, `${JSON.stringify(graph, null, 2)}\n`);

console.log(
  `✓ ${nodes.length} projects (${appCount} apps, ${libCount} libs), ${edges.length} deps → graph.json` +
    (droppedExternal ? ` · dropped ${droppedExternal} external edges` : ""),
);

// Print the most depended-on projects — these are the hotspots for high visibility risk.
const topFanIn = [...nodes].sort((a, b) => b.fanIn - a.fanIn).slice(0, 3);
console.log(`  hotspots (fan-in): ${topFanIn.map((n) => `${n.id}←${n.fanIn}`).join(", ")}`);
