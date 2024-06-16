import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'func',
    targets: [
        'contracts/imports/stdlib.fc',
        'contracts/statics.fc',
        'contracts/utils.fc',
        'contracts/minter.fc'
    ],
};
