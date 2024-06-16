import { Blockchain, SandboxContract, TreasuryContract, internal, BlockchainSnapshot } from '@ton/sandbox';
import { Cell, toNano, beginCell, Address } from '@ton/core';
import { Wallet } from '../wrappers/Wallet';
import { Minter, jettonContentToCell } from '../wrappers/Minter';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { randomAddress, getRandomTon, differentAddress, getRandomInt, testJettonTransfer, testJettonInternalTransfer, testJettonNotification, testJettonBurnNotification } from './utils';

import { Op, Errors } from '../wrappers/Constants';

let fwd_fee = 1804014n, gas_consumption = 15000000n, min_tons_for_storage = 10000000n;
//let fwd_fee = 1804014n, gas_consumption = 14000000n, min_tons_for_storage = 10000000n;

describe('Wallet', () => {
    let jwallet_code = new Cell();
    let minter_code = new Cell();
    let blockchain: Blockchain;
    let deployer:SandboxContract<TreasuryContract>;
    let notDeployer:SandboxContract<TreasuryContract>;
    let minter:SandboxContract<Minter>;
    let userWallet:any;
    let defaultContent:Cell;

    beforeAll(async () => {
        jwallet_code   = await compile('Wallet');
        minter_code    = await compile('Minter');
        blockchain     = await Blockchain.create();
        deployer       = await blockchain.treasury('deployer');
        notDeployer    = await blockchain.treasury('notDeployer');
        defaultContent = jettonContentToCell({type: 1, uri: "https://testjetton.org/content.json"});
        minter   = blockchain.openContract(
                   Minter.createFromConfig(
                     {
                       admin: deployer.address,
                       content: defaultContent,
                       wallet_code: jwallet_code,
                     },
                     minter_code));
        userWallet = async (address:Address) => blockchain.openContract(
                          Wallet.createFromAddress(
                            await minter.getWalletAddress(address)
                          )
                     );
    });

    // implementation detail
    it('should deploy', async () => {
        const deployResult = await minter.sendDeploy(deployer.getSender(), toNano('100'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: minter.address,
            deploy: true,
        });
    });
    // implementation detail
    it('minter admin should be able to mint jettons', async () => {
        // can mint from deployer
        let initialTotalSupply = await minter.getTotalSupply();
        const deployerWallet = await userWallet(deployer.address);
        let initialJettonBalance = toNano('1000.23');
        const mintResult = await minter.sendMint(deployer.getSender(), deployer.address, initialJettonBalance, toNano('0.05'), toNano('1'));

        expect(mintResult.transactions).toHaveTransaction({
            from: minter.address,
            to: deployerWallet.address,
            deploy: true,
        });
		
        expect(mintResult.transactions).toHaveTransaction({ // excesses
            from: deployerWallet.address,
            to: minter.address
        });
		

        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await minter.getTotalSupply()).toEqual(initialTotalSupply + initialJettonBalance);
        initialTotalSupply += initialJettonBalance;
        // can mint from deployer again
        let additionalJettonBalance = toNano('2.31');
        await minter.sendMint(deployer.getSender(), deployer.address, additionalJettonBalance, toNano('0.05'), toNano('1'));
        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance + additionalJettonBalance);
        expect(await minter.getTotalSupply()).toEqual(initialTotalSupply + additionalJettonBalance);
        initialTotalSupply += additionalJettonBalance;
        // can mint to other address
        let otherJettonBalance = toNano('3.12');
        await minter.sendMint(deployer.getSender(), notDeployer.address, otherJettonBalance, toNano('0.05'), toNano('1'));
        const notDeployerWallet = await userWallet(notDeployer.address);
        expect(await notDeployerWallet.getJettonBalance()).toEqual(otherJettonBalance);
        expect(await minter.getTotalSupply()).toEqual(initialTotalSupply + otherJettonBalance);
    });

    // implementation detail
    it('not a minter admin should not be able to mint jettons', async () => {
        let initialTotalSupply = await minter.getTotalSupply();
        const deployerWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
        const unAuthMintResult = await minter.sendMint(notDeployer.getSender(), deployer.address, toNano('777'), toNano('0.05'), toNano('1'));

        expect(unAuthMintResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: minter.address,
            aborted: true,
            exitCode: Errors.not_admin, // error::unauthorized_mint_request
        });
        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await minter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    // Implementation detail
    it('minter admin can change admin', async () => {
        const adminBefore = await minter.getAdminAddress();
        expect(adminBefore).toEqualAddress(deployer.address);
        let res = await minter.sendChangeAdmin(deployer.getSender(), notDeployer.address);
        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            on: minter.address,
            success: true
        });

	const adminAfter = await minter.getAdminAddress();
        expect(adminAfter).toEqualAddress(notDeployer.address);
        await minter.sendChangeAdmin(notDeployer.getSender(), deployer.address);
        expect((await minter.getAdminAddress()).equals(deployer.address)).toBe(true);
    });
    it('not a minter admin can not change admin', async () => {
        const adminBefore = await minter.getAdminAddress();
        expect(adminBefore).toEqualAddress(deployer.address);
        let changeAdmin = await minter.sendChangeAdmin(notDeployer.getSender(), notDeployer.address);
        expect((await minter.getAdminAddress()).equals(deployer.address)).toBe(true);
        expect(changeAdmin.transactions).toHaveTransaction({
            from: notDeployer.address,
            on: minter.address,
            aborted: true,
            exitCode: Errors.not_admin, // error::unauthorized_change_admin_request
        });
    });

    it('minter admin can change content', async () => {
        let newContent = jettonContentToCell({type: 1, uri: "https://totally_new_jetton.org/content.json"})
        expect((await minter.getContent()).equals(defaultContent)).toBe(true);
        let changeContent = await minter.sendChangeContent(deployer.getSender(), newContent);
        expect((await minter.getContent()).equals(newContent)).toBe(true);
        changeContent = await minter.sendChangeContent(deployer.getSender(), defaultContent);
        expect((await minter.getContent()).equals(defaultContent)).toBe(true);
    });
    it('not a minter admin can not change content', async () => {
        let newContent = beginCell().storeUint(1,1).endCell();
        let changeContent = await minter.sendChangeContent(notDeployer.getSender(), newContent);
        expect((await minter.getContent()).equals(defaultContent)).toBe(true);
        expect(changeContent.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: minter.address,
            aborted: true,
            exitCode: Errors.not_admin, // error::unauthorized_change_content_request
        });
    });

    it('wallet owner should be able to send jettons', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
        let initialTotalSupply = await minter.getTotalSupply();
        const notDeployerWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, null);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerWallet.address,
            to: deployer.address,
        });
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerWallet.address,
            to: notDeployer.address,
            value: forwardAmount
        });
        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
        expect(await minter.getTotalSupply()).toEqual(initialTotalSupply);
    });


    it('not wallet owner should not be able to send jettons', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
        let initialTotalSupply = await minter.getTotalSupply();
        const notDeployerWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        const sendResult = await deployerWallet.sendTransfer(notDeployer.getSender(), toNano('0.1'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, toNano('0.05'), null);
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerWallet.address,
            aborted: true,
            exitCode: Errors.not_owner, //error::unauthorized_transfer
        });
        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await notDeployerWallet.getJettonBalance()).toEqual(initialJettonBalance2);
        expect(await minter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('impossible to send too much jettons', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
        const notDeployerWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerWallet.getJettonBalance();
        let sentAmount = initialJettonBalance + 1n;
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, null);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerWallet.address,
            aborted: true,
            exitCode: Errors.balance_error, //error::not_enough_jettons
        });
        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance);
        expect(await notDeployerWallet.getJettonBalance()).toEqual(initialJettonBalance2);
    });

    it.skip('malformed forward payload', async() => {

        const deployerWallet    = await userWallet(deployer.address);
        const notDeployerWallet = await userWallet(notDeployer.address);

        let sentAmount     = toNano('0.5');
        let forwardAmount  = getRandomTon(0.01, 0.05); // toNano('0.05');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        let msgPayload     = beginCell().storeUint(0xf8a7ea5, 32).storeUint(0, 64) // op, queryId
                                        .storeCoins(sentAmount).storeAddress(notDeployer.address)
                                        .storeAddress(deployer.address)
                                        .storeMaybeRef(null)
                                        .storeCoins(toNano('0.05')) // No forward payload indication
                            .endCell();
        const res = await blockchain.sendMessage(internal({
                                                    from: deployer.address,
                                                    to: deployerWallet.address,
                                                    body: msgPayload,
                                                    value: toNano('0.2')
                                                    }));


        expect(res.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerWallet.address,
            aborted: true,
            exitCode: 708
        });
    });

    it('correctly sends forward_payload', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
        const notDeployerWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerWallet.address,
            to: deployer.address,
        });
        /*
        transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
                                      sender:MsgAddress forward_payload:(Either Cell ^Cell)
                                      = InternalMsgBody;
        */
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerWallet.address,
            to: notDeployer.address,
            value: forwardAmount,
            body: beginCell().storeUint(Op.transfer_notification, 32).storeUint(0, 64) //default queryId
                              .storeCoins(sentAmount)
                              .storeAddress(deployer.address)
                              .storeUint(1, 1)
                              .storeRef(forwardPayload)
                  .endCell()
        });
        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
    });

    it('no forward_ton_amount - no forward', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
        const notDeployerWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerWallet.getJettonBalance();
        let sentAmount = toNano('0.5');
        let forwardAmount = 0n;
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerWallet.address,
            to: deployer.address,
        });

        expect(sendResult.transactions).not.toHaveTransaction({ //no notification
            from: notDeployerWallet.address,
            to: notDeployer.address
        });
        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await notDeployerWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);
    });

    it('check revert on not enough tons for forward', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
        await deployer.send({value:toNano('1'), bounce:false, to: deployerWallet.address});
        let sentAmount = toNano('0.1');
        let forwardAmount = toNano('0.3');
        let forwardPayload = beginCell().storeUint(0x1234567890abcdefn, 128).endCell();
        const sendResult = await deployerWallet.sendTransfer(deployer.getSender(), forwardAmount, // not enough tons, no tons for gas
               sentAmount, notDeployer.address,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            on: deployerWallet.address,
            aborted: true,
            exitCode: Errors.not_enough_ton, //error::not_enough_tons
        });
        // Make sure value bounced
        expect(sendResult.transactions).toHaveTransaction({
            from: deployerWallet.address,
            on: deployer.address,
            inMessageBounced: true,
            success: true
        });

        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance);
    });

    // implementation detail
    it('works with minimal ton amount', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
        const someAddress = Address.parse("EQD__________________________________________0vo");
        const someWallet = await userWallet(someAddress);
        let initialJettonBalance2 = await someWallet.getJettonBalance();
        await deployer.send({value:toNano('1'), bounce:false, to: deployerWallet.address});
        let forwardAmount = toNano('0.3');
        /*
                     forward_ton_amount +
                     fwd_count * fwd_fee +
                     (2 * gas_consumption + min_tons_for_storage));
        */
        let minimalFee = 2n* fwd_fee + 2n*gas_consumption + min_tons_for_storage;
        let sentAmount = forwardAmount + minimalFee; // not enough, need >
        let forwardPayload = null;
        let tonBalance =(await blockchain.getContract(deployerWallet.address)).balance;
        let tonBalance2 = (await blockchain.getContract(someWallet.address)).balance;
        let sendResult = await deployerWallet.sendTransfer(deployer.getSender(), sentAmount,
               sentAmount, someAddress,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerWallet.address,
            aborted: true,
            exitCode: Errors.not_enough_ton, //error::not_enough_tons
        });
        sentAmount += 1n; // now enough
        sendResult = await deployerWallet.sendTransfer(deployer.getSender(), sentAmount,
               sentAmount, someAddress,
               deployer.address, null, forwardAmount, forwardPayload);
        expect(sendResult.transactions).not.toHaveTransaction({ //no excesses
            from: someWallet.address,
            to: deployer.address,
        });
        /*
        transfer_notification#7362d09c query_id:uint64 amount:(VarUInteger 16)
                                      sender:MsgAddress forward_payload:(Either Cell ^Cell)
                                      = InternalMsgBody;
        */
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: someWallet.address,
            to: someAddress,
            value: forwardAmount,
            body: beginCell().storeUint(Op.transfer_notification, 32).storeUint(0, 64) //default queryId
                              .storeCoins(sentAmount)
                              .storeAddress(deployer.address)
                              .storeUint(0, 1)
                  .endCell()
        });
        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount);
        expect(await someWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount);

        tonBalance =(await blockchain.getContract(deployerWallet.address)).balance;
        expect((await blockchain.getContract(someWallet.address)).balance).toBeGreaterThan(min_tons_for_storage);
    });

    // implementation detail
    it('wallet does not accept internal_transfer not from wallet', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
/*
  internal_transfer  query_id:uint64 amount:(VarUInteger 16) from:MsgAddress
                     response_address:MsgAddress
                     forward_ton_amount:(VarUInteger 16)
                     forward_payload:(Either Cell ^Cell)
                     = InternalMsgBody;
*/
        let internalTransfer = beginCell().storeUint(0x178d4519, 32).storeUint(0, 64) //default queryId
                              .storeCoins(toNano('0.01'))
                              .storeAddress(deployer.address)
                              .storeAddress(deployer.address)
                              .storeCoins(toNano('0.05'))
                              .storeUint(0, 1)
                  .endCell();
        const sendResult = await blockchain.sendMessage(internal({
                    from: notDeployer.address,
                    to: deployerWallet.address,
                    body: internalTransfer,
                    value:toNano('0.3')
                }));
        expect(sendResult.transactions).toHaveTransaction({
            from: notDeployer.address,
            to: deployerWallet.address,
            aborted: true,
            exitCode: Errors.not_valid_wallet, //error::unauthorized_incoming_transfer
        });
        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance);
    });

    it('wallet owner should be able to burn jettons', async () => {
           const deployerWallet = await userWallet(deployer.address);
            let initialJettonBalance = await deployerWallet.getJettonBalance();
            let initialTotalSupply = await minter.getTotalSupply();
            let burnAmount = toNano('0.01');
            const sendResult = await deployerWallet.sendBurn(deployer.getSender(), toNano('0.1'), // ton amount
                                 burnAmount, deployer.address, null); // amount, response address, custom payload
            expect(sendResult.transactions).toHaveTransaction({ //burn notification
                from: deployerWallet.address,
                to: minter.address
            });
            expect(sendResult.transactions).toHaveTransaction({ //excesses
                from: minter.address,
                to: deployer.address
            });
            expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance - burnAmount);
            expect(await minter.getTotalSupply()).toEqual(initialTotalSupply - burnAmount);

    });

    it('not wallet owner should not be able to burn jettons', async () => {
              const deployerWallet = await userWallet(deployer.address);
              let initialJettonBalance = await deployerWallet.getJettonBalance();
              let initialTotalSupply = await minter.getTotalSupply();
              let burnAmount = toNano('0.01');
              const sendResult = await deployerWallet.sendBurn(notDeployer.getSender(), toNano('0.1'), // ton amount
                                    burnAmount, deployer.address, null); // amount, response address, custom payload
              expect(sendResult.transactions).toHaveTransaction({
                 from: notDeployer.address,
                 to: deployerWallet.address,
                 aborted: true,
                 exitCode: Errors.not_owner, //error::unauthorized_transfer
                });
              expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance);
              expect(await minter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('wallet owner can not burn more jettons than it has', async () => {
                const deployerWallet = await userWallet(deployer.address);
                let initialJettonBalance = await deployerWallet.getJettonBalance();
                let initialTotalSupply = await minter.getTotalSupply();
                let burnAmount = initialJettonBalance + 1n;
                const sendResult = await deployerWallet.sendBurn(deployer.getSender(), toNano('0.1'), // ton amount
                                        burnAmount, deployer.address, null); // amount, response address, custom payload
                expect(sendResult.transactions).toHaveTransaction({
                     from: deployer.address,
                     to: deployerWallet.address,
                     aborted: true,
                     exitCode: Errors.balance_error, //error::not_enough_jettons
                    });
                expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance);
                expect(await minter.getTotalSupply()).toEqual(initialTotalSupply);
    });

    it('minimal burn message fee', async () => {
       const deployerWallet = await userWallet(deployer.address);
       let initialJettonBalance   = await deployerWallet.getJettonBalance();
       let initialTotalSupply     = await minter.getTotalSupply();
       let burnAmount   = toNano('0.01');
       let fwd_fee      = 1492012n /*1500012n*/, gas_consumption = 15000000n;
       let minimalFee   = fwd_fee + 2n*gas_consumption;

       const sendLow    = await deployerWallet.sendBurn(deployer.getSender(), minimalFee, // ton amount
                            burnAmount, deployer.address, null); // amount, response address, custom payload

       expect(sendLow.transactions).toHaveTransaction({
                from: deployer.address,
                to: deployerWallet.address,
                aborted: true,
                exitCode: Errors.not_enough_gas, //error::burn_fee_not_matched
             });

        const sendExcess = await deployerWallet.sendBurn(deployer.getSender(), minimalFee + 1n,
                                                                      burnAmount, deployer.address, null);

        expect(sendExcess.transactions).toHaveTransaction({
            from: deployer.address,
            to: deployerWallet.address,
            success: true
        });

        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance - burnAmount);
        expect(await minter.getTotalSupply()).toEqual(initialTotalSupply - burnAmount);

    });

    it('minter should only accept burn messages from jetton wallets', async () => {
        const deployerWallet = await userWallet(deployer.address);
        const burnAmount = toNano('1');
        const burnNotification = (amount: bigint, addr: Address) => {
        return beginCell()
                .storeUint(Op.burn_notification, 32)
                .storeUint(0, 64)
                .storeCoins(amount)
                .storeAddress(addr)
                .storeAddress(deployer.address)
               .endCell();
        }

        let res = await blockchain.sendMessage(internal({
            from: deployerWallet.address,
            to: minter.address,
            body: burnNotification(burnAmount, randomAddress(0)),
            value: toNano('0.1')
        }));

        expect(res.transactions).toHaveTransaction({
            from: deployerWallet.address,
            to: minter.address,
            aborted: true,
            exitCode: Errors.unouthorized_burn // Unauthorized burn
        });

        res = await blockchain.sendMessage(internal({
            from: deployerWallet.address,
            to: minter.address,
            body: burnNotification(burnAmount, deployer.address),
            value: toNano('0.1')
        }));

        expect(res.transactions).toHaveTransaction({
            from: deployerWallet.address,
            to: minter.address,
            success: true
        });
   });

    // TEP-89
    it('report correct discovery address', async () => {
        let discoveryResult = await minter.sendDiscovery(deployer.getSender(), deployer.address, true);
        /*
          take_wallet_address#d1735400 query_id:uint64 wallet_address:MsgAddress owner_address:(Maybe ^MsgAddress) = InternalMsgBody;
        */
        const deployerWallet = await userWallet(deployer.address);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: minter.address,
            to: deployer.address,
            body: beginCell().storeUint(Op.take_wallet_address, 32).storeUint(0, 64)
                              .storeAddress(deployerWallet.address)
                              .storeUint(1, 1)
                              .storeRef(beginCell().storeAddress(deployer.address).endCell())
                  .endCell()
        });

        discoveryResult = await minter.sendDiscovery(deployer.getSender(), notDeployer.address, true);
        const notDeployerWallet = await userWallet(notDeployer.address);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: minter.address,
            to: deployer.address,
            body: beginCell().storeUint(Op.take_wallet_address, 32).storeUint(0, 64)
                              .storeAddress(notDeployerWallet.address)
                              .storeUint(1, 1)
                              .storeRef(beginCell().storeAddress(notDeployer.address).endCell())
                  .endCell()
        });

        // do not include owner address
        discoveryResult = await minter.sendDiscovery(deployer.getSender(), notDeployer.address, false);
        expect(discoveryResult.transactions).toHaveTransaction({
            from: minter.address,
            to: deployer.address,
            body: beginCell().storeUint(Op.take_wallet_address, 32).storeUint(0, 64)
                              .storeAddress(notDeployerWallet.address)
                              .storeUint(0, 1)
                  .endCell()
        });

    });

    it('Minimal discovery fee', async () => {
       // 5000 gas-units + msg_forward_prices.lump_price + msg_forward_prices.cell_price = 0.0061
        const fwdFee     = 1464012n;
        const minimalFee = fwdFee + 10000000n; // toNano('0.0061');

        let discoveryResult = await minter.sendDiscovery(deployer.getSender(),
                                                                      notDeployer.address,
                                                                      false,
                                                                      minimalFee);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: minter.address,
            aborted: true,
            exitCode: Errors.discovery_fee_not_matched // discovery_fee_not_matched
        });

        /*
         * Might be helpfull to have logical OR in expect lookup
         * Because here is what is stated in standard:
         * and either throw an exception if amount of incoming value is not enough to calculate wallet address
         * or response with message (sent with mode 64)
         * https://github.com/ton-blockchain/TEPs/blob/master/text/0089-jetton-wallet-discovery.md
         * At least something like
         * expect(discoveryResult.hasTransaction({such and such}) ||
         * discoveryResult.hasTransaction({yada yada})).toBeTruethy()
         */
        discoveryResult = await minter.sendDiscovery(deployer.getSender(),
                                                           notDeployer.address,
                                                           false,
                                                           minimalFee + 1n);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: minter.address,
            success: true
        });

    });

    it('Correctly handles not valid address in discovery', async () =>{
        const badAddr       = randomAddress(-1);
        let discoveryResult = await minter.sendDiscovery(deployer.getSender(),
                                                               badAddr,
                                                               false);

        expect(discoveryResult.transactions).toHaveTransaction({
            from: minter.address,
            to: deployer.address,
            body: beginCell().storeUint(Op.take_wallet_address, 32).storeUint(0, 64)
                             .storeUint(0, 2) // addr_none
                             .storeUint(0, 1)
                  .endCell()

        });

        // Include address should still be available

        discoveryResult = await minter.sendDiscovery(deployer.getSender(),
                                                           badAddr,
                                                           true); // Include addr

        expect(discoveryResult.transactions).toHaveTransaction({
            from: minter.address,
            to: deployer.address,
            body: beginCell().storeUint(Op.take_wallet_address, 32).storeUint(0, 64)
                             .storeUint(0, 2) // addr_none
                             .storeUint(1, 1)
                             .storeRef(beginCell().storeAddress(badAddr).endCell())
                  .endCell()

        });
    });

    // This test consume a lot of time: 18 sec
    // and is needed only for measuring ton accruing
    /*it('wallet can process 250 transfer', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
        const notDeployerWallet = await userWallet(notDeployer.address);
        let initialJettonBalance2 = await notDeployerWallet.getJettonBalance();
        let sentAmount = 1n, count = 250n;
        let forwardAmount = toNano('0.05');
        let sendResult: any;
        let payload = beginCell()
                          .storeUint(0x12345678, 32).storeUint(0x87654321, 32)
                          .storeRef(beginCell().storeUint(0x12345678, 32).storeUint(0x87654321, 108).endCell())
                          .storeRef(beginCell().storeUint(0x12345671, 32).storeUint(0x87654321, 240).endCell())
                          .storeRef(beginCell().storeUint(0x12345672, 32).storeUint(0x87654321, 77)
                                               .storeRef(beginCell().endCell())
                                               .storeRef(beginCell().storeUint(0x1245671, 91).storeUint(0x87654321, 32).endCell())
                                               .storeRef(beginCell().storeUint(0x2245671, 180).storeUint(0x87654321, 32).endCell())
                                               .storeRef(beginCell().storeUint(0x8245671, 255).storeUint(0x87654321, 32).endCell())
                                    .endCell())
                      .endCell();
        let initialBalance =(await blockchain.getContract(deployerWallet.address)).balance;
        let initialBalance2 = (await blockchain.getContract(notDeployerWallet.address)).balance;
        for(let i = 0; i < count; i++) {
            sendResult = await deployerWallet.sendTransferMessage(deployer.getSender(), toNano('0.1'), //tons
                   sentAmount, notDeployer.address,
                   deployer.address, null, forwardAmount, payload);
        }
        // last chain was successful
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: notDeployerWallet.address,
            to: deployer.address,
        });
        expect(sendResult.transactions).toHaveTransaction({ //notification
            from: notDeployerWallet.address,
            to: notDeployer.address,
            value: forwardAmount
        });

        expect(await deployerWallet.getJettonBalance()).toEqual(initialJettonBalance - sentAmount*count);
        expect(await notDeployerWallet.getJettonBalance()).toEqual(initialJettonBalance2 + sentAmount*count);

        let finalBalance =(await blockchain.getContract(deployerWallet.address)).balance;
        let finalBalance2 = (await blockchain.getContract(notDeployerWallet.address)).balance;

        // if it is not true, it's ok but gas_consumption constant is too high
        // and excesses of TONs will be accrued on wallet
        expect(finalBalance).toBeLessThan(initialBalance + toNano('0.001'));
        expect(finalBalance2).toBeLessThan(initialBalance2 + toNano('0.001'));
        expect(finalBalance).toBeGreaterThan(initialBalance - toNano('0.001'));
        expect(finalBalance2).toBeGreaterThan(initialBalance2 - toNano('0.001'));

    });
    */
    // implementation detail
    it('can not send to masterchain', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        const sendResult = await deployerWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, Address.parse("Ef8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAU"),
               deployer.address, null, forwardAmount, null);
        expect(sendResult.transactions).toHaveTransaction({ //excesses
            from: deployer.address,
            to: deployerWallet.address,
            aborted: true,
            exitCode: Errors.wrong_workchain //error::wrong_workchain
        });
    });
    describe('Bounces', () => {
        // This is borrowed from stablecoin, and is not implemented here.
        // Should it be implemented?
        it.skip('minter should restore supply on internal_transfer bounce', async () => {
            const deployerWallet    = await userWallet(deployer.address);
            const mintAmount = BigInt(getRandomInt(1000, 2000));
            const mintMsg    = Minter.mintMessage(minter.address, deployer.address, mintAmount,toNano('0.1'), toNano('0.1'));

            const supplyBefore = await minter.getTotalSupply();
            const minterSmc    = await blockchain.getContract(minter.address);

            // Sending message but only processing first step of tx chain
            let res = await minterSmc.receiveMessage(internal({
                from: deployer.address,
                to: minter.address,
                body: mintMsg,
                value: toNano('1')
            }));

            expect(res.outMessagesCount).toEqual(1);
            const outMsgSc = res.outMessages.get(0)!.body.beginParse();
            expect(outMsgSc.preloadUint(32)).toEqual(Op.internal_transfer);

            expect(await minter.getTotalSupply()).toEqual(supplyBefore + mintAmount);

            minterSmc.receiveMessage(internal({
                from: deployerWallet.address,
                to: minter.address,
                bounced: true,
                body: beginCell().storeUint(0xFFFFFFFF, 32).storeSlice(outMsgSc).endCell(),
                value: toNano('0.95')
            }));

            // Supply should change back
            expect(await minter.getTotalSupply()).toEqual(supplyBefore);
        });
        it('wallet should restore balance on internal_transfer bounce', async () => {
            const deployerWallet    = await userWallet(deployer.address);
            const notDeployerWallet = await userWallet(notDeployer.address);
            const balanceBefore           = await deployerWallet.getJettonBalance();
            const txAmount = BigInt(getRandomInt(100, 200));
            const transferMsg = Wallet.transferMessage(txAmount, notDeployer.address, deployer.address, null, 0n, null);

            const walletSmc = await blockchain.getContract(deployerWallet.address);

            const res = await walletSmc.receiveMessage(internal({
                from: deployer.address,
                to: deployerWallet.address,
                body: transferMsg,
                value: toNano('1')
            }));

            expect(res.outMessagesCount).toEqual(1);

            const outMsgSc = res.outMessages.get(0)!.body.beginParse();
            expect(outMsgSc.preloadUint(32)).toEqual(Op.internal_transfer);

            expect(await deployerWallet.getJettonBalance()).toEqual(balanceBefore - txAmount);

            walletSmc.receiveMessage(internal({
                from: notDeployerWallet.address,
                to: walletSmc.address,
                bounced: true,
                body: beginCell().storeUint(0xFFFFFFFF, 32).storeSlice(outMsgSc).endCell(),
                value: toNano('0.95')
            }));

            // Balance should roll back
            expect(await deployerWallet.getJettonBalance()).toEqual(balanceBefore);
        });
        it('wallet should restore balance on burn_notification bounce', async () => {
            const deployerWallet = await userWallet(deployer.address);
            const balanceBefore        = await deployerWallet.getJettonBalance();
            const burnAmount = BigInt(getRandomInt(100, 200));

            const burnMsg = Wallet.burnMessage(burnAmount, deployer.address, null);

            const walletSmc = await blockchain.getContract(deployerWallet.address);

            const res = await walletSmc.receiveMessage(internal({
                from: deployer.address,
                to: deployerWallet.address,
                body: burnMsg,
                value: toNano('1')
            }));

            expect(res.outMessagesCount).toEqual(1);

            const outMsgSc = res.outMessages.get(0)!.body.beginParse();
            expect(outMsgSc.preloadUint(32)).toEqual(Op.burn_notification);

            expect(await deployerWallet.getJettonBalance()).toEqual(balanceBefore - burnAmount);

            walletSmc.receiveMessage(internal({
                from: minter.address,
                to: walletSmc.address,
                bounced: true,
                body: beginCell().storeUint(0xFFFFFFFF, 32).storeSlice(outMsgSc).endCell(),
                value: toNano('0.95')
            }));

            // Balance should roll back
            expect(await deployerWallet.getJettonBalance()).toEqual(balanceBefore);
        });
    });

    // Current wallet version doesn't support those operations
    // implementation detail
    it.skip('owner can withdraw excesses', async () => {
        const deployerWallet = await userWallet(deployer.address);
        await deployer.send({value:toNano('1'), bounce:false, to: deployerWallet.address});
        let initialBalance = (await blockchain.getContract(deployer.address)).balance;
        const withdrawResult = await deployerWallet.sendWithdrawTons(deployer.getSender());
        expect(withdrawResult.transactions).toHaveTransaction({ //excesses
            from: deployerWallet.address,
            to: deployer.address
        });
        let finalBalance = (await blockchain.getContract(deployer.address)).balance;
        let finalWalletBalance = (await blockchain.getContract(deployerWallet.address)).balance;
        expect(finalWalletBalance).toEqual(min_tons_for_storage);
        expect(finalBalance - initialBalance).toBeGreaterThan(toNano('0.99'));
    });
    // implementation detail
    it.skip('not owner can not withdraw excesses', async () => {
        const deployerWallet = await userWallet(deployer.address);
        await deployer.send({value:toNano('1'), bounce:false, to: deployerWallet.address});
        let initialBalance = (await blockchain.getContract(deployer.address)).balance;
        const withdrawResult = await deployerWallet.sendWithdrawTons(notDeployer.getSender());
        expect(withdrawResult.transactions).not.toHaveTransaction({ //excesses
            from: deployerWallet.address,
            to: deployer.address
        });
        let finalBalance = (await blockchain.getContract(deployer.address)).balance;
        let finalWalletBalance = (await blockchain.getContract(deployerWallet.address)).balance;
        expect(finalWalletBalance).toBeGreaterThan(toNano('1'));
        expect(finalBalance - initialBalance).toBeLessThan(toNano('0.1'));
    });
    // implementation detail
    it.skip('owner can withdraw jettons owned by Wallet', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        await deployerWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, deployerWallet.address,
               deployer.address, null, forwardAmount, null);
        const childWallet = await userWallet(deployerWallet.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
        let initialChildJettonBalance = await childWallet.getJettonBalance();
        expect(initialChildJettonBalance).toEqual(toNano('0.5'));
        let withdrawResult = await deployerWallet.sendWithdrawJettons(deployer.getSender(), childWallet.address, toNano('0.4'));
        expect(await deployerWallet.getJettonBalance() - initialJettonBalance).toEqual(toNano('0.4'));
        expect(await childWallet.getJettonBalance()).toEqual(toNano('0.1'));
        //withdraw the rest
        await deployerWallet.sendWithdrawJettons(deployer.getSender(), childWallet.address, toNano('0.1'));
    });
    // implementation detail
    it.skip('not owner can not withdraw jettons owned by Wallet', async () => {
        const deployerWallet = await userWallet(deployer.address);
        let sentAmount = toNano('0.5');
        let forwardAmount = toNano('0.05');
        await deployerWallet.sendTransfer(deployer.getSender(), toNano('0.1'), //tons
               sentAmount, deployerWallet.address,
               deployer.address, null, forwardAmount, null);
        const childWallet = await userWallet(deployerWallet.address);
        let initialJettonBalance = await deployerWallet.getJettonBalance();
        let initialChildJettonBalance = await childWallet.getJettonBalance();
        expect(initialChildJettonBalance).toEqual(toNano('0.5'));
        let withdrawResult = await deployerWallet.sendWithdrawJettons(notDeployer.getSender(), childWallet.address, toNano('0.4'));
        expect(await deployerWallet.getJettonBalance() - initialJettonBalance).toEqual(toNano('0.0'));
        expect(await childWallet.getJettonBalance()).toEqual(toNano('0.5'));
    });
});
