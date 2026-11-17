import { describe, expect, it } from 'vitest';
import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ExtensionType,type Mint } from '@solana/spl-token';
import { assertCompatibleQuoteMint,assertAllowedExtensions } from '../src/lib/quoteMint';

const mint: Mint = {address:PublicKey.default,mintAuthority:null,supply:1_000_000_000n,decimals:6,isInitialized:true,freezeAuthority:null,tlvData:Buffer.alloc(0)};
function tlv(type: number,length = 0): Buffer { const bytes = Buffer.alloc(4 + length);bytes.writeUInt16LE(type);bytes.writeUInt16LE(length,2);return bytes; }
describe('shared quote mint transfer compatibility',() => {
  it('supports plain SPL and metadata-only Token-2022',() => {
    expect(() => assertCompatibleQuoteMint(mint,TOKEN_PROGRAM_ID)).not.toThrow();
    expect(() => assertCompatibleQuoteMint({...mint,tlvData:Buffer.concat([tlv(ExtensionType.MetadataPointer,64),tlv(ExtensionType.TokenMetadata,80)])},TOKEN_2022_PROGRAM_ID)).not.toThrow();
  });
  it('rejects all known unsupported nonzero Token-2022 extension types, not only fees',() => {
    for (const value of Object.values(ExtensionType)) {
      if (typeof value !== 'number' || value === 0 || value === ExtensionType.MetadataPointer || value === ExtensionType.TokenMetadata) continue;
      expect(() => assertCompatibleQuoteMint({...mint,tlvData:tlv(value)},TOKEN_2022_PROGRAM_ID),`extension ${value}`).toThrow();
    }
    expect(() => assertCompatibleQuoteMint({...mint,tlvData:tlv(65535)},TOKEN_2022_PROGRAM_ID)).toThrow();
  });
  it('rejects duplicate extension declarations and truncated payloads',() => {
    expect(() => assertCompatibleQuoteMint({...mint,tlvData:Buffer.concat([tlv(18,64),tlv(18,64)])},TOKEN_2022_PROGRAM_ID)).toThrow();
    const truncated = tlv(18,64).subarray(0,5);
    expect(() => assertCompatibleQuoteMint({...mint,tlvData:truncated},TOKEN_2022_PROGRAM_ID)).toThrow('malformées');
    expect(() => assertAllowedExtensions(Buffer.from([18,0,1]),[ExtensionType.MetadataPointer])).toThrow('malformées');
  });
  it('accepts only terminal all-zero padding and rejects hidden extensions after padding',() => {
    expect(() => assertCompatibleQuoteMint({...mint,tlvData:Buffer.concat([tlv(18,64),Buffer.alloc(30)])},TOKEN_2022_PROGRAM_ID)).not.toThrow();
    expect(() => assertCompatibleQuoteMint({...mint,tlvData:Buffer.concat([Buffer.alloc(12),tlv(ExtensionType.TransferFeeConfig,8)])},TOKEN_2022_PROGRAM_ID)).toThrow();
  });
  it('rejects frozen, uninitialized, unsupported-owner and unsupported-decimals mints',() => {
    expect(() => assertCompatibleQuoteMint({...mint,freezeAuthority:PublicKey.default},TOKEN_2022_PROGRAM_ID)).toThrow();
    expect(() => assertCompatibleQuoteMint({...mint,isInitialized:false},TOKEN_PROGRAM_ID)).toThrow();
    expect(() => assertCompatibleQuoteMint({...mint,decimals:19},TOKEN_PROGRAM_ID)).toThrow();
    expect(() => assertCompatibleQuoteMint(mint,PublicKey.default)).toThrow();
    expect(() => assertCompatibleQuoteMint({...mint,tlvData:tlv(18,64)},TOKEN_PROGRAM_ID)).toThrow();
  });
});
