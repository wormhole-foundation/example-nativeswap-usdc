// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.13;

import "./libraries/BytesLib.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

import "./interfaces/IWormhole.sol";
import "./interfaces/IWETH.sol";
import "./interfaces/IUSDCIntegration.sol";

import "./SwapHelper.sol";

/// @title A cross-chain UniswapV2 example
/// @notice Swaps against UniswapV2 pools and uses Wormhole's USDC Bridge integration
/// to mint and burn USDC cross-chain
contract CrossChainSwapV2 is SwapHelper {
    using SafeERC20 for IERC20;
    using BytesLib for bytes;

    // contracts
    IUniswapV2Router02 public immutable SWAP_ROUTER;
    IWormhole public immutable WORMHOLE;
    IUSDCIntegration public immutable USDC_INTEGRATION;

    // token addresses
    address public immutable USDC_ADDRESS;
    address public immutable WRAPPED_NATIVE_ADDRESS;

    constructor(
        address _swapRouterAddress,
        address _wormholeAddress,
        address _usdcIntegrationAddress,
        address _usdcAddress,
        address _wrappedNativeAddress
    ) {
        SWAP_ROUTER = IUniswapV2Router02(_swapRouterAddress);
        WORMHOLE = IWormhole(_wormholeAddress);
        USDC_INTEGRATION = IUSDCIntegration(_usdcIntegrationAddress);
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

        // cache wormhole fee and check msg.value
        uint256 wormholeFee = WORMHOLE.messageFee();
        require(msg.value > WORMHOLE.messageFee(), "insufficient value");

        // wrap native asset
        IWETH(WRAPPED_NATIVE_ADDRESS).deposit{
            value : msg.value - wormholeFee
        }();

        // peform the first swap
        uint256 amountOut = _swapExactInBeforeTransfer(
            msg.value - wormholeFee,
            swapParams.amountOutMinimum,
            path[0:2],
            swapParams.deadline
        );

        // create payload with target swap instructions
        bytes memory payload = abi.encodePacked(
            uint8(1),
            swapParams.targetAmountOutMinimum,
            swapParams.targetChainRecipient,
            path[2],
            path[3],
            swapParams.deadline,
            swapParams.poolFee,
            relayerFee
        );

        // approve USDC integration contract to spend USDC
        SafeERC20.safeApprove(
            IERC20(USDC_ADDRESS),
            address(USDC_INTEGRATION),
            amountOut
        );

        // Call the USDC integration contract to burn the USDC
        // and emit a wormhole message.
        USDC_INTEGRATION.transferTokensWithPayload(
            USDC_ADDRESS,
            amountOut,
            targetChainId,
            targetContractAddress,
            payload
        );
    }

    function _swapExactInBeforeTransfer(
        uint256 amountIn,
        uint256 amountOutMinimum,
        address[] calldata path,
        uint256 deadline
    ) internal returns (uint256 amountOut) {
        // approve the router to spend tokens
        SafeERC20.safeApprove(
            IERC20(path[0]),
            address(SWAP_ROUTER),
            amountIn
        );

        // perform the swap
        uint256[] memory amounts = SWAP_ROUTER.swapExactTokensForTokens(
            amountIn,
            amountOutMinimum,
            path,
            address(this),
            deadline
        );
        amountOut = amounts[1];
    }

    /// @dev Mints USDC and executes exactIn native asset swap and pays the relayer
    function recvAndSwapExactNativeIn(
        IUSDCIntegration.RedeemParameters memory usdcIntegrationParams
    ) external payable returns (uint256[] memory amounts) {
        // check USDC balance before minting
        uint256 balanceBefore = IERC20(USDC_ADDRESS).balanceOf(address(this));

        // mint USDC to this contract
        IUSDCIntegration.WormholeDepositWithPayload memory deposit = USDC_INTEGRATION.redeemTokensWithPayload(
            usdcIntegrationParams
        );

        // check USDC balance after minting
        uint256 balanceAfter = IERC20(USDC_ADDRESS).balanceOf(address(this));
        uint256 swapAmount = balanceAfter - balanceBefore;

        // parse swap params from USDC integration contract payload
        RecvSwapInParameters memory swapParams = decodeSwapInParameters(
            deposit.payload
        );

        // create dynamic address array, uniswap won't take fixed size array
        address[] memory uniPath = new address[](2);
        uniPath[0] = swapParams.path[0];
        uniPath[1] = swapParams.path[1];

        // sanity check path
        require(
            uniPath[0]==USDC_ADDRESS,
            "tokenIn must be USDC"
        );
        require(
            uniPath[1]==WRAPPED_NATIVE_ADDRESS,
            "tokenOut must be wrapped native asset"
        );

        // approve the router to spend tokens
        SafeERC20.safeApprove(
            IERC20(uniPath[0]),
            address(SWAP_ROUTER),
            swapAmount
        );

        // convert recipient bytes32 address to type address
        address recipientAddress = address(uint160(uint256(swapParams.recipientAddress)));

        // try to execute the swap
        try SWAP_ROUTER.swapExactTokensForTokens(
            swapAmount,
            swapParams.estimatedAmount,
            uniPath,
            address(this),
            swapParams.deadline
        ) returns (uint256[] memory amounts) {
            // calculate how much to pay the relayer in the native token
            uint256 nativeRelayerFee = amounts[1] * swapParams.relayerFee / swapAmount;
            uint256 nativeAmountOut = amounts[1] - nativeRelayerFee;

            // unwrap native and send to recipient
            IWETH(WRAPPED_NATIVE_ADDRESS).withdraw(amounts[1]);
            payable(recipientAddress).transfer(nativeAmountOut);

            /// pay the relayer in the native token
            payable(msg.sender).transfer(nativeRelayerFee);

            // used in UI to tell user they're getting
            // their desired token
            emit SwapResult(
                recipientAddress,
                uniPath[1],
                msg.sender,
                nativeAmountOut,
                1
            );
            return amounts;
        } catch {
            // pay relayer in the USDC since the swap failed
            IERC20 feeToken = IERC20(USDC_ADDRESS);
            feeToken.safeTransfer(msg.sender, swapParams.relayerFee);

            // swap failed - return USDC to recipient
            feeToken.safeTransfer(
                recipientAddress,
                swapAmount - swapParams.relayerFee
            );

            // used in UI to tell user theyere getting
            // USDC instead of their desired native asset
            emit SwapResult(
                recipientAddress,
                uniPath[0],
                msg.sender,
                swapAmount - swapParams.relayerFee,
                0
            );
        }
    }

    // necessary for receiving native assets
    receive() external payable {}
}