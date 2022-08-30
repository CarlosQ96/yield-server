const { request, gql } = require('graphql-request');
const utils = require('../utils');
const { default: BigNumber } = require('bignumber.js');

const secsInOneYear = 31536000;
const toBigNumberJs = (eb) => new BigNumber(eb.toString());

const urlUniswapV2 =
  'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2';
const urlHoneyswapV2 =
  'https://api.thegraph.com/subgraphs/name/1hive/honeyswap-v2';
const urlGivEconomyMainnet =
  'https://api.thegraph.com/subgraphs/name/mateodaza/givpower-subgraph-mainnet';
const urlGivEconomyGnosis =
  'https://api.thegraph.com/subgraphs/name/giveth/giveth-economy-xdai';
const urlBalancer =
  'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2';

// GIV Token
const givTokenMainnetAddress = '0x900db999074d9277c5da2a43f252d74366230da0';
const givTokenGnosisAddress = '0x4f4f9b8d5b4d0dc10506e5551b0513b61fd59e75';

// GIV 100% UNIPOOL LM
const givMainnetContractInfo = '0x4b9efae862a1755f7cecb021856d467e86976755';
const givGnosisContractInfo = '0xd93d3bdba18ebcb3317a57119ea44ed2cf41c2f2';

// Giv - Dai Mainnet LP
const givDaiPairMainnetAddress = '0xbeba1666c62c65e58770376de332891b09461eeb';
const givDaiPairUnipoolContractInfo =
  '0xa4523d703f663615bd41606b46b58deb2f926d98';

// GIV - ETH Balancer
const givEthBalancerPoolId =
  '0x7819f1532c49388106f7762328c51ee70edd134c000200000000000000000109';
const givEthBalancerAddress = '0xc0dbdca66a0636236fabe1b3c16b1bd4c84bb1e1';

const tokenPairPoolQuery = gql`
  {
    pair(id: "<PLACEHOLDER>") {
      id
      reserveUSD
      volumeUSD
      reserve0
      reserve1
      totalSupply
      token0 {
        id
        symbol
      }
      token1 {
        id
        symbol
      }
    }
  }
`;

const balancerPairQuery = gql`
  {
    pool(id: "<PLACEHOLDER>") {
      id
      tokens {
        id
        address
        balance
        weight
        symbol
      }
      totalShares
    }
  }
`;

const unipoolContractInfoQuery = gql`
  {
    unipool(id: "<PLACEHOLDER>") {
      id
      totalSupply
      rewardRate
    }
  }
`;

const balancerCalculatePoolApy = async (chainString, entry, contractInfo) => {
  const givTokenAddress =
    chainString === 'ethereum' ? givTokenMainnetAddress : givTokenGnosisAddress;

  const tokenReserve = entry.tokens.find(
    (i) => i.address === givTokenAddress
  ).balance;
  const weights = [entry.tokens[0].weight, entry.tokens[1].weight].map(
    toBigNumberJs
  );
  const balances = [entry.tokens[0].balance, entry.tokens[1].balance].map(
    toBigNumberJs
  );

  const lp = BigNumber(entry.totalShares)
    .div(BigNumber.sum(...weights).div(weights[0]))
    .div(tokenReserve);

  const totalSupply = BigNumber(entry.totalShares);
  const apr = totalSupply.isZero()
    ? null
    : BigNumber(contractInfo.rewardRate)
        .div(totalSupply)
        .times(secsInOneYear)
        .times('100')
        .times(lp);
  return apr;
};

const calculatePairApy = async (chainString, entry, contractInfo) => {
  const givTokenAddress =
    chainString === 'ethereum' ? givTokenMainnetAddress : givTokenGnosisAddress;

  const tokenReserve = BigNumber(
    entry.token0.id.toLowerCase() !== givTokenAddress
      ? entry.reserve1
      : entry.reserve0
  );
  const lp = BigNumber(entry.totalSupply)
    .times(10 ** 18)
    .div(2)
    .div(tokenReserve);

  const totalSupply = BigNumber(contractInfo.totalSupply);

  const apr = totalSupply.isZero()
    ? null
    : BigNumber(contractInfo.rewardRate)
        .div(totalSupply)
        .times(secsInOneYear)
        .times('100')
        .times(lp)
        .div(10 ** 18);

  return apr;
};

const calculateUnipoolTvl = async (chainString, totalSupply) => {
  const givTokenAddress =
    chainString === 'ethereum' ? givTokenMainnetAddress : givTokenGnosisAddress;
  // DefiLlama price api
  const defiLlamaGivId = `${chainString}:${givTokenAddress}`;
  const idsSet = [defiLlamaGivId];
  let prices = await utils.getData('https://coins.llama.fi/prices', {
    coins: idsSet,
  });
  prices = prices.coins;
  console.log({ prices });
  const price = prices[defiLlamaGivId]?.price;
  const tvl = BigNumber(totalSupply) * price;
  return tvl;
};

const calculateBalancerTvl = async (chainString, tokens, amounts) => {
  // TODO: Sum all tokens and their balances from the BAL pool
  return NaN;
};

const calculateUnipoolApy = async (entry) => {
  const totalSupply = BigNumber(entry.totalSupply);
  const rewardRate = BigNumber(entry.rewardRate);

  const apr = totalSupply.isZero()
    ? 0
    : rewardRate.div(totalSupply).times(secsInOneYear).times('100');

  return apr;
};

const buildBalancerPool = async (entry, chainString) => {
  const symbol = entry?.tokens
    ? `${entry?.tokens[0]?.symbol}-${entry?.tokens[1]?.symbol}`
    : 'GIV';

  const newObj = {
    pool: entry.id,
    chain: utils.formatChain(chainString),
    project: 'giveth',
    symbol: symbol,
    tvlUsd: Number(entry.reserveUSD), // number representing current USD TVL in pool
    apy: Number(entry.apy), // current APY of the pool in %
  };

  return newObj;
};

const buildPool = async (entry, chainString) => {
  const symbol = entry?.token0
    ? `${entry.token0.symbol}-${entry.token1.symbol}`
    : 'GIV';

  const newObj = {
    pool: entry.id,
    chain: utils.formatChain(chainString),
    project: 'giveth',
    symbol: symbol,
    tvlUsd: Number(entry.reserveUSD), // number representing current USD TVL in pool
    apy: Number(entry.apy), // current APY of the pool in %
  };

  return newObj;
};

const balancerTopLvlMain = async (poolId) => {
  const chainString = 'ethereum';
  let data;
  let farmData = await request(
    urlBalancer,
    balancerPairQuery.replace('<PLACEHOLDER>', poolId)
  );
  farmData = farmData.pool;
  let contractInfo = await request(
    urlGivEconomyMainnet,
    unipoolContractInfoQuery.replace('<PLACEHOLDER>', givEthBalancerAddress)
  );
  contractInfo = contractInfo.unipool;
  farmData['reserveUSD'] = await calculateUnipoolTvl(
    chainString,
    farmData.totalShares
  );
  farmData['apy'] = await balancerCalculatePoolApy(
    chainString,
    farmData,
    contractInfo
  );
  console.log({ farmData, contractInfo });

  data = buildBalancerPool(farmData, chainString);

  return data;
};

const topLvl = async (
  chainString,
  poolUrl,
  poolQuery,
  poolAddress,
  contractInfoUrl,
  contractInfoQuery,
  contractInfoAddress
) => {
  let data;
  if (poolUrl) {
    // Pair
    let farmData = await request(
      poolUrl,
      poolQuery.replace('<PLACEHOLDER>', poolAddress)
    );
    farmData = farmData.pair;
    const contractInfo = await request(
      contractInfoUrl,
      contractInfoQuery.replace('<PLACEHOLDER>', contractInfoAddress)
    );
    farmData['apy'] = await calculatePairApy(
      chainString,
      farmData,
      contractInfo.unipool
    );
    data = buildPool(farmData, chainString);
  } else {
    // Unipool
    let farmData = await request(
      contractInfoUrl,
      contractInfoQuery.replace('<PLACEHOLDER>', contractInfoAddress)
    );
    farmData = farmData.unipool;
    farmData['reserveUSD'] = await calculateUnipoolTvl(
      chainString,
      farmData.totalSupply
    );
    farmData['apy'] = await calculateUnipoolApy(farmData);

    data = buildPool(farmData, chainString);
  }

  return data;
};

const main = async () => {
  let data = await Promise.all([
    // ETH Mainnet
    topLvl(
      'ethereum',
      null,
      tokenPairPoolQuery,
      null,
      urlGivEconomyMainnet,
      unipoolContractInfoQuery,
      givMainnetContractInfo
    ),
    topLvl(
      'ethereum',
      urlUniswapV2,
      tokenPairPoolQuery,
      givDaiPairMainnetAddress,
      urlGivEconomyMainnet,
      unipoolContractInfoQuery,
      givDaiPairUnipoolContractInfo
    ),
    balancerTopLvlMain(givEthBalancerPoolId),
  ]);

  return data;
};

module.exports = {
  timetravel: true,
  apy: main,
  url: 'https://giveth.io/givfarm',
};
