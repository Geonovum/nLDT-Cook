import { EventEmitter } from "events";
import { ExecutionError } from "./executionError.js";

/**
 * Registry that pairs async job IDs with Promises. Callers can wait for
 * external callbacks to complete a job; external systems call success/failed
 * to resolve or reject the corresponding Promise.
 */
class CallbackRegistry {
  constructor() {
    console.log(`CallbackRegistry started`);
    this.emitter = new EventEmitter();
  }

  /** Returns a Promise that resolves or rejects when the job completes (or times out). */
  waitFor(jobId, timeoutMs = 80000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.log(`timeout ${jobId}`);
        this.emitter.removeAllListeners(`${jobId}:success`);
        this.emitter.removeAllListeners(`${jobId}:failed`);
        reject(
          new ExecutionError({
            httpCode: 504,
            code: "timeout",
            description: `Timed out waiting for a callback for job ${jobId}.`,
          }),
        );
      }, timeoutMs);

      this.emitter.once(`${jobId}:success`, (data) => {
        clearTimeout(timeout);
        resolve(data);
      });

      this.emitter.once(`${jobId}:failed`, (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /** Resolves waiters for this job with the given payload. */
  success(jobId, payload) {
    console.log(`success ${jobId}`);
    this.emitter.emit(`${jobId}:success`, payload);
  }

  /** Rejects waiters for this job with the given error. */
  failed(jobId, error) {
    if (!error?.cancelled) console.log(`failed ${jobId}`);
    this.emitter.emit(`${jobId}:failed`, error);
  }
}

export const callbackRegistry = new CallbackRegistry();
