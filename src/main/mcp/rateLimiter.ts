export interface McpRateLimitConfiguration {
  maxRequests: number;
  windowMs: number;
}

export const defaultMcpRateLimit: McpRateLimitConfiguration = {
  maxRequests: 60,
  windowMs: 60_000
};

export class McpRateLimiter {
  private readonly timestampsByClient = new Map<string, number[]>();

  constructor(private readonly configuration: McpRateLimitConfiguration = defaultMcpRateLimit) {}

  allows(clientKey: string, now: Date): boolean {
    const cutoff = now.getTime() - this.configuration.windowMs;
    const timestamps = (this.timestampsByClient.get(clientKey) ?? []).filter(
      (timestamp) => timestamp >= cutoff
    );

    if (timestamps.length >= this.configuration.maxRequests) {
      this.timestampsByClient.set(clientKey, timestamps);
      return false;
    }

    timestamps.push(now.getTime());
    this.timestampsByClient.set(clientKey, timestamps);
    return true;
  }
}
