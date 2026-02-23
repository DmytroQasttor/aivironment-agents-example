import { EventSource } from "eventsource";

const URL = process.env.MCP_SSE_URL!;

export function connectMcpSSE(onMessage: (msg: any) => void) {
  const es = new EventSource(URL, {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        headers: { ...init?.headers },
      }),
  });

  es.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data);
      onMessage(data);
    } catch (err) {
      console.error("Invalid MCP SSE message:", err);
    }
  };

  es.onerror = (err) => {
    console.error("MCP SSE connection error:", err);
  };

  return es;
}
