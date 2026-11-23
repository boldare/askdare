/**
 * The parts of a test runner the contract suites use. Vitest's and Jest's `describe`, `it` and
 * `expect` fit, so `@boldare/askdare/testing` depends on no runner.
 */
export interface ContractRunner {
  readonly describe: (name: string, body: () => void) => void;
  readonly it: (name: string, body: () => Promise<void>, timeout?: number) => void;
  readonly expect: ContractExpect;
}

/** The assertions the contract suites make. */
export type ContractExpect = (actual: unknown) => {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeInstanceOf(expected: abstract new (...args: never[]) => unknown): void;
};
