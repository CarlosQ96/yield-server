const { request, gql } = require('graphql-request');
const utils = require('../utils');
const fetch = require('node-fetch');
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
const urlIchi = 'https://api.ichi.org/v1/farms/20009';

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

// ICHI Angel Vault
const oneGivPairUnipoolContractInfo =
  '0xa4b727df6fd608d1835e3440288c73fb28c4ef16';

const defiLlamaGivId = `ethereum:${givTokenMainnetAddress}`;

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

const getPrices = async (tokens = []) => {
  const idsSet = [defiLlamaGivId, ...tokens];
  let prices = await utils.getData('https://coins.llama.fi/prices', {
    coins: idsSet,
  });
  return prices.coins;
};

const balancerCalculatePoolApy = async (chainString, entry, contractInfo) => {
  const givTokenAddress =
    chainString === 'ethereum' ? givTokenMainnetAddress : givTokenGnosisAddress;

  const weights = [entry.tokens[0].weight, entry.tokens[1].weight].map(
    toBigNumberJs
  );
  const balances = [entry.tokens[0].balance, entry.tokens[1].balance].map(
    toBigNumberJs
  );

  if (entry.tokens[0].address.toLowerCase() !== givTokenAddress) {
    balances.reverse();
    weights.reverse();
  }

  const lp = BigNumber(entry.totalShares)
    .div(BigNumber.sum(...weights).div(weights[0]))
    .div(balances[0]);

  const totalSupply = BigNumber(contractInfo.totalSupply);
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
  const prices = await getPrices([]);
  const price = prices[defiLlamaGivId]?.price;
  const tvl = BigNumber(totalSupply) * price;
  return tvl;
};

const calculateBalancerTvl = async (chainString, tokens) => {
  const givTokenAddress =
    chainString === 'ethereum' ? givTokenMainnetAddress : givTokenGnosisAddress;
  let token1Address = tokens[1].address.toLowerCase();
  if (tokens[0].address.toLowerCase() !== givTokenAddress) {
    token1Address = tokens[0].address.toLowerCase();
  }
  const defiLlamaWethId = `${chainString}:${token1Address}`;
  const givSupply = tokens.find((i) => i.symbol === 'GIV').balance;
  const wethSupply = tokens.find((i) => i.symbol === 'WETH').balance;

  const prices = await getPrices([defiLlamaWethId], chainString);
  const givPrice = prices[defiLlamaGivId]?.price;
  const wethPrice = prices[defiLlamaWethId]?.price;
  const tvl =
    BigNumber(givSupply) * givPrice + BigNumber(wethSupply) * wethPrice;
  return tvl;
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

const buildPool = async (entry, chainString, customName) => {
  const symbol = customName
    ? customName
    : entry?.token0
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

const balancerTopLvlGivWeth = async () => {
  const poolId = givEthBalancerPoolId;
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
  farmData['reserveUSD'] = await calculateBalancerTvl(
    chainString,
    farmData.tokens
  );
  farmData['apy'] = await balancerCalculatePoolApy(
    chainString,
    farmData,
    contractInfo
  );

  data = buildBalancerPool(farmData, chainString);

  return data;
};

const topLvlIchi = async (
  chainString,
  contractInfoUrl,
  contractInfoQuery,
  contractInfoAddress
) => {
  let data;
  let farmData = await fetch(urlIchi).then((res) => res.json());
  let contractInfo = await request(
    contractInfoUrl,
    contractInfoQuery.replace('<PLACEHOLDER>', contractInfoAddress)
  );

  contractInfo = contractInfo.unipool;
  const defiLlamaGivId = `${chainString}:${givTokenMainnetAddress}`;

  const prices = await getPrices([], chainString);

  const givTokenPrice = prices[defiLlamaGivId]?.price;
  const totalSupply = BigNumber(contractInfo.totalSupply);
  const rewardRate = BigNumber(contractInfo.rewardRate);
  const lpPrice = BigNumber(farmData.lpPrice);
  const vaultIRR = BigNumber(farmData.vaultIRR);

  const totalAPR = rewardRate
    .div(totalSupply)
    .times(givTokenPrice)
    .div(lpPrice)
    .times(secsInOneYear)
    .times('100')
    .plus(vaultIRR);
  farmData['apy'] = totalAPR;
  farmData['id'] = farmData.lpAddress;
  farmData['reserveUSD'] = farmData.tvl;
  data = buildPool(farmData, chainString, 'oneGIV-GIV');
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
    topLvlIchi(
      'ethereum',
      urlGivEconomyMainnet,
      unipoolContractInfoQuery,
      oneGivPairUnipoolContractInfo
    ),
    balancerTopLvlGivWeth(),
  ]);

  return data;
};

module.exports = {
  timetravel: true,
  apy: main,
  url: 'https://giveth.io/givfarm',
};
