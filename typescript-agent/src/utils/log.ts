interface LogFields {
  [key: string]: unknown;
}

export function logInfo(message: string, fields: LogFields = {}) {
  console.log(
    JSON.stringify({
      level: "info",
      message,
      ...fields,
      ts: new Date().toISOString(),
    }),
  );
}

export function logError(message: string, fields: LogFields = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      message,
      ...fields,
      ts: new Date().toISOString(),
    }),
  );
}
