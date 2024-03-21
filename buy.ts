import {
  BigNumberish,
  Liquidity,
  LIQUIDITY_STATE_LAYOUT_V4,
  LiquidityPoolKeys,
  LiquidityStateV4,
  MARKET_STATE_LAYOUT_V3,
  MarketStateV3,
  Token,
  TokenAmount,
} from '@raydium-io/raydium-sdk';
import {
  AccountLayout,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  RawMint,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
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
import { getTokenAccounts, RAYDIUM_LIQUIDITY_PROGRAM_ID_V4, OPENBOOK_PROGRAM_ID, createPoolKeys } from './liquidity';
import { retrieveEnvVariable } from './utils';
import { getMinimalMarketV3, MinimalMarketLayoutV3 } from './market';
import { MintLayout } from './types';
import { PoolInfo, TokenEntry } from './entry';
import pino, { P } from 'pino';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

const transport = pino.transport({
  targets: [
    // {
    //   level: 'trace',
    //   target: 'pino/file',
    //   options: {
    //     destination: 'buy.log',
    //   },
    // },

    {
      level: 'debug',
      target: 'pino-pretty',
      options: {},
    },
  ],
});

export const logger = pino(
  {
    level: 'debug',
    redact: ['poolKeys'],
    serializers: {
      error: pino.stdSerializers.err,
    },
    base: undefined,
  },
  transport,
);

const network = 'mainnet-beta';
const RPC_ENDPOINT = retrieveEnvVariable('RPC_ENDPOINT', logger);
const RPC_WEBSOCKET_ENDPOINT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', logger);
const RPC_ENDPOINT_ALT = retrieveEnvVariable('RPC_ENDPOINT', logger);
const RPC_WEBSOCKET_ENDPOINT_ALT = retrieveEnvVariable('RPC_WEBSOCKET_ENDPOINT', logger);
const LOG_LEVEL = retrieveEnvVariable('LOG_LEVEL', logger);

const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
});
let tempConn = new Connection(RPC_ENDPOINT_ALT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT_ALT,
});

// let tempConn = new Connection('https://mainnet.helius-rpc.com/?api-key=e778cb0f-c7c6-4fb8-b5c6-5284b36a91f5', {
//   wsEndpoint: 'wss://mainnet.helius-rpc.com/?api-key=e778cb0f-c7c6-4fb8-b5c6-5284b36a91f5',
// });

export type MinimalTokenAccountData = {
  mint: PublicKey;
  address: PublicKey;
  poolKeys?: LiquidityPoolKeys;
  market?: MinimalMarketLayoutV3;
};

let existingLiquidityPools: Set<string> = new Set<string>();
let existingOpenBookMarkets: Set<string> = new Set<string>();
let existingTokenAccounts: Map<string, MinimalTokenAccountData> = new Map<string, MinimalTokenAccountData>();

let wallet: Keypair;
let quoteToken: Token;
let quoteTokenAssociatedAddress: PublicKey;
let quoteAmount: TokenAmount;
let commitment: Commitment = retrieveEnvVariable('COMMITMENT_LEVEL', logger) as Commitment;
let processingToken: Boolean = false;
let solPrice: Number = 0;
const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const CHECK_IF_MINT_IS_RENOUNCED = retrieveEnvVariable('CHECK_IF_MINT_IS_RENOUNCED', logger) === 'true';
const USE_SNIPE_LIST = retrieveEnvVariable('USE_SNIPE_LIST', logger) === 'true';
const AUTO_SAVE_LOG = retrieveEnvVariable('AUTO_SAVE_LOG', logger) === 'true';
const SNIPE_LIST_REFRESH_INTERVAL = Number(retrieveEnvVariable('SNIPE_LIST_REFRESH_INTERVAL', logger));
const AUTO_SELL = retrieveEnvVariable('AUTO_SELL', logger) === 'true';
const MAX_SELL_RETRIES = Number(retrieveEnvVariable('MAX_SELL_RETRIES', logger));
const AUTO_SELL_DELAY = Number(retrieveEnvVariable('AUTO_SELL_DELAY', logger));
const RETRY_GET_ACCOUNT_INFO = Number(retrieveEnvVariable('RETRY_GET_ACCOUNT_INFO', logger));
const DELAY_RETRY_GETACCOUNT_INFO = Number(retrieveEnvVariable('DELAY_RETRY_GETACCOUNT_INFO', logger));
const LIQUIDITY_SUPPLY_PERCENTAGE = Number(retrieveEnvVariable('LIQUIDITY_SUPPLY_PERCENTAGE', logger));
const CHECK_LOCKED_LIQUIDITY = retrieveEnvVariable('CHECK_LOCKED_LIQUIDITY', logger) === 'true';
const MIN_LIQUIDITY_USD = Number(retrieveEnvVariable('MIN_LIQUIDITY_USD', logger));
const CHECK_LIQUIDITY_AMMOUNT = retrieveEnvVariable('CHECK_LIQUIDITY_AMMOUNT', logger) === 'true';
const ONE_TOKEN_AT_A_TIME = retrieveEnvVariable('ONE_TOKEN_AT_A_TIME', logger);
const BUY_MICRO_LAMPOT = Number(retrieveEnvVariable('BUY_MICRO_LAMPOT', logger));
const BUY_COMPUTE_UNIT = Number(retrieveEnvVariable('BUY_COMPUTE_UNIT', logger));
const SELL_MICRO_LAMPOT = Number(retrieveEnvVariable('SELL_MICRO_LAMPOT', logger));
const SELL_COMPUTE_UNIT = Number(retrieveEnvVariable('SELL_COMPUTE_UNIT', logger));
var ledger = new Map<String, TokenEntry>();
let snipeList: string[] = [];

async function init(): Promise<void> {
  logger.level = LOG_LEVEL;

  // get wallet
  const PRIVATE_KEY = retrieveEnvVariable('PRIVATE_KEY', logger);
  wallet = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
  logger.info(`Wallet Address: ${wallet.publicKey}`);

  // get quote mint and amount
  const QUOTE_MINT = retrieveEnvVariable('QUOTE_MINT', logger);
  const QUOTE_AMOUNT = retrieveEnvVariable('QUOTE_AMOUNT', logger);
  switch (QUOTE_MINT) {
    case 'WSOL': {
      quoteToken = Token.WSOL;
      quoteAmount = new TokenAmount(Token.WSOL, QUOTE_AMOUNT, false);
      break;
    }
    case 'USDC': {
      quoteToken = new Token(
        TOKEN_PROGRAM_ID,
        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
        6,
        'USDC',
        'USDC',
      );
      quoteAmount = new TokenAmount(quoteToken, QUOTE_AMOUNT, false);
      break;
    }
    default: {
      throw new Error(`Unsupported quote mint "${QUOTE_MINT}". Supported values are USDC and WSOL`);
    }
  }
  solPrice = await getCurrentSolPrice();
  if (solPrice == 0) {
    logger.error("could'nt fetch the sol price! stopping");
    return;
  }
  logger.info('Updated sol price :' + solPrice);
  logger.info(
    `Script will buy all new tokens using ${QUOTE_MINT}. Amount that will be used to buy each token is: ${quoteAmount.toFixed().toString()}`,
  );
  let estimatedBuyFee = (BUY_MICRO_LAMPOT * BUY_COMPUTE_UNIT) / 1000000 / 1000000000;
  let estimatedSellFee = (SELL_MICRO_LAMPOT * SELL_COMPUTE_UNIT) / 1000000 / 1000000000;
  logger.info(`Estimated buy fee ${estimatedBuyFee.toFixed(6)} . Estimated sell fee ${estimatedSellFee.toFixed(6)} `);
  // check existing wallet for associated token account of quote mint
  const tokenAccounts = await getTokenAccounts(tempConn, wallet.publicKey, commitment);

  for (const ta of tokenAccounts) {
    existingTokenAccounts.set(ta.accountInfo.mint.toString(), <MinimalTokenAccountData>{
      mint: ta.accountInfo.mint,
      address: ta.pubkey,
    });
  }

  const tokenAccount = tokenAccounts.find((acc) => acc.accountInfo.mint.toString() === quoteToken.mint.toString())!;

  if (!tokenAccount) {
    throw new Error(`No ${quoteToken.symbol} token account found in wallet: ${wallet.publicKey}`);
  }

  quoteTokenAssociatedAddress = tokenAccount.pubkey;

  // load tokens to snipe
  loadSnipeList();
}

async function getCurrentSolPrice(): Promise<Number> {
  try {
    let data = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=solana');
    var body = await data.json();
    let price = Number(body[0].current_price);
    if (price <= 0) {
      return solPrice;
    }

    return price;
  } catch (e) {
    return solPrice;
  }
}

function saveTokenAccount(mint: PublicKey, accountData: MinimalMarketLayoutV3) {
  const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey);
  const tokenAccount = <MinimalTokenAccountData>{
    address: ata,
    mint: mint,
    market: <MinimalMarketLayoutV3>{
      bids: accountData.bids,
      asks: accountData.asks,
      eventQueue: accountData.eventQueue,
    },
  };
  existingTokenAccounts.set(mint.toString(), tokenAccount);
  return tokenAccount;
}

export async function processRaydiumPool(id: PublicKey, poolState: LiquidityStateV4) {
  if (!shouldBuy(poolState.baseMint.toString())) {
    return;
  }
  let accInfo: any = undefined;
  if (CHECK_IF_MINT_IS_RENOUNCED) {
    accInfo = await getParsedAccountInfo(poolState.baseMint, RETRY_GET_ACCOUNT_INFO);
    if (accInfo == undefined) {
      return;
    }
    const mintOption = checkMintable(accInfo);
    if (mintOption !== true) {
      logger.warn({ mint: poolState.baseMint }, 'Skipping, owner can mint tokens!');
      return;
    }
  }
  logger.info('found pool ' + id + ' at ' + Date.now());

  //if sinper enabled then dont check liquidity ammount anymore
  if (CHECK_LIQUIDITY_AMMOUNT && !USE_SNIPE_LIST) {
    let poolInfo = await getPoolInfo(poolState);
    if(poolInfo.totalLiquidity < MIN_LIQUIDITY_USD){
      logger.info('pool ' + id + ' have '+ Math.round(poolInfo.liquidityUSDC) +" USD lower than "+ MIN_LIQUIDITY_USD+" USD skipping");
      return;
    }
    logger.info('pool ' + id + ' have '+ Math.round(poolInfo.liquidityUSDC) +" USD in liquidity");
  }
  //if sinper enabled then dont check liquidity locked anymore
  if (CHECK_LOCKED_LIQUIDITY && !USE_SNIPE_LIST) {
    if (accInfo == undefined) {
      accInfo = await getParsedAccountInfo(new PublicKey(poolState.lpMint), RETRY_GET_ACCOUNT_INFO);
    }
    let lpPercentBurned = await calculateLPBurned(poolState, accInfo);
    if (lpPercentBurned.valueOf() == -1) {
      logger.info('pool ' + id + ' getting locked liquid failed skipping');
      return;
    }
    if (lpPercentBurned.valueOf() < LIQUIDITY_SUPPLY_PERCENTAGE) {
      logger.info(
        'pool ' +
          id +
          ' not locked only ' +
          lpPercentBurned +
          '% lower than ' +
          LIQUIDITY_SUPPLY_PERCENTAGE +
          '% skipping',
      );
      return;
    } else {
      logger.info('pool ' + id + ' locked at ' + lpPercentBurned + '%');
    }
  }

  //console.log("pool state "+JSON.stringify(poolState));
  //return;
  let entryToken = new TokenEntry();
  entryToken.baseMint = poolState.baseMint;
  entryToken.timeFound = Date.now();
  ledger.set(entryToken.baseMint.toBase58(), entryToken);
  await buy(id, poolState, entryToken);
}

export function checkMintable(deserialize: RawMint): boolean | undefined {
  try {
    return deserialize.mintAuthorityOption === 0;
  } catch (e) {
    logger.debug(e);
  }
}

export async function getParsedAccountInfo(vault: PublicKey, retry: number): Promise<RawMint | undefined> {
  try {
    let { data } = (await solanaConnection.getAccountInfo(vault)) || {};
    if (!data) {
      //  / logger.error("can't get account info retrying " + retry);
      if (retry.valueOf() > 0) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_RETRY_GETACCOUNT_INFO));
        return await getParsedAccountInfo(vault, --retry);
      } else {
        return;
      }
    }
    const deserialize = MintLayout.decode(data);
    return deserialize;
  } catch (e) {
    logger.debug(e);
    logger.error({ mint: vault }, `Failed to get account info`);
  }
}

export async function processOpenBookMarket(updatedAccountInfo: KeyedAccountInfo) {
  let accountData: MarketStateV3 | undefined;
  try {
    accountData = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);

    // to be competitive, we collect market data before buying the token...
    if (existingTokenAccounts.has(accountData.baseMint.toString())) {
      return;
    }

    saveTokenAccount(accountData.baseMint, accountData);
  } catch (e) {
    logger.debug(e);
    logger.error({ mint: accountData?.baseMint }, `Failed to process market`);
  }
}

async function buy(accountId: PublicKey, accountData: LiquidityStateV4, entryToken: TokenEntry): Promise<void> {
  try {
    //entryToken.buyTx = 'hello worlds';
    //console.log(ledger);

    let tokenAccount = existingTokenAccounts.get(accountData.baseMint.toString());

    if (!tokenAccount) {
      // it's possible that we didn't have time to fetch open book data
      const market = await getMinimalMarketV3(solanaConnection, accountData.marketId, commitment);
      tokenAccount = saveTokenAccount(accountData.baseMint, market);
    }

    tokenAccount.poolKeys = createPoolKeys(accountId, accountData, tokenAccount.market!);
    const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
      {
        poolKeys: tokenAccount.poolKeys,
        userKeys: {
          tokenAccountIn: quoteTokenAssociatedAddress,
          tokenAccountOut: tokenAccount.address,
          owner: wallet.publicKey,
        },
        amountIn: quoteAmount.raw,
        minAmountOut: 0,
      },
      tokenAccount.poolKeys.version,
    );

    const latestBlockhash = await solanaConnection.getLatestBlockhash({
      commitment: commitment,
    });
    const messageV0 = new TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: BUY_MICRO_LAMPOT }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: BUY_COMPUTE_UNIT }),
        createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey,
          tokenAccount.address,
          wallet.publicKey,
          accountData.baseMint,
        ),
        ...innerTransaction.instructions,
      ],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet, ...innerTransaction.signers]);
    entryToken.timeSendBuyTx = Date.now();
    const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), {
      preflightCommitment: commitment,
    });
    entryToken.timeSentBuyTx = Date.now();
    logger.info({ mint: accountData.baseMint, signature }, `Sent buy tx`);
    processingToken = true;
    const confirmation = await solanaConnection.confirmTransaction(
      {
        signature,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        blockhash: latestBlockhash.blockhash,
      },
      commitment,
    );
    if (!confirmation.value.err) {
      logger.info(
        {
          mint: accountData.baseMint,
          signature,
          url: `https://solscan.io/tx/${signature}?cluster=${network}`,
        },
        `Confirmed buy tx`,
      );
      entryToken.buyTx = `https://solscan.io/tx/${signature}?cluster=${network}`;
      entryToken.buySolAmmount = quoteAmount.toExact();
      entryToken.timeAcceptBuyTx = Date.now();
      entryToken.totalTimeBuy = entryToken.timeAcceptBuyTx - entryToken.timeFound;
    } else {
      logger.debug(confirmation.value.err);
      logger.info({ mint: accountData.baseMint, signature }, `Error confirming buy tx`);
      entryToken.errorCode = -1;
    }
  } catch (e) {
    logger.debug(e);
    logger.error({ mint: accountData.baseMint }, `Failed to buy token`);
    processingToken = false;
    entryToken.errorCode = -2;
  }
}

async function sell(accountId: PublicKey, mint: PublicKey, amount: BigNumberish): Promise<void> {
  let sold = false;
  let retries = 0;
  let entryToken = ledger.get(mint.toBase58());
  if (entryToken == undefined) {
    return;
  }
  if (AUTO_SELL_DELAY > 0) {
    await new Promise((resolve) => setTimeout(resolve, AUTO_SELL_DELAY));
  }

  do {
    try {
      const tokenAccount = existingTokenAccounts.get(mint.toString());

      if (!tokenAccount) {
        return;
      }

      if (!tokenAccount.poolKeys) {
        logger.warn({ mint }, 'No pool keys found');
        return;
      }

      if (amount === 0) {
        logger.info(
          {
            mint: tokenAccount.mint,
          },
          `Empty balance, can't sell`,
        );
        return;
      }

      const { innerTransaction } = Liquidity.makeSwapFixedInInstruction(
        {
          poolKeys: tokenAccount.poolKeys!,
          userKeys: {
            tokenAccountOut: quoteTokenAssociatedAddress,
            tokenAccountIn: tokenAccount.address,
            owner: wallet.publicKey,
          },
          amountIn: amount,
          minAmountOut: 0,
        },
        tokenAccount.poolKeys!.version,
      );

      const latestBlockhash = await solanaConnection.getLatestBlockhash({
        commitment: commitment,
      });
      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: SELL_MICRO_LAMPOT }), //ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: SELL_COMPUTE_UNIT }),
          ...innerTransaction.instructions,
          createCloseAccountInstruction(tokenAccount.address, wallet.publicKey, wallet.publicKey),
        ],
      }).compileToV0Message();
      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([wallet, ...innerTransaction.signers]);
      entryToken.tokenAmmount = amount.toString();
      entryToken.timeSendSellTx = Date.now();
      const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), {
        preflightCommitment: commitment,
      });
      entryToken.timeSentSellTx = Date.now();
      logger.info({ mint, signature }, `Sent sell tx`);
      const confirmation = await solanaConnection.confirmTransaction(
        {
          signature,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          blockhash: latestBlockhash.blockhash,
        },
        commitment,
      );
      if (confirmation.value.err) {
        logger.debug(confirmation.value.err);
        logger.info({ mint, signature }, `Error confirming sell tx`);
        entryToken.errorCode = -3;
        continue;
      }

      logger.info(
        {
          dex: `https://dexscreener.com/solana/${mint}?maker=${wallet.publicKey}`,
          mint,
          signature,
          url: `https://solscan.io/tx/${signature}?cluster=${network}`,
        },
        `Confirmed sell tx`,
      );
      entryToken.sellTx = `https://solscan.io/tx/${signature}?cluster=${network}`;
      entryToken.timeAcceptSellTx = Date.now();
      entryToken.errorCode = 0;
      entryToken.totalTimeSell = entryToken.timeAcceptSellTx - entryToken.timeSentSellTx;
      sold = true;
      processingToken = false;
    } catch (e: any) {
      retries++;
      entryToken.retrySellTimes = retries;
      logger.debug(e);
      logger.error({ mint }, `Failed to sell token, retry: ${retries}/${MAX_SELL_RETRIES}`);
    }
  } while (!sold && retries < MAX_SELL_RETRIES);
}

function loadSnipeList() {
  if (!USE_SNIPE_LIST) {
    return;
  }

  const count = snipeList.length;
  const data = fs.readFileSync(path.join(__dirname, 'snipe-list.txt'), 'utf-8');
  snipeList = data
    .split('\n')
    .map((a) => a.trim())
    .filter((a) => a);

  if (snipeList.length != count) {
    logger.info(`Loaded snipe list: ${snipeList.length}`);
  }
}

function shouldBuy(key: string): boolean {
  if (!USE_SNIPE_LIST && ONE_TOKEN_AT_A_TIME && processingToken) {
    logger.info('ignored mint ' + key + ' because currently processing another mint');
  }
  return USE_SNIPE_LIST ? snipeList.includes(key) : ONE_TOKEN_AT_A_TIME ? !processingToken : true;
}

async function calculateLPBurned(poolState: any, accInfo: RawMint): Promise<Number> {
  const lpMint = poolState.lpMint;
  let lpReserve: any = poolState.lpReserve;
  //const accInfo = await getParsedAccountInfo(new PublicKey(lpMint));
  if (accInfo == undefined) {
    //logger.error("failed to calulate mint info")
    return -1;
  }

  lpReserve = lpReserve / Math.pow(10, accInfo.decimals);
  const actualSupply = accInfo.supply / BigInt(Math.pow(10, accInfo.decimals));
  //console.log(`lpMint: ${lpMint}, Reserve: ${lpReserve}, Actual Supply: ${actualSupply}`);
  lpReserve = BigInt(Math.round(lpReserve));
  //Calculate burn percentage
  // const maxLpSupply = actualSupply > BigInt(lpReserve - BigInt(1))?actualSupply : BigInt(lpReserve - BigInt(1));
  const burnAmt = lpReserve - actualSupply;
  //console.log(`burn amt: ${burnAmt}`)
  const burnPct = (burnAmt / BigInt(lpReserve)) * BigInt(100);
  //console.log(`${burnPct} % LP burned`);
  return Number(burnPct);
}
async function getPoolInfo(poolState:LiquidityStateV4):Promise<PoolInfo> {
      let poolInfo = new PoolInfo(); 
      poolInfo.baseMint = poolState.baseMint;
      poolInfo.qouteMint = poolState.quoteMint;
      poolInfo.qouteVault = poolState.quoteVault;
      poolInfo.baseVault = poolState.baseVault;
      //solanaConnection.getMultipleAccounts
      const baseTokenAmount = await solanaConnection.getTokenAccountBalance(poolState.baseVault);
      const quoteTokenAmount = await solanaConnection.getTokenAccountBalance(poolState.quoteVault);
      let tokenPooled = baseTokenAmount.value.uiAmount;
      let pairPooled = quoteTokenAmount.value.uiAmount;
      poolInfo.tokenPooled = tokenPooled != null ? tokenPooled : 0;
      poolInfo.pairPooled = pairPooled != null ? pairPooled : 0;
      let currentQuoteMint = poolState.quoteMint.toBase58();
      if (pairPooled && tokenPooled) {
        let solTokenPrice = -1;
        let usdcPrice = -1;
        if (currentQuoteMint == SOL) {
          solTokenPrice = pairPooled / tokenPooled;
          usdcPrice = (pairPooled * solPrice.valueOf()) / tokenPooled;

          poolInfo.liquiditySol = pairPooled;
          poolInfo.liquidityUSDC = solPrice.valueOf() * pairPooled;
        }
         else if(currentQuoteMint == USDC) {
          usdcPrice = pairPooled / tokenPooled;
          solTokenPrice = pairPooled / solPrice.valueOf() / tokenPooled;
          
          poolInfo.liquidityUSDC = pairPooled;
          poolInfo.liquiditySol = pairPooled / solPrice.valueOf();
        }
        poolInfo.totalLiquidity =poolInfo.liquidityUSDC + (tokenPooled * usdcPrice);
        
        poolInfo.priceSol = solTokenPrice;
        poolInfo.priceUSDC = usdcPrice;
        
        // logger.info(
        //   'mint ' +
        //     poolState.baseMint.toBase58() +
        //     ' sol price ' +
        //     solTokenPrice.toFixed(10) +
        //     ' usdc price ' +
        //     usdcPrice.toFixed(10),
        // );
        return poolInfo;
      }
      return poolInfo;
}

const runListener = async () => {
  await init();
  const runTimestamp = Math.floor(new Date().getTime() / 1000);
  const raydiumSubscriptionId = solanaConnection.onProgramAccountChange(
    RAYDIUM_LIQUIDITY_PROGRAM_ID_V4,
    async (updatedAccountInfo) => {
      const key = updatedAccountInfo.accountId.toString();
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
      const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
      //console.log(JSON.stringify(await getPoolInfo(poolState)));
      const existing = existingLiquidityPools.has(key);
      if (poolOpenTime > runTimestamp && !existing) {
        existingLiquidityPools.add(key);
        const _ = processRaydiumPool(updatedAccountInfo.accountId, poolState);
      }
    },
    commitment,
    [
      { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
          bytes: quoteToken.mint.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
          bytes: OPENBOOK_PROGRAM_ID.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
          bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
        },
      },
    ],
  );

  const openBookSubscriptionId = solanaConnection.onProgramAccountChange(
    OPENBOOK_PROGRAM_ID,
    async (updatedAccountInfo) => {
      const key = updatedAccountInfo.accountId.toString();
      const existing = existingOpenBookMarkets.has(key);
      if (!existing) {
        existingOpenBookMarkets.add(key);
        const _ = processOpenBookMarket(updatedAccountInfo);
      }
    },
    commitment,
    [
      { dataSize: MARKET_STATE_LAYOUT_V3.span },
      {
        memcmp: {
          offset: MARKET_STATE_LAYOUT_V3.offsetOf('quoteMint'),
          bytes: quoteToken.mint.toBase58(),
        },
      },
    ],
  );

  if (AUTO_SELL) {
    const walletSubscriptionId = solanaConnection.onProgramAccountChange(
      TOKEN_PROGRAM_ID,
      async (updatedAccountInfo) => {
        const accountData = AccountLayout.decode(updatedAccountInfo.accountInfo!.data);

        if (updatedAccountInfo.accountId.equals(quoteTokenAssociatedAddress)) {
          return;
        }
        const _ = sell(updatedAccountInfo.accountId, accountData.mint, accountData.amount);
      },
      commitment,
      [
        {
          dataSize: 165,
        },
        {
          memcmp: {
            offset: 32,
            bytes: wallet.publicKey.toBase58(),
          },
        },
      ],
    );

    logger.info(`Listening for wallet changes: ${walletSubscriptionId}`);
  }

  logger.info(`Listening for raydium changes: ${raydiumSubscriptionId}`);
  logger.info(`Listening for open book changes: ${openBookSubscriptionId}`);

  if (USE_SNIPE_LIST) {
    setInterval(loadSnipeList, SNIPE_LIST_REFRESH_INTERVAL);
  }
  if (AUTO_SAVE_LOG) {
    setInterval(() => {
      writeMapToFile(ledger, `log_buy_${runTimestamp}.txt`);
    }, 30000);
  }
  // Function to convert object to string with '|' separated variables
  function objectToString(obj: any) {
    return Object.values(obj).join('|');
  }

  // Function to write map to file
  function writeMapToFile(map: Map<String, TokenEntry>, filename: any) {
    const stream = fs.openSync(filename, 'w');
    fs.writeSync(stream, '[');
    for (const [key, value] of map) {
      //console.log(value);
      const line = JSON.stringify(value) + ',\n';
      //const line = `${key}|${objectToString(value)}\n`;
      fs.writeSync(stream, line);
    }
    fs.writeSync(stream, ']');
    fs.closeSync(stream);
  }
};

runListener();
