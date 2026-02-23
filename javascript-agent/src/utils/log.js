export function logInfo(message, fields = {}) {
  console.log(
    JSON.stringify({
      level: "info",
      message,
      ...fields,
      ts: new Date().toISOString(),
    }),
  );
}

export function logError(message, fields = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      message,
      ...fields,
      ts: new Date().toISOString(),
    }),
  );
}
