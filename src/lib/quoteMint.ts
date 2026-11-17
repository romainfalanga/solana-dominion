import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { ExtensionType, getExtensionTypes, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, type Mint } from '@solana/spl-token';

/** Validate TLV bounds before the SPL helper, which otherwise trusts declared lengths. */
export function assertAllowedExtensions(tlv: Buffer, allowed: readonly ExtensionType[]): void {
  let offset = 0;
  while (offset < tlv.length) {
    // Only all-zero terminal allocation padding is ignored; unknown nonzero entries fail below.
    if (tlv[offset] === 0 && (offset + 1 === tlv.length || tlv[offset + 1] === 0)) {
      if (tlv.subarray(offset).every(byte => byte === 0)) break;
      throw new Error('Extensions Token-2022 malformées.');
    }
    if (offset + 4 > tlv.length) throw new Error('Extensions Token-2022 malformées.');
    const length = tlv.readUInt16LE(offset + 2);
    if (offset + 4 + length > tlv.length) throw new Error('Extensions Token-2022 malformées.');
    offset += 4 + length;
  }
  const extensions = getExtensionTypes(tlv.subarray(0,offset));
  if (extensions.some(extension => !allowed.includes(extension)) || new Set(extensions).size !== extensions.length) {
    throw new Error('Extension Token-2022 non prise en charge.');
  }
}

/** No audit claim: this narrowly checks the transfer semantics implemented by the launchpad. */
export function assertCompatibleQuoteMint(mint: Mint, owner: PublicKey): void {
  if (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error('Le token de paiement doit appartenir à un programme SPL pris en charge.');
  }
  if (!mint.isInitialized || !Number.isInteger(mint.decimals) || mint.decimals < 0 || mint.decimals > 18 || mint.freezeAuthority) {
    throw new Error('Le token de paiement doit être initialisé et sans autorité de gel (18 décimales maximum).');
  }
  if (owner.equals(TOKEN_2022_PROGRAM_ID)) {
    assertAllowedExtensions(mint.tlvData,[ExtensionType.MetadataPointer,ExtensionType.TokenMetadata]);
  } else if (mint.tlvData.length) {
    throw new Error('Extensions inattendues sur un mint SPL classique.');
  }
}
