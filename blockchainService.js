const { ethers } = require("ethers");
const path = require("path");

let escrowArtifact;
try {
  escrowArtifact = require(path.join(
    __dirname,
    "../../contracts/artifacts/contracts/RentalEscrow.sol/RentalEscrow.json"
  ));
} catch (e) {
  console.warn("[blockchainService] Contract artifact not found. Run `npm run compile` in /contracts first.");
}

function getProvider() {
  return new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
}

/** Signer used by the PLATFORM (e.g. relaying a landlord's createAgreement call
 *  if the platform is sponsoring gas, or for the arbitrator's resolveDispute call). */
function getArbitratorSigner() {
  const provider = getProvider();
  return new ethers.Wallet(process.env.PLATFORM_ARBITRATOR_PRIVATE_KEY, provider);
}

function getEscrowContract(signerOrProvider) {
  if (!escrowArtifact) throw new Error("Escrow ABI not loaded - compile the contract first.");
  return new ethers.Contract(
    process.env.ESCROW_CONTRACT_ADDRESS,
    escrowArtifact.abi,
    signerOrProvider || getProvider()
  );
}

/** Converts an INR deposit amount into wei using the configured ETH/INR rate.
 *  In production this would hit a live price oracle/Chainlink feed instead
 *  of an env var. */
function inrToWei(amountINR) {
  const rate = Number(process.env.ETH_INR_RATE || 250000); // INR per 1 ETH
  const ethAmount = amountINR / rate;
  return ethers.parseEther(ethAmount.toFixed(18));
}

function weiToINR(weiAmount) {
  const rate = Number(process.env.ETH_INR_RATE || 250000);
  const ethAmount = Number(ethers.formatEther(weiAmount));
  return Math.round(ethAmount * rate);
}

/** Arbitrator resolves a dispute on-chain per an off-chain decision
 *  (human reviewer or a future ML/rules-based auto-arbitration model). */
async function resolveDisputeOnChain(onChainId, landlordSharePctBasisPoints) {
  const signer = getArbitratorSigner();
  const contract = getEscrowContract(signer);
  const tx = await contract.resolveDispute(onChainId, landlordSharePctBasisPoints);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

async function getAgreementOnChain(onChainId) {
  const contract = getEscrowContract();
  return contract.getAgreement(onChainId);
}

/** keccak256 hash of a canonical evidence bundle (used for tamper-proof
 *  on-chain anchoring; the actual files live in IPFS/cloud storage). */
function hashEvidenceBundle(bundle) {
  const canonical = JSON.stringify(bundle, Object.keys(bundle).sort());
  return ethers.keccak256(ethers.toUtf8Bytes(canonical));
}

module.exports = {
  getProvider,
  getArbitratorSigner,
  getEscrowContract,
  inrToWei,
  weiToINR,
  resolveDisputeOnChain,
  getAgreementOnChain,
  hashEvidenceBundle,
};
