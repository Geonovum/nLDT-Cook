import { randomUUID } from "crypto";
import fetch from "node-fetch";
import { callbackRegistry } from "./callbackRegistry.js";
import { ExecutionError } from "./executionError.js";

const JOB_ID_TOKENS = [":jobId", ":jobID", "{jobID}", "{jobId}"];

/** Converts [{ id, value }, ...] into { id: value, ... } */
function normalize(outputsArray) {
  const out = {};
  for (const o of outputsArray) out[o.id] = o.value;
  return out;
}

/**
 * Client that executes a single node by POSTing to its execution URL.
 * Supports sync (immediate response) and async (201/202 + polling or callback) modes.
 */
export class ProcessClient {

  /** Executes the node; returns normalized outputs. Uses callback when subscriber present, else polls. */
  async execute(node) {
    const mode = node.execution?.mode || "sync";
    const executionUrl = `${node.link.href}/execution`;
    const body = structuredClone(node.body);

    var headers = { "Content-Type": "application/json" };
    if (mode === "async")
      headers["Prefer"] = "respond-async";

    // A subscriber is notified by the process for both sync and async execution.
    // Bind :jobId before the request. Only async execution waits on that callback;
    // sync execution uses the HTTP response and the process still calls the URLs.
    let correlationId;
    let waiter;
    if (body.subscriber) {
      correlationId = randomUUID();
      const bound = bindSubscriberJobId(body.subscriber, correlationId);
      if (mode === "async") {
        if (!bound) {
          throw new ExecutionError({
            httpCode: 400,
            code: "invalid-subscriber",
            description:
              "Async subscriber URIs must include a :jobId placeholder so the callback can be matched to this job.",
          });
        }
        waiter = callbackRegistry.waitFor(correlationId);
        waiter.catch(() => {});
      }
    }

    let response;
    try {
      response = await fetch(executionUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      cancelWait(correlationId);
      throw new ExecutionError({
        httpCode: 502,
        code: "Bad Gateway",
        description: `Failed to reach process at ${executionUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    // Sync mode: wait for immediate JSON response
    if (mode === "sync") {
      if (!response.ok) throw await executionErrorFromResponse(response);
      const json = await response.json();
      const location = response.headers.get("location") || ""; // job identifier
      return json;
    }

    // Some processes finish immediately and return the outputs with 200.
    if (response.status === 200) {
      cancelWait(correlationId);
      return response.json();
    }

    // OGC API Processes accepts an async job with 201. 202 is also used.
    if (response.status !== 201 && response.status !== 202) {
      const error = await executionErrorFromResponse(response);
      cancelWait(correlationId);
      throw error;
    }

    await response.text().catch(() => "");

    if (waiter) {
      try {
        return outputsFromCallback(await waiter);
      } catch (err) {
        throw errorFromCallback(err);
      }
    }

    const location = response.headers.get("Location");
    if (!location)
      throw new ExecutionError({
        httpCode: 502,
        code: "Bad Gateway",
        description: "Process response is missing a Location header.",
      });

    return this.poll(location);
  }

  /** Polls jobUrl until the job completes, fails, or is cancelled. */
  async poll(jobUrl, interval = 500) {
    while (true) {
      await new Promise((r) => setTimeout(r, interval));
      let resp;
      try {
        resp = await fetch(jobUrl);
      } catch (err) {
        throw new ExecutionError({
          httpCode: 502,
          code: "Bad Gateway",
          description: `Failed to poll job at ${jobUrl}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }

      if (!resp.ok) throw await executionErrorFromResponse(resp);

      const json = await resp.json();

      if (json.status === "successful") return normalize(json.outputs);
      if (["failed", "cancelled"].includes(json.status)) {
        const detail = json.message || json.detail || json.status;
        throw new ExecutionError({
          httpCode: 502,
          code: "job-failed",
          description: `Job ${json.status}: ${detail}`,
        });
      }
    }
  }
}

/**
 * Turns a failed process HTTP response into an ExecutionError.
 * OGC API exception documents ({ title, status, detail }) are passed through.
 * Upstream 5xx responses become 502 so they are not reported as cook failures.
 */
async function executionErrorFromResponse(response) {
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  const upstream = response.status || 502;
  const httpCode = upstream >= 500 ? 502 : upstream;
  const detail = detailFromBody(body, text, upstream);
  const description =
    upstream >= 500 ? `Process returned HTTP ${upstream}: ${detail}` : detail;

  return new ExecutionError({
    httpCode,
    code: codeFromBody(body, upstream),
    description,
  });
}

function detailFromBody(body, text, status) {
  if (body && typeof body === "object") {
    if (typeof body.detail === "string" && body.detail) return body.detail;
    if (typeof body.description === "string" && body.description)
      return body.description;
    if (typeof body.message === "string" && body.message) return body.message;
  }
  if (text) return text.slice(0, 1000);
  return `Process returned HTTP ${status}`;
}

function codeFromBody(body, status) {
  if (body && typeof body === "object") {
    if (typeof body.title === "string" && body.title) return body.title;
    if (typeof body.code === "string" && body.code) return body.code;
  }
  if (status >= 500) return "Bad Gateway";
  return "process-error";
}

/** Replaces job-id tokens in subscriber URIs. Returns false when none were present. */
function bindSubscriberJobId(subscriber, jobId) {
  let bound = false;
  for (const key of ["successUri", "inProgressUri", "failedUri", "successUrl"]) {
    const uri = subscriber?.[key];
    if (typeof uri !== "string") continue;
    let next = uri;
    for (const token of JOB_ID_TOKENS) {
      if (!next.includes(token)) continue;
      next = next.replaceAll(token, jobId);
      bound = true;
    }
    subscriber[key] = next;
  }
  return bound;
}

function cancelWait(jobId) {
  if (!jobId) return;
  const cancelled = new Error("callback wait cancelled");
  cancelled.cancelled = true;
  callbackRegistry.failed(jobId, cancelled);
}

function outputsFromCallback(data) {
  if (data && Array.isArray(data.outputs)) return normalize(data.outputs);
  if (Array.isArray(data)) return normalize(data);
  return data;
}

function errorFromCallback(err) {
  if (err instanceof ExecutionError) return err;
  const description =
    err?.detail ||
    err?.description ||
    err?.message ||
    (typeof err === "string" ? err : "Process job failed.");
  return new ExecutionError({
    httpCode: Number(err?.status || err?.httpCode) || 502,
    code: err?.title || err?.code || "job-failed",
    description: typeof description === "string" ? description : "Process job failed.",
  });
}
