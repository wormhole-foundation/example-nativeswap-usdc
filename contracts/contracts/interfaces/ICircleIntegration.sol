// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.13;

import {IWormhole} from "../interfaces/IWormhole.sol";

interface ICircleIntegration {
    struct TransferParameters {
        address token;
        uint256 amount;
        uint16 targetChain;
        bytes32 mintRecipient;
    }

    struct RedeemParameters {
        bytes encodedWormholeMessage;
        bytes circleBridgeMessage;
        bytes circleAttestation;
    }

    struct DepositWithPayload {
        bytes32 token;
        uint256 amount;
        uint32 sourceDomain;
        uint32 targetDomain;
        uint64 nonce;
        bytes32 fromAddress;
        bytes32 mintRecipient;
        bytes payload;
    }

    function transferTokensWithPayload(
        TransferParameters memory transferParams,
        uint32 batchId,
        bytes memory payload
    ) external payable returns (uint64 messageSequence);

    function redeemTokensWithPayload(RedeemParameters memory params)
        external
        returns (DepositWithPayload memory depositWithPayload);

    function chainId() external view returns (uint16);

    function getDomainFromChainId(uint16 chainId_) external view returns (uint32);

    function getChainIdFromDomain(uint32 domain) external view returns (uint16);
}
