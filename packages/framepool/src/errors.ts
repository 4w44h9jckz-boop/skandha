/**
 * Result codes. Names follow go-ethereum's error variables where one exists;
 * emem `docs/spec/` says which clause raises each. The list is emem's
 * `ref/python/emem/errors.py`, one constant a line.
 */
export const OK = "ok";

// Shared with go-ethereum
export const ErrAlreadyKnown = "ErrAlreadyKnown";
export const ErrTxTypeNotSupported = "ErrTxTypeNotSupported";
export const ErrOversizedData = "ErrOversizedData";
export const ErrMaxInitCodeSizeExceeded = "ErrMaxInitCodeSizeExceeded";
export const ErrGasLimitTooHigh = "ErrGasLimitTooHigh";
export const ErrNegativeValue = "ErrNegativeValue";
export const ErrGasLimit = "ErrGasLimit";
export const ErrTipAboveFeeCap = "ErrTipAboveFeeCap";
export const ErrInvalidSender = "ErrInvalidSender";
export const ErrNonceMax = "ErrNonceMax";
export const ErrIntrinsicGas = "ErrIntrinsicGas";
export const ErrFloorDataGas = "ErrFloorDataGas";
export const ErrTxGasPriceTooLow = "ErrTxGasPriceTooLow";
export const ErrEmptyAuthList = "ErrEmptyAuthList";
export const ErrNonceTooLow = "ErrNonceTooLow";
export const ErrNonceTooHigh = "ErrNonceTooHigh";
export const ErrInsufficientFunds = "ErrInsufficientFunds";
export const ErrOutOfOrderTxFromDelegated = "ErrOutOfOrderTxFromDelegated";
export const ErrInflightTxLimitReached = "ErrInflightTxLimitReached";
export const ErrAuthorityReserved = "ErrAuthorityReserved";
export const ErrAlreadyReserved = "ErrAlreadyReserved";
export const ErrUnderpriced = "ErrUnderpriced";
export const ErrTxPoolOverflow = "ErrTxPoolOverflow";
export const ErrFutureReplacePending = "ErrFutureReplacePending";
export const ErrReplaceUnderpriced = "ErrReplaceUnderpriced";
export const ErrFeeCapTooLow = "ErrFeeCapTooLow";

// This repository's, for the frame pool
export const ErrFrameMalformed = "ErrFrameMalformed";
export const ErrFrameExpiryNotFirst = "ErrFrameExpiryNotFirst";
export const ErrFrameNoPayer = "ErrFrameNoPayer";
export const ErrFrameAtomicInPrefix = "ErrFrameAtomicInPrefix";
export const ErrFrameUnrecognizedPrefix = "ErrFrameUnrecognizedPrefix";
export const ErrFrameVerifyAfterPrefix = "ErrFrameVerifyAfterPrefix";
export const ErrFrameVerifyGas = "ErrFrameVerifyGas";
export const ErrFrameVerifyStateGas = "ErrFrameVerifyStateGas";
export const ErrFrameExpired = "ErrFrameExpired";
export const ErrFramePrefixReverted = "ErrFramePrefixReverted";
export const ErrFrameMissingApprove = "ErrFrameMissingApprove";
export const ErrFrameDeployNoCode = "ErrFrameDeployNoCode";
export const ErrFrameBannedOpcode = "ErrFrameBannedOpcode";
export const ErrFrameStateWrite = "ErrFrameStateWrite";
export const ErrFrameStorageReadNonSender = "ErrFrameStorageReadNonSender";
export const ErrFrameCallTarget = "ErrFrameCallTarget";
export const ErrFramePayerExposure = "ErrFramePayerExposure";
export const ErrFramePaymasterBusy = "ErrFramePaymasterBusy";
export const ErrFrameSenderBusy = "ErrFrameSenderBusy";

// This repository's, for the MATCHA proposal (`docs/spec/04-matcha.md`)
export const ErrFrameInsufficientWidth = "ErrFrameInsufficientWidth";
export const ErrFrameLoadUnderpriced = "ErrFrameLoadUnderpriced";

// This repository's, for EIP-8288 aggregation (`docs/spec/05-aggregation.md`)
export const ErrDepFrameMalformed = "ErrDepFrameMalformed";
export const ErrFrameTooManyDeps = "ErrFrameTooManyDeps";
export const ErrFrameDepsUnproven = "ErrFrameDepsUnproven";
export const ErrWrapperMalformed = "ErrWrapperMalformed";
export const ErrWrapperUnknownTx = "ErrWrapperUnknownTx";
export const ErrWrapperDeps = "ErrWrapperDeps";
export const ErrWrapperTooManyDeps = "ErrWrapperTooManyDeps";
export const ErrWrapperProof = "ErrWrapperProof";

// This repository's, for EIP-8272 recent roots (`docs/spec/08-recent-roots.md`)
export const ErrFrameRootPosition = "ErrFrameRootPosition";
export const ErrFrameRootFuture = "ErrFrameRootFuture";
export const ErrFrameRootExpired = "ErrFrameRootExpired";
export const ErrFrameRootUnknown = "ErrFrameRootUnknown";

// This repository's, for EIP-8266 expiring nonces (`docs/spec/09-expiring-nonces.md`)
export const ErrFrameExpiryMissing = "ErrFrameExpiryMissing";
export const ErrFrameExpiryTooFar = "ErrFrameExpiryTooFar";

// This repository's, for EIP-8184 sealed transactions (`docs/spec/06-lucid.md`)
export const ErrSTMalformed = "ErrSTMalformed";
export const ErrSTExceedsToB = "ErrSTExceedsToB";
export const ErrSTNotIncludable = "ErrSTNotIncludable";

/** A rejection. The pool throws it internally and returns its code from `add`. */
export class TxError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
