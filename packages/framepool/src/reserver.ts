/**
 * The shared reservation tracker of NP-8 and FP-13: a sender lives in one
 * subpool at a time. go-ethereum `core/txpool/reserver.go`.
 *
 * The frame pool takes one and asks it; an account-nonce pool, which this
 * package does not hold, would share the same one.
 */
export class Reserver {
  private owner = new Map<string, object>();

  /** Take `addr` for `pool`. False if another subpool holds it. */
  hold(addr: string, pool: object): boolean {
    const owner = this.owner.get(addr);
    if (owner !== undefined && owner !== pool) return false;
    this.owner.set(addr, pool);
    return true;
  }

  release(addr: string, pool: object): void {
    if (this.owner.get(addr) === pool) this.owner.delete(addr);
  }

  heldByOther(addr: string, pool: object): boolean {
    const owner = this.owner.get(addr);
    return owner !== undefined && owner !== pool;
  }
}
