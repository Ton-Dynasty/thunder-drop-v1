import { Address, beginCell, toNano } from '@ton/core';
import { MerkleData, MerkleTree, ThunderDrop, bufferToBigInt, createWhiteList } from '../wrappers/ThunderDrop';
import { compile, NetworkProvider } from '@ton/blueprint';
import { promptAddress, promptAmount } from '../utils/ui';
import whitelist from './sample/whitelist.json';

export async function run(provider: NetworkProvider) {
    const airdropAddr = await promptAddress("Enter the Airdrop's address: ", provider.ui());
    const indexToClaim = BigInt(await provider.ui().input('Enter the index to claim: '));
    const merkleData = createWhiteList(whitelist);
    const merkleTree = MerkleTree.fromMerkleData(merkleData);
    const { index, amount, account } = merkleData[Number(indexToClaim)];
    const thunderDrop = provider.open(ThunderDrop.createFromAddress(airdropAddr));
    const proof = merkleTree.getProof(indexToClaim);
    await thunderDrop.sendClaim(
        provider.sender(),
        { value: toNano('0.2') },
        {
            $$type: 'Claim',
            queryId: 0n,
            index: index,
            amount: amount,
            account: account,
            merkleProof: proof,
        },
    );
}
