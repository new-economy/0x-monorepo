/*

  Copyright 2018 ZeroEx Intl.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.

*/

pragma solidity ^0.4.23;
pragma experimental ABIEncoderV2;

import "../../protocol/Exchange/interfaces/IExchange.sol";
import "../../protocol/Exchange/libs/LibOrder.sol";
import "../../utils/Ownable/Ownable.sol";

contract Whitelist is 
    Ownable
{
    // Revert reasons
    string constant ADDRESS_NOT_WHITELISTED = "Address not whitelisted.";

    // Mapping of address => whitelist status.
    mapping (address => bool) public isWhitelisted;

    // Exchange contract.
    IExchange EXCHANGE;

    // TxOrigin signature type is the 5th value in enum SignatureType and has a length of 1.
    bytes constant TX_ORIGIN_SIGNATURE = "\x04";

    constructor (address _exchange)
        public
    {
        EXCHANGE = IExchange(_exchange);
    }

    /// @dev Adds or removes an address from the whitelist.
    /// @param target Address to add or remove from whitelist.
    /// @param isApproved Whitelist status to assign to address.
    function updateWhitelistStatus(address target, bool isApproved)
        external
        onlyOwner
    {
        isWhitelisted[target] = isApproved;
    }

    /// @dev Fills an order using `msg.sender` as the taker.
    ///      The transaction will revert if both the maker and taker are not whitelisted.
    ///      Orders should specify this contract as the `senderAddress` in order to gaurantee
    ///      that both maker and taker have been whitelisted.
    /// @param order Order struct containing order specifications.
    /// @param takerAssetFillAmount Desired amount of takerAsset to sell.
    /// @param salt Arbitrary value to gaurantee uniqueness of 0x transaction hash.
    /// @param orderSignature Proof that order has been created by maker.
    function fillOrderIfWhitelisted(
        LibOrder.Order memory order,
        uint256 takerAssetFillAmount,
        uint256 salt,
        bytes memory orderSignature)
        public
    {
        address takerAddress = msg.sender;
    
        // This contract must be the entry point for the transaction.
        require(takerAddress == tx.origin);

        // Check if maker is on the whitelist
        require(
            isWhitelisted[order.makerAddress],
            ADDRESS_NOT_WHITELISTED
        );

        // Check if taker is on the whitelist.
        require(
            isWhitelisted[takerAddress],
            ADDRESS_NOT_WHITELISTED
        );

        // Encode arguments into byte array.
        bytes memory data = abi.encodeWithSelector(
            EXCHANGE.fillOrder.selector,
            order,
            takerAssetFillAmount,
            orderSignature
        );

        // Call `fillOrder` via `executeTransaction`.
        EXCHANGE.executeTransaction(
            salt,
            takerAddress,
            data,
            TX_ORIGIN_SIGNATURE
        );
    }
}