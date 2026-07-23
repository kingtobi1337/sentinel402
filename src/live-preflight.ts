export type LiveHealth = {
  network?: string;
  payToAccount?: string;
  demoReady?: boolean;
};

export function assertLivePaymentPreflight(
  health: LiveHealth,
  expected: { network: string; payToAccount: string },
): void {
  if (health.network !== expected.network) {
    throw new Error(`resource server network mismatch: expected ${expected.network}, got ${health.network ?? "missing"}`);
  }
  if (health.payToAccount !== expected.payToAccount) {
    throw new Error(`resource server receiver mismatch: expected ${expected.payToAccount}, got ${health.payToAccount ?? "missing"}`);
  }
  if (health.demoReady !== true) {
    throw new Error("resource server buyer is not ready; refusing to create a payment");
  }
}
