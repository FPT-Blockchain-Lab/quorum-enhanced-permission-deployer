const Web3 = require('web3');
const Tx = require("ethereumjs-tx").Transaction;
const ethereumjs_common = require ('ethereumjs-common').default;
const path = require('path');
const fs = require('fs-extra');

const web3 = new Web3(process.env.RPC_URL);
const privateKey = process.env.ACCOUNT_PRIVATE_KEY.substring(2);
const account = web3.eth.accounts.privateKeyToAccount(privateKey);

function getAbi(contractName) {
  let contractAbiPath = path.resolve(__dirname, `${contractName}.abi`);
  return JSON.parse(fs.readFileSync(contractAbiPath));
}

function getBytecode(contractName) {
  let contractBinPath = path.resolve(__dirname, `${contractName}.bin`);
  return '0x' + fs.readFileSync(contractBinPath);
}

async function sendSignedTransaction(txOptions) {
  let txnCount = await web3.eth.getTransactionCount(account.address);
  let rawTxOptions = {
    nonce: web3.utils.numberToHex(txnCount),
    from: account,
    to: null, // public tx
    value: "0x00",
    data: '', // contract binary appended with initialization value
    gasPrice: "0x0", // Set to 0 in GoQuorum networks
    gasLimit: "0x47b7600", // max number of gas units the tx is allowed to use
    ...txOptions
  }
  let common = ethereumjs_common.forCustomChain ('mainnet', { networkId: parseInt(process.env.NETWORK_ID), chainId: parseInt(process.env.NETWORK_ID), name: 'fpt-lab' }, 'istanbul');
  let tx = new Tx(rawTxOptions, { common: common });

  tx.sign(Buffer.from(privateKey, 'hex'));
  return await web3.eth.sendSignedTransaction('0x' + tx.serialize().toString('hex').toString("hex"));
}

async function deployContract(contractName, initData){
  let bContract =  new web3.eth.Contract(getAbi(contractName));
  let hexdata = bContract.deploy({
    data: getBytecode(contractName),
    arguments: initData,
  }).encodeABI();

  console.log("Creating transaction...");
  let tx = await sendSignedTransaction({ data: hexdata });
  console.log(`Deployed contract ${contractName}: ${tx.contractAddress}`);
  return tx;
}

async function initUpgradableContract(txs) {
  let contractInstance = await new web3.eth.Contract(getAbi('PermissionsUpgradable'))
  let hexdata = contractInstance.methods.init(txs.permissionsInterface.contractAddress, txs.permissionsImplementation.contractAddress).encodeABI();
  console.log("Creating transaction...");
  let tx = await sendSignedTransaction({ to: txs.permissionUpgradable.contractAddress, data: hexdata });
  console.log('Success call contract PermissionsUpgradable init.')
  console.log(tx);
}

function exportPermissionConfig(txs) {
  let data = {
    "permissionModel": "v2",
    "upgradableAddress": txs.permissionUpgradable.contractAddress,
    "interfaceAddress": txs.permissionsInterface.contractAddress,
    "implAddress": txs.permissionsImplementation.contractAddress,
    "nodeMgrAddress": txs.nodeManager.contractAddress,
    "accountMgrAddress": txs.accountManager.contractAddress,
    "roleMgrAddress": txs.roleManager.contractAddress,
    "voterMgrAddress": txs.voterManager.contractAddress,
    "orgMgrAddress" : txs.orgManager.contractAddress,
    "nwAdminOrg": "ADMINORG",
    "nwAdminRole" : "ADMIN",
    "orgAdminRole" : "ORGADMIN",
    "accounts":[account.address],
    "subOrgBreadth" : 4,
    "subOrgDepth" : 4
  }

  fs.writeFile('permission-config.json', JSON.stringify(data), 'utf8', (err) => {
    if (err) throw err;
    console.log('Data written to file: ' + path.resolve(__dirname, 'permission-config.json'));
  });
}

async function main() {
  var txs = {};

  txs.permissionUpgradable = await deployContract('PermissionsUpgradable', [account.address]);
  if (txs.permissionUpgradable.contractAddress) {
    txs.accountManager = await deployContract('AccountManager', [txs.permissionUpgradable.contractAddress]);
    txs.nodeManager = await deployContract('NodeManager', [txs.permissionUpgradable.contractAddress]);
    txs.orgManager = await deployContract('OrgManager', [txs.permissionUpgradable.contractAddress]);
    txs.permissionsInterface = await deployContract('PermissionsInterface', [txs.permissionUpgradable.contractAddress]);
    txs.roleManager = await deployContract('RoleManager', [txs.permissionUpgradable.contractAddress]);
    txs.voterManager = await deployContract('VoterManager', [txs.permissionUpgradable.contractAddress]);
    txs.permissionsImplementation = await deployContract('PermissionsImplementation', [
      txs.permissionUpgradable.contractAddress,
      txs.orgManager.contractAddress,
      txs.roleManager.contractAddress,
      txs.accountManager.contractAddress,
      txs.voterManager.contractAddress,
      txs.nodeManager.contractAddress
    ]);

    initUpgradableContract(txs);
    exportPermissionConfig(txs);
  } else {
    console.log("Couldn't deploy PermissionsUpgradable contract");
  }
}

main();
