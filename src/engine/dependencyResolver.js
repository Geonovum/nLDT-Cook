import { ExecutionError } from "./executionError.js";

/**
 * Extracts node IDs that this node depends on via input references.
 * Inputs use the format ":nodeId.outputs.outputName" to reference outputs from other nodes.
 */
export function extractDependencies(node) {
  const deps = new Set();

  for (const value of Object.values(node.body.inputs || {})) {
    if (typeof value === "string" && value.startsWith(":")) {
      const match = value.match(/^:(.+)\.outputs\.(.+)$/);
      if (!match)
        throw new ExecutionError({
          httpCode: 400,
          code: "invalid-reference",
          description: `Invalid reference: ${value}`,
        });
      deps.add(match[1]);
    }
  }

  return [...deps];
}

/**
 * Replaces input references (":nodeId.outputs.outputName") with actual values from results.
 * Throws if a referenced dependency has not been computed yet.
 */
export function resolveInputs(node, results) {
  const resolved = structuredClone(node.body);
  resolved.inputs = {};

  for (const [key, value] of Object.entries(node.body.inputs || {})) {
    if (typeof value === "string" && value.startsWith(":")) {
      const [, stepId, outputName] = value.match(/^:(.+)\.outputs\.(.+)$/);

      if (!results[stepId])
        throw new ExecutionError({
          httpCode: 400,
          code: "unresolved-dependency",
          description: `Dependency '${stepId}' not resolved.`,
        });

      resolved.inputs[key] = results[stepId][outputName];
    } else {
      resolved.inputs[key] = value;
    }
  }

  return resolved;
}

/**
 * Returns node IDs that are not referenced as inputs by any other node.
 * These are the "leaf" nodes whose outputs are the final results of the DAG.
 */
export function getTerminalNodes(nodes) {
  const referenced = new Set();

  for (const node of nodes) {
    for (const value of Object.values(node.body.inputs || {})) {
      if (typeof value === "string" && value.startsWith(":")) {
        const [, stepId] = value.match(/^:(.+)\.outputs\./);
        referenced.add(stepId);
      }
    }
  }

  return nodes
    .map((n) => n.id)
    .filter((id) => !referenced.has(id));
}
