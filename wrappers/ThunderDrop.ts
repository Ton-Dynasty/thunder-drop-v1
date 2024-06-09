import {
    Address,
    beginCell,
    Builder,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
    DictionaryKey,
    DictionaryKeyTypes,
    Sender,
    SendMode,
} from '@ton/core';
import { Maybe } from '@ton/core/dist/utils/maybe';

export type ThunderDropConfigFull = {
    isInitialized: boolean;
    pending: bigint;
    totalAmount: bigint; // total amount of airdrop tokens in the contract
    expectedAmount: bigint; // expected amount of airdrop tokens to be distributed
    merkleRoot: bigint; // merkle root of the airdrop list
    startTime: bigint; // start time of the airdrop
    endTime: bigint; // end time of the airdrop
    masterAddress: Address; // address of the airdrop jetton master
    walletAddress: Maybe<Address>; // address of the wallet account
    adminAddress: Address; // address of the admin account
    distributorCode: Cell; // code of the distributor contract
    content: Cell; // content of the airdrop, and uri of the airdrop list json file on IPFS
};
export type ThunderDropConfig = Omit<
    ThunderDropConfigFull,
    'isInitialized' | 'pending' | 'totalAmount' | 'walletAddress'
>;

export function thunderDropConfigFullToCell(config: ThunderDropConfigFull): Cell {
    return beginCell()
        .storeBit(config.isInitialized)
        .storeUint(config.pending, 32)
        .storeCoins(config.totalAmount)
        .storeCoins(config.expectedAmount)
        .storeUint(config.merkleRoot, 256)
        .storeUint(config.startTime, 32)
        .storeUint(config.endTime, 32)
        .storeRef(
            beginCell()
                .storeAddress(config.masterAddress)
                .storeAddress(config.walletAddress)
                .storeAddress(config.adminAddress)
                .endCell(),
        )
        .storeRef(config.distributorCode)
        .storeRef(config.content)
        .endCell();
}

export function thunderDropConfigToCell(config: ThunderDropConfig): Cell {
    return beginCell()
        .storeBit(false) // isInitialized
        .storeUint(0, 32) // pending
        .storeCoins(0) // totalAmount
        .storeCoins(config.expectedAmount) // expectedAmount
        .storeUint(config.merkleRoot, 256) // merkleRoot
        .storeUint(config.startTime, 32) // startTime
        .storeUint(config.endTime, 32) // endTime
        .storeRef(
            beginCell()
                .storeAddress(config.masterAddress)
                .storeAddress(null) // jetton wallet address
                .storeAddress(config.adminAddress)
                .endCell(),
        )
        .storeRef(config.distributorCode)
        .storeRef(config.content)
        .endCell();
}

export const DropOpcodes = {
    TopUp: 0xd372158c,
    JettonTransfer: 0xf8a7ea5,
    Claim: 0xa769de27,
    Withdraw: 0xb5de5f9e,
    Upgrade: 0xb766741a,
};

export const DropError = (exitCode: number) => {
    switch (exitCode) {
        case 0xffff:
            return 'Invalid Opcode';
        case 333:
            return 'Wrong Workchain';
        case 500:
            return 'Permission Denied';
        case 501:
            return 'Not Started';
        case 502:
            return 'Finished';
        case 503:
            return 'Invalid Proof';
        case 504:
            return 'Invalid Params';
        case 505:
            return 'Already Claimed';
        case 506:
            return 'Not Initialized';
        case 507:
            return 'Is Initialized';
        case 508:
            return 'Pending Claim';
        case 509:
            return 'Not Finished';
        default:
            return `Unknown Exit Code: ${exitCode}`;
    }
};

export type TopUp = {
    $$type: 'TopUp';
    queryId: bigint;
};

export function storeTopUp(src: TopUp) {
    return (b: Builder) => {
        b.storeUint(DropOpcodes.TopUp, 32);
        b.storeUint(src.queryId, 64);
    };
}

export type Claim = {
    $$type: 'Claim';
    queryId: bigint;
    index: bigint;
    account: Address;
    amount: bigint;
    merkleProof: Dictionary<bigint, bigint>; // array index -> hash
};

export function storeClaim(src: Claim) {
    return (b: Builder) => {
        b.storeUint(DropOpcodes.Claim, 32);
        b.storeUint(src.queryId, 64);
        b.storeUint(src.index, 256);
        b.storeAddress(src.account);
        b.storeCoins(src.amount);
        b.storeUint(src.merkleProof.size, 32);
        b.storeDictDirect(src.merkleProof);
    };
}

export type Withdraw = {
    $$type: 'Withdraw';
    queryId: bigint;
};

export function storeWithdraw(src: Withdraw) {
    return (b: Builder) => {
        b.storeUint(DropOpcodes.Withdraw, 32);
        b.storeUint(src.queryId, 64);
    };
}

export type Upgrade = {
    $$type: 'Upgrade';
    queryId: bigint;
    newCode: Cell;
    newData: Maybe<Cell>;
};

export function storeUpgrade(src: Upgrade) {
    return (b: Builder) => {
        b.storeUint(DropOpcodes.Upgrade, 32);
        b.storeUint(src.queryId, 64);
        b.storeRef(src.newCode);
        b.storeMaybeRef(src.newData);
    };
}

export type JettonTransferDrop = {
    $$type: 'JettonTransfer';
    queryId: bigint;
    jettonAmount: bigint;
    to: Address;
    responseAddress: Address | null;
    customPayload: Maybe<Cell>;
    forwardTonAmount: bigint;
    forwardPayload: Maybe<Cell>;
};

export function storeJettonTransferDrop(src: JettonTransferDrop) {
    return (b: Builder) => {
        b.storeUint(DropOpcodes.JettonTransfer, 32);
        b.storeUint(src.queryId, 64);
        b.storeCoins(src.jettonAmount);
        b.storeAddress(src.to);
        b.storeAddress(src.responseAddress);
        b.storeMaybeRef(src.customPayload);
        b.storeCoins(src.forwardTonAmount);
        b.storeMaybeRef(src.forwardPayload);
    };
}

export class ThunderDrop implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static createFromAddress(address: Address) {
        return new ThunderDrop(address);
    }

    static createFromConfigFull(config: ThunderDropConfigFull, code: Cell, workchain = 0) {
        const data = thunderDropConfigFullToCell(config);
        const init = { code, data };
        return new ThunderDrop(contractAddress(workchain, init), init);
    }

    static createFromConfig(config: ThunderDropConfig, code: Cell, workchain = 0) {
        const data = thunderDropConfigToCell(config);
        const init = { code, data };
        return new ThunderDrop(contractAddress(workchain, init), init);
    }

    /* Pack */
    static packTopUp(src: TopUp) {
        return beginCell().store(storeTopUp(src)).endCell();
    }
    static packClaim(src: Claim) {
        return beginCell().store(storeClaim(src)).endCell();
    }
    static packWithdraw(src: Withdraw) {
        return beginCell().store(storeWithdraw(src)).endCell();
    }
    static packUpgrade(src: Upgrade) {
        return beginCell().store(storeUpgrade(src)).endCell();
    }
    static packJettonTransfer(src: JettonTransferDrop) {
        return beginCell()
            .storeUint(0xf8a7ea5, 32)
            .storeUint(src.queryId, 64)
            .storeCoins(src.jettonAmount)
            .storeAddress(src.to)
            .storeAddress(src.responseAddress)
            .storeMaybeRef(src.customPayload)
            .storeCoins(src.forwardTonAmount)
            .storeMaybeRef(src.forwardPayload)
            .endCell();
    }

    /* Send */
    async sendDeploy(
        provider: ContractProvider,
        via: Sender,
        args: { value: bigint; bounce?: boolean },
        body: TopUp,
        sendMode?: SendMode,
    ) {
        await provider.internal(via, {
            value: args.value,
            bounce: args.bounce,
            sendMode: sendMode,
            body: ThunderDrop.packTopUp(body),
        });
    }

    async sendClaim(
        provider: ContractProvider,
        via: Sender,
        args: { value: bigint; bounce?: boolean },
        body: Claim,
        sendMode?: SendMode,
    ) {
        await provider.internal(via, {
            value: args.value,
            bounce: args.bounce,
            sendMode: sendMode,
            body: ThunderDrop.packClaim(body),
        });
    }

    async sendTopUp(
        provider: ContractProvider,
        via: Sender,
        args: { value: bigint; bounce?: boolean },
        body: TopUp,
        sendMode?: SendMode,
    ) {
        await provider.internal(via, {
            value: args.value,
            bounce: args.bounce,
            sendMode: sendMode,
            body: ThunderDrop.packTopUp(body),
        });
    }

    async sendWithdraw(
        provider: ContractProvider,
        via: Sender,
        args: { value: bigint; bounce?: boolean },
        body: Withdraw,
        sendMode?: SendMode,
    ) {
        await provider.internal(via, {
            value: args.value,
            bounce: args.bounce,
            sendMode: sendMode,
            body: ThunderDrop.packWithdraw(body),
        });
    }

    /* Getter */
    async getContent(provider: ContractProvider) {
        const result = await provider.get('get_content', []);
        const content = result.stack.readCell().beginParse();
        return content.loadStringTail();
    }

    async getDistributorAddress(provider: ContractProvider, index: bigint) {
        const result = await provider.get('get_distributor_address', [
            {
                type: 'int',
                value: index,
            },
        ]);
        return result.stack.readAddress();
    }
}
