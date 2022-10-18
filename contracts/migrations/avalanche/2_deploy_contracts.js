const fsp = require("fs/promises");

const CrossChainSwapV2 = artifacts.require("CrossChainSwapV2");

const scriptsAddressPath = "../react/src/addresses";

module.exports = async function (deployer, network) {
  const routerAddress = "0x7e3411b04766089cfaa52db688855356a12f05d1"; // hurricaneswap router
  const wormholeAddress = "0x7bbcE28e64B3F8b84d876Ab298393c38ad7aac4C";
  const usdcIntegrationAddress = "0x3e6a4543165aaecbf7ffc81e54a1c7939cb12cb8";
  const usdcAddress = "0x5425890298aed601595a70AB815c96711a31Bc65";
  const wrappedAvaxAddress = "0xd00ae08403B9bbb9124bB305C09058E32C39A48c";

  await deployer.deploy(
    CrossChainSwapV2,
    routerAddress,
    wormholeAddress,
    usdcIntegrationAddress,
    usdcAddress,
    wrappedAvaxAddress
  );

  // save the contract address somewhere
  await fsp.mkdir(scriptsAddressPath, {recursive: true});

  await fsp.writeFile(
    `${scriptsAddressPath}/${network}.ts`,
    `export const SWAP_CONTRACT_ADDRESS = '${CrossChainSwapV2.address}';`
  );

  //deployer.link(ConvertLib, MetaCoin);
  //deployer.deploy(MetaCoin);
};
