import { Blockchain, SandboxContract, TreasuryContract, prettyLogTransactions } from '@ton/sandbox';
import { Address, Cell, beginCell, toNano } from '@ton/core';
import { MerkleData, ThunderDrop, bufferToBigInt, MerkleTree, DropOpcodes } from '../wrappers/ThunderDrop';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonContent, buildJettonContent } from '../utils/jetton';
import { JettonWallet } from '../wrappers/JettonWallet';
import { buffer } from 'stream/consumers';
import { Maybe } from '@ton/core/dist/utils/maybe';

describe('ThunderDrop', () => {
    let thunderDropCode: Cell;
    let distributorCode: Cell;
    let jettonMinterCode: Cell;
    let jettonWalletCode: Cell;

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;

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
        blockchain.now = Number(actualStartTime);
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
        return accountJettonWallet.getJettonBalance();
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
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and thunderDrop are ready to use
        // TODO
        // TODO
        // TODO: @ipromise2324 when generateMerkleData(2), it will fail with exit code 5
        // TODO
        // TODO
        const { merkleData, totalAmount } = await generateMerkleData(3);
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
    });

    it('Should claim jetton', async () => {
        const { merkleData, tree, jetton, thunderDrop } = await setupThunderDrop({ sampleSize: 1000 });
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
        const distributorAddress = await thunderDrop.getDistributorAddress(index);
        expect(claimResult.transactions).toHaveTransaction({
            from: thunderDrop.address,
            to: distributorAddress,
            deploy: true,
            success: true,
        });

        // get account jetton balance after claim
        const accountBalanceAfter = await getJettonBalance(jetton, account);
        expect(accountBalanceAfter).toEqual(accountBalanceBefore + amount);
    });
});
