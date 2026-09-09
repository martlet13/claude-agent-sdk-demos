export function mapGenerationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout/i.test(message)) {
    return message.includes("Generation timed out")
      ? message
      : "Generation timed out. Try fewer images or retry. You can cancel a stuck run and start again.";
  }
  if (/401|unauthorized|invalid.?api.?key|authentication|api key/i.test(message)) {
    return "Claude rejected this API key. Paste a valid Anthropic key in Setup and try again.";
  }
  if (/429|rate.?limit/i.test(message)) {
    return "Claude rate-limited this request. Wait a moment and retry.";
  }
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|network|fetch failed|socket/i.test(message)) {
    return `Could not reach Claude from this computer: ${message}`;
  }
  return message;
}
