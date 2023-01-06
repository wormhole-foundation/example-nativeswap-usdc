import { ethers } from "ethers";
import axios, { AxiosResponse } from "axios";
import {
  ChainId,
  getEmitterAddressEth,
  getSignedVAAWithRetry,
  Implementation__factory,
} from "@certusone/wormhole-sdk";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";
import {
  CrossChainSwapV2__factory,
  CrossChainSwapV3__factory,
  ICircleIntegration__factory,
} from "./ethers-contracts";
import { WebSocketProvider } from "./websocket";
import { TypedEvent } from "./ethers-contracts/common";

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

  const srcWebsocketProvider = new WebSocketProvider(
    process.env.SRC_WEBSOCKET_RPC!
  );
  const srcProvider = new ethers.providers.StaticJsonRpcProvider(
    process.env.SRC_STATIC_RPC!
  );

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
  const wormholeAddress = await srcContract.WORMHOLE();
  const srcChainId = await Implementation__factory.connect(
    wormholeAddress,
    srcProvider
  )
    .chainId()
    .then((id) => id as ChainId);

  const wormCircle = await srcContract
    .CIRCLE_INTEGRATION()
    .then((address) =>
      ICircleIntegration__factory.connect(address, srcProvider)
    );

  // let's go
  console.log("starting relayer");
  console.log(`src: wormhole chain id: ${srcChainId}`);

  // collect pending transactions
  const pending: [string, string][] = [];

  const websocketWormhole = Implementation__factory.connect(
    wormholeAddress,
    srcWebsocketProvider
  );
  websocketWormhole.on(
    websocketWormhole.filters.LogMessagePublished(wormCircle.address),
    (
      _sender: string,
      sequence: ethers.BigNumber,
      _nonce: number,
      _payload: string,
      _consistencyLevel: number,
      typedEvent: TypedEvent<
        [string, ethers.BigNumber, number, string, number] & {
          sender: string;
          sequence: ethers.BigNumber;
          nonce: number;
          payload: string;
          consistencyLevel: number;
        }
      >
    ) => {
      const txHash = typedEvent.transactionHash;
      if (
        pending.findIndex(([foundTxHash, _]) => foundTxHash === txHash) >= 0
      ) {
        return;
      }
      pending.push([txHash, sequence.toString()]);
    }
  );

  console.log("listening to transactions");

  // process transactions here
  while (true) {
    if (pending.length > 0) {
      // get first transaction hash
      const [txHash, sequence] = pending[0];

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
        pending.shift();
        continue;
      }

      console.log(`found transaction ${txHash}, sequence: ${sequence}`);

      // now fetch the signed message
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
        pending.shift();
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
        pending.shift();
        continue;
      }

      await dstContract.provider
        .getBalance(dstWallet.address)
        .then((balance) =>
          console.log(`wallet balance: ${ethers.utils.formatUnits(balance)}`)
        );

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

      await dstContract.provider
        .getBalance(dstWallet.address)
        .then((balance) =>
          console.log(`wallet balance: ${ethers.utils.formatUnits(balance)}`)
        );

      pending.shift();
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
