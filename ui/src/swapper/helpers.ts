import { ethers } from "ethers";
import { TransactionReceipt } from "@ethersproject/abstract-provider";

import {
  EVM_ETH_NETWORK_CHAIN_ID,
  EVM_POLYGON_NETWORK_CHAIN_ID,
  EVM_AVAX_NETWORK_CHAIN_ID,
  //EVM_BSC_NETWORK_CHAIN_ID,
} from "../utils/consts";
import { CrossChainSwapV2, CrossChainSwapV3 } from "../ethers-contracts";

export const CROSSCHAINSWAP_GAS_PARAMETERS_EIP1559 = {
  gasLimit: "694200",
  //maxFeePerGas: "250000000000",
  maxFeePerGas: "100420690000",
  maxPriorityFeePerGas: "1690000000",
};

export const CROSSCHAINSWAP_GAS_PARAMETERS_EVM = {
  gasLimit: "694200",
  //gasPrice: "250000000000",
  gasPrice: "20420690000",
};

export const EVM_EIP1559_CHAIN_IDS = [
  EVM_ETH_NETWORK_CHAIN_ID,
  EVM_POLYGON_NETWORK_CHAIN_ID,
  EVM_AVAX_NETWORK_CHAIN_ID,
];

export async function getEvmGasParametersForContract(
  contract: ethers.Contract
): Promise<any> {
  const chainId = await getChainIdFromContract(contract);

  if (EVM_EIP1559_CHAIN_IDS.indexOf(chainId) >= 0) {
    return CROSSCHAINSWAP_GAS_PARAMETERS_EIP1559;
  }

  return CROSSCHAINSWAP_GAS_PARAMETERS_EVM;
}

async function getChainIdFromContract(
  contract: ethers.Contract
): Promise<number> {
  const network = await contract.provider.getNetwork();
  return network.chainId;
}

export interface RedeemParametersStruct {
  encodedWormholeMessage: Uint8Array;
  circleBridgeMessage: Uint8Array;
  circleAttestation: Uint8Array;
}

// exact in
//
export async function evmSwapExactInFromVaaNative(
  swapContractWithSigner: CrossChainSwapV2 | CrossChainSwapV3,
  encodedWormholeMessage: Uint8Array,
  circleBridgeMessage: Uint8Array,
  circleAttestation: Uint8Array
): Promise<TransactionReceipt> {
  const gasParams = await getEvmGasParametersForContract(
    swapContractWithSigner
  );

  const tx = await swapContractWithSigner.recvAndSwapExactNativeIn(
    { encodedWormholeMessage, circleBridgeMessage, circleAttestation },
    gasParams
  );
  return tx.wait();
}
