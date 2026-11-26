/**
 * What the console hands the dashboard when it mounts it (ADR-0032, decision 9). The console owns
 * the admin token and the URLs; the dashboard only names an action and its input.
 */
export interface DashboardHost {
  /** POSTs the input to the dashboard action; rejects with an Error whose message is the error code. */
  call(action: string, input: unknown): Promise<unknown>;
  /** Opens the console's own review of a conversation, from the conversation store. */
  review?(ref: string): void;
}

/** What the dashboard script puts on `globalThis` for the console to find. */
export interface DashboardEntry {
  mount(element: HTMLElement, host: DashboardHost): () => void;
}
