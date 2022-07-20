const { request, gql } = require('graphql-request');
const utils = require('../utils');
const { default: BigNumber } = require('bignumber.js');

const baseUrl = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2'
const givUnipoolTokenDistributorUrl = 'https://api.thegraph.com/subgraphs/name/aminlatifi/giveth-economy-xdai'

const givTokenAddress = '0x900db999074d9277c5da2a43f252d74366230da0'

const uniV2DaiGivQuery = gql`
  {
    pair(id: "0xbeba1666c62c65e58770376de332891b09461eeb") {
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

// first one is GIV LM token distributor
const givLMUnipoolTokenDistributor = gql`
  {
    unipoolContractInfos(first: 1) {
      id
      rewardRate
      totalSupply
    }
  }
`;

const fetchFarmData = async (
  chainString,
  url,
  query,
  version
) => {
  let farmData = await request(url, query);
  farmData = farmData.pair;

  const rewardRates = (await request(givUnipoolTokenDistributorUrl, givLMUnipoolTokenDistributor)).unipoolContractInfos;

  farmData['apy'] = await calculateApy(farmData, rewardRates);

  const data = buildFarmObj(farmData, version, chainString);

  return data;
}

const calculateApy = async (entry, rewardRatesEntry) => {
  const tokenReserve = BigNumber(
    entry.token0.id.toLowerCase() !== givTokenAddress
      ? entry.reserve1
      : entry.reserve0,
  );

  const lp = BigNumber(entry.totalSupply)
    .times(10 ** 18)
    .div(2)
    .div(tokenReserve);

  const totalSupply = BigNumber(rewardRatesEntry[0].totalSupply);

  const apr = totalSupply.isZero()
    ? null
    : BigNumber(rewardRatesEntry[0].rewardRate)
        .div(totalSupply)
        .times('31536000')
        .times('100')
        .times(lp)
        .div(10 ** 18);

  return apr;
}


const buildFarmObj = async (entry, version, chainString) => {
  const symbol = utils.formatSymbol(
    `${entry.token0.symbol}-${entry.token1.symbol}`
  );

  const newObj = {
    pool: entry.id,
    chain: utils.formatChain(chainString),
    project: 'uniswap',
    market: version,
    symbol: symbol,
    tvlUsd: Number(entry.reserveUSD),
    apy: Number(entry.apy),
  };

  return newObj;
}

const main = async () => {
  let data = await Promise.all([
    fetchFarmData('ethereum', baseUrl, uniV2DaiGivQuery, 'v2')
  ]);

  return data;
}

module.exports = {
  timetravel: true,
  apy: main,
};