const express = require("express");
const { body, validationResult } = require("express-validator");
const router = express.Router();

const Agreement = require("../models/Agreement");
const User = require("../models/User");
const { requireAuth, requireProfile, requireVerifiedKYC } = require("../middleware/authMiddleware");
const blockchain = require("../services/blockchainService");

/**
 * POST /api/escrow/agreements
 * Landlord drafts a new rental agreement. The actual on-chain
 * `createAgreement` call is signed by the LANDLORD'S OWN wallet on the
 * frontend (via MetaMask/WalletConnect + ethers.js) — the backend never
 * holds user private keys. This endpoint just persists the off-chain record
 * and, once the frontend confirms the tx, patches in the on-chain id/hash.
 */
router.post(
  "/agreements",
  requireAuth,
  requireProfile,
  requireVerifiedKYC,
  [
    body("tenantId").isMongoId(),
    body("assetType").isIn(["property", "equipment", "freelance_gig"]),
    body("assetDescription").trim().notEmpty(),
    body("depositAmountINR").isFloat({ gt: 0 }),
    body("rentalStartsAt").isISO8601(),
    body("rentalEndsAt").isISO8601(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const tenant = await User.findById(req.body.tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });
    if (!tenant.walletAddress) return res.status(400).json({ error: "Tenant has not linked a wallet yet" });
    if (!req.user.walletAddress) return res.status(400).json({ error: "Link your wallet before creating an agreement" });

    const depositWei = blockchain.inrToWei(req.body.depositAmountINR).toString();

    const agreement = await Agreement.create({
      landlord: req.user._id,
      tenant: tenant._id,
      landlordWallet: req.user.walletAddress,
      tenantWallet: tenant.walletAddress,
      assetType: req.body.assetType,
      assetDescription: req.body.assetDescription,
      depositAmountINR: req.body.depositAmountINR,
      depositAmountWei: depositWei,
      rentalStartsAt: req.body.rentalStartsAt,
      rentalEndsAt: req.body.rentalEndsAt,
      disputeWindowSeconds: req.body.disputeWindowSeconds || 3 * 24 * 3600,
      status: "draft",
      contractAddress: process.env.ESCROW_CONTRACT_ADDRESS,
    });

    res.status(201).json({
      agreement,
      onChainParams: {
        tenant: tenant.walletAddress,
        arbitrator: process.env.PLATFORM_ARBITRATOR_ADDRESS,
        depositAmountWei: depositWei,
        rentalEndsAtUnix: Math.floor(new Date(req.body.rentalEndsAt).getTime() / 1000),
        disputeWindowSeconds: agreement.disputeWindowSeconds,
      },
      message: "Draft created. Sign createAgreement() on-chain from the landlord wallet, then call PATCH /confirm-created.",
    });
  }
);

/** PATCH /api/escrow/agreements/:id/confirm-created
 *  Frontend calls this after the landlord's createAgreement tx confirms. */
router.patch("/agreements/:id/confirm-created", requireAuth, requireProfile, async (req, res) => {
  const { onChainId, txHash } = req.body;
  const agreement = await Agreement.findById(req.params.id);
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });
  if (String(agreement.landlord) !== String(req.user._id)) return res.status(403).json({ error: "Not your agreement" });

  agreement.onChainId = onChainId;
  agreement.txHashCreated = txHash;
  agreement.status = "awaiting_deposit";
  await agreement.save();

  res.json({ agreement });
});

/** GET /api/escrow/agreements - list agreements for the current user (as either party) */
router.get("/agreements", requireAuth, requireProfile, async (req, res) => {
  const agreements = await Agreement.find({
    $or: [{ landlord: req.user._id }, { tenant: req.user._id }],
  })
    .populate("landlord", "fullName trustScore.value trustScore.tier")
    .populate("tenant", "fullName trustScore.value trustScore.tier")
    .sort({ createdAt: -1 });

  res.json({ agreements });
});

/** GET /api/escrow/agreements/:id */
router.get("/agreements/:id", requireAuth, requireProfile, async (req, res) => {
  const agreement = await Agreement.findById(req.params.id)
    .populate("landlord", "fullName trustScore walletAddress")
    .populate("tenant", "fullName trustScore walletAddress");
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });

  let onChain = null;
  if (agreement.onChainId) {
    try {
      onChain = await blockchain.getAgreementOnChain(agreement.onChainId);
    } catch (e) {
      console.warn("Could not fetch on-chain state:", e.message);
    }
  }

  res.json({ agreement, onChain });
});

/** PATCH /api/escrow/agreements/:id/confirm-funded - after tenant's fundDeposit() tx confirms */
router.patch("/agreements/:id/confirm-funded", requireAuth, requireProfile, async (req, res) => {
  const { txHash } = req.body;
  const agreement = await Agreement.findById(req.params.id);
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });
  if (String(agreement.tenant) !== String(req.user._id)) return res.status(403).json({ error: "Not your agreement" });

  agreement.status = "funded";
  agreement.txHashFunded = txHash;
  await agreement.save();

  res.json({ agreement });
});

/** POST /api/escrow/agreements/:id/complete - marks completed once on-chain signoff/auto-release finalizes */
router.post("/agreements/:id/complete", requireAuth, requireProfile, async (req, res) => {
  const agreement = await Agreement.findById(req.params.id);
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });

  agreement.status = "completed";
  await agreement.save();

  // Update reputation signals for both parties, then recompute trust scores.
  const { computeTrustScore } = require("../services/trustScoreEngine");
  const landlord = await User.findById(agreement.landlord);
  const tenant = await User.findById(agreement.tenant);

  landlord.reputation.completedAgreements += 1;
  tenant.reputation.completedAgreements += 1;
  landlord.trustScore = computeTrustScore(landlord);
  tenant.trustScore = computeTrustScore(tenant);

  await Promise.all([landlord.save(), tenant.save()]);

  res.json({ agreement });
});

module.exports = router;
