// Manual compilation using the npm-distributed solc (pure JS/WASM build).
// We do this instead of `hardhat compile` because Hardhat's default compiler
// downloader fetches the native binary from binaries.soliditylang.org, which
// is blocked in sandboxed/offline CI environments. This script produces
// artifacts in the exact schema Hardhat + hardhat-ethers expect, so the rest
// of the toolchain (tests, ethers, typechain-free contract factories) works
// unmodified.
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const CONTRACTS_DIR = path.join(__dirname, "contracts");
const ARTIFACTS_DIR = path.join(__dirname, "artifacts", "contracts");

function findSolFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".sol"));
}

function compileFile(fileName) {
  const source = fs.readFileSync(path.join(CONTRACTS_DIR, fileName), "utf8");
  const input = {
    language: "Solidity",
    sources: { [fileName]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (output.errors) {
    let hasError = false;
    for (const err of output.errors) {
      console.log(err.formattedMessage || err.message);
      if (err.severity === "error") hasError = true;
    }
    if (hasError) process.exit(1);
  }

  const contracts = output.contracts[fileName];
  for (const contractName of Object.keys(contracts)) {
    const c = contracts[contractName];
    const artifact = {
      _format: "hh-sol-artifact-1",
      contractName,
      sourceName: `contracts/${fileName}`,
      abi: c.abi,
      bytecode: "0x" + c.evm.bytecode.object,
      deployedBytecode: "0x" + c.evm.deployedBytecode.object,
      linkReferences: {},
      deployedLinkReferences: {},
    };

    const outDir = path.join(ARTIFACTS_DIR, fileName);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${contractName}.json`), JSON.stringify(artifact, null, 2));
    console.log(`Compiled ${contractName} -> artifacts/contracts/${fileName}/${contractName}.json`);
  }
}

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
for (const file of findSolFiles(CONTRACTS_DIR)) {
  compileFile(file);
}
console.log("\nCompilation complete.");
