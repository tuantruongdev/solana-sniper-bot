import { BigNumberish } from '@raydium-io/raydium-sdk';
import {
  Keypair,
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  KeyedAccountInfo,
  TransactionMessage,
  VersionedTransaction,
  Commitment,
} from '@solana/web3.js';

export class TokenEntry {
  public baseMint: PublicKey = new PublicKey('DqVm2EsirBypP9CJBFDviCFRxCM4meeBvWHzp6a6Eo1i');
  public timeFound: number = 0;
  public timeSendBuyTx: number = 0;
  public timeSentBuyTx: number = 0;
  public timeAcceptBuyTx: number = 0;
  public timeSendSellTx: number = 0;
  public timeSentSellTx: number = 0;
  public timeAcceptSellTx: number = 0;
  public retrySellTimes: number = 0;
  public buyTx: string = '';
  public sellTx: string = '';
  public buySolAmmount: string = '';
  public sellSolAmmount: number = 0;
  public tokenAmmount: string = '0';
  public totalTimeBuy: number = 0;
  public totalTimeSell: number = 0;
  public errorCode: number = 0;
  public dexLink: string = '';
}
export class PoolInfo {
  public baseMint: PublicKey = new PublicKey('DqVm2EsirBypP9CJBFDviCFRxCM4meeBvWHzp6a6Eo1i');
  public qouteMint: PublicKey = new PublicKey('DqVm2EsirBypP9CJBFDviCFRxCM4meeBvWHzp6a6Eo1i');
  public baseVault: PublicKey = new PublicKey('DqVm2EsirBypP9CJBFDviCFRxCM4meeBvWHzp6a6Eo1i'); //token account hold paired token
  public qouteVault: PublicKey = new PublicKey('DqVm2EsirBypP9CJBFDviCFRxCM4meeBvWHzp6a6Eo1i'); //token account hold sol.usdc...
  public priceUSDC: number = -1;
  public priceSol: number = -1;
  public liquidityUSDC: number = -1;
  public liquiditySol: number = -1;
  public totalLiquidity: number = -1;
  public fdv: number = -1;
  public tokenPooled: number = -1;
  public pairPooled: number = -1;
}
