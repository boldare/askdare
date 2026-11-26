/**
 * A handoff transport could not deliver the report. Its message says what happened (a status,
 * a timeout) and never quotes the report or the receiver's answer, which may carry visitor text.
 */
export class HandoffDeliveryError extends Error {
  override readonly name: 'HandoffDeliveryError' = 'HandoffDeliveryError';
}
