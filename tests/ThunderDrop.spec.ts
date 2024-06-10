import {
    Blockchain,
    SandboxContract,
    TreasuryContract,
    prettyLogTransactions,
    printTransactionFees,
} from '@ton/sandbox';
import { Address, Cell, Transaction, beginCell, storeStateInit, toNano } from '@ton/core';
import {
    MerkleData,
    ThunderDrop,
    bufferToBigInt,
    MerkleTree,
    DropOpcodes,
    DropExitCodes,
} from '../wrappers/ThunderDrop';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonContent, buildJettonContent } from '../utils/jetton';
import { JettonWallet } from '../wrappers/JettonWallet';
import { buffer } from 'stream/consumers';
import { Maybe } from '@ton/core/dist/utils/maybe';
import { collectCellStats, computedGeneric } from './gasUtils';
import { findTransactionRequired } from '@ton/test-utils';

describe('ThunderDrop', () => {
    let thunderDropCode: Cell;
    let distributorCode: Cell;
    let jettonMinterCode: Cell;
    let jettonWalletCode: Cell;

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let printTxGasStats: (name: string, trans: Transaction) => bigint;

    beforeAll(async () => {
        thunderDropCode = await compile('ThunderDrop');
        distributorCode = await compile('Distributor');
        jettonMinterCode = await compile('JettonMinter');
        jettonWalletCode = await compile('JettonWallet');
    });

    const toDeciamal = (value: number | string | bigint, decimalBase: number) => {
        return BigInt(value) * BigInt(10) ** BigInt(decimalBase);
    };

    const deployMockJetton = async (creator: SandboxContract<TreasuryContract>) => {
        const jetton = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: creator.address,
                    wallet_code: jettonWalletCode,
                    jetton_content: buildJettonContent({}),
                },
                jettonMinterCode,
            ),
        );
        const deployResult = await jetton.sendDeploy(creator.getSender(), toNano('2'));
        return { jetton, deployResult };
    };

    const mintJetton = async (
        creator: SandboxContract<TreasuryContract>,
        jetton: SandboxContract<JettonMinter>,
        to: Address,
        jettonAmount: bigint,
    ) => {
        const mintResult = await jetton.sendMint(creator.getSender(), to, jettonAmount);
        return { mintResult };
    };

    const deployThunderDrop = async (
        deployer: SandboxContract<TreasuryContract>,
        args: {
            merkleRoot: bigint;
            expectedAmount: bigint;
            startTime?: bigint;
            endTime?: bigint;
            mockJetton: SandboxContract<JettonMinter>;
            contentUri?: string;
        },
    ) => {
        let actualStartTime = args.startTime || BigInt(Math.ceil(Date.now() / 1000));
        let actualEndTime = args.endTime || actualStartTime + 3600n;
        // blockchain.now = Number(actualStartTime); We should set this time before we operate on the contract
        const thunderDrop = blockchain.openContract(
            ThunderDrop.createFromConfig(
                {
                    expectedAmount: args.expectedAmount,
                    merkleRoot: args.merkleRoot,
                    startTime: actualStartTime,
                    endTime: actualEndTime,
                    masterAddress: args.mockJetton.address,
                    adminAddress: deployer.address,
                    distributorCode: distributorCode,
                    content: beginCell()
                        .storeStringTail(args.contentUri || '')
                        .endCell(),
                },
                thunderDropCode,
            ),
        );
        const deployResult = await thunderDrop.sendDeploy(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'TopUp',
                queryId: 0n,
            },
        );
        // transfer jetton to thunderDrop
        return { thunderDrop, deployResult };
    };

    const generateMerkleData = async (samepleSize: number, decimalBase: number = 9) => {
        const numbers = Array.from({ length: samepleSize }, (_, i) => i);
        const merkleData: MerkleData[] = [];
        let totalAmount = 0n;
        for (const i of numbers) {
            const amount = toDeciamal(i + 1, decimalBase);
            const account = (await blockchain.treasury(`address${i}`, { balance: toNano('10000') })).address;
            totalAmount += amount;
            merkleData.push({
                index: BigInt(i),
                account,
                amount: amount,
            });
        }
        return {
            merkleData,
            totalAmount,
        };
    };

    const transferJetton = async (
        jetton: SandboxContract<JettonMinter>,
        from: SandboxContract<TreasuryContract>,
        to: Address,
        jettonAmount: bigint,
        responseAddress?: Address,
        forwardTonAmount?: bigint,
        forwardPayload?: Maybe<Cell>,
    ) => {
        const fromJettonWalletAddress = await jetton.getWalletAddress(from.address);
        const fromJettonWallet = blockchain.openContract(JettonWallet.createFromAddress(fromJettonWalletAddress));
        const transferResult = await fromJettonWallet.sendTransfer(
            from.getSender(),
            toNano('2'),
            jettonAmount,
            to,
            responseAddress || from.address,
            null,
            forwardTonAmount || 0n,
            forwardPayload || null,
        );
        return { transferResult, fromJettonWallet };
    };

    const getJettonBalance = async (jetton: SandboxContract<JettonMinter>, account: Address) => {
        const accountJettonWalletAddress = await jetton.getWalletAddress(account);
        const accountJettonWallet = blockchain.openContract(JettonWallet.createFromAddress(accountJettonWalletAddress));
        return await accountJettonWallet.getJettonBalance();
    };

    const setupThunderDrop = async (args: { sampleSize: number }) => {
        const { merkleData, totalAmount } = await generateMerkleData(args.sampleSize);
        const tree = MerkleTree.fromMerkleData(merkleData);
        const { jetton } = await deployMockJetton(deployer);
        await mintJetton(deployer, jetton, deployer.address, totalAmount);
        const { thunderDrop } = await deployThunderDrop(deployer, {
            merkleRoot: bufferToBigInt(tree.getRoot()),
            expectedAmount: totalAmount,
            mockJetton: jetton,
        });
        await transferJetton(jetton, deployer, thunderDrop.address, totalAmount, deployer.address, toNano('1'), null);
        const thunderDropData = await thunderDrop.getThunderDropData();
        blockchain.now = Number(thunderDropData.startTime) + 1;
        return {
            merkleData,
            tree,
            jetton,
            thunderDrop,
        };
    };

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        printTxGasStats = (name, transaction) => {
            const txComputed = computedGeneric(transaction);
            console.log(`${name} used ${txComputed.gasUsed} gas`);
            console.log(`${name} gas cost: ${txComputed.gasFees}`);
            return txComputed.gasFees;
        };
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and thunderDrop are ready to use
        const { merkleData, totalAmount } = await generateMerkleData(2000);
        const tree = MerkleTree.fromMerkleData(merkleData);
        const recoveredTree = MerkleTree.fromNodes(tree.exportNodes());
        expect(recoveredTree.getRoot().toString('hex')).toEqual(tree.getRoot().toString('hex'));

        // deploy jetton
        const { jetton } = await deployMockJetton(deployer);

        // mint jetton
        const { mintResult } = await mintJetton(deployer, jetton, deployer.address, totalAmount);
        expect(mintResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: jetton.address,
            success: true,
        });

        // deploy thunderDrop
        const { thunderDrop, deployResult } = await deployThunderDrop(deployer, {
            merkleRoot: bufferToBigInt(tree.getRoot()),
            expectedAmount: totalAmount,
            mockJetton: jetton,
        });
        expect(deployResult.transactions).toHaveTransaction({
            op: DropOpcodes.TopUp,
            from: deployer.address,
            to: thunderDrop.address,
            success: true,
            deploy: true,
        });
        expect(deployResult.transactions).toHaveTransaction({
            op: 0x2c76b973, // provide wallet address
            from: thunderDrop.address,
            to: jetton.address,
            success: true,
        });
        expect(deployResult.transactions).toHaveTransaction({
            op: 0xd1735400, // take wallet address
            from: jetton.address,
            to: thunderDrop.address,
            success: true,
        });

        // initialize thunderDrop
        const { transferResult, fromJettonWallet } = await transferJetton(
            jetton,
            deployer,
            thunderDrop.address,
            totalAmount,
            deployer.address,
            toNano('1'),
            null,
        );
        expect(transferResult.transactions).toHaveTransaction({
            op: 0xf8a7ea5, // jetton transfer
            from: deployer.address,
            to: fromJettonWallet.address,
            success: true,
        });

        // check jetton balance
        const thunderDropBalance = await getJettonBalance(jetton, thunderDrop.address);
        expect(thunderDropBalance).toEqual(totalAmount);

        // get thunder drop data
        const thunderDropData = await thunderDrop.getThunderDropData();
        expect(thunderDropData.walletAddress).not.toEqual(null);
        expect(thunderDropData.isInitialized).toEqual(true);

        // verify proof
        const proof = tree.getProofBuffer(0n);
        const isValidProof = tree.verifyProof(merkleData[0], proof);
        expect(isValidProof).toEqual(true);

        // Calculate Jetton Master Bond contract gas fee
        const smc = await blockchain.getContract(thunderDrop.address);
        if (smc.accountState === undefined) throw new Error("Can't access wallet account state");
        if (smc.accountState.type !== 'active') throw new Error('Wallet account is not active');
        if (smc.account.account === undefined || smc.account.account === null)
            throw new Error("Can't access wallet account!");
        console.log('Thunder Drop max storage stats:', smc.account.account.storageStats.used);
        const state = smc.accountState.state;
        const stateCell = beginCell().store(storeStateInit(state)).endCell();
        console.log('State init stats:', collectCellStats(stateCell, []));
    });

    it('Should claim jetton', async () => {
        const { merkleData, tree, jetton, thunderDrop } = await setupThunderDrop({ sampleSize: 10 });
        const index = 0n;
        const account = merkleData[0].account;
        const amount = merkleData[0].amount;
        const proof = tree.getProof(0n);

        // get thunder drop data
        const thunderDropData = await thunderDrop.getThunderDropData();
        expect(thunderDropData.isInitialized).toEqual(true);

        // get account jetton balance before claim
        const accountBalanceBefore = await getJettonBalance(jetton, account);

        // claim jetton
        const claimResult = await thunderDrop.sendClaim(
            deployer.getSender(),
            {
                value: toNano('0.5'),
            },
            {
                $$type: 'Claim',
                queryId: 0n,
                merkleProof: proof,
                index: index,
                account: account,
                amount: amount,
            },
        );

        expect(claimResult.transactions).toHaveTransaction({
            op: DropOpcodes.Claim,
            from: deployer.address,
            to: thunderDrop.address,
            success: true,
        });

        // Calculate gas fee for claiming airdrop
        const claimTx = findTransactionRequired(claimResult.transactions, {
            op: DropOpcodes.Claim,
            from: deployer.address,
            to: thunderDrop.address,
            success: true,
        });
        printTxGasStats('User claim gas fee:', claimTx);

        const distributorAddress = await thunderDrop.getDistributorAddress(index);
        expect(claimResult.transactions).toHaveTransaction({
            op: 0xca03fb47, // claim internal
            from: thunderDrop.address,
            to: distributorAddress,
            deploy: true,
            success: true,
        });

        // Calculate gas fee for claim internal
        const claimInternalTx = findTransactionRequired(claimResult.transactions, {
            op: 0xca03fb47, // claim internal
            from: thunderDrop.address,
            to: distributorAddress,
            success: true,
        });
        printTxGasStats('User claim internal gas fee:', claimInternalTx);

        expect(claimResult.transactions).toHaveTransaction({
            op: 0xd4a4cd9c, // claim internal reply
            from: distributorAddress,
            to: thunderDrop.address,
            success: true,
        });

        // Calculate gas fee for claim internal reply
        const claimInternaReplylTx = findTransactionRequired(claimResult.transactions, {
            op: 0xd4a4cd9c, // claim internal reply
            from: distributorAddress,
            to: thunderDrop.address,
            success: true,
        });
        printTxGasStats('User claim internal reply gas fee:', claimInternaReplylTx);

        // get account jetton balance after claim
        const accountBalanceAfter = await getJettonBalance(jetton, account);
        expect(accountBalanceAfter).toEqual(accountBalanceBefore + amount);

        // Calculate Distributor contract gas fee
        const smc2 = await blockchain.getContract(distributorAddress);
        if (smc2.accountState === undefined) throw new Error("Can't access wallet account state");
        if (smc2.accountState.type !== 'active') throw new Error('Wallet account is not active');
        if (smc2.account.account === undefined || smc2.account.account === null)
            throw new Error("Can't access wallet account!");
        console.log('Distributor max storage stats:', smc2.account.account.storageStats.used);
        const state2 = smc2.accountState.state;
        const stateCell2 = beginCell().store(storeStateInit(state2)).endCell();
        console.log('State init stats:', collectCellStats(stateCell2, []));
    });

    it("Should fail to withdraw if it's not the end time", async () => {
        const { thunderDrop } = await setupThunderDrop({ sampleSize: 10 });
        const result = await thunderDrop.sendWithdraw(
            deployer.getSender(),
            { value: toNano('0.5') },
            {
                $$type: 'Withdraw',
                queryId: 0n,
            },
        );
        expect(result.transactions).toHaveTransaction({
            op: DropOpcodes.Withdraw,
            from: deployer.address,
            to: thunderDrop.address,
            success: false,
            exitCode: DropExitCodes.NotFinished,
        });
    });

    it("Should withdraw if it's the end time", async () => {
        const { jetton, thunderDrop } = await setupThunderDrop({ sampleSize: 10 });

        const balanceBefore = await getJettonBalance(jetton, deployer.address);

        // set the end time
        const { endTime, expectedAmount, totalAmount } = await thunderDrop.getThunderDropData();
        blockchain.now = Number(endTime) + 1;

        // check the total amount is equal to the expected amount
        expect(expectedAmount).toEqual(totalAmount);

        // After the end time, the thunderDrop can be withdrawn
        const result = await thunderDrop.sendWithdraw(
            deployer.getSender(),
            { value: toNano('0.5') },
            {
                $$type: 'Withdraw',
                queryId: 0n,
            },
        );
        expect(result.transactions).toHaveTransaction({
            op: DropOpcodes.Withdraw,
            from: deployer.address,
            to: thunderDrop.address,
            success: true,
        });
        const { walletAddress } = await thunderDrop.getThunderDropData();
        expect(result.transactions).toHaveTransaction({
            op: 0xf8a7ea5, // jetton transfer
            from: thunderDrop.address,
            to: walletAddress!,
            success: true,
        });

        // Airdrop jetton wallet should send jetton internal transfer to admin jetton wallet
        const adminJettonWalletAddress = await jetton.getWalletAddress(deployer.address);
        expect(result.transactions).toHaveTransaction({
            op: 0x178d4519, // jetton internal transfer
            from: walletAddress!,
            to: adminJettonWalletAddress,
            success: true,
        });

        // Admin jetton wallet should send excess to admin
        expect(result.transactions).toHaveTransaction({
            op: 0xd53276db, // excess
            from: adminJettonWalletAddress,
            to: deployer.address,
            success: true,
        });
        const balanceAfter = await getJettonBalance(jetton, deployer.address);
        expect(balanceAfter).toBeGreaterThan(balanceBefore);
        expect(balanceAfter).toEqual(totalAmount);
    });

    it('Should fail to claim if the thunderDrop is not initialized', async () => {
        const { merkleData, totalAmount } = await generateMerkleData(10);
        const tree = MerkleTree.fromMerkleData(merkleData);
        const { jetton } = await deployMockJetton(deployer);
        await mintJetton(deployer, jetton, deployer.address, totalAmount);
        const { thunderDrop } = await deployThunderDrop(deployer, {
            merkleRoot: bufferToBigInt(tree.getRoot()),
            expectedAmount: totalAmount * 100n,
            mockJetton: jetton,
        });
        // Only transfer totalAmount to thunderDrop, but it need totalAmount * 100
        await transferJetton(jetton, deployer, thunderDrop.address, totalAmount, deployer.address, toNano('1'), null);

        // User try to claim
        const index = 0n;
        const account = merkleData[0].account;
        const amount = merkleData[0].amount;
        const proof = tree.getProof(0n);
        const claimResult = await thunderDrop.sendClaim(
            deployer.getSender(),
            {
                value: toNano('0.5'),
            },
            {
                $$type: 'Claim',
                queryId: 0n,
                merkleProof: proof,
                index: index,
                account: account,
                amount: amount,
            },
        );

        // Expect to thrwo not_initialized error (506)
        expect(claimResult.transactions).toHaveTransaction({
            op: DropOpcodes.Claim,
            from: deployer.address,
            to: thunderDrop.address,
            success: false,
            exitCode: DropExitCodes.NotInitialized,
        });
    });

    it('Should fail to claim if now < start time', async () => {
        const { merkleData, totalAmount } = await generateMerkleData(10);
        const tree = MerkleTree.fromMerkleData(merkleData);
        const { jetton } = await deployMockJetton(deployer);
        await mintJetton(deployer, jetton, deployer.address, totalAmount);
        const { thunderDrop } = await deployThunderDrop(deployer, {
            merkleRoot: bufferToBigInt(tree.getRoot()),
            expectedAmount: totalAmount,
            mockJetton: jetton,
            startTime: BigInt(Math.ceil(Date.now() / 1000)) + 3600n,
        });
        // Only transfer totalAmount to thunderDrop, but it need totalAmount * 100
        await transferJetton(jetton, deployer, thunderDrop.address, totalAmount, deployer.address, toNano('1'), null);

        const thunderDropData = await thunderDrop.getThunderDropData();
        blockchain.now = Number(thunderDropData.startTime) - 1;

        // User try to claim
        const index = 0n;
        const account = merkleData[0].account;
        const amount = merkleData[0].amount;
        const proof = tree.getProof(0n);
        const claimResult = await thunderDrop.sendClaim(
            deployer.getSender(),
            {
                value: toNano('0.5'),
            },
            {
                $$type: 'Claim',
                queryId: 0n,
                merkleProof: proof,
                index: index,
                account: account,
                amount: amount,
            },
        );

        // Expect to thrwo not_started error (501)
        expect(claimResult.transactions).toHaveTransaction({
            op: DropOpcodes.Claim,
            from: deployer.address,
            to: thunderDrop.address,
            success: false,
            exitCode: DropExitCodes.NotStarted,
        });
    });

    it('Should fail to claim if now > end time', async () => {
        const { merkleData, totalAmount } = await generateMerkleData(10);
        const tree = MerkleTree.fromMerkleData(merkleData);
        const { jetton } = await deployMockJetton(deployer);
        await mintJetton(deployer, jetton, deployer.address, totalAmount);
        const { thunderDrop } = await deployThunderDrop(deployer, {
            merkleRoot: bufferToBigInt(tree.getRoot()),
            expectedAmount: totalAmount,
            mockJetton: jetton,
            startTime: BigInt(Math.ceil(Date.now() / 1000)) + 3600n,
        });
        // Only transfer totalAmount to thunderDrop, but it need totalAmount * 100
        await transferJetton(jetton, deployer, thunderDrop.address, totalAmount, deployer.address, toNano('1'), null);

        const thunderDropData = await thunderDrop.getThunderDropData();
        blockchain.now = Number(thunderDropData.endTime) + 1;

        // User try to claim
        const index = 0n;
        const account = merkleData[0].account;
        const amount = merkleData[0].amount;
        const proof = tree.getProof(0n);
        const claimResult = await thunderDrop.sendClaim(
            deployer.getSender(),
            {
                value: toNano('0.5'),
            },
            {
                $$type: 'Claim',
                queryId: 0n,
                merkleProof: proof,
                index: index,
                account: account,
                amount: amount,
            },
        );

        // Expect to thrwo already_finished error (502)
        expect(claimResult.transactions).toHaveTransaction({
            op: DropOpcodes.Claim,
            from: deployer.address,
            to: thunderDrop.address,
            success: false,
            exitCode: DropExitCodes.Finished,
        });
    });
});
