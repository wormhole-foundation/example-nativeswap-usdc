import { ethers } from "ethers";

import { UniswapV3Router as EthRouter } from "./uniswap-v3";
import { HurricaneswapRouter as AvaxRouter } from "./hurricaneswap";
import { ETH_TOKEN_INFO, AVAX_TOKEN_INFO } from "../utils/consts";
import { addFixedAmounts, subtractFixedAmounts } from "../utils/math";
import { UsdcLocation } from "./generic";
import {
  ExactInParameters,
  ExactOutParameters,
  makeExactInParameters,
  makeExactOutParameters,
} from "./uniswap-core";
import { ChainId, CHAIN_ID_ETH, CHAIN_ID_AVAX } from "@certusone/wormhole-sdk";

export { PROTOCOL as PROTOCOL_UNISWAP_V2 } from "./uniswap-v2";
export { PROTOCOL as PROTOCOL_UNISWAP_V3 } from "./uniswap-v3";

export enum QuoteType {
  ExactIn = 1,
  ExactOut,
}

export function makeEvmProviderFromAddress(tokenAddress: string) {
  switch (tokenAddress) {
    case ETH_TOKEN_INFO.address: {
      const url = process.env.REACT_APP_GOERLI_PROVIDER;
      if (!url) {
        throw new Error("Could not find REACT_APP_GOERLI_PROVIDER");
      }
      return new ethers.providers.StaticJsonRpcProvider(url);
    }
    case AVAX_TOKEN_INFO.address: {
      const url = process.env.REACT_APP_FUJI_PROVIDER;
      if (!url) {
        throw new Error("Could not find REACT_APP_FUJI_PROVIDER");
      }
      return new ethers.providers.StaticJsonRpcProvider(url);
    }
    default: {
      throw Error("unrecognized evm token address");
    }
  }
}

export function getChainIdFromAddress(tokenAddress: string) {
  switch (tokenAddress) {
    case ETH_TOKEN_INFO.address: {
      return CHAIN_ID_ETH;
    }
    case AVAX_TOKEN_INFO.address: {
      return CHAIN_ID_AVAX;
    }
    default: {
      throw Error("unrecognized evm token address");
    }
  }
}

async function makeRouter(tokenAddress: string, loc: UsdcLocation) {
  switch (tokenAddress) {
    case ETH_TOKEN_INFO.address: {
      const provider = makeEvmProviderFromAddress(tokenAddress);
      const router = new EthRouter(provider);
      await router.initialize(loc);
      return router;
    }
    case AVAX_TOKEN_INFO.address: {
      const provider = makeEvmProviderFromAddress(tokenAddress);
      const router = new AvaxRouter(provider);
      await router.initialize(loc);
      return router;
    }
    default: {
      throw Error("unrecognized chain id");
    }
  }
}

function splitSlippageInHalf(totalSlippage: string): string {
  const divisor = ethers.FixedNumber.from("2");
  return ethers.FixedNumber.from(totalSlippage)
    .divUnsafe(divisor)
    .round(4)
    .toString();
}

export interface RelayerFee {
  amount: string;
  tokenAddress: string;
}

export interface ExactInCrossParameters {
  amountIn: string;
  usdcAmountIn: string;
  minAmountOut: string;
  src: ExactInParameters | undefined;
  dst: ExactInParameters | undefined;
  relayerFee: RelayerFee;
}

export interface ExactOutCrossParameters {
  amountOut: string;
  usdcAmountIn: string;
  maxAmountIn: string;
  src: ExactOutParameters | undefined;
  dst: ExactOutParameters | undefined;
  relayerFee: RelayerFee;
}

export class UniswapToUniswapQuoter {
  // tokens
  tokenInAddress: string;
  tokenOutAddress: string;

  // routers
  srcRouter: EthRouter | AvaxRouter;
  dstRouter: EthRouter | AvaxRouter;

  async initialize(tokenInAddress: string, tokenOutAddress: string) {
    if (tokenInAddress !== this.tokenInAddress) {
      this.tokenInAddress = tokenInAddress;
      this.srcRouter = await makeRouter(tokenInAddress, UsdcLocation.Out);
    }

    if (tokenOutAddress !== this.tokenOutAddress) {
      this.tokenOutAddress = tokenOutAddress;
      this.dstRouter = await makeRouter(tokenOutAddress, UsdcLocation.In);
    }
  }

  async computeAndVerifySrcPoolAddress(): Promise<string> {
    return this.srcRouter.computeAndVerifyPoolAddress();
  }

  async computeAndVerifyDstPoolAddress(): Promise<string> {
    return this.dstRouter.computeAndVerifyPoolAddress();
  }

  computeSwapSlippage(slippage: string): string {
    return splitSlippageInHalf(slippage);
  }

  getRelayerFee(amount: string): RelayerFee {
    const relayerFee: RelayerFee = {
      amount: this.srcRouter.computeUnitAmountOut(amount),
      tokenAddress: this.srcRouter.getTokenOutAddress(),
    };
    return relayerFee;
  }

  makeSrcExactInParameters(
    amountIn: string,
    minAmountOut: string
  ): ExactInParameters | undefined {
    // @ts-ignore
    return makeExactInParameters(this.srcRouter, amountIn, minAmountOut);
  }

  makeDstExactInParameters(
    amountIn: string,
    minAmountOut: string
  ): ExactInParameters | undefined {
    // @ts-ignore
    return makeExactInParameters(this.dstRouter, amountIn, minAmountOut);
  }

  async computeExactInParameters(
    amountIn: string,
    slippage: string,
    relayerFeeUsdc: string
  ): Promise<ExactInCrossParameters> {
    const singleSlippage = this.computeSwapSlippage(slippage);

    // src quote
    const srcRouter = this.srcRouter;
    const srcMinAmountOut = await srcRouter.fetchExactInQuote(
      amountIn,
      singleSlippage
    );

    // dst quote
    const dstRouter = this.dstRouter;
    const dstAmountIn = srcMinAmountOut; //srcRouter.formatAmountOut(srcMinAmountOut);
    if (Number(dstAmountIn) < Number(relayerFeeUsdc)) {
      throw Error(
        `srcAmountOut <= relayerFeeUsdc. ${dstAmountIn} vs ${relayerFeeUsdc}`
      );
    }

    const dstAmountInAfterFee = subtractFixedAmounts(
      dstAmountIn,
      relayerFeeUsdc,
      dstRouter.getTokenInDecimals()
    );

    const dstMinAmountOut = await dstRouter.fetchExactInQuote(
      dstAmountInAfterFee,
      singleSlippage
    );

    // organize parameters
    const params: ExactInCrossParameters = {
      amountIn: amountIn,
      usdcAmountIn: dstAmountInAfterFee,
      minAmountOut: dstMinAmountOut,
      src: this.makeSrcExactInParameters(amountIn, srcMinAmountOut),
      dst: this.makeDstExactInParameters(dstAmountInAfterFee, dstMinAmountOut),
      relayerFee: this.getRelayerFee(relayerFeeUsdc),
    };
    return params;
  }

  makeSrcExactOutParameters(
    amountOut: string,
    maxAmountIn: string
  ): ExactOutParameters | undefined {
    // @ts-ignore
    return makeExactOutParameters(this.srcRouter, amountOut, maxAmountIn);
  }

  makeDstExactOutParameters(
    amountOut: string,
    maxAmountIn: string
  ): ExactOutParameters | undefined {
    // @ts-ignore
    return makeExactOutParameters(this.dstRouter, amountOut, maxAmountIn);
  }

  async computeExactOutParameters(
    amountOut: string,
    slippage: string,
    relayerFeeUsdc: string
  ): Promise<ExactOutCrossParameters> {
    const singleSlippage = splitSlippageInHalf(slippage);

    // dst quote first
    const dstRouter = this.dstRouter;
    const dstMaxAmountIn = await dstRouter.fetchExactOutQuote(
      amountOut,
      singleSlippage
    );

    // src quote
    const srcRouter = this.srcRouter;
    const srcAmountOut = dstMaxAmountIn;
    if (Number(srcAmountOut) < Number(relayerFeeUsdc)) {
      throw Error(
        `dstAmountIn <= relayerFeeUsdc. ${srcAmountOut} vs ${relayerFeeUsdc}`
      );
    }

    const srcAmountOutBeforeFee = addFixedAmounts(
      srcAmountOut,
      relayerFeeUsdc,
      srcRouter.getTokenOutDecimals()
    );

    const srcMaxAmountIn = await srcRouter.fetchExactOutQuote(
      srcAmountOutBeforeFee,
      singleSlippage
    );

    // organize parameters
    const params: ExactOutCrossParameters = {
      amountOut: amountOut,
      usdcAmountIn: dstMaxAmountIn,
      maxAmountIn: srcMaxAmountIn,
      src: this.makeSrcExactOutParameters(
        srcAmountOutBeforeFee,
        srcMaxAmountIn
      ),
      dst: this.makeDstExactOutParameters(amountOut, dstMaxAmountIn),
      relayerFee: this.getRelayerFee(relayerFeeUsdc),
    };
    return params;
  }

  setDeadlines(deadline: string): void {
    // @ts-ignore
    this.srcRouter.setDeadline(deadline);
    // @ts-ignore
    this.dstRouter.setDeadline(deadline);
  }

  getSrcEvmProvider(): ethers.providers.Provider | undefined {
    // @ts-ignore
    return this.srcRouter.getProvider();
  }

  getDstEvmProvider(): ethers.providers.Provider | undefined {
    // @ts-ignore
    return this.dstRouter.getProvider();
  }

  getSrcChainId(): ChainId {
    return getChainIdFromAddress(this.tokenInAddress);
  }

  getDstChainId(): ChainId {
    return getChainIdFromAddress(this.tokenOutAddress);
  }
}
