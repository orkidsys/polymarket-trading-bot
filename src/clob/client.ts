import {
  ClobClient,
  OrderType,
  Side,
  AssetType,
  type ApiKeyCreds,
  type OrderBookSummary,
  type BalanceAllowanceResponse,
  type CreateOrderOptions,
} from "@polymarket/clob-client";
import { Wallet } from "ethers";
import { getClobHttpUrl, getPrivateKey, getProxyWallet } from "../config/index.js";
import { adaptEthersV6Wallet } from "./ethers-adapter.js";

const POLYGON_CHAIN_ID = 137;
/** Signature type 0 = EOA (MetaMask, private key wallet). */
const SIGNATURE_TYPE = 0;

let clientInstance: ClobClient | null = null;

function getSigner(): Wallet {
  const pk = getPrivateKey();
  const hexKey = pk.startsWith("0x") ? pk : `0x${pk}`;
  return new Wallet(hexKey);
}

/**
 * Create or get singleton ClobClient with L1+L2 auth.
 * Call initClobClient() once at startup (e.g. after config is loaded).
 */
export async function initClobClient(): Promise<ClobClient> {
  if (clientInstance) return clientInstance;

  const host = getClobHttpUrl();
  const signer = getSigner();
  const adapter = adaptEthersV6Wallet(signer);
  const funder = getProxyWallet();

  const tempClient = new ClobClient(host, POLYGON_CHAIN_ID, adapter);
  const creds = await tempClient.createOrDeriveApiKey();
  clientInstance = new ClobClient(
    host,
    POLYGON_CHAIN_ID,
    adapter,
    creds as ApiKeyCreds,
    SIGNATURE_TYPE,
    funder,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true
  );
  return clientInstance;
}

/** Get existing client (must have called initClobClient first). */
export function getClobClient(): ClobClient {
  if (!clientInstance) throw new Error("ClobClient not initialized. Call initClobClient() first.");
  return clientInstance;
}

/** USDC balance and allowance (in raw units; divide by 1e6 for USD). */
export async function getBalanceAllowance(): Promise<BalanceAllowanceResponse> {
  const client = getClobClient();
  const res = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
  if (res && typeof res === "object" && "balance" in res && "allowance" in res) {
    return res as BalanceAllowanceResponse;
  }
  throw new Error("Invalid balance allowance response");
}

/** Our USDC balance in USD (float). */
export async function getOurBalanceUsd(): Promise<number> {
  const res = await getBalanceAllowance();
  const raw = typeof res.balance === "string" ? res.balance : String(res.balance);
  return Number(BigInt(raw)) / 1e6;
}

/** Order book for a token (for slippage and tick/negRisk). */
export async function getOrderBook(tokenId: string): Promise<OrderBookSummary> {
  const client = getClobClient();
  return client.getOrderBook(tokenId);
}

/** Create and post a limit order. Returns API response (orderID, status, etc.). */
export async function createAndPostOrder(params: {
  tokenID: string;
  price: number;
  side: "BUY" | "SELL";
  size: number;
  tickSize: CreateOrderOptions["tickSize"];
  negRisk?: boolean;
}): Promise<{ orderID?: string; status?: string; error?: string; [k: string]: unknown }> {
  const client = getClobClient();
  const side = params.side === "BUY" ? Side.BUY : Side.SELL;
  const options: Partial<CreateOrderOptions> = {
    tickSize: params.tickSize,
    negRisk: params.negRisk ?? false,
  };
  const result = await client.createAndPostOrder(
    {
      tokenID: params.tokenID,
      price: params.price,
      side,
      size: params.size,
    },
    options,
    OrderType.GTC
  );
  return result as { orderID?: string; status?: string; error?: string; [k: string]: unknown };
}

/** Check if CLOB client can authenticate (e.g. get server time or balance). */
export async function pingClob(): Promise<boolean> {
  try {
    await initClobClient();
    await getClobClient().getServerTime();
    return true;
  } catch {
    return false;
  }
}
