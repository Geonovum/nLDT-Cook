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

export function serviceUrlFromRequest(req) {
  const forwarded = req.headers["x-forwarded-proto"];
  const proto =
    (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") ||
    req.protocol ||
    "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}${req.baseUrl || ""}`;
}

const SUBSCRIBER_URIS = ["successUri", "inProgressUri", "failedUri", "successUrl"];

function applySubscriberPlaceholders(subscriber, context) {
  if (!subscriber || typeof subscriber !== "object") return;
  const serviceUrl = (context.serviceUrl || "").replace(/\/$/, "");
  const recipeId = encodeURIComponent(context.recipeId || "recipe");
  for (const key of SUBSCRIBER_URIS) {
    if (typeof subscriber[key] !== "string") continue;
    subscriber[key] = subscriber[key]
      .replaceAll(":serviceUrl", serviceUrl)
      .replaceAll(":recipeId", recipeId);
  }
}

/** POSTs to a processing subscriber. Sync and async executions both notify. */
async function callSubscriber(subscriber, type, payload) {
  const key = {
    inProgress: "inProgressUri",
    success: "successUri",
    failed: "failedUri",
  }[type];
  const uri = subscriber?.[key];
  if (typeof uri !== "string" || !uri) return;

  console.log(`Calling subscriber ${type}: ${uri}`);
  try {
    const response = await fetch(uri, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `Subscriber ${type} ${uri} returned ${response.status} ${detail.slice(0, 300)}`,
      );
      return;
    }
    await response.text().catch(() => "");
  } catch (err) {
    console.warn(
      `Subscriber ${type} ${uri} failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function runRecipe(recipe, ingredients, engine, callback, context = {}) {
  console.log(`Recipe Id ${recipe.id}`);
  console.log(`Title ${recipe.title}`);
  console.log(`Description ${recipe.description}`);

  const subscriberContext = {
    serviceUrl: context.serviceUrl || "",
    recipeId: recipe.id || "recipe",
  };

  // substitute ingredients in the recipe
  for (const process of recipe.processing) {
    applySubscriberPlaceholders(process.subscriber, subscriberContext);
    for (const node of process.nodes) {
      changeValue(node, ingredients);
      applySubscriberPlaceholders(node.body?.subscriber, subscriberContext);
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

    await callSubscriber(process.subscriber, "inProgress", {
      id: recipe.id,
      processing: process.id,
      status: "running",
    });

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
      await callSubscriber(process.subscriber, "failed", {
        id: recipe.id,
        processing: process.id,
        status: "failed",
        code: error.code,
        description: error.description,
        node: error.nodeId,
      });
      return callback(error);
    }

    // Store the results in the content object using the process ID as the key
    content[process.id] = results.terminalResults;

    await callSubscriber(process.subscriber, "success", {
      id: recipe.id,
      processing: process.id,
      status: "successful",
      results: results.terminalResults,
    });

    console.log("=".repeat(50));
    console.log("All calculations completed successfully!\n");
    console.log("Results:");
    console.log(results);
  }

  return callback(undefined, content);
}
