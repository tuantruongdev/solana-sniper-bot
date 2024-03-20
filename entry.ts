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
  public pool: PublicKey = new PublicKey('DqVm2EsirBypP9CJBFDviCFRxCM4meeBvWHzp6a6Eo1i');
  public timeFound: Number = 0;
  public timeSendBuyTx: Number = 0;
  public timeSentBuyTx: Number = 0;
  public timeAcceptBuyTx: Number = 0;
  public timeSendSellTx: Number = 0;
  public timeSentSellTx: Number = 0;
  public timeAcceptSellTx: Number = 0;
  public retrySellTimes: Number = 0;
  public buyTx: String = '';
  public sellTx: String = '';
  public buySolAmmount: Number = 0;
  public sellSolAmmount: Number = 0;
  public tokenAmmount: Number = 0;
  public totalTimeBuy: Number = 0;
  public totalTimeSell: Number = 0;
  public errorCode: Number = 0;
}
