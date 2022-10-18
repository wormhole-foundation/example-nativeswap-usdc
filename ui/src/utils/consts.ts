import {
  ChainId,
  CHAIN_ID_ETH,
  CHAIN_ID_POLYGON,
  CHAIN_ID_AVAX,
  CHAIN_ID_BSC,
} from "@certusone/wormhole-sdk";

export const EVM_POLYGON_NETWORK_CHAIN_ID = 80001;
export const EVM_ETH_NETWORK_CHAIN_ID = 5;
export const EVM_AVAX_NETWORK_CHAIN_ID = 43113;
export const EVM_BSC_NETWORK_CHAIN_ID = 97;

export interface TokenInfo {
  name: string;
  address: string;
  chainId: ChainId;
  evmChainId: number | undefined;
  maxAmount: number;
  usdcPairedAddress: string | undefined;
}

export const ETH_TOKEN_INFO: TokenInfo = {
  name: "ETH",
  address: "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6",
  chainId: CHAIN_ID_ETH,
  evmChainId: EVM_ETH_NETWORK_CHAIN_ID,
  //logo: ethIcon,
  maxAmount: 0.0001,
  usdcPairedAddress: "0x07865c6E87B9F70255377e024ace6630C1Eaa37F",
};

export const AVAX_TOKEN_INFO: TokenInfo = {
  name: "AVAX",
  address: "0xd00ae08403B9bbb9124bB305C09058E32C39A48c",
  chainId: CHAIN_ID_AVAX,
  evmChainId: EVM_AVAX_NETWORK_CHAIN_ID,
  //logo: avaxIcon,
  maxAmount: 0.01,
  usdcPairedAddress: "0x5425890298aed601595a70AB815c96711a31Bc65",
};

export const TOKEN_INFOS = [ETH_TOKEN_INFO, AVAX_TOKEN_INFO];

export const getSupportedSwaps = (tokenInfo: TokenInfo) => {
  return TOKEN_INFOS.filter((x) => x !== tokenInfo);
};

export const getEvmChainId = (chainId: ChainId): number | undefined => {
  switch (chainId) {
    case CHAIN_ID_ETH:
      return EVM_ETH_NETWORK_CHAIN_ID;
    case CHAIN_ID_POLYGON:
      return EVM_POLYGON_NETWORK_CHAIN_ID;
    case CHAIN_ID_AVAX:
      return EVM_AVAX_NETWORK_CHAIN_ID;
    case CHAIN_ID_BSC:
      return EVM_BSC_NETWORK_CHAIN_ID;
    default:
      return undefined;
  }
};

export const getChainName = (chainId: ChainId) => {
  switch (chainId) {
    case CHAIN_ID_ETH:
      return "Ethereum";
    case CHAIN_ID_AVAX:
      return "Avalanche";
    default:
      return "";
  }
};

export const RELAYER_FEE_USDC = "0.00001";

export const WORMHOLE_RPC_HOSTS = [
  "https://wormhole-v2-testnet-api.certus.one",
];

// core bridge
export const CORE_BRIDGE_ADDRESS_ETHEREUM =
  "0x706abc4E45D419950511e474C7B9Ed348A4a716c";

export const CORE_BRIDGE_ADDRESS_AVALANCHE =
  "0x7bbcE28e64B3F8b84d876Ab298393c38ad7aac4C";

// token bridge
export const TOKEN_BRIDGE_ADDRESS_ETHEREUM =
  "0xF890982f9310df57d00f659cf4fd87e65adEd8d7";

export const TOKEN_BRIDGE_ADDRESS_AVALANCHE =
  "0x61E44E506Ca5659E6c0bba9b678586fA2d729756";

// gas
export const APPROVAL_GAS_LIMIT = "100000";
