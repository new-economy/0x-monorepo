import { BlockchainLifecycle, web3Factory } from '@0xproject/dev-utils';
import { LogWithDecodedArgs } from '@0xproject/types';
import { AbiDecoder, BigNumber } from '@0xproject/utils';
import { Web3Wrapper } from '@0xproject/web3-wrapper';
import * as chai from 'chai';
import 'make-promises-safe';
import * as Web3 from 'web3';

import * as multiSigWalletJSON from '../../build/contracts/MultiSigWalletWithTimeLock.json';
import { MultiSigWalletContract } from '../src/contract_wrappers/generated/multi_sig_wallet';
import { MultiSigWalletWithTimeLockContract } from '../src/contract_wrappers/generated/multi_sig_wallet_with_time_lock';
import { artifacts } from '../src/utils/artifacts';
import { expectRevertOrAlwaysFailingTransaction } from '../src/utils/assertions';
import { chaiSetup } from '../src/utils/chai_setup';
import { constants } from '../src/utils/constants';
import { MultiSigWrapper } from '../src/utils/multi_sig_wrapper';
import { SubmissionContractEventArgs } from '../src/utils/types';
import { provider, txDefaults, web3Wrapper } from '../src/utils/web3_wrapper';

const MULTI_SIG_ABI = artifacts.MultiSigWalletWithTimeLock.compilerOutput.abi;
chaiSetup.configure();
const expect = chai.expect;
const blockchainLifecycle = new BlockchainLifecycle(web3Wrapper);
const abiDecoder = new AbiDecoder([MULTI_SIG_ABI]);

describe('MultiSigWalletWithTimeLock', () => {
    let owners: string[];
    before(async () => {
        const accounts = await web3Wrapper.getAvailableAddressesAsync();
        owners = [accounts[0], accounts[1]];
    });
    const SIGNATURES_REQUIRED = new BigNumber(2);
    const SECONDS_TIME_LOCKED = new BigNumber(10000);

    let multiSig: MultiSigWalletWithTimeLockContract;
    let multiSigWrapper: MultiSigWrapper;
    let txId: BigNumber;
    let initialSecondsTimeLocked: number;
    beforeEach(async () => {
        await blockchainLifecycle.startAsync();
    });
    afterEach(async () => {
        await blockchainLifecycle.revertAsync();
    });

    describe('changeTimeLock', () => {
        describe('initially non-time-locked', async () => {
            before(async () => {
                await blockchainLifecycle.startAsync();
            });
            after(async () => {
                await blockchainLifecycle.revertAsync();
            });
            before('deploy a wallet', async () => {
                multiSig = await MultiSigWalletWithTimeLockContract.deployFrom0xArtifactAsync(
                    artifacts.MultiSigWalletWithTimeLock,
                    provider,
                    txDefaults,
                    owners,
                    SIGNATURES_REQUIRED,
                    new BigNumber(0),
                );
                multiSigWrapper = new MultiSigWrapper((multiSig as any) as MultiSigWalletContract);

                const secondsTimeLocked = await multiSig.secondsTimeLocked.callAsync();
                initialSecondsTimeLocked = secondsTimeLocked.toNumber();
            });
            it('should throw when not called by wallet', async () => {
                return expectRevertOrAlwaysFailingTransaction(
                    multiSig.changeTimeLock.sendTransactionAsync(SECONDS_TIME_LOCKED, { from: owners[0] }),
                );
            });

            it('should throw without enough confirmations', async () => {
                const destination = multiSig.address;
                const from = owners[0];
                const dataParams = {
                    name: 'changeTimeLock',
                    abi: MULTI_SIG_ABI,
                    args: [SECONDS_TIME_LOCKED.toNumber()],
                };
                const txHash = await multiSigWrapper.submitTransactionAsync(destination, from, dataParams);
                const txReceipt = await web3Wrapper.awaitTransactionSuccessAsync(
                    txHash,
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );
                const log = abiDecoder.tryToDecodeLogOrNoop(txReceipt.logs[0]) as LogWithDecodedArgs<
                    SubmissionContractEventArgs
                >;

                txId = log.args.transactionId;
                return expectRevertOrAlwaysFailingTransaction(
                    multiSig.executeTransaction.sendTransactionAsync(txId, { from: owners[0] }),
                );
            });

            it('should set confirmation time with enough confirmations', async () => {
                const destination = multiSig.address;
                const from = owners[0];
                const dataParams = {
                    name: 'changeTimeLock',
                    abi: MULTI_SIG_ABI,
                    args: [SECONDS_TIME_LOCKED.toNumber()],
                };
                let txHash = await multiSigWrapper.submitTransactionAsync(destination, from, dataParams);
                const txReceipt = await web3Wrapper.awaitTransactionSuccessAsync(
                    txHash,
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );
                const log = abiDecoder.tryToDecodeLogOrNoop(txReceipt.logs[0]) as LogWithDecodedArgs<
                    SubmissionContractEventArgs
                >;

                txId = log.args.transactionId;
                txHash = await multiSig.confirmTransaction.sendTransactionAsync(txId, { from: owners[1] });
                const res = await web3Wrapper.awaitTransactionSuccessAsync(
                    txHash,
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );
                expect(res.logs).to.have.length(2);

                const blockNum = await web3Wrapper.getBlockNumberAsync();
                const blockInfo = await web3Wrapper.getBlockAsync(blockNum);
                const timestamp = new BigNumber(blockInfo.timestamp);
                const confirmationTimeBigNum = new BigNumber(await multiSig.confirmationTimes.callAsync(txId));

                expect(timestamp).to.be.bignumber.equal(confirmationTimeBigNum);
            });

            it('should be executable with enough confirmations and secondsTimeLocked of 0', async () => {
                const destination = multiSig.address;
                const from = owners[0];
                const dataParams = {
                    name: 'changeTimeLock',
                    abi: MULTI_SIG_ABI,
                    args: [SECONDS_TIME_LOCKED.toNumber()],
                };
                let txHash = await multiSigWrapper.submitTransactionAsync(destination, from, dataParams);
                const txReceipt = await web3Wrapper.awaitTransactionSuccessAsync(
                    txHash,
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );
                const log = abiDecoder.tryToDecodeLogOrNoop(txReceipt.logs[0]) as LogWithDecodedArgs<
                    SubmissionContractEventArgs
                >;

                txId = log.args.transactionId;
                txHash = await multiSig.confirmTransaction.sendTransactionAsync(txId, { from: owners[1] });
                await web3Wrapper.awaitTransactionSuccessAsync(txHash, constants.AWAIT_TRANSACTION_MINED_MS);

                expect(initialSecondsTimeLocked).to.be.equal(0);

                txHash = await multiSig.executeTransaction.sendTransactionAsync(txId, { from: owners[0] });
                const res = await web3Wrapper.awaitTransactionSuccessAsync(
                    txHash,
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );
                expect(res.logs).to.have.length(2);

                const secondsTimeLocked = new BigNumber(await multiSig.secondsTimeLocked.callAsync());
                expect(secondsTimeLocked).to.be.bignumber.equal(SECONDS_TIME_LOCKED);
            });
        });
        describe('initially time-locked', async () => {
            before(async () => {
                await blockchainLifecycle.startAsync();
            });
            after(async () => {
                await blockchainLifecycle.revertAsync();
            });
            const newSecondsTimeLocked = 0;
            before('deploy a wallet', async () => {
                multiSig = await MultiSigWalletWithTimeLockContract.deployFrom0xArtifactAsync(
                    artifacts.MultiSigWalletWithTimeLock,
                    provider,
                    txDefaults,
                    owners,
                    SIGNATURES_REQUIRED,
                    SECONDS_TIME_LOCKED,
                );
                multiSigWrapper = new MultiSigWrapper((multiSig as any) as MultiSigWalletContract);

                const secondsTimeLocked = await multiSig.secondsTimeLocked.callAsync();
                initialSecondsTimeLocked = secondsTimeLocked.toNumber();
                const destination = multiSig.address;
                const from = owners[0];
                const dataParams = {
                    name: 'changeTimeLock',
                    abi: MULTI_SIG_ABI,
                    args: [newSecondsTimeLocked],
                };
                let txHash = await multiSigWrapper.submitTransactionAsync(destination, from, dataParams);
                let txReceipt = await web3Wrapper.awaitTransactionSuccessAsync(
                    txHash,
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );
                const log = abiDecoder.tryToDecodeLogOrNoop(txReceipt.logs[0]) as LogWithDecodedArgs<
                    SubmissionContractEventArgs
                >;
                txId = log.args.transactionId;
                txHash = await multiSig.confirmTransaction.sendTransactionAsync(txId, {
                    from: owners[1],
                });
                txReceipt = await web3Wrapper.awaitTransactionSuccessAsync(
                    txHash,
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );
                expect(txReceipt.logs).to.have.length(2);
            });

            it('should throw if it has enough confirmations but is not past the time lock', async () => {
                return expectRevertOrAlwaysFailingTransaction(
                    multiSig.executeTransaction.sendTransactionAsync(txId, { from: owners[0] }),
                );
            });

            // TODO(albrow): increaseTimeAsync not supported
            it('should execute if it has enough confirmations and is past the time lock', async () => {
                await web3Wrapper.increaseTimeAsync(SECONDS_TIME_LOCKED.toNumber());
                // Note: we need to send a transaction after increasing time so
                // that a block is actually mined. The contract looks at the
                // last mined block for the timestamp.
                await web3Wrapper.awaitTransactionSuccessAsync(
                    await web3Wrapper.sendTransactionAsync({ from: owners[0], to: owners[1], value: 1 }),
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );
                await web3Wrapper.awaitTransactionSuccessAsync(
                    await multiSig.executeTransaction.sendTransactionAsync(txId, { from: owners[0] }),
                    constants.AWAIT_TRANSACTION_MINED_MS,
                );

                const secondsTimeLocked = new BigNumber(await multiSig.secondsTimeLocked.callAsync());
                expect(secondsTimeLocked).to.be.bignumber.equal(newSecondsTimeLocked);
            });
        });
    });
});
