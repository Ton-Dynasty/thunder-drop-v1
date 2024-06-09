import { toNano } from '@ton/core';
import { ThunderDrop } from '../wrappers/ThunderDrop';
import { compile, NetworkProvider } from '@ton/blueprint';
import { MerkleTree } from 'merkletreejs';

export async function run(provider: NetworkProvider) {
    // const thunderDrop = provider.open(ThunderDrop.createFromConfig({}, await compile('ThunderDrop')));
    // await thunderDrop.sendDeploy(provider.sender(), toNano('0.05'));
    // await provider.waitForDeploy(thunderDrop.address);
    // run methods on `thunderDrop`
}
