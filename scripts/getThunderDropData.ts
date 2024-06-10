import { Address, beginCell, toNano } from '@ton/core';
import { MerkleData, MerkleTree, ThunderDrop, bufferToBigInt, createWhiteList } from '../wrappers/ThunderDrop';
import { compile, NetworkProvider } from '@ton/blueprint';
import { promptAddress, promptAmount } from '../utils/ui';
import whitelist from './sample/whitelist.json';

export async function run(provider: NetworkProvider) {
    const airdropAddr = await promptAddress("Enter the Airdrop's address: ", provider.ui());
    const thunderDrop = provider.open(ThunderDrop.createFromAddress(airdropAddr));
    const data = await thunderDrop.getThunderDropData();
    console.log(data);
}
