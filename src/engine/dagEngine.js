import {
  extractDependencies,
  resolveInputs,
  getTerminalNodes,
} from "./dependencyResolver.js";
import { ExecutionError } from "./executionError.js";

/**
 * Executes a DAG of nodes in topological order. Nodes with no dependencies run first;
 * once a node completes, dependents become ready. Results are passed via input references
 * (:nodeId.outputs.outputName). Returns all results plus a subset of terminal (leaf) results.
 */
export class DagEngine {
  constructor(processClient) {
    this.processClient = processClient;
  }

  async execute(_nodes) {
    const results = {};
    const nodes = new Map();
    const dependencies = new Map();  // node id -> set of node ids it depends on
    const dependents = new Map();    // node id -> set of node ids that depend on it

    for (const node of _nodes) {
      nodes.set(node.id, node);

      let deps;
      try {
        deps = extractDependencies(node);
      } catch (err) {
        if (err instanceof Error) {
          err.nodeId = err.nodeId || node.id;
          err.processTitle = err.processTitle || node.link?.title;
        }
        throw err;
      }
      dependencies.set(node.id, new Set(deps));

      for (const dep of deps) {
        if (!dependents.has(dep)) dependents.set(dep, new Set());
        dependents.get(dep).add(node.id);
      }
    }

    // Nodes with no unmet dependencies are ready to execute
    const ready = [...nodes.keys()].filter(
      (id) => dependencies.get(id).size === 0,
    );

    const executed = new Set();

    while (ready.length > 0) {
      const batch = [...ready];
      ready.length = 0;

      // Execute ready nodes in parallel; each completion may unblock dependents
      await Promise.all(
        batch.map(async (id) => {
          const node = nodes.get(id);

          const resolvedBody = resolveInputs(node, results);
          const execNode = { ...node, body: resolvedBody };

          console.log(`Executing node ${id} (${node.link.title}) with resolved body:`, resolvedBody);
          let output;
          try {
            output = await this.processClient.execute(execNode);
          } catch (err) {
            if (err instanceof Error) {
              err.nodeId = err.nodeId || id;
              err.processTitle = err.processTitle || node.link?.title;
            }
            throw err;
          }

          results[id] = output;
          executed.add(id);

          for (const child of dependents.get(id) || []) {
            dependencies.get(child).delete(id);
            if (dependencies.get(child).size === 0) ready.push(child);
          }
        }),
      );
    }

    if (executed.size !== nodes.size)
      throw new ExecutionError({
        httpCode: 400,
        code: "invalid-recipe",
        description: "Cycle detected or unresolved dependency.",
      });

    const terminalIds = getTerminalNodes(_nodes);

    return {
      allResults: results,
      terminalResults: Object.fromEntries(
        terminalIds.map((id) => [id, results[id]]),
      ),
    };
  }
}
