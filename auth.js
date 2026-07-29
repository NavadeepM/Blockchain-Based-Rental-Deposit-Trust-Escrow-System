const express = require("express");
const { body, validationResult } = require("express-validator");
const router = express.Router();

const User = require("../models/User");
const { requireAuth } = require("../middleware/authMiddleware");
const { computeTrustScore } = require("../services/trustScoreEngine");

/**
 * POST /api/auth/onboard
 * Called right after Firebase OTP sign-in on the client. Creates (or fetches)
 * the Mongo profile tied to the verified firebaseUid.
 */
router.post(
  "/onboard",
  requireAuth,
  [
    body("fullName").trim().notEmpty().withMessage("Full name is required"),
    body("role").isIn(["tenant", "landlord", "both"]),
    body("walletAddress").optional().isEthereumAddress().withMessage("Invalid Ethereum address"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { fullName, role, walletAddress, email } = req.body;
    const { uid, phone_number } = req.firebaseUser;

    let user = await User.findOne({ firebaseUid: uid });
    if (user) {
      user.fullName = fullName;
      user.role = role;
      if (walletAddress) user.walletAddress = walletAddress.toLowerCase();
      if (email) user.email = email;
    } else {
      user = new User({
        firebaseUid: uid,
        phone: phone_number || req.body.phone,
        email,
        fullName,
        role,
        walletAddress: walletAddress?.toLowerCase() || null,
      });
    }

    const scored = computeTrustScore(user);
    user.trustScore = scored;

    await user.save();
    res.status(200).json({ user });
  }
);

/** GET /api/auth/me - fetch the current user's profile */
router.get("/me", requireAuth, async (req, res) => {
  if (!req.user) return res.status(404).json({ error: "Profile not found. Complete onboarding first." });
  res.json({ user: req.user });
});

module.exports = router;
