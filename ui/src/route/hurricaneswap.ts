import { ethers } from "ethers";

import { AVAX_TOKEN_INFO } from "../utils/consts";
import { UsdcLocation } from "./generic";
import { UniswapV2Router } from "./uniswap-v2";

export { PROTOCOL } from "./uniswap-v2";

const HURRICANESWAP_FACTORY_ADDRESS = "";

export class HurricaneswapRouter extends UniswapV2Router {
  constructor(provider: ethers.providers.Provider) {
    super(provider);
    super.setFactoryAddress(HURRICANESWAP_FACTORY_ADDRESS);
  }

  async initialize(usdcLocation: UsdcLocation): Promise<void> {
    await super.initializeTokens(AVAX_TOKEN_INFO, usdcLocation);
    return;
  }

  computePoolAddress(): string {
    // cannot find factory address on testnet
    return "0x808FF1000c3A70A8D55725C44FffD6b7BfeDD06A";
  }
}
