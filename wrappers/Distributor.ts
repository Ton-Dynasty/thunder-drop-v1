import { Address, Cell, Contract, ContractProvider, beginCell, contractAddress } from '@ton/core';

export type DistributorConfig = {
    prefix: bigint;
    thunderDrop: Address;
    claimWord: bigint;
};

export function distributorConfigToCell(config: DistributorConfig): Cell {
    return beginCell()
        .storeUint(config.prefix, 256)
        .storeAddress(config.thunderDrop)
        .storeUint(config.claimWord, 256)
        .endCell();
}

export class Distributor implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new Distributor(address);
    }

    static createFromConfig(config: DistributorConfig, code: Cell, workchain = 0) {
        const data = distributorConfigToCell(config);
        const init = { code, data };
        return new Distributor(contractAddress(workchain, init), init);
    }

    async getContent(provider: ContractProvider, index: bigint) {
        const result = await provider.get('get_is_claimed', [
            {
                type: 'int',
                value: index,
            },
        ]);
        const content = result.stack.readCell().beginParse();
        return content.loadStringTail();
    }

    async getDistributorData(provider: ContractProvider) {
        const result = await provider.get('get_distributor_data', []);
        const prefix = result.stack.readBigNumber();
        const thunderDrop = result.stack.readAddress();
        const claimWord = result.stack.readBigNumber();
        return { prefix, thunderDrop, claimWord };
    }
}
