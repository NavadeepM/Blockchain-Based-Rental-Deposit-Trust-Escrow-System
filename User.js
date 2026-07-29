const mongoose = require("mongoose");

const kycSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["not_started", "pending", "verified", "rejected"], default: "not_started" },
    idType: { type: String, enum: ["aadhaar", "pan", "passport", "drivers_license"], default: null },
    idNumberHash: { type: String, default: null }, // never store raw ID numbers, only a hash
    idDocumentUrl: { type: String, default: null }, // off-chain (cloud/IPFS) pointer
    livenessScore: { type: Number, min: 0, max: 100, default: null }, // from selfie liveness check
    livenessCheckedAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
  },
  { _id: false }
);

const reputationSchema = new mongoose.Schema(
  {
    completedAgreements: { type: Number, default: 0 },
    disputedAgreements: { type: Number, default: 0 },
    onTimePayments: { type: Number, default: 0 },
    latePayments: { type: Number, default: 0 },
    avgLandlordRating: { type: Number, min: 0, max: 5, default: null }, // ratings received as tenant
    avgTenantRating: { type: Number, min: 0, max: 5, default: null }, // ratings received as landlord
    linkedSocialAccounts: [{ type: String }], // e.g. "google", "linkedin", "facebook" - platform reputation signal
    accountAgeInDays: { type: Number, default: 0 },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, required: true, unique: true, index: true },
    phone: { type: String, required: true },
    email: { type: String, default: null },
    fullName: { type: String, required: true },
    role: { type: String, enum: ["tenant", "landlord", "both"], default: "both" },

    walletAddress: { type: String, default: null, lowercase: true }, // Ethereum address for escrow interactions

    kyc: { type: kycSchema, default: () => ({}) },
    reputation: { type: reputationSchema, default: () => ({}) },

    trustScore: {
      value: { type: Number, min: 0, max: 100, default: 0 },
      breakdown: {
        kyc: { type: Number, default: 0 },
        liveness: { type: Number, default: 0 },
        history: { type: Number, default: 0 },
        reputation: { type: Number, default: 0 },
        recency: { type: Number, default: 0 },
      },
      tier: { type: String, enum: ["unrated", "low", "medium", "high", "excellent"], default: "unrated" },
      lastComputedAt: { type: Date, default: null },
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
