import { ExecutionError } from "../../engine/executionError.js";

// substitute ingredients in the recipe
function changeValue(obj, ingredients) {
  if (typeof obj === "object") {
    // iterating over the object using for..in
    for (var keys in obj) {
      //checking if the current value is an object itself
      if (typeof obj[keys] === "object") {
        // if so then again calling the same function
        changeValue(obj[keys], ingredients);
      } else {
        var inputValue = obj[keys];
        if (
          typeof inputValue === "string" &&
          (inputValue.startsWith("$") || inputValue.startsWith("!"))
        ) {
          const variableName = inputValue.slice(1); // Remove $ prefix
          if (ingredients.hasOwnProperty(variableName)) {
            obj[keys] = ingredients[variableName];
            console.log(
              `Substituted variable ${inputValue} with value ${ingredients[variableName]} in node ${obj[keys]}`,
            );
          } else {
            console.warn(
              `Variable ${variableName} not found for substitution in node ${obj[keys]}`,
            );
          }
        }
      }
    }
    return obj;
  }
}

export async function runRecipe(recipe, ingredients, engine, callback) {
  console.log(`Recipe Id ${recipe.id}`);
  console.log(`Title ${recipe.title}`);
  console.log(`Description ${recipe.description}`);

  // substitute ingredients in the recipe
  for (const process of recipe.processing) {
    for (const node of process.nodes) {
      changeValue(node, ingredients);
    }
  }

  // Accumulate terminal results from each process (keyed by process ID)
  const content = {};

  for (const process of recipe.processing) {
    console.log("═".repeat(50));
    console.log(`Running ${process.id}`);
    console.log(`Title ${process.title}`);
    console.log(`Description ${process.description}`);
    console.log("-".repeat(50));

    // Execute the process and store the results
    let results;
    try {
      results = await engine.execute(process.nodes);
    } catch (err) {
      const error =
        err instanceof ExecutionError
          ? err
          : new ExecutionError({
              httpCode: err?.httpCode || err?.status || 500,
              code: err?.code || err?.title || "Internal Server Error",
              description:
                err?.description ||
                err?.detail ||
                err?.message ||
                "Recipe execution failed.",
              nodeId: err?.nodeId,
              processTitle: err?.processTitle,
            });
      error.processing = process.id;
      return callback(error);
    }

    // Store the results in the content object using the process ID as the key
    content[process.id] = results.terminalResults;

    console.log("=".repeat(50));
    console.log("All calculations completed successfully!\n");
    console.log("Results:");
    console.log(results);
  }

  return callback(undefined, content);
}
