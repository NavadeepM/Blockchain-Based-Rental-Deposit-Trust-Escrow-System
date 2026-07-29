import { BrowserProvider, Contract, parseEther } from "ethers";
import escrowAbi from "../abi/RentalEscrow.json";

const CONTRACT_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS;
const EXPECTED_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || 11155111);

/** Connects to MetaMask (or any EIP-1193 wallet) and returns the signer's address. */
export async function connectWallet() {
  if (!window.ethereum) throw new Error("No Ethereum wallet found. Please install MetaMask.");

  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    await switchToExpectedChain();
  }

  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  return { provider, signer, address };
}

async function switchToExpectedChain() {
  const hexChainId = "0x" + EXPECTED_CHAIN_ID.toString(16);
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
  } catch (err) {
    if (err.code === 4902) {
      throw new Error(
        `Please add ${import.meta.env.VITE_CHAIN_NAME || "the configured network"} to your wallet first.`
      );
    }
    throw err;
  }
}

async function getContract(signerOrProvider) {
  if (!CONTRACT_ADDRESS) throw new Error("VITE_ESCROW_CONTRACT_ADDRESS is not set");
  return new Contract(CONTRACT_ADDRESS, escrowAbi, signerOrProvider);
}

/** Landlord: creates the on-chain agreement shell. Returns { onChainId, txHash }. */
export async function createAgreementOnChain(signer, { tenant, arbitrator, depositWei, rentalEndsAtUnix, disputeWindowSeconds }) {
  const contract = await getContract(signer);
  const tx = await contract.createAgreement(tenant, arbitrator, depositWei, rentalEndsAtUnix, disputeWindowSeconds);
  const receipt = await tx.wait();

  const event = receipt.logs
    .map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "AgreementCreated");

  return { onChainId: Number(event.args.id), txHash: receipt.hash };
}

/** Tenant: locks the deposit into escrow. */
export async function fundDepositOnChain(signer, onChainId, depositWei) {
  const contract = await getContract(signer);
  const tx = await contract.fundDeposit(onChainId, { value: depositWei });
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Either party: 2-of-2 signoff to release funds without a dispute. */
export async function confirmCompletionOnChain(signer, onChainId) {
  const contract = await getContract(signer);
  const tx = await contract.confirmCompletion(onChainId);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Anyone: triggers auto-release once the dispute window has elapsed. */
export async function autoReleaseOnChain(signer, onChainId) {
  const contract = await getContract(signer);
  const tx = await contract.autoReleaseAfterWindow(onChainId);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Either party: raises a dispute with the IPFS-anchored evidence hash. */
export async function raiseDisputeOnChain(signer, onChainId, evidenceHash, evidenceURI) {
  const contract = await getContract(signer);
  const tx = await contract.raiseDispute(onChainId, evidenceHash, evidenceURI);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/** Read-only: fetches the current on-chain state of an agreement. */
export async function fetchAgreementOnChain(provider, onChainId) {
  const contract = await getContract(provider);
  return contract.getAgreement(onChainId);
}

export { parseEther };
