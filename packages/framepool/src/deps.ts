/**
 * FP-10: what a simulated prefix depends on, and the value each had. A
 * dependency is a kind, an address and, for a nonce sequence or a storage
 * slot, a number; FP-15 compares each with its value at a new head.
 */
import { State } from "./model.js";

export type DepKind =
  | "nonce_seq"
  | "code"
  | "balance"
  | "storage"
  | "withdrawal";
export type DepValue = string | bigint;

export interface DepKey {
  readonly kind: DepKind;
  readonly addr: string;
  readonly n: bigint | null;
  readonly id: string;
}

export function depKey(
  kind: DepKind,
  addr: string,
  n: bigint | null = null
): DepKey {
  return { kind, addr, n, id: `${kind}|${addr}|${n ?? ""}` };
}

/** An insertion-ordered map of dependencies; setting a key again keeps its place. */
export class Deps {
  private map = new Map<string, { key: DepKey; value: DepValue }>();

  set(key: DepKey, value: DepValue): void {
    const held = this.map.get(key.id);
    if (held !== undefined) held.value = value;
    else this.map.set(key.id, { key, value });
  }

  get(key: DepKey): DepValue | undefined {
    return this.map.get(key.id)?.value;
  }

  *entries(): IterableIterator<[DepKey, DepValue]> {
    for (const { key, value } of this.map.values()) yield [key, value];
  }

  *keys(): IterableIterator<DepKey> {
    for (const { key } of this.map.values()) yield key;
  }
}

export function depValue(state: State, key: DepKey): DepValue {
  switch (key.kind) {
    case "nonce_seq":
      return state.nonceSeq(key.addr, key.n as bigint);
    case "code":
      return state.code(key.addr);
    case "balance":
      return state.balance(key.addr);
    case "storage":
      return state.storage(key.addr, key.n as bigint);
    case "withdrawal":
      return state.withdrawal(key.addr);
  }
}
