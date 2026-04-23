/**
 * Tiny console-backed logger with level filtering.
 *
 * - Prefix: `[AxeraWikiClipper]`
 * - Default level: DEBUG in dev build (`NODE_ENV !== "production"`), INFO in prod build.
 * - Runtime override: set `window.AxWikiClipperDebug = true` to force DEBUG.
 */

export enum LogLevel {
  DEBUG = 10,
  INFO = 20,
  WARN = 30,
  ERROR = 40,
}

const PREFIX = "[AxeraWikiClipper]";

function defaultLevel(): LogLevel {
  const isProd = (process as unknown as { env?: { NODE_ENV?: string } }).env?.NODE_ENV === "production";
  return isProd ? LogLevel.INFO : LogLevel.DEBUG;
}

function overrideLevel(): LogLevel | null {
  try {
    if (typeof window !== "undefined" && (window as unknown as { AxWikiClipperDebug?: boolean }).AxWikiClipperDebug) {
      return LogLevel.DEBUG;
    }
  } catch {
    /* no window */
  }
  return null;
}

function currentLevel(): LogLevel {
  return overrideLevel() ?? defaultLevel();
}

export const logger = {
  debug(...args: unknown[]): void {
    if (currentLevel() <= LogLevel.DEBUG) console.debug(PREFIX, ...args);
  },
  info(...args: unknown[]): void {
    if (currentLevel() <= LogLevel.INFO) console.info(PREFIX, ...args);
  },
  warn(...args: unknown[]): void {
    if (currentLevel() <= LogLevel.WARN) console.warn(PREFIX, ...args);
  },
  error(...args: unknown[]): void {
    if (currentLevel() <= LogLevel.ERROR) console.error(PREFIX, ...args);
  },
  /** Force DEBUG for the rest of the session (called by the settings page button). */
  enableDebug(): void {
    try {
      (window as unknown as { AxWikiClipperDebug?: boolean }).AxWikiClipperDebug = true;
    } catch {
      /* no window */
    }
  },
  /** Turn the runtime DEBUG override back off. */
  disableDebug(): void {
    try {
      (window as unknown as { AxWikiClipperDebug?: boolean }).AxWikiClipperDebug = false;
    } catch {
      /* no window */
    }
  },
  /** Whether the runtime DEBUG override is currently active. */
  isDebugEnabled(): boolean {
    try {
      return !!(window as unknown as { AxWikiClipperDebug?: boolean }).AxWikiClipperDebug;
    } catch {
      return false;
    }
  },
};
