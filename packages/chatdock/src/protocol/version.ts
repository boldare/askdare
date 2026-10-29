/**
 * Version of the SSE wire protocol between the chatdock server and its clients.
 * Bumped on any breaking change to event names or payloads (ADR-0006).
 */
export const PROTOCOL_VERSION: 1 = 1;

/** Response header carrying {@link PROTOCOL_VERSION} on every streaming response. */
export const PROTOCOL_HEADER: 'x-chatdock-protocol' = 'x-chatdock-protocol';
