// Core Express.js imports
import express, { json } from "express";
import cors from "cors";
import morgan from "morgan";
import { major } from "semver";
import { join } from "path";
import { readFileSync } from "fs";
import YAML from "yaml";

// Custom middleware imports
import apiVersion from "./middlewares/apiversion.js";

// Engine and client imports
import { DagEngine } from "./engine/dagEngine.js";
import { ProcessClient } from "./engine/processClient.js";
import { callbackRegistry } from "./engine/callbackRegistry.js";

// Route handlers
import recipeCore from "./routes/recipeCore.js";
import recipes    from "./routes/recipes.js";
import recipeCallback from "./routes/processCallback.js";

/**
 * Express application instance
 * Exported for use in index.js and testing
 */
export const app = express();

// Get current directory for ES modules (requires Node.js 20.16+)
const __dirname = import.meta.dirname;
if (__dirname === undefined) console.log("need node 20.16 or higher");

/**
 * Load Configuration from YAML
 * Reads the local.config.yml file and parses it into global.config
 * This configuration includes server settings, metadata, and API options
 */
const configPath = join(__dirname, "..");
const yamlStr = readFileSync(join(configPath, `local.config.yml`));
global.config = YAML.parse(yamlStr.toString());

/**
 * Environment Configuration
 * Sets default values for environment variables if not provided
 */
global.config.server.id =
  process.env.ID || global.config.server.id || "demoservice"; // Service identifier for URL path
global.config.server.host =
  process.env.HOST || global.config.server.host || "0.0.0.0";
global.config.server.port =
  process.env.PORT || global.config.server.port || 8080; // Server port
global.config.api.version =
  process.env.VERSION || global.config.api.version || "1.2.3"; // API version number

/**
 * Middleware Configuration
 * Sets up various middleware components for the Express application
 */

// HTTP Request Logging
// Uses Morgan to log HTTP requests with method, URL, and response time
app.use(
  morgan(":method :url :response-time", {
    stream: { write: (msg) => console.log(msg) },
  })
);

// JSON Pretty Printing
// Enables pretty-printed JSON responses when configured
if (global.config.server && global.config.server.prettyPrint)
  app.set("json spaces", 2); // TODO: only when running DEBUG

// CORS (Cross-Origin Resource Sharing) Configuration
// Implements OGC API requirements for browser compatibility
// (OAPIF P1) 7.5 Servers implementing CORS will implement the method OPTIONS, too.
// (OAPIF P1) 7.8 Recommendation 5 If the server is intended to be accessed from the browser,
//         cross-origin requests SHOULD be supported.
//         Note that support can also be added in a proxy layer on top of the server.
// (OAPIC P1) 8.5 Support for Cross-Origin Requests
if (global.config.server && global.config.server.cors) app.use(cors()); // Enable All CORS Requests

// JSON Body Parsing
// Enables parsing of JSON request bodies
app.use(json());

// Security Headers
// Controls the X-Powered-By header for security reasons
// No need to tell the world what tools we are using, it only gives
// out information to not-so-nice people
if (global.config.server && global.config.server["x-powered-by"])
  app.enable("x-powered-by");
else app.disable("x-powered-by");

app.disable("etag");

// Make callback registry available in routes
app.locals.callbackRegistry = callbackRegistry; 

const processClient = new ProcessClient();
const engine = new DagEngine(processClient);
// Make engine available in routes
app.locals.engine = engine;

// API Version Header Middleware
// (ADR) /core/version-header: Return the full version number in a response header
// https://gitdocumentatie.logius.nl/publicatie/api/adr/#/core/version-header
app.use(apiVersion);

/**
 * API Route Configuration
 * Sets up the service root path and mounts all OGC API route handlers
 */

// Service Root Path Configuration
// (ADR) /core/uri-version: Include the major version number in the URI
// https://gitdocumentatie.logius.nl/publicatie/api/adr/#/core/uri-version
// Creates a versioned API path like /demoservice/v1
app.serviceRoot = `/${global.config.server.id}/v${major(
  global.config.api.version
)}`;

app.use(app.serviceRoot, recipeCore);
app.use(app.serviceRoot, recipes);
app.use(app.serviceRoot, recipeCallback);

/**
 * Global Error Handler
 * Handles requests that don't match any defined routes
 * (ADR) /core/http-methods: Only apply standard HTTP methods
 * https://gitdocumentatie.logius.nl/publicatie/api/adr/#/core/http-methods
 */
app.use((req, res) => {
  res
    .status(405)
    .json({ code: "Method Not Allowed", description: "Not allowed" });
});

// JSON error handler. Keeps process and recipe failures out of the HTML stack page.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  const status = Number(err.httpCode || err.status || err.statusCode) || 500;
  const safeStatus = status >= 400 && status < 600 ? status : 500;

  if (safeStatus >= 500) console.error(err);
  else console.warn(err.description || err.message);

  res.status(safeStatus).json({
    code:
      err.code ||
      (safeStatus >= 500 ? "Internal Server Error" : "Bad Request"),
    description:
      err.description || err.message || "An unexpected error occurred.",
  });
});
