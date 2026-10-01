import { join } from "path";
import { runRecipe, serviceUrlFromRequest } from "../../models/recipe/bake.js";
import { ExecutionError, sendExecutionError } from "../../engine/executionError.js";

export async function get(req, res) {
  const recipe = req.params.recipe;

  const __dirname = import.meta.dirname;
  if (__dirname === undefined)
    console.log("need node 20 or higher (and Express 5 or higher)");

  var dataPath = global.config.data.path || join(__dirname, "../../..");

  var directoryPath = join(dataPath, "examples", "json");
  var fileName = join(directoryPath, recipe);

  res.status(200).sendFile(fileName);
}

/**
 * POST /recipe/execute
 *
 * 'Bakes' a recipe by running each of its processes sequentially.
 * Each process is run through the engine, and terminal results are collected
 * into a content object keyed by process ID. Returns the aggregated results.
 */
function fetchFailureDetail(err) {
  if (!(err instanceof Error)) return String(err);

  const cause = err.cause;
  const nested = cause instanceof AggregateError ? cause.errors : [];
  const preferred =
    nested.find((error) => error?.address === "127.0.0.1" && error.message) ||
    nested.find((error) => error?.message);
  if (preferred?.message) return preferred.message;
  if (cause instanceof Error && cause.message) return cause.message;
  if (cause && typeof cause === "object" && cause.code) return String(cause.code);
  return err.message;
}

async function fetchRecipe(uri) {
  let response;
  try {
    response = await fetch(uri, {
      headers: { accept: "application/json" },
    });
  } catch (err) {
    throw new ExecutionError({
      httpCode: 502,
      code: "Bad Gateway",
      description: `Failed to fetch recipe document from ${uri}: ${fetchFailureDetail(err)}`,
    });
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const excerpt = bodyText ? ` ${bodyText.slice(0, 500)}` : "";
    throw new ExecutionError({
      httpCode: 502,
      code: "Bad Gateway",
      description: `Failed to fetch recipe document from ${uri} (HTTP ${response.status}${
        response.statusText ? ` ${response.statusText}` : ""
      }).${excerpt}`,
    });
  }

  try {
    return await response.json();
  } catch {
    throw new ExecutionError({
      httpCode: 502,
      code: "Bad Gateway",
      description: `Recipe document at ${uri} is not valid JSON.`,
    });
  }
}

/**
 * POST /recipe/execute
 *
 * 'Bakes' a recipe by running each of its processes sequentially.
 * Each process is run through the engine, and terminal results are collected
 * into a content object keyed by process ID. Returns the aggregated results.
 */
export async function post(req, res) {
  const type = req.body?.type;
  const recipeUri = req.body?.recipe;

  var recipe = {};
  var ingredients = {};

  switch (type) {
    case "recipe":
      recipe = req.body;
      ingredients = req.body?.ingredients || {};
      break;
    case "recipe-ref":
      if (!recipeUri || typeof recipeUri !== "string") {
        return res.status(400).json({
          error:
            "Missing or invalid 'recipe' field. Expected a recipe URI string.",
        });
      }
      try {
        recipe = await fetchRecipe(recipeUri);
      } catch (err) {
        sendExecutionError(res, err);
        return;
      }
      // first ingredients from request body, then from recipe document, default to empty object
      ingredients = req.body?.ingredients || recipe?.ingredients || {};
      break;
    default:
      return res.status(400).json({
        error: "Invalid recipe type.",
      });
  }

  if (!recipe || typeof recipe !== "object") {
    return res
      .status(400)
      .json({ error: "Recipe document is not a JSON object." });
  }

  const engine = req.app.locals.engine;

  await runRecipe(
    recipe,
    ingredients,
    engine,
    function (err, content) {
    if (err) {
      sendExecutionError(res, err);
      return;
    }

    let c1 =  Object.entries(content).length
    let c2 =  Object.entries(content).reduce((acc, [process, v]) => acc + Object.entries(v).length, 0);

    if (c1 > 1 || c2 > 1) {
      const boundary = `MIME_boundary_recipe`;

      res.setHeader("Content-Type", `multipart/related; boundary=${boundary}`);

      let body = [];

      for (const [process, v] of Object.entries(content)) {
        for (const [step, value] of Object.entries(v)) {
          body.push( `--${boundary}\r\n`);
          // Headers voor dit specifieke JSON-onderdeel
          body.push("Content-Type: application/json; charset=UTF-8\r\n");
          
          let bb = {}
          bb[step] = value
          let aa = {}
          aa[process] = bb

          body.push(JSON.stringify(aa, null, 2) + "\r\n");
        }
      }

      body.push(`--${boundary}--\r\n`);
      res.status(200).send(body.join(""));
    }
    else
    {
          res.status(200).json(content);
    }
  },
    { serviceUrl: serviceUrlFromRequest(req) },
  );
}
