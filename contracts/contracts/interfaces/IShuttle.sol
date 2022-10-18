// contracts/Messages.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.13;

interface IShuttle {
    struct RedeemParameters {
        bytes encodedWormholeMessage;
        bytes circleBridgeMessage;
        bytes circleAttestation;
    }

    struct WormholeDeposit {
        uint8 payloadId; // == 1
        bytes32 token;
        uint256 amount;
        uint32 sourceDomain;
        uint32 targetDomain;
        uint64 nonce;
        bytes32 circleSender; // circle bridge on this chain
    }

    struct WormholeDepositWithPayload {
        WormholeDeposit depositHeader;
        bytes32 mintRecipient;
        bytes payload;
    }

    function transferTokensWithPayload(
        address token,
        uint256 amount,
        uint16 targetChain,
        bytes32 mintRecipient,
        bytes memory payload
    ) external payable returns (uint64 messageSequence);

    function redeemTokensWithPayload(
        RedeemParameters memory params
    ) external returns (WormholeDepositWithPayload memory wormholeDepositWithPayload);
}
