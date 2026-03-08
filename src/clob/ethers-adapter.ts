/**
 * Adapter so ethers v6 Wallet satisfies ClobSigner (EthersSigner expects _signTypedData).
 */
import type { Wallet } from "ethers";

export interface EthersV6SignerAdapter {
  _signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>
  ): Promise<string>;
  getAddress(): Promise<string>;
}

export function adaptEthersV6Wallet(wallet: Wallet): EthersV6SignerAdapter {
  return {
    _signTypedData: (domain, types, value) =>
      wallet.signTypedData(domain, types, value),
    getAddress: () => wallet.getAddress(),
  };
}
