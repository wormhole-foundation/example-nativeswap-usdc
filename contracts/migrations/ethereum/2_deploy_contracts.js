const fsp = require("fs/promises");

const CrossChainSwapV3 = artifacts.require("CrossChainSwapV3");

const scriptsAddressPath = "../react/src/addresses";

module.exports = async function (deployer, network) {
  const routerAddress = "0xE592427A0AEce92De3Edee1F18E0157C05861564"; // Uniswap
  const wormholeAddress = "0x706abc4E45D419950511e474C7B9Ed348A4a716c";
  const usdcIntegrationAddress = "0xdbedb4ebd098e9f1777af9f8088e794d381309d1";
  const usdcAddress = "0x07865c6E87B9F70255377e024ace6630C1Eaa37F";
  const wrappedEthAddress = "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6";

  await deployer.deploy(
    CrossChainSwapV3,
    routerAddress,
    wormholeAddress,
    usdcIntegrationAddress,
    usdcAddress,
    wrappedEthAddress
  );

  // save the contract address somewhere
  await fsp.mkdir(scriptsAddressPath, {recursive: true});

  await fsp.writeFile(
    `${scriptsAddressPath}/goerli.ts`,
    `export const SWAP_CONTRACT_ADDRESS = '${CrossChainSwapV3.address}';`
  );

  //deployer.link(ConvertLib, MetaCoin);
  //deployer.deploy(MetaCoin);
};
