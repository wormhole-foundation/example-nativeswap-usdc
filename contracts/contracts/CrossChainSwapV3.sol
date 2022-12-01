// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.13;

import "./libraries/BytesLib.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

import "./interfaces/IWormhole.sol";
import "./interfaces/IWETH.sol";
import "./interfaces/IUniswap.sol";
import "./interfaces/ICircleIntegration.sol";

import "./SwapHelper.sol";

/// @title A cross-chain UniswapV3 example
/// @notice Swaps against UniswapV3 pools and uses Wormhole's USDC Bridge integration
/// to mint and burn USDC cross-chain
contract CrossChainSwapV3 is SwapHelper {
    using SafeERC20 for IERC20;
    using BytesLib for bytes;

    // contract deployer
    address deployer;

    // contracts
    IUniswapRouter public immutable SWAP_ROUTER;
    IWormhole public immutable WORMHOLE;
    ICircleIntegration public immutable CIRCLE_INTEGRATION;

    // token addresses
    address public immutable USDC_ADDRESS;
    address public immutable WRAPPED_NATIVE_ADDRESS;

    // registered nativeswap contracts
    mapping(uint16 => bytes32) registeredContracts;

    constructor(
        address _swapRouterAddress,
        address _wormholeAddress,
        address _usdcIntegrationAddress,
        address _usdcAddress,
        address _wrappedNativeAddress
    ) {
        deployer = msg.sender;
        SWAP_ROUTER = IUniswapRouter(_swapRouterAddress);
        WORMHOLE = IWormhole(_wormholeAddress);
        CIRCLE_INTEGRATION = ICircleIntegration(_usdcIntegrationAddress);
        USDC_ADDRESS = _usdcAddress;
        WRAPPED_NATIVE_ADDRESS = _wrappedNativeAddress;
    }

    /// @dev Used to communicate information about executed swaps to UI/user
    event SwapResult(
        address indexed _recipient,
        address _tokenOut,
        address _from,
        uint256 _amountOut,
        uint8 _success
    );

    /// @dev Calls _swapExactInBeforeTransfer and encodes custom payload with
    /// instructions for executing native asset swaps on the destination chain
    function swapExactNativeInAndTransfer(
        ExactInParameters calldata swapParams,
        address[] calldata path,
        uint256 relayerFee,
        uint16 targetChainId,
        bytes32 targetContractAddress
    ) external payable {
        require(
            swapParams.amountOutMinimum > relayerFee,
            "insufficient amountOutMinimum to pay relayer"
        );
        require(
            path[0]==WRAPPED_NATIVE_ADDRESS,
            "tokenIn must be wrapped native asset"
        );
        require(
            path[1]==USDC_ADDRESS,
            "tokenOut must be USDC"
        );
        require(path.length == 4, "invalid path");
        require(
            registeredContracts[targetChainId] == targetContractAddress,
            "target contract not registered"
        );

        // cache wormhole fee and check msg.value
        uint256 wormholeFee = WORMHOLE.messageFee();
        require(msg.value > WORMHOLE.messageFee(), "insufficient value");

        // peform the first swap
        uint256 amountOut = _swapExactInBeforeTransfer(
            msg.value - wormholeFee,
            swapParams.amountOutMinimum,
            path[0:2],
            swapParams.deadline,
            swapParams.poolFee
        );

        // create payload with target swap instructions
        bytes memory payload = abi.encodePacked(
            uint8(1), // swap version
            swapParams.targetAmountOutMinimum,
            swapParams.targetChainRecipient,
            path[2],
            path[3],
            swapParams.deadline,
            uint24(0),
            relayerFee
        );

        // approve USDC integration contract to spend USDC
        SafeERC20.safeApprove(
            IERC20(USDC_ADDRESS),
            address(CIRCLE_INTEGRATION),
            amountOut
        );

        // create transfer params used to invoke the circle integration contract
        ICircleIntegration.TransferParameters memory transferParams =
            ICircleIntegration.TransferParameters({
                token: USDC_ADDRESS,
                amount: amountOut,
                targetChain: targetChainId,
                mintRecipient: targetContractAddress
            });

        // Call the USDC integration contract to burn the USDC
        // and emit a wormhole message.
        CIRCLE_INTEGRATION.transferTokensWithPayload(
            transferParams,
            0, // batchId=0 to opt out of batching
            payload
        );
    }

    function _swapExactInBeforeTransfer(
        uint256 amountIn,
        uint256 amountOutMinimum,
        address[] calldata path,
        uint256 deadline,
        uint24 poolFee
    ) internal returns (uint256 amountOut) {
        // set swap options with user params
        ISwapRouter.ExactInputSingleParams memory params =
            ISwapRouter.ExactInputSingleParams({
                tokenIn: path[0],
                tokenOut: path[1],
                fee: poolFee,
                recipient: address(this),
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            });

        // perform the swap
        amountOut = SWAP_ROUTER.exactInputSingle{value: amountIn}(params);
    }

    /// @dev Mints USDC and executes exactIn native asset swap and pays the relayer
    function recvAndSwapExactNativeIn(
        ICircleIntegration.RedeemParameters memory redeemParams
    ) external returns (uint256 amountOut) {
        // check USDC balance before minting
        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(address(this));

        // mint USDC to this contract
        ICircleIntegration.DepositWithPayload memory deposit = CIRCLE_INTEGRATION.redeemTokensWithPayload(
            redeemParams
        );

        // check USDC balance after minting
        uint256 balanceAfter = IERC20(USDC_ADDRESS).balanceOf(address(this));
        uint256 swapAmount = balanceAfter - balanceBefore;

        // parse swap params from USDC integration contract payload
        RecvSwapInParameters memory swapParams = decodeSwapInParameters(
            deposit.payload
        );

        // verify that the sender is a registered contract
        require(
            deposit.fromAddress == registeredContracts[
                CIRCLE_INTEGRATION.getChainIdFromDomain(deposit.sourceDomain)
            ],
            "fromAddress is not a registered contract"
        );

        // sanity check path
        require(
            swapParams.path[0]==USDC_ADDRESS &&
            address(uint160(uint256(deposit.token)))==USDC_ADDRESS,
            "tokenIn must be USDC"
        );
        require(
            swapParams.path[1]==WRAPPED_NATIVE_ADDRESS,
            "tokenOut must be wrapped Native asset"
        );

        // approve the router to spend tokens
        SafeERC20.safeApprove(
            IERC20(swapParams.path[0]),
            address(SWAP_ROUTER),
            swapAmount
        );

        // set swap options with user params
        ISwapRouter.ExactInputSingleParams memory params =
            ISwapRouter.ExactInputSingleParams({
                tokenIn: swapParams.path[0],
                tokenOut: swapParams.path[1],
                fee: swapParams.poolFee,
                recipient: address(this),
                deadline: swapParams.deadline,
                amountIn: swapAmount,
                amountOutMinimum: swapParams.estimatedAmount,
                sqrtPriceLimitX96: 0
            });

        // convert recipient bytes32 address to type address
        address recipientAddress = address(uint160(uint256(swapParams.recipientAddress)));

        // try to execute the swap
        try SWAP_ROUTER.exactInputSingle(params) returns (uint256 amountOut) {
            // calculate how much to pay the relayer in the native token
            uint256 nativeRelayerFee = amountOut * swapParams.relayerFee / swapAmount;
            uint256 nativeAmountOut = amountOut - nativeRelayerFee;

            // unwrap native and send to recipient
            IWETH(WRAPPED_NATIVE_ADDRESS).withdraw(amountOut);
            payable(recipientAddress).transfer(nativeAmountOut);

            /// pay the relayer in the native token
            payable(msg.sender).transfer(nativeRelayerFee);

            // used in UI to tell user they're getting
            // their desired token
            emit SwapResult(
                recipientAddress,
                swapParams.path[1],
                msg.sender,
                nativeAmountOut,
                1
            );
            return amountOut;
        } catch {
            // pay relayer in the USDC since the swap failed
            IERC20 feeToken = IERC20(USDC_ADDRESS);
            feeToken.safeTransfer(msg.sender, swapParams.relayerFee);

            // swap failed - return USDC (less relayer fees) to recipient
            feeToken.safeTransfer(
                recipientAddress,
                swapAmount - swapParams.relayerFee
            );

            // set the Uniswap allowance to zero
             SafeERC20.safeApprove(
                IERC20(swapParams.path[0]),
                address(SWAP_ROUTER),
                0
            );

            // used in UI to tell user they're getting
            // USDC instead of their desired native asset
            emit SwapResult(
                recipientAddress,
                swapParams.path[0],
                msg.sender,
                swapAmount - swapParams.relayerFee,
                0
            );
        }
    }

    /// @dev `registerContract` serves to save trusted circle relayer contract addresses
    function registerContract(
        uint16 chainId,
        bytes32 contractAddress
    ) public onlyDeployer {
        // sanity check both input arguments
        require(
            contractAddress != bytes32(0),
            "emitterAddress cannot equal bytes32(0)"
        );
        require(chainId != 0, "chainId must be > 0");

        // update the registeredContracts state variable
        registeredContracts[chainId] = contractAddress;
    }

    modifier onlyDeployer() {
        require(deployer == msg.sender, "caller not the deployer");
        _;
    }

    // necessary for receiving native assets
    receive() external payable {}
}
