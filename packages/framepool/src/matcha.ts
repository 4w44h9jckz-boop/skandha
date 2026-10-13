/** MATCHA's charge: emem `docs/spec/04-matcha.md`, MA-2. */
import { Prefix } from "./prefix.js";
import { FrameTx, TX_VALUE_COST } from "./tx.js";

/** FEE-4's intrinsic gas without the value-transfer term, plus the prefix's declared execution limits. */
export function admissionGas(tx: FrameTx, prefix: Prefix): bigint {
  const valueFrames = tx.frames.filter(
    (f) => f.value > 0n && f.target !== null && f.target !== tx.sender
  ).length;
  return (
    tx.gas.intrinsic -
    TX_VALUE_COST * BigInt(valueFrames) +
    prefix.frames.reduce((g, f) => g + f.execGas, 0n)
  );
}

/** A non-negative decimal as a fraction, read from the digits it is written with. */
function decimal(x: number): [bigint, bigint] {
  const text = String(x);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null)
    throw new Error(`safety factor ${text} is not a plain decimal`);
  const fraction = match[2] ?? "";
  return [BigInt(match[1] + fraction), 10n ** BigInt(fraction.length)];
}

/** ceil(safetyFactor * admissionGas), exactly: the factor is read as the decimal it is written as. */
export function charge(
  tx: FrameTx,
  prefix: Prefix,
  safetyFactor: number
): bigint {
  const [num, den] = decimal(safetyFactor);
  const product = num * admissionGas(tx, prefix);
  return (product + den - 1n) / den;
}
