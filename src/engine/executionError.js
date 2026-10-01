/**
 * Error raised while executing a recipe node.
 * httpCode is the status the bake API should return.
 * Upstream process failures in the 5xx range are reported as 502.
 */
export class ExecutionError extends Error {
  constructor({
    httpCode = 500,
    code = "Internal Server Error",
    description = "Recipe execution failed.",
    processing,
    nodeId,
    processTitle,
  } = {}) {
    super(description);
    this.name = "ExecutionError";
    this.httpCode = httpCode;
    this.code = code;
    this.description = description;
    if (processing) this.processing = processing;
    if (nodeId) this.nodeId = nodeId;
    if (processTitle) this.processTitle = processTitle;
  }
}

/** Writes a recipe execution failure as JSON. */
export function sendExecutionError(res, err) {
  const status = Number(err?.httpCode || err?.status || err?.statusCode) || 500;
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const description =
    err?.description || err?.message || "Recipe execution failed.";

  if (safeStatus >= 500) console.error(err);
  else console.warn(description);

  const body = {
    code: err?.code || (safeStatus >= 500 ? "Internal Server Error" : "Error"),
    description,
  };
  if (err?.processing) body.processing = err.processing;
  if (err?.nodeId) body.node = err.nodeId;
  if (err?.processTitle) body.process = err.processTitle;

  res.status(safeStatus).json(body);
}
