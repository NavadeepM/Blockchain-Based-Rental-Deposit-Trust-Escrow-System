const express = require("express");
const multer = require("multer");
const router = express.Router();

const Agreement = require("../models/Agreement");
const { requireAuth, requireProfile } = require("../middleware/authMiddleware");
const ipfsService = require("../services/ipfsService");
const blockchain = require("../services/blockchainService");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

/**
 * POST /api/dispute/:agreementId/raise
 * Party uploads evidence photos + a condition report. Files go to IPFS;
 * the resulting manifest CID + a keccak256 hash of the manifest are
 * returned so the frontend can call `raiseDispute(id, hash, uri)` on-chain
 * with the connected wallet (backend never signs on behalf of a party here,
 * to keep custody of the dispute action with the actual user).
 */
router.post("/:agreementId/raise", requireAuth, requireProfile, upload.array("evidence", 10), async (req, res) => {
  const agreement = await Agreement.findById(req.params.agreementId);
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });

  const isLandlord = String(agreement.landlord) === String(req.user._id);
  const isTenant = String(agreement.tenant) === String(req.user._id);
  if (!isLandlord && !isTenant) return res.status(403).json({ error: "Not a party to this agreement" });

  const { conditionReport, reason } = req.body;

  const { manifestCID, manifestURI, manifest } = await ipfsService.buildEvidenceBundle({
    files: req.files || [],
    conditionReport,
    submittedBy: req.user._id.toString(),
  });

  const evidenceHash = blockchain.hashEvidenceBundle(manifest);

  agreement.status = "disputed";
  agreement.dispute.raisedBy = req.user._id;
  agreement.dispute.reason = reason;
  if (isLandlord) {
    agreement.dispute.landlordEvidenceHash = evidenceHash;
    agreement.dispute.landlordEvidenceCID = manifestCID;
  } else {
    agreement.dispute.tenantEvidenceHash = evidenceHash;
    agreement.dispute.tenantEvidenceCID = manifestCID;
  }
  await agreement.save();

  res.json({
    message: "Evidence pinned to IPFS. Sign raiseDispute() on-chain with this hash + URI.",
    evidenceHash,
    manifestURI,
    agreement,
  });
});

/** POST /api/dispute/:agreementId/counter-evidence - other party responds */
router.post("/:agreementId/counter-evidence", requireAuth, requireProfile, upload.array("evidence", 10), async (req, res) => {
  const agreement = await Agreement.findById(req.params.agreementId);
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });
  if (agreement.status !== "disputed") return res.status(400).json({ error: "No active dispute" });

  const isLandlord = String(agreement.landlord) === String(req.user._id);
  const isTenant = String(agreement.tenant) === String(req.user._id);
  if (!isLandlord && !isTenant) return res.status(403).json({ error: "Not a party to this agreement" });

  const { conditionReport } = req.body;
  const { manifestCID, manifestURI, manifest } = await ipfsService.buildEvidenceBundle({
    files: req.files || [],
    conditionReport,
    submittedBy: req.user._id.toString(),
  });
  const evidenceHash = blockchain.hashEvidenceBundle(manifest);

  if (isLandlord) {
    agreement.dispute.landlordEvidenceHash = evidenceHash;
    agreement.dispute.landlordEvidenceCID = manifestCID;
  } else {
    agreement.dispute.tenantEvidenceHash = evidenceHash;
    agreement.dispute.tenantEvidenceCID = manifestCID;
  }
  await agreement.save();

  res.json({ evidenceHash, manifestURI, agreement });
});

/**
 * POST /api/dispute/:agreementId/resolve
 * Arbitrator (platform admin / DAO multisig signer) reviews both evidence
 * bundles off-chain and submits a verdict as landlordSharePct (0-10000 bps).
 * The backend relays this to resolveDispute() using the platform arbitrator
 * key, then mirrors the result into Mongo + triggers the Razorpay split refund.
 */
router.post("/:agreementId/resolve", requireAuth, requireProfile, async (req, res) => {
  const { landlordSharePct, arbitratorNote } = req.body;
  if (landlordSharePct < 0 || landlordSharePct > 10000) {
    return res.status(400).json({ error: "landlordSharePct must be between 0 and 10000 basis points" });
  }

  const agreement = await Agreement.findById(req.params.agreementId);
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });
  if (agreement.status !== "disputed") return res.status(400).json({ error: "No active dispute" });

  // TODO in production: restrict this route to users with an "arbitrator" role.
  const { txHash } = await blockchain.resolveDisputeOnChain(agreement.onChainId, landlordSharePct);

  agreement.status = "resolved";
  agreement.txHashResolved = txHash;
  agreement.dispute.landlordSharePct = landlordSharePct;
  agreement.dispute.arbitratorNote = arbitratorNote;
  agreement.dispute.resolvedAt = new Date();

  const landlordINR = Math.round((agreement.depositAmountINR * landlordSharePct) / 10000);
  const tenantINR = agreement.depositAmountINR - landlordINR;

  await agreement.save();

  res.json({
    message: "Dispute resolved on-chain.",
    txHash,
    split: { landlordINR, tenantINR },
    agreement,
  });
});

module.exports = router;
