// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

interface IHotpotMarketplace {
    enum OfferTokenType {
        ERC721,
        ERC1155
    }

    struct OrderParameters {
        address payable offerer;
        address receiver;
        OfferItem offerItem;
        RoyaltyData royalty;
        PendingAmountData pendingAmountsData;
        uint256 salt;
        bytes orderSignature;
        bytes pendingAmountsSignature;
        OfferTokenType tokenType;
    }

    // Order without pending amounts
    struct PureOrder { 
        address payable offerer;
        OfferItem offerItem;
        RoyaltyData royalty;
        uint256 salt;
    }

    struct OfferItem {
        address offerToken;
        uint256 offerTokenId;
        uint256 offerAmount; // the amount of ether for the offerer
        uint256 endTime; // offer expiration timestamp
        uint256 amount; // amount of items (erc1155)
    }

    struct RoyaltyData {
        uint256 royaltyPercent;
        address payable royaltyRecipient;
    }

    struct PendingAmountData {
        uint256 offererPendingAmount;
        uint256 buyerPendingAmount;
        bytes32 orderHash;
    }

    struct BatchOrderParameters {
        address payable offerer;
        address receiver;
        uint16 offererIndex; // index in the array of offerers
        OfferItem offerItem;
        RoyaltyData royalty;
        PendingAmountData pendingAmountsData;
        uint256 salt;
        bytes orderSignature;
        bytes pendingAmountsSignature;
        OfferTokenType tokenType;
    }

    function fulfillOrder(OrderParameters memory parameters) external payable;

    function batchFulfillOrder(
        BatchOrderParameters[] memory parameters,
        address[] memory offerers
    ) external payable;
}