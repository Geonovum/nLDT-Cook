const STEP_OUTPUT = /^:([A-Za-z_][\w-]*)\.outputs\.([A-Za-z_][\w-]*)$/;

/**
 * Raises a cookbook recipe to an Open Workflow Specification 1.0.3 document.
 * Tasks are a flat list. Cook derives the graph from `${ $context.step.name }`,
 * the same way it derived it from `:step.outputs.name`.
 * `:step.outputs.name` becomes `${ $context.step.name }`.
 * `$ingredient` becomes `${ $workflow.input.ingredient }`, and the ingredient
 * value is returned separately as the /execute input.
 * A `$link` used as a node's process is resolved to that ingredient's href.
 */
export function raiseRecipe(recipe) {
  if (!recipe || recipe.type !== "recipe" || !Array.isArray(recipe.processing)) {
    throw new Error("Recipe must be a JSON object with type recipe and processing.");
  }

  const ingredients = recipe.ingredients || {};
  const input = {};
  const groups = recipe.processing.map((group) => raiseGroup(group, ingredients, input));
  const doTasks =
    groups.length === 1
      ? groups[0].tasks
      : groups.map((group) => ({ [group.id]: { do: group.tasks } }));

  const terminals = groups.flatMap((group) => group.terminals);
  const last = groups.at(-1);
  const workflow = {
    document: {
      dsl: "1.0.3",
      namespace: "https://nldt.geonovum.nl/cook",
      name: recipe.id || "recipe",
      version: recipe.version || "1.0.0",
      title: recipe.title || recipe.id || "Recipe",
      summary: recipe.description || "",
    },
    do: doTasks,
  };

  const cook = {};
  if (recipe.attribution) cook.attribution = recipe.attribution;
  if (recipe.tags) cook.tags = recipe.tags;
  if (recipe.license) cook.license = recipe.license;
  const processing = groups
    .filter((group) => group.subscriber)
    .map((group) => ({ id: group.id, subscriber: group.subscriber }));
  if (processing.length) cook.processing = processing;
  if (Object.keys(cook).length) workflow.document.metadata = { cook };

  const output = outputAs(terminals, last);
  if (output) workflow.output = { as: output };

  return { workflow, input };
}

function raiseGroup(group, ingredients, input) {
  const nodes = group.nodes || [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const waves = [];
  const pending = new Set(nodes.map((node) => node.id));

  while (pending.size) {
    const ready = nodes.filter(
      (node) => pending.has(node.id) && dependencies(node).every((id) => !pending.has(id)),
    );
    if (!ready.length) {
      throw new Error(`Recipe group ${group.id} has a cycle or a missing step.`);
    }
    waves.push(ready);
    for (const node of ready) pending.delete(node.id);
  }

  const tasks = waves.flatMap((wave) =>
    wave.map((node) => ({ [node.id]: httpTask(node, ingredients, input) })),
  );

  const referenced = new Set(nodes.flatMap((node) => dependencies(node)));
  return {
    id: group.id,
    tasks,
    terminals: nodes.map((node) => node.id).filter((id) => !referenced.has(id)),
    subscriber: group.subscriber,
    byId,
  };
}

function httpTask(node, ingredients, input) {
  const link = resolveProcessLink(node.link, ingredients);
  const headers = { "Content-Type": "application/json" };
  if (node.execution?.mode === "async") headers.Prefer = "respond-async";

  const inputs = {};
  for (const [key, value] of Object.entries(node.body?.inputs || {})) {
    inputs[key] = raiseValue(value, ingredients, input);
  }
  const body = { inputs };
  if (node.body?.subscriber) body.subscriber = node.body.subscriber;

  return {
    call: "http",
    with: {
      method: "post",
      endpoint: `${String(link.href).replace(/\/$/, "")}/execution`,
      headers,
      body,
    },
    export: { as: `\${ $context + { ${node.id}: . } }` },
  };
}

function raiseValue(value, ingredients, input) {
  if (typeof value !== "string") return value;
  const wire = value.match(STEP_OUTPUT);
  if (wire) return `\${ $context.${wire[1]}.${wire[2]} }`;
  if (value.startsWith("$")) {
    const name = value.slice(1);
    if (Object.prototype.hasOwnProperty.call(ingredients, name)) input[name] = ingredients[name];
    return `\${ $workflow.input.${name} }`;
  }
  return value;
}

function resolveProcessLink(link, ingredients) {
  if (typeof link === "string" && link.startsWith("$")) {
    const found = ingredients?.[link.slice(1)];
    if (!found || typeof found !== "object" || !found.href) {
      throw new Error(`${link} is not a process link ingredient.`);
    }
    return found;
  }
  if (link && typeof link.href === "string") return link;
  throw new Error("A step is missing a process href.");
}

function dependencies(node) {
  const ids = [];
  for (const value of Object.values(node.body?.inputs || {})) {
    if (typeof value !== "string") continue;
    const wire = value.match(STEP_OUTPUT);
    if (wire) ids.push(wire[1]);
  }
  return ids;
}

function outputAs(terminals, last) {
  if (!last) return null;
  const lastTask = last.tasks.at(-1);
  const lastName = Object.keys(lastTask || {})[0];
  const lastIsFork = Boolean(lastTask?.[lastName]?.fork);
  if (terminals.length === 1 && terminals[0] === lastName && !lastIsFork) return null;
  const fields = terminals.map((id) =>
    id === lastName && !lastIsFork ? `${id}: .` : `${id}: $context.${id}`,
  );
  return `\${ { ${fields.join(", ")} } }`;
}
