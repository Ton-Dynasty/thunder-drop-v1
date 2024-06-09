import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, beginCell, toNano } from '@ton/core';
import { ThunderDrop } from '../wrappers/ThunderDrop';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { JettonMinter } from '../wrappers/JettonMinter';
import { JettonContent, buildJettonContent } from '../utils/jetton';

describe('ThunderDrop', () => {
    let thunderDropCode: Cell;
    let distributorCode: Cell;
    let jettonMinterCode: Cell;
    let jettonWalletCode: Cell;

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let airdropContract: SandboxContract<ThunderDrop>;
    let jettonMaster: SandboxContract<JettonMinter>;

    beforeAll(async () => {
        thunderDropCode = await compile('ThunderDrop');
        distributorCode = await compile('Distributor');
        jettonMinterCode = await compile('JettonMinter');
        jettonWalletCode = await compile('JettonWallet');
    });

    const deployMockJetton = async (
        creator: SandboxContract<TreasuryContract>,
        content:
            | JettonContent
            | {
                  name: 'Mock Jetton';
                  symbol: 'MJT';
                  decimals: '9';
              },
        config?: {
            premintAmount?: bigint;
        },
    ) => {
        const jetton = blockchain.openContract(
            JettonMinter.createFromConfig(
                {
                    admin: deployer.address,
                    wallet_code: jettonWalletCode,
                    jetton_content: buildJettonContent(content),
                },
                jettonMinterCode,
            ),
        );
        const deployResult = await jetton.sendDeploy(deployer.getSender(), toNano('0.05'));
        // premint
        if (config?.premintAmount) {
            await jetton.sendMint(creator.getSender(), creator.address, config.premintAmount);
        }
        return { jetton, deployResult };
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

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        const { jetton } = await deployMockJetton(
            deployer,
            {
                name: 'ox Mock Jetton',
                symbol: 'OMJ',
                decimals: '9',
            },
            {
                premintAmount: toNano('100000'), // mint 100000 OMJ
            },
        );
        jettonMaster = jetton;
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and thunderDrop are ready to use
        const { thunderDrop, deployResult } = await deployThunderDrop(deployer, {
            merkleRoot: 0n,
            expectedAmount: toNano('1000'),
            mockJetton: jettonMaster,
        });
        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: thunderDrop.address,
            success: true,
            deploy: true,
        });
    });
});
