import { ethers } from "ethers";
import axios, { AxiosResponse } from "axios";
import {
  ChainId,
  getEmitterAddressEth,
  getSignedVAAWithRetry,
  IWormhole__factory,
  parseSequencesFromLogEth,
} from "@certusone/wormhole-sdk";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import {
  CrossChainSwapV2__factory,
  CrossChainSwapV3__factory,
  ICircleIntegration__factory,
} from "./ethers-contracts";
import { WebSocketProvider } from "./websocket";

const WORMHOLE_RPC_HOSTS = ["https://wormhole-v2-testnet-api.certus.one"];

// main
(async () => {
  const relayerTimeout = Number(process.env.RELAYER_TIMEOUT!);
  const receiptMaxAttempts = Number(process.env.RECEIPT_MAX_ATTEMPTS!);
  const receiptTimeout = Number(process.env.RECEIPT_TIMEOUT!);

  const attestationTimeout = Number(process.env.ATTESTATION_TIMEOUT!);
  console.log(`attestation timeout: ${attestationTimeout}`);

  const attestationMaxAttempts = Number(process.env.ATTESTATION_MAX_ATTEMPTS!);
  console.log(`attestation max attempts: ${attestationMaxAttempts}`);

  const vaaTimeout = Number(process.env.ATTESTATION_TIMEOUT!);
  console.log(`vaa timeout: ${vaaTimeout}`);

  const vaaMaxAttempts = Number(process.env.ATTESTATION_MAX_ATTEMPTS!);
  console.log(`vaa max attempts: ${vaaMaxAttempts}`);

  const srcContractType = process.env.SRC_CONTRACT_TYPE!;
  const circleEmitter = process.env.CIRCLE_EMITTER!;

  const srcProvider = new WebSocketProvider(process.env.SRC_RPC!);
  const dstWallet = new ethers.Wallet(
    process.env.PRIVATE_KEY!,
    new ethers.providers.StaticJsonRpcProvider(process.env.DST_RPC!)
  );

  const [srcContract, dstContract] = (() => {
    const srcAddress = process.env.SRC_CONTRACT_ADDRESS!;
    const dstAddress = process.env.DST_CONTRACT_ADDRESS!;
    if (srcContractType == "v3") {
      return [
        CrossChainSwapV3__factory.connect(srcAddress, srcProvider),
        CrossChainSwapV2__factory.connect(dstAddress, dstWallet),
      ];
    } else {
      return [
        CrossChainSwapV2__factory.connect(srcAddress, srcProvider),
        CrossChainSwapV3__factory.connect(dstAddress, dstWallet),
      ];
    }
  })();

  // wormhole
  const wormhole = await srcContract
    .WORMHOLE()
    .then((address) => IWormhole__factory.connect(address, srcProvider));
  const srcChainId = await wormhole.chainId().then((id) => id as ChainId);

  const wormCircle = await srcContract
    .CIRCLE_INTEGRATION()
    .then((address) =>
      ICircleIntegration__factory.connect(address, srcProvider)
    );

  // let's go
  console.log("starting relayer");
  console.log(`src: wormhole chain id: ${srcChainId}`);

  // collect pending transactions
  const pendingTxHashes: string[] = [];
  srcProvider.on("pending", (txHash: string) => {
    if (pendingTxHashes.includes(txHash)) {
      return;
    }
    pendingTxHashes.push(txHash);
  });
  console.log("listening to transactions");

  // process transactions here
  while (true) {
    if (pendingTxHashes.length > 0) {
      // get first transaction hash
      const txHash = pendingTxHashes[0];

      // attempt to get transaction receipt
      let receipt: ethers.providers.TransactionReceipt | null = null;
      let numAttempts = 0;
      while (numAttempts <= receiptMaxAttempts) {
        const attempt = await srcProvider.getTransactionReceipt(txHash);
        if (attempt !== null) {
          receipt = attempt;
          break;
        }
        ++numAttempts;
        await sleep(receiptTimeout);
      }

      // if we really have a receipt, process the logs
      if (receipt === null || receipt.to != srcContract.address) {
        pendingTxHashes.shift();
        continue;
      }

      console.log(`found transaction ${txHash}`);

      // fetch wormhole message sequence
      const sequences = parseSequencesFromLogEth(receipt, wormhole.address);
      if (sequences.length == 0) {
        console.log(`probably just a redeem. moving on`);
        pendingTxHashes.shift();
        continue;
      }
      const sequence = sequences[0];

      // now fetched the signed message
      const result = await getSignedVAAWithRetry(
        WORMHOLE_RPC_HOSTS,
        srcChainId,
        getEmitterAddressEth(wormCircle.address),
        sequence,
        {
          transport: NodeHttpTransport(),
        },
        vaaTimeout,
        vaaMaxAttempts
      ).catch((reason) => null);

      if (result === null) {
        console.log(`cannot find signed vaa for ${txHash}`);
        pendingTxHashes.shift();
        continue;
      }

      const { vaaBytes: encodedWormholeMessage } = result;

      // find circle message
      const [circleBridgeMessage, circleAttestation] =
        await handleCircleMessageInLogs(
          receipt.logs,
          circleEmitter,
          attestationTimeout,
          attestationMaxAttempts
        );
      if (circleBridgeMessage === null || circleAttestation === null) {
        console.log(`cannot attest Circle message for ${txHash}`);
        pendingTxHashes.shift();
        continue;
      }

      const redeemReceipt = await dstContract
        .recvAndSwapExactNativeIn({
          encodedWormholeMessage,
          circleBridgeMessage,
          circleAttestation,
        })
        .catch((reason) => {
          console.log(reason);
          return null;
        })
        .then((tx) => {
          if (tx === null) {
            return null;
          }

          return tx.wait() as Promise<ethers.ContractReceipt>;
        });
      if (redeemReceipt !== null) {
        console.log(`relayed ${redeemReceipt.transactionHash}`);
      }

      pendingTxHashes.shift();
    }

    await sleep(relayerTimeout);
  }
})();

async function handleCircleMessageInLogs(
  logs: ethers.providers.Log[],
  circleEmitterAddress: string,
  attestationTimeout: number,
  attestationMaxAttempts: number
): Promise<[string | null, string | null]> {
  const circleMessage = await findCircleMessageInLogs(
    logs,
    circleEmitterAddress
  );
  if (circleMessage === null) {
    return [null, null];
  }

  const circleMessageHash = ethers.utils.keccak256(circleMessage);
  const signature = await getCircleAttestation(
    circleMessageHash,
    attestationTimeout,
    attestationMaxAttempts
  );
  if (signature === null) {
    return [null, null];
  }

  return [circleMessage, signature];
}

async function findCircleMessageInLogs(
  logs: ethers.providers.Log[],
  circleEmitterAddress: string
): Promise<string | null> {
  for (const log of logs) {
    if (log.address == circleEmitterAddress) {
      const messageSentIface = new ethers.utils.Interface([
        "event MessageSent(bytes message)",
      ]);
      return messageSentIface.parseLog(log).args.message as string;
    }
  }

  return null;
}

async function sleep(timeout: number) {
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

async function getCircleAttestation(
  messageHash: ethers.BytesLike,
  timeout: number,
  maxAttempts: number
) {
  //while (true) {
  for (let i = 0; i < maxAttempts; ++i) {
    // get the post
    const response = await axios
      .get(`https://iris-api-sandbox.circle.com/attestations/${messageHash}`)
      .catch((reason) => {
        return null;
      })
      .then(async (response: AxiosResponse | null) => {
        if (
          response !== null &&
          response.status == 200 &&
          response.data.status == "complete"
        ) {
          return response.data.attestation as string;
        }

        return null;
      });

    if (response !== null) {
      return response;
    }

    await sleep(timeout);
  }

  return null;
}
