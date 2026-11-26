// @boldare/askdare/testing: the contract suites a store, an index or a log must pass (ADR-0024,
// ADR-0025, ADR-0027, ADR-0032), and the fixtures an index's own tests need. The suites take the
// test runner's describe, it and expect, so this entry depends on no runner.

export type { KnowledgeIndexContractOptions, OpenKnowledgeIndex } from '../knowledge/contract';
export { knowledgeIndexContract } from '../knowledge/contract';
export type { KnowledgeDocumentInput } from '../knowledge/document';
export { knowledgeDocument } from '../knowledge/document';
export type { FakeEmbedderOptions } from '../knowledge/fake-embedder';
export { fakeEmbedder } from '../knowledge/fake-embedder';
export type { TurnEventLogContractOptions } from '../resume/turn-log-contract';
export { turnEventLogContract } from '../resume/turn-log-contract';
export type { AdminStoreContractOptions } from './admin-store-contract';
export { adminStoreContract } from './admin-store-contract';
export type { ConversationStoreContractOptions } from './conversation-store-contract';
export { conversationStoreContract } from './conversation-store-contract';
export { rateLimitStoreContract } from './rate-limit-store-contract';
export type { ContractExpect, ContractRunner } from './runner';
