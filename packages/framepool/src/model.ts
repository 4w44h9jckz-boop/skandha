/**
 * Accounts, state, heads and the base fee: emem `docs/spec/00-model.md`,
 * MD-1 to MD-4 and FEE-1.
 */

export const DELEGATION_PREFIX = "0xef0100";

/** MD-2: a code value starting with 0xef0100 is an EIP-7702 delegation indicator. */
export function isDelegation(code: string): boolean {
  return code.startsWith(DELEGATION_PREFIX);
}

/** MD-2. */
export class Account {
  constructor(
    public nonce: bigint = 0n,
    public balance: bigint = 0n,
    public code: string = "",
    public storage: Map<bigint, bigint> = new Map(),
    public nonceSeqs: Map<bigint, bigint> = new Map(),
    public withdrawal: bigint = 0n
  ) {}

  copy(): Account {
    return new Account(
      this.nonce,
      this.balance,
      this.code,
      new Map(this.storage),
      new Map(this.nonceSeqs),
      this.withdrawal
    );
  }
}

const EMPTY = new Account();
let versions = 1;
const nextVersion = (): number => versions++;

/**
 * MD-3: addresses to accounts. An absent address reads as the default account.
 *
 * Pools only read a state. Whoever produces the next state copies first, so a
 * state handed to a pool never changes under it. A copy shares its accounts
 * with the original until `edit` copies one, on either side, so an account
 * nobody edited is the same object in both (`changedSince`).
 */
export class State {
  private accounts: Map<string, Account>;
  private own: Set<string>; // accounts this state alone holds, and may change in place
  private version: number; // renewed at every copy
  private base = 0; // the version of the state this one was copied from

  constructor(accounts?: Map<string, Account>) {
    this.accounts = new Map();
    for (const [addr, acc] of accounts ?? [])
      this.accounts.set(addr, acc.copy());
    this.own = new Set(this.accounts.keys());
    this.version = nextVersion();
  }

  /** A read-only view. Mutating it is a bug; use `edit`. */
  account(addr: string): Readonly<Account> {
    return this.accounts.get(addr) ?? EMPTY;
  }

  edit(addr: string): Account {
    if (!this.own.has(addr)) {
      const acc = this.accounts.get(addr);
      this.accounts.set(addr, acc !== undefined ? acc.copy() : new Account());
      this.own.add(addr);
    }
    return this.accounts.get(addr) as Account;
  }

  nonce(addr: string): bigint {
    return this.account(addr).nonce;
  }

  balance(addr: string): bigint {
    return this.account(addr).balance;
  }

  code(addr: string): string {
    return this.account(addr).code;
  }

  storage(addr: string, slot: bigint): bigint {
    return this.account(addr).storage.get(slot) ?? 0n;
  }

  withdrawal(addr: string): bigint {
    return this.account(addr).withdrawal;
  }

  /** MD-3: key 0 is the account nonce (EIP-8250). */
  nonceSeq(addr: string, key: bigint): bigint {
    if (key === 0n) return this.nonce(addr);
    return this.account(addr).nonceSeqs.get(key) ?? 0n;
  }

  addresses(): string[] {
    return [...this.accounts.keys()];
  }

  copy(): State {
    const fresh = Object.create(State.prototype) as State;
    fresh.accounts = new Map(this.accounts);
    fresh.own = new Set();
    this.own = new Set();
    this.version = nextVersion(); // its edits so far are no longer its own to list
    this.base = 0;
    fresh.version = nextVersion();
    fresh.base = this.version;
    return fresh;
  }

  /**
   * The addresses whose account may differ from `older`'s: every one edited
   * since a common copy, at least. When this state is the latest copy of
   * `older` and `older` has not been edited since, that is exactly the
   * accounts this one has edited.
   */
  changedSince(older: State): Set<string> {
    if (this.base === older.version && older.own.size === 0)
      return new Set(this.own);
    const out = new Set<string>();
    for (const [addr, acc] of this.accounts)
      if (older.accounts.get(addr) !== acc) out.add(addr);
    for (const addr of older.accounts.keys())
      if (!this.accounts.has(addr)) out.add(addr);
    return out;
  }
}

/** MD-4, with the slot of `08-recent-roots.md`, RR-2. */
export interface Head {
  readonly number: number;
  readonly timestamp: number;
  readonly gasLimit: bigint;
  readonly gasUsed: bigint;
  readonly baseFee: bigint;
  readonly slot: number; // RR-2: EIP-7843's slotNumber
}

export const ELASTICITY_MULTIPLIER = 2n;
export const BASE_FEE_CHANGE_DENOMINATOR = 8n;

/** FEE-1, go-ethereum `CalcBaseFee`. Every operand is non-negative, so `/` floors. */
export function nextBaseFee(
  gasLimit: bigint,
  gasUsed: bigint,
  baseFee: bigint
): bigint {
  const target = gasLimit / ELASTICITY_MULTIPLIER;
  if (gasUsed === target) return baseFee;
  if (gasUsed > target) {
    const delta =
      (baseFee * (gasUsed - target)) / target / BASE_FEE_CHANGE_DENOMINATOR;
    return baseFee + (delta > 1n ? delta : 1n);
  }
  const delta =
    (baseFee * (target - gasUsed)) / target / BASE_FEE_CHANGE_DENOMINATOR;
  const next = baseFee - delta;
  return next > 0n ? next : 0n;
}

export function headNextBaseFee(head: Head): bigint {
  return nextBaseFee(head.gasLimit, head.gasUsed, head.baseFee);
}

/** FEE-2. Negative when the fee cap is below the base fee. */
export function effectiveTip(
  maxFee: bigint,
  tip: bigint,
  baseFee: bigint
): bigint {
  const room = maxFee - baseFee;
  return tip < room ? tip : room;
}
