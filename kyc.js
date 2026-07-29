const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const router = express.Router();

const { requireAuth, requireProfile } = require("../middleware/authMiddleware");
const { computeTrustScore } = require("../services/trustScoreEngine");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

/**
 * POST /api/kyc/submit
 * Accepts an ID document image + declared ID type. In production this hands
 * off to a licensed KYC provider (DigiLocker / Aadhaar eKYC / Passport OCR).
 * Here we simulate: hash the ID number (never store it raw), mark status
 * "pending", then simulate provider callback via /kyc/verify-callback.
 */
router.post(
  "/submit",
  requireAuth,
  requireProfile,
  upload.single("idDocument"),
  async (req, res) => {
    const { idType, idNumber } = req.body;
    if (!idType || !idNumber) return res.status(400).json({ error: "idType and idNumber are required" });
    if (!req.file) return res.status(400).json({ error: "ID document image is required" });

    const idNumberHash = crypto.createHash("sha256").update(idNumber).digest("hex");

    // TODO: upload req.file.buffer to secure cloud storage / IPFS and store the URL.
    const idDocumentUrl = `https://storage.example.com/kyc/${req.user._id}-${Date.now()}.jpg`;

    req.user.kyc = {
      ...req.user.kyc,
      status: "pending",
      idType,
      idNumberHash,
      idDocumentUrl,
    };
    await req.user.save();

    // Simulate async provider verification (in production: webhook callback).
    setTimeout(async () => {
      req.user.kyc.status = "verified";
      req.user.kyc.verifiedAt = new Date();
      req.user.trustScore = computeTrustScore(req.user);
      await req.user.save();
    }, 3000);

    res.status(202).json({ message: "KYC submitted, verification in progress", kyc: req.user.kyc });
  }
);

/**
 * POST /api/kyc/liveness
 * Accepts a liveness confidence score computed client-side (e.g. from a
 * face-match SDK comparing a live selfie against the ID photo). The backend
 * treats this as an untrusted input from a *provider webhook* in production;
 * here it's accepted directly for demo purposes.
 */
router.post("/liveness", requireAuth, requireProfile, async (req, res) => {
  const { livenessScore } = req.body;
  if (typeof livenessScore !== "number" || livenessScore < 0 || livenessScore > 100) {
    return res.status(400).json({ error: "livenessScore must be a number between 0 and 100" });
  }

  req.user.kyc.livenessScore = livenessScore;
  req.user.kyc.livenessCheckedAt = new Date();
  req.user.trustScore = computeTrustScore(req.user);
  await req.user.save();

  res.json({ kyc: req.user.kyc, trustScore: req.user.trustScore });
});

/** GET /api/kyc/status */
router.get("/status", requireAuth, requireProfile, async (req, res) => {
  res.json({ kyc: req.user.kyc, trustScore: req.user.trustScore });
});

module.exports = router;
