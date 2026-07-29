const crypto = require("crypto");

// ipfs-http-client ships as an ESM-only package, so it must be loaded via a
// dynamic import even from this CommonJS file. We cache the client per
// process since `create()` is cheap but importing repeatedly is wasteful.
let _clientPromise = null;
async function getClient() {
  if (!_clientPromise) {
    _clientPromise = import("ipfs-http-client").then(({ create }) => {
      const auth =
        "Basic " +
        Buffer.from(`${process.env.IPFS_PROJECT_ID}:${process.env.IPFS_PROJECT_SECRET}`).toString("base64");

      return create({
        url: process.env.IPFS_API_URL,
        headers: { authorization: auth },
      });
    });
  }
  return _clientPromise;
}

/**
 * Uploads a buffer (photo, PDF condition report, etc.) to IPFS and returns
 * the CID + a sha256 hash of the raw bytes for an extra local integrity
 * check (the on-chain hash is keccak256 over the *bundle metadata*, defined
 * in blockchainService.hashEvidenceBundle).
 */
async function uploadEvidenceFile(buffer, filename) {
  const client = await getClient();
  const { cid } = await client.add({ path: filename, content: buffer });
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  return {
    cid: cid.toString(),
    uri: `ipfs://${cid.toString()}`,
    gatewayUrl: `https://ipfs.io/ipfs/${cid.toString()}`,
    sha256,
  };
}

/** Bundles multiple evidence files + a text condition report into a single
 *  JSON manifest, uploads that manifest to IPFS too, and returns everything
 *  needed to raise/counter a dispute on-chain. */
async function buildEvidenceBundle({ files, conditionReport, submittedBy }) {
  const client = await getClient();
  const uploadedFiles = [];
  for (const f of files) {
    const uploaded = await uploadEvidenceFile(f.buffer, f.originalname);
    uploadedFiles.push({ filename: f.originalname, ...uploaded });
  }

  const manifest = {
    submittedBy,
    submittedAt: new Date().toISOString(),
    conditionReport,
    files: uploadedFiles,
  };

  const manifestBuffer = Buffer.from(JSON.stringify(manifest));
  const { cid } = await client.add({ path: "manifest.json", content: manifestBuffer });

  return {
    manifestCID: cid.toString(),
    manifestURI: `ipfs://${cid.toString()}`,
    manifest,
  };
}

module.exports = { uploadEvidenceFile, buildEvidenceBundle };
