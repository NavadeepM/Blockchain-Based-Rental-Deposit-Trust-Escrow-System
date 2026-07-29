const express = require("express");
const router = express.Router();

const User = require("../models/User");
const { requireAuth, requireProfile } = require("../middleware/authMiddleware");
const { computeTrustScore, suggestedDepositMultiplier } = require("../services/trustScoreEngine");

/** GET /api/trust/me - recompute + return the caller's current trust score */
router.get("/me", requireAuth, requireProfile, async (req, res) => {
  const scored = computeTrustScore(req.user);
  req.user.trustScore = scored;
  await req.user.save();

  res.json({
    trustScore: scored,
    suggestedDepositMultiplier: suggestedDepositMultiplier(scored.tier),
  });
});

/** GET /api/trust/:userId - view another user's public trust summary (e.g. a landlord vetting a tenant) */
router.get("/:userId", requireAuth, requireProfile, async (req, res) => {
  const target = await User.findById(req.params.userId).select(
    "fullName trustScore reputation.completedAgreements reputation.disputedAgreements kyc.status"
  );
  if (!target) return res.status(404).json({ error: "User not found" });

  res.json({
    fullName: target.fullName,
    kycVerified: target.kyc?.status === "verified",
    trustScore: target.trustScore,
    completedAgreements: target.reputation?.completedAgreements || 0,
    disputedAgreements: target.reputation?.disputedAgreements || 0,
  });
});

module.exports = router;
