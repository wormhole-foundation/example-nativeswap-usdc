## NativeSwap

https://certusone.github.io/nativeswap-usdc-example/

This is a non-production example program.

Multi-chain native-to-native token swap using existing DEXes.

### Details

Using liquidity of native vs USDC (i.e. the USDC highway), one can swap from native A on chain A to native B on chain B. For this specific example, we demonstrate a swap between ETH (Goerli testnet) and AVAX (Fuji testnet). We wrote example smart contracts to interact with Uniswap V3 and Uniswap V2 forks. Any DEX can be used to replace our example as long as the swap for a particular DEX has all of its parameters to perform the swap(s).

A protocol that hosts NativeSwap is expected to run its own relayer to enhance its user experience by only requiring a one-click transaction to perform the complete swap. Otherwise the user will have to perform an extra transaction to manually allow the final swap.

Here is what happens under the hood of this example:

- User generates quote from front-end for native-to-native swap.
- User calls the smart contract with its quote on chain A.
- Smart contract on chain A executes swap from native A to USDC. If the swap succeeds, the smart contract will burn the USDC on the source chain, and generate a wormhole message with target-chain swap information.
- Guardian's sign the wormhole message.
- Circle generates an attestation for a depositToBurn message.
- The relayer reads the signed VAA and calls the smart contract with the VAA, the Circle attestation, and Circle depositToBurn message.
- Smart contract on chain B completes the USDC mint and decodes the swap parameters from the Wormhole message payload.
- Smart contract on chain B executes swap from USDC to native B. If the swap succeeds, the smart contract will send native B to user. Otherwise, it will send USDC to user.

The Wormhole message payload for swap parameters are all encoded and decoded on-chain.

We also wrote a front-end UI using a custom class (UniswapToUniswapExecutor) to perform the quotes for "Exact In" (swapping from an exact amount of native A to an estimated amount of native B) swaps and execute these swaps based on this quote. This library uses the ABIs of our example smart contracts to execute the swap transactions.

### What's next?

That is up to you! You are not limited to native-to-native multi-chain swaps. Build in your own smart routing with whichever DEX to perform any swap from chain A to chain B. Wormhole messaging and token transfers with payload are generic enough to adapt this example for any of the chains Wormhole currently supports.

### Deploying Contracts

First compile the example contracts:

```
cd contracts
npm ci
./compile_contracts.sh
```

Then copy sample.env to .env, edit .env and replace YOUR-PROJECT-ID with your Infura Goerli and also add your Ethereum wallet's private key.
These are needed to deploy the example contracts.

```
cp .env.sample .env
# make sure to edit .env file
```

Then deploy the example contracts:

```
./deploy_v2.sh
./deploy_v3.sh
```

### Running the off-chain relayer

First, make sure that the contracts are compiled and deployed. Then run the following commands to set up the off-chain relayer environment variables:

```
cp avax-to-eth.sample.env avax-to-eth.env

# add your Goerli REST RPC to the `DST_RPC=` variable
# update the SRC_CONTRACT_ADDRESS and DST_CONTRACT ADDRESS with your deployed contract addresses

# source the avax-to-eth.env file
. avax-to-eth.env
```

Install dependencies and build the relayer:

```
yarn
yarn build
```

Run the off-chain relayer process:

```
PRIVATE_KEY=put_your_private_key_here yarn start
```
