import {
  hexToBin,
  binToHex,
  walletTemplateToCompilerBch,
  secp256k1,
  hash256,
  SigningSerializationFlag,
  generateSigningSerializationBch,
  generateTransaction,
  encodeTransaction,
  decodeTransaction,
  importWalletTemplate,
  walletTemplateP2pkhNonHd,
  type CompilationContextBch,
  type TransactionTemplate,
} from '@bitauth/libauth';
import type { WcSignTransactionRequest } from '@bch-wc2/interfaces';

export function createSignedWcTransaction(
  wcTransactionObj: WcSignTransactionRequest,
  signingInfo: { privateKey: Uint8Array; pubkeyCompressed: Uint8Array },
  walletLockingBytecodeHex: string,
) {
  const { transaction: wcTransactionItem, sourceOutputs } = wcTransactionObj;
  const { privateKey, pubkeyCompressed } = signingInfo;

  const walletTemplate = importWalletTemplate(walletTemplateP2pkhNonHd);
  if (typeof walletTemplate === 'string') throw new Error('Transaction template error');

  const unsignedTransaction =
    typeof wcTransactionItem === 'string' ? decodeTransaction(hexToBin(wcTransactionItem)) : wcTransactionItem;

  if (typeof unsignedTransaction === 'string') {
    throw new Error(`Transaction template error: ${unsignedTransaction}`);
  }

  const compiler = walletTemplateToCompilerBch(walletTemplate);
  const txTemplate = { ...unsignedTransaction } as TransactionTemplate<typeof compiler>;

  for (const [index, input] of txTemplate.inputs.entries()) {
    const correspondingSourceOutput = sourceOutputs[index] as (typeof sourceOutputs)[number];

    if (correspondingSourceOutput.contract?.artifact.contractName) {
      let unlockingBytecodeHex = binToHex(correspondingSourceOutput.unlockingBytecode);
      const sigPlaceholder = '41' + binToHex(new Uint8Array(65));
      const pubkeyPlaceholder = '21' + binToHex(new Uint8Array(33));
      if (unlockingBytecodeHex.indexOf(sigPlaceholder) !== -1) {
        const hashType =
          SigningSerializationFlag.allOutputs | SigningSerializationFlag.utxos | SigningSerializationFlag.forkId;
        const context: CompilationContextBch = { inputIndex: index, sourceOutputs, transaction: unsignedTransaction };
        const signingSerializationType = new Uint8Array([hashType]);

        const coveredBytecode = correspondingSourceOutput.contract?.redeemScript;
        if (!coveredBytecode) {
          throw new Error('Not enough information provided, please include contract redeemScript');
        }
        const sighashPreimage = generateSigningSerializationBch(context, { coveredBytecode, signingSerializationType });
        const sighash = hash256(sighashPreimage);
        const signature = secp256k1.signMessageHashSchnorr(privateKey, sighash);
        if (typeof signature === 'string') {
          throw new Error(`Signature error: ${signature}`);
        }
        const sig = Uint8Array.from([...signature, hashType]);

        unlockingBytecodeHex = unlockingBytecodeHex.replace(sigPlaceholder, '41' + binToHex(sig));
      }
      if (unlockingBytecodeHex.indexOf(pubkeyPlaceholder) !== -1) {
        unlockingBytecodeHex = unlockingBytecodeHex.replace(pubkeyPlaceholder, '21' + binToHex(pubkeyCompressed));
      }

      input.unlockingBytecode = hexToBin(unlockingBytecodeHex);
    } else {
      const inputLockingBytecodeHex = binToHex(correspondingSourceOutput.lockingBytecode);
      if (!correspondingSourceOutput.unlockingBytecode?.length && inputLockingBytecodeHex === walletLockingBytecodeHex) {
        input.unlockingBytecode = {
          compiler,
          data: {
            keys: { privateKeys: { key: privateKey } },
          },
          valueSatoshis: correspondingSourceOutput.valueSatoshis,
          token: correspondingSourceOutput.token,
          script: 'unlock',
        };
      }
    }
  }

  const generated = generateTransaction(txTemplate);
  if (!generated.success) {
    throw new Error(JSON.stringify(generated, null, 2));
  }

  return encodeTransaction(generated.transaction);
}
