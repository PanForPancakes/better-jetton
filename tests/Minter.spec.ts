import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { Minter } from '../wrappers/Minter';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('Minter', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('Minter');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let minter: SandboxContract<Minter>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        minter = blockchain.openContract(Minter.createFromConfig({}, code));

        deployer = await blockchain.treasury('deployer');

        const deployResult = await minter.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: minter.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and minter are ready to use
    });
});
