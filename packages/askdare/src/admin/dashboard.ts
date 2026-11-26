/**
 * The `AdminDashboard` type (ADR-0032, decision 9): how `@boldare/askdare-admin` plugs its
 * dashboard into the console. Core serves the assets under the console, checks access, then calls
 * the handlers: one route, one sign-in, one set of headers. Core implements none of it.
 */
import type { AdminStore } from './port';

/** What a dashboard handler gets for one request, once core has checked access. */
export interface AdminDashboardRequest {
  /** The admin store the handler reads from. */
  readonly store: AdminStore;
  /** The request's JSON body, parsed and size-limited by core. The handler validates its shape. */
  readonly input: unknown;
  /**
   * Seals a conversation ID into a reference the browser may hold, bound to the admin session.
   * The browser never gets a raw conversation ID (ADR-0032, decision 8).
   */
  seal(conversationId: string): Promise<string>;
  /** Opens a reference `seal` made for this session: `undefined` when it is invalid or expired. */
  open(reference: string): Promise<string | undefined>;
  readonly signal: AbortSignal;
}

/** A read handler: resolves to the JSON answer, or throws to answer with an error. */
export type AdminDashboardHandler = (request: AdminDashboardRequest) => Promise<unknown>;

/** The dashboard: its inlined assets and read handlers, as `adminDashboard()` returns them. */
export interface AdminDashboard {
  /** The dashboard's script, built and inlined by the add-on. Holds no configuration. */
  readonly script: string;
  /** The dashboard's stylesheet, built and inlined by the add-on. */
  readonly style: string;
  /** Read handlers by action name (`a-z`, digits and `-`), called with POST requests only. */
  readonly handlers: Readonly<Record<string, AdminDashboardHandler>>;
}
