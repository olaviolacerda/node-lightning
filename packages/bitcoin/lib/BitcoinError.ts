import { BitcoinErrorCode } from "./BitcoinErrorCode";

function getMessage(code: BitcoinErrorCode) {
    switch (code) {
        case BitcoinErrorCode.InvalidPrivateKey:
            return "Invalid private key";
        case BitcoinErrorCode.Base58ChecksumFailed:
            return "Base58Check checksum failed";
        case BitcoinErrorCode.PubKeyInvalid:
            return "Invalid public key";
        case BitcoinErrorCode.PubKeyHashInvalid:
            return "Invalid pubkeyhash";
        case BitcoinErrorCode.SigEncodingInvalid:
            return "Signatures requires BIP66 DER encoding";
        case BitcoinErrorCode.SigHashTypeInvalid:
            return "Invalid Signature SIGHASH type";
        case BitcoinErrorCode.MultiSigSetupInvalid:
            return "MultiSig structure is invalid";
        case BitcoinErrorCode.Hash160Invalid:
            return "Hash160 requires 20-byte Buffer";
        case BitcoinErrorCode.Hash256Invalid:
            return "Hash256 requires 32-byte Buffer";
        case BitcoinErrorCode.NetworkMismatch:
            return "Network mismatch";

        case BitcoinErrorCode.UnkownHdKeyVersion:
            return "Unkown HD key version";
        case BitcoinErrorCode.InvalidHdEncoding:
            return "Invalid HD encoding";
        case BitcoinErrorCode.InvalidHdPath:
            return "Invalid HD key path";
        case BitcoinErrorCode.InvalidHdDerivation:
            return "Invalid HD key derivation";
        case BitcoinErrorCode.InvalidHdPrivateKey:
            return "Invalid HD private key";
        case BitcoinErrorCode.InvalidHdPublicKey:
            return "Invalid HD public key";

        default:
            return "Unknown";
    }
}

export class BitcoinError extends Error {
    constructor(readonly code: BitcoinErrorCode, readonly info?: any) {
        super(getMessage(code));
        this.name = "BitcoinError";
    }
}
