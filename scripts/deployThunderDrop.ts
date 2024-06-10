import { Address, beginCell, toNano } from '@ton/core';
import { MerkleData, MerkleTree, ThunderDrop, bufferToBigInt, createWhiteList } from '../wrappers/ThunderDrop';
import { compile, NetworkProvider } from '@ton/blueprint';
import { buildJettonContent } from '../utils/jetton';
import { promptAddress } from '../utils/ui';
import whitelist from './sample/whitelist.json';
import { JettonMaster } from '@ton/ton';
import { JettonWallet } from '../wrappers/JettonWallet';

export async function run(provider: NetworkProvider) {
    const jettonMaster = await promptAddress("Enter the Jetton Master's address: ", provider.ui());
    const merkleData = createWhiteList(whitelist);
    const expectedAmount = merkleData.reduce((acc, item) => acc + item.amount, 0n);
    const merkleTree = MerkleTree.fromMerkleData(merkleData);
    const thunderDrop = provider.open(
        ThunderDrop.createFromConfig(
            {
                expectedAmount: expectedAmount,
                merkleRoot: bufferToBigInt(merkleTree.getRoot()),
                startTime: BigInt(0), // no start time
                endTime: BigInt(Math.floor(Date.now() / 1000) + 600), // 10 minutes
                masterAddress: jettonMaster,
                adminAddress: provider.sender().address!,
                distributorCode: await compile('Distributor'),
                content: beginCell().storeStringTail('https://google.com').endCell(),
            },
            await compile('ThunderDrop'),
        ),
    );

    await thunderDrop.sendDeploy(
        provider.sender(),
        { value: toNano('0.2') },
        {
            $$type: 'TopUp',
            queryId: 0n,
        },
    );
    await provider.waitForDeploy(thunderDrop.address);

    // transfer the expected amount to the ThunderDrop contract
    const jm = provider.open(JettonMaster.create(jettonMaster));
    const jwAddr = await jm.getWalletAddress(provider.sender().address!);
    const jw = provider.open(JettonWallet.createFromAddress(jwAddr));
    await jw.sendTransfer(
        provider.sender(),
        toNano('0.2'),
        expectedAmount,
        thunderDrop.address,
        provider.sender().address!,
        null,
        toNano('0.1'),
        null,
    );
}
// Master: kQBjJmqqIGCWfK4XyV1kDVZT5wDf2V-qMQDE4_rPOUgO97Cq