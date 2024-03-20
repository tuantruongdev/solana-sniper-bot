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
  public buySolAmmount: string = "";
  public sellSolAmmount: number = 0;
  public tokenAmmount: string = "0";
  public totalTimeBuy: number = 0;
  public totalTimeSell: number = 0;
  public errorCode: number = 0;
}
