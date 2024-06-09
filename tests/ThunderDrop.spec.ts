import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { ThunderDrop } from '../wrappers/ThunderDrop';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('ThunderDrop', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('ThunderDrop');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let thunderDrop: SandboxContract<ThunderDrop>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        thunderDrop = blockchain.openContract(ThunderDrop.createFromConfig({}, code));

        deployer = await blockchain.treasury('deployer');

        const deployResult = await thunderDrop.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: thunderDrop.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and thunderDrop are ready to use
    });
});
