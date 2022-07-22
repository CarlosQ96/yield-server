const { request, gql } = require('graphql-request');
const utils = require('../utils');
const { default: BigNumber } = require('bignumber.js');

const urlUniswapV2 = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2'
const urlHoneyswapV2 = 'https://api.thegraph.com/subgraphs/name/1hive/honeyswap-v2';
const urlGivEconomyMainnet = 'https://api.thegraph.com/subgraphs/name/giveth/giveth-economy-mainnet'
const urlGivEconomyGnosis = 'https://api.thegraph.com/subgraphs/name/giveth/giveth-economy-xdai';

// GIV Token
const givTokenMainnetAddress = '0x900db999074d9277c5da2a43f252d74366230da0';
const givTokenGnosisAddress = '0x4f4f9b8d5b4d0dc10506e5551b0513b61fd59e75';

// GIV 100% UNIPOOL LM
const givMainnetContractInfo = '0x4b9efae862a1755f7cecb021856d467e86976755';
const givGnosisContractInfo = '0xd93d3bdba18ebcb3317a57119ea44ed2cf41c2f2';

// Giv - Dai Mainnet LP
const givDaiPairMainnetAddress = '0xbeba1666c62c65e58770376de332891b09461eeb';
const givDaiPairUnipoolContractInfo = '0xa4523d703f663615bd41606b46b58deb2f926d98';

// Giv - Xdai Gnosis LP
const givDaiPairGnosisAddress = '0xb7189a7ea38fa31210a79fe282aec5736ad5fa57';
const givDaiPairGnosisUnipoolContractInfo = '0x24a6067fed46dc8663794c4d39ec91b074cf85d4';

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

const unipoolContractInfoQuery = gql`
  {
    unipoolContractInfo(id: "<PLACEHOLDER>" ) {
      id
      totalSupply
      rewardRate
    }
  }
`;

const calculatePairApy = async (chainString, entry, contractInfo) => {
  const givTokenAddress = chainString === 'ethereum' ? givTokenMainnetAddress : givTokenGnosisAddress;

  const tokenReserve = BigNumber(
    entry.token0.id.toLowerCase() !== givTokenAddress
      ? entry.reserve1
      : entry.reserve0,
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
        .times('31536000')
        .times('100')
        .times(lp)
        .div(10 ** 18);

  return apr;
}

const calculateUnipoolTvl = async (chainString, entry) => {
  const givTokenAddress = chainString === 'ethereum' ? givTokenMainnetAddress : givTokenGnosisAddress;

  // DefiLlama price api
  const defiLlamaGivId = `${chainString}:${givTokenAddress}`;
  const idsSet = [defiLlamaGivId];
  let prices = await utils.getData('https://coins.llama.fi/prices', {
    coins: idsSet,
  });
  prices = prices.coins;
  const price = prices[defiLlamaGivId]?.price;

  const tvl = BigNumber(entry.totalSupply) * price;

  return tvl;
}

const calculateUnipoolApy = async (entry) => {
  const totalSupply = BigNumber(entry.totalSupply);
  const rewardRate = BigNumber(entry.rewardRate);

  const apr = totalSupply.isZero()
    ? 0
    : rewardRate.div(totalSupply).times('31536000').times('100');

  return apr;
}

const buildPool = async (entry, chainString) => {
  const symbol = entry?.token0 ?
    `${entry.token0.symbol}-${entry.token1.symbol}` : 'GIV';

  const newObj = {
    pool: entry.id,
    chain: utils.formatChain(chainString),
    project: 'giveth',
    symbol: symbol,
    tvlUsd: Number(entry.reserveUSD), // number representing current USD TVL in pool
    apy: Number(entry.apy), // current APY of the pool in %
  };

  return newObj;
}

const topLvl = async (
  chainString,
  poolUrl,
  poolQuery,
  poolAddress,
  contractInfoUrl,
  contractInfoQuery,
  contractInfoAddress,
) => {
  let data;
  if (poolUrl) { // Pair
    let farmData = await request(poolUrl, poolQuery.replace('<PLACEHOLDER>', poolAddress));
    farmData = farmData.pair;

    const contractInfo = (await request(contractInfoUrl, contractInfoQuery.replace('<PLACEHOLDER>', contractInfoAddress))).unipoolContractInfo;

    farmData['apy'] = await calculatePairApy(chainString, farmData, contractInfo);
    data = buildPool(farmData, chainString);
  } else { // Unipool
    const farmData = (await request(contractInfoUrl, contractInfoQuery.replace('<PLACEHOLDER>', contractInfoAddress))).unipoolContractInfo;

    farmData['reserveUSD'] = await calculateUnipoolTvl(chainString, farmData);
    farmData['apy'] = await calculateUnipoolApy(farmData);

    data = buildPool(farmData, chainString);
  }

  return data;
}

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
    // // Gnosis
    topLvl(
      'xdai',
      urlHoneyswapV2,
      tokenPairPoolQuery,
      givDaiPairGnosisAddress,
      urlGivEconomyGnosis,
      unipoolContractInfoQuery,
      givDaiPairGnosisUnipoolContractInfo,
    ),
    topLvl(
      'xdai',
      null,
      tokenPairPoolQuery,
      null,
      urlGivEconomyGnosis,
      unipoolContractInfoQuery,
      givGnosisContractInfo
    ),
  ]);

  return data;
}

module.exports = {
  timetravel: true,
  apy: main,
};