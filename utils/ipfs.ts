export type PinataResponse = {
    IpfsHash: string;
    PinSize: number;
    Timestamp: string;
    isDuplicate: boolean;
    uri: string;
};

export async function pinJsonToIPFS(JWT: string, metadata: object) {
    const blob = new Blob([JSON.stringify(metadata)], { type: 'application/json' });
    const data = new FormData();
    data.append('file', blob, 'metadata.json');

    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${JWT}`,
        },
        body: data,
    });
    const resData = await res.json();
    resData.uri = `https://gateway.pinata.cloud/ipfs/${resData.IpfsHash}`;
    return resData as PinataResponse;
}
