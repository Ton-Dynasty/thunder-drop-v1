import {
    Address,
    beginCell,
    Builder,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Dictionary,
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
    ClaimInternal: 0xca03fb47,
    ClaimInternalReply: 0xd4a4cd9c,
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
        b.storeDict(src.merkleProof);
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
    async getThunderDropData(provider: ContractProvider): Promise<ThunderDropConfigFull> {
        const result = await provider.get('get_thunderdrop_data', []);
        const isInitialized = result.stack.readBoolean();
        const pending = result.stack.readBigNumber();
        const totalAmount = result.stack.readBigNumber();
        const expectedAmount = result.stack.readBigNumber();
        const merkleRoot = result.stack.readBigNumber();
        const startTime = result.stack.readBigNumber();
        const endTime = result.stack.readBigNumber();
        const masterAddress = result.stack.readAddress();
        const walletAddress = result.stack.readAddressOpt();
        const adminAddress = result.stack.readAddress();
        const distributorCode = result.stack.readCell();
        const content = result.stack.readCell();
        return {
            isInitialized,
            pending,
            totalAmount,
            expectedAmount,
            merkleRoot,
            startTime,
            endTime,
            masterAddress,
            walletAddress,
            adminAddress,
            distributorCode,
            content,
        };
    }
}

export interface MerkleData {
    index: bigint;
    account: Address;
    amount: bigint;
}

export function bufferToBigInt(buffer: Buffer): bigint {
    return BigInt(`0x${buffer.toString('hex')}`);
}
export class MerkleTree {
    private nodes: Buffer[];
    private leafCount: number;

    constructor(data: Buffer[], skipBuild: boolean = false) {
        if (skipBuild) {
            this.nodes = data;
            this.leafCount = Math.floor((data.length + 1) / 2);
        } else {
            let leaves = data;

            // Padding to ensure leaves length is a power of 2
            const targetLength = Math.pow(2, Math.ceil(Math.log2(leaves.length)));
            while (leaves.length < targetLength) {
                leaves.push(Buffer.alloc(0));
            }

            this.leafCount = leaves.length;
            this.nodes = this.buildNodes(leaves);
        }
    }

    leafHashFunction(a: MerkleData): Buffer {
        return beginCell().storeUint(a.index, 256).storeAddress(a.account).storeCoins(a.amount).endCell().hash();
    }

    layerHashFunction(a: Buffer, b: Buffer): Buffer {
        let intA = a.length === 0 ? 0n : bufferToBigInt(a);
        let intB = b.length === 0 ? 0n : bufferToBigInt(b);
        if (intA > intB) {
            [intA, intB] = [intB, intA];
        }
        return beginCell().storeUint(intA, 256).storeUint(intB, 256).endCell().hash();
    }

    private buildNodes(leaves: Buffer[]): Buffer[] {
        const nodes = [...leaves];
        let offset = 0;

        while (nodes.length < 2 * leaves.length - 1) {
            const currentLayerSize = nodes.length - offset;
            for (let i = 0; i < currentLayerSize; i += 2) {
                const left = nodes[offset + i];
                const right = i + 1 < currentLayerSize ? nodes[offset + i + 1] : Buffer.alloc(0);
                nodes.push(this.layerHashFunction(left, right));
            }
            offset += currentLayerSize;
        }

        return nodes;
    }
    getRoot(): Buffer {
        return this.nodes[this.nodes.length - 1];
    }

    private getProofInternal(index: number): Buffer[] {
        let proof: Buffer[] = [];
        let nodeIndex = index;
        let offset = 0;
        let layerSize = this.leafCount;

        while (layerSize > 1) {
            const pairIndex = nodeIndex ^ 1;
            if (pairIndex < layerSize) {
                proof.push(this.nodes[offset + pairIndex]);
            }

            nodeIndex >>= 1;
            offset += layerSize;
            layerSize >>= 1;
        }

        return proof;
    }

    getProofBuffer(index: bigint): Buffer[] {
        return this.getProofInternal(Number(index));
    }

    getProof(index: bigint): Dictionary<bigint, bigint> {
        const proof = this.getProofInternal(Number(index));
        const dict = Dictionary.empty(Dictionary.Keys.BigUint(32), Dictionary.Values.BigUint(256));
        for (let i = 0; i < proof.length; i++) {
            dict.set(BigInt(i), bufferToBigInt(proof[i]));
        }
        return dict;
    }

    verifyProof(leaf: MerkleData, proof: Buffer[]): boolean {
        let hash = this.leafHashFunction(leaf);
        for (const proofElement of proof) {
            hash = this.layerHashFunction(hash, proofElement);
        }
        return hash.equals(this.getRoot());
    }

    getLeaves(): Buffer[] {
        return this.nodes.slice(0, this.leafCount);
    }
    static fromMerkleData(data: MerkleData[]): MerkleTree {
        const leaves = data.map((item) =>
            beginCell().storeUint(item.index, 256).storeAddress(item.account).storeCoins(item.amount).endCell().hash(),
        );
        return new MerkleTree(leaves);
    }

    static fromNodes(hexNodes: string[]): MerkleTree {
        const nodes = hexNodes.map((hex) => Buffer.from(hex, 'hex'));
        return new MerkleTree(nodes, true);
    }

    exportNodes(): string[] {
        return this.nodes.map((hash) => hash.toString('hex'));
    }

    display() {
        let offset = 0;
        let layerSize = this.leafCount;
        while (layerSize > 0) {
            for (let i = offset; i < offset + layerSize; i++) {
                console.log(layerSize, this.nodes[i].toString('hex'));
            }
            offset += layerSize;
            layerSize = Math.floor(layerSize / 2);
        }
    }
}
