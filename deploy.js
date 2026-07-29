const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying RentalEscrow with account:", deployer.address);

  const Escrow = await hre.ethers.getContractFactory("RentalEscrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("RentalEscrow deployed to:", address);

  // Write address + ABI to backend/frontend so they can pick it up automatically.
  const artifact = require("../artifacts/contracts/RentalEscrow.sol/RentalEscrow.json");
  const deploymentInfo = {
    address,
    network: hre.network.name,
    deployedAt: new Date().toISOString(),
    abi: artifact.abi,
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${hre.network.name}.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log(`Deployment info written to deployments/${hre.network.name}.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
