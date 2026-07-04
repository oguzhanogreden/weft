import { Cause, Logger, LogLevel } from "effect";

/** An `Error`-level log entry captured by {@link makeErrorLogCapture}. */
export interface CapturedErrorLog {
  readonly message: unknown;
  readonly cause: Cause.Cause<unknown>;
  readonly annotations: Record<string, unknown>;
}

/**
 * Builds a replacement default logger that records every `Error`-level log
 * entry carrying a non-empty `Cause` — the shape of both the Effect runtime's
 * "Fiber terminated with an unhandled error" report and an explicit
 * `Effect.logError(message, cause)` — so tests can assert that unhandled
 * failures are surfaced (with their `weft.region` annotation) rather than
 * silently swallowed. Provide `logger` to the mount/hydrate Effect; `entries`
 * populates asynchronously as failures occur.
 */
export function makeErrorLogCapture() {
  const entries: CapturedErrorLog[] = [];
  const logger = Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ logLevel, message, cause, annotations }) => {
      if (logLevel === LogLevel.Error && Cause.isCause(cause) && !Cause.isEmpty(cause)) {
        entries.push({ message, cause, annotations: Object.fromEntries(annotations) });
      }
    }),
  );
  return { entries, logger };
}
