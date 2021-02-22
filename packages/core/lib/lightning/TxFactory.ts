import {
    bip69InputSorter,
    bip69OutputSorter,
    OutPoint,
    Script,
    TxBuilder,
    TxOut,
    Value,
} from "@node-lightning/bitcoin";
import { CommitmentNumber } from "./CommitmentNumber";
import { Htlc } from "./Htlc";
import { HtlcDirection } from "./HtlcDirection";
import { ScriptFactory } from "./ScriptFactory";

export class TxFactory {
    /**
     * Creates a TxOut to attach to a funding transaction. This includes
     * the P2WSH-P2MS script that uses 2-2MS. The open and accept funding
     * pubkeys are sorted lexicographcially to create the script.
     * @param builder
     */
    public static createFundingOutput(
        value: Value,
        openPubKey: Buffer,
        acceptPubKey: Buffer,
    ): TxOut {
        const script = Script.p2wshLock(ScriptFactory.fundingScript(openPubKey, acceptPubKey));
        return new TxOut(value, script);
    }

    /**
     * Constructs an unsigned commitment transaction according to BOLT3.
     * This method is a low level commitment transaction builder, meaning
     * it accepts primatives and constructs a commitment transaction
     * accordingly. The proper inputs are determiend
     *
     * @param isFunderLocal True when the funding node is local. This
     * is used to determine which output pays fees (to_local/to_remote).
     * @param commitmentNumber The commitment number of the transaction
     * which is used to generate the obscurred commitment number.
     * @param openPaymentBasePoint The basepoint sent in open_channel
     * which is used to generate the obscurred commitment number.
     * @param acceptPaymentBasePoint The basepoitn sent in accept_channel
     * which is used to generate the obscurred commitment number.
     * @param fundingOutPoint The outpoint of the funding transaction
     * which was established in funding_created.
     * @param dustLimitSatoshi The dust limit in sats after which outputs
     * will be prune
     * @param feePerKw The fee rate per kiloweight which will be deducted
     * from the funding node's output
     * @param localDelay The delay applied to the to_local output
     * @param localValue Value paid to the to_local RSMC output
     * @param remoteValue Value paid to the to_emote P2WPKH output
     * @param revocationPubKey The revocation public key used to in the
     * to_local and HTLC outputs
     * @param delayedPubKey The delayed public key used to spend the
     * to_local output
     * @param remotePubKey The public key used to spend the to_remote
     * output
     * @param reverseHtlcs True when the HTLC direction needs to be
     * inverted because the holder of this commitment transaction is
     * our counterparty.
     * @param localHtlcPubKey The public key used to spend HTLC outputs
     * by the commitment holder.
     * @param remoteHtlcPubKey The public key used to spend HTLC outputs
     * by the commitment counterparty.
     * @param htlcs A full list of HTLCs that will be selectively
     * included in the commitment transaction based on the feePerKw.
     */
    public static createCommitment(
        isFunderLocal: boolean,
        commitmentNumber: number,
        openPaymentBasePoint: Buffer,
        acceptPaymentBasePoint: Buffer,
        fundingOutPoint: OutPoint,
        dustLimitSatoshi: Value,
        feePerKw: bigint,
        localDelay: number,
        localValue: Value,
        remoteValue: Value,
        revocationPubKey: Buffer,
        delayedPubKey: Buffer,
        remotePubKey: Buffer,
        reverseHtlcs: boolean,
        localHtlcPubKey?: Buffer,
        remoteHtlcPubKey?: Buffer,
        htlcs: Htlc[] = [],
    ): TxBuilder {
        const obscuredCommitmentNumber = CommitmentNumber.obscure(
            commitmentNumber,
            openPaymentBasePoint,
            acceptPaymentBasePoint,
        );

        // 1. add the input as the funding outpoint and set the nSequence
        const tx = new TxBuilder(bip69InputSorter, bip69OutputSorter);
        tx.version = 2;
        tx.addInput(fundingOutPoint, CommitmentNumber.getSequence(obscuredCommitmentNumber));

        // 2. set the locktime to the obscurred commitment number
        tx.locktime = CommitmentNumber.getLockTime(obscuredCommitmentNumber);

        // 3. find unpruned outputs
        const unprunedHtlcs: Htlc[] = [];
        for (const htlc of htlcs) {
            const valueInSats = htlc.value.sats;
            let feeWeight: bigint;

            // HtlcDirection refers to the local nodes perception of the HTLC.
            // When isLocal, offered uses the HTLC-Timeout weight of 663. When
            // remote, the commitment is for the remote counterparty and an
            // offered HTLC is received and will be spent by the remote
            // counterparty using the HTLC-Success transaction with a weight of 703
            if (reverseHtlcs) {
                feeWeight = htlc.direction === HtlcDirection.Offered ? 703n : 663n;
            } else {
                feeWeight = htlc.direction === HtlcDirection.Offered ? 663n : 703n;
            }

            // Calculate the HTLC less fees
            const feeInSats = (feeWeight * feePerKw) / 1000n;
            const satsLessFee = valueInSats - feeInSats;

            // Only keep HTLCs greater than the dustLimitSatoshi for the tx
            if (satsLessFee >= dustLimitSatoshi.sats) {
                unprunedHtlcs.push(htlc);
            }
        }

        // 4. calculate base fee
        const weight = 724 + unprunedHtlcs.length * 172;
        const baseFee = (BigInt(weight) * feePerKw) / 1000n;

        // 5. substract base fee from funding node
        if (isFunderLocal) {
            const newValue = localValue.sats - baseFee;
            if (newValue > 0n) {
                localValue = Value.fromSats(newValue);
            } else {
                localValue = Value.zero();
            }
        } else {
            const newValue = remoteValue.sats - baseFee;
            if (newValue > 0n) {
                remoteValue = Value.fromSats(newValue);
            } else {
                remoteValue = Value.zero();
            }
        }

        // 6/7. add unpruned offered/received HTLCs
        for (const htlc of unprunedHtlcs) {
            const witnessScript: Script =
                (!reverseHtlcs && htlc.direction === HtlcDirection.Offered) ||
                (reverseHtlcs && htlc.direction === HtlcDirection.Accepted)
                    ? ScriptFactory.offeredHtlcScript(
                          htlc.paymentHash,
                          revocationPubKey,
                          localHtlcPubKey,
                          remoteHtlcPubKey,
                      )
                    : ScriptFactory.receivedHtlcScript(
                          htlc.paymentHash,
                          htlc.cltvExpiry,
                          revocationPubKey,
                          localHtlcPubKey,
                          remoteHtlcPubKey,
                      );
            tx.addOutput(htlc.value, Script.p2wshLock(witnessScript));
        }

        // 8. add local if unpruned
        if (localValue.sats >= dustLimitSatoshi.sats) {
            tx.addOutput(
                localValue,
                Script.p2wshLock(ScriptFactory.toLocalScript(revocationPubKey, delayedPubKey, localDelay)), // prettier-ignore
            );
        }

        // 9. add remote if unpruned
        if (remoteValue.sats >= dustLimitSatoshi.sats) {
            tx.addOutput(remoteValue, Script.p2wpkhLock(remotePubKey));
        }

        return tx;
    }
}
