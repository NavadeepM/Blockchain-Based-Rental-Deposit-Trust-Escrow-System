const mongoose = require("mongoose");

const agreementSchema = new mongoose.Schema(
  {
    // On-chain linkage
    onChainId: { type: Number, default: null, index: true }, // id returned by RentalEscrow.createAgreement
    contractAddress: { type: String, default: null },
    network: { type: String, default: "sepolia" },
    txHashCreated: { type: String, default: null },
    txHashFunded: { type: String, default: null },
    txHashResolved: { type: String, default: null },

    // Parties
    landlord: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    landlordWallet: { type: String, required: true, lowercase: true },
    tenantWallet: { type: String, required: true, lowercase: true },

    // Terms
    assetType: { type: String, enum: ["property", "equipment", "freelance_gig"], required: true },
    assetDescription: { type: String, required: true },
    depositAmountINR: { type: Number, required: true },
    depositAmountWei: { type: String, required: true }, // stored as string, BigInt-safe
    rentalStartsAt: { type: Date, required: true },
    rentalEndsAt: { type: Date, required: true },
    disputeWindowSeconds: { type: Number, default: 3 * 24 * 3600 },

    // Razorpay
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    razorpayRefundId: { type: String, default: null },

    // Lifecycle
    status: {
      type: String,
      enum: [
        "draft",
        "awaiting_deposit",
        "funded",
        "completed",
        "disputed",
        "resolved",
        "cancelled",
      ],
      default: "draft",
    },

    // Dispute + evidence
    dispute: {
      raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      reason: { type: String, default: null },
      landlordEvidenceHash: { type: String, default: null }, // keccak256 hash stored on-chain
      landlordEvidenceCID: { type: String, default: null }, // IPFS pointer, off-chain files
      tenantEvidenceHash: { type: String, default: null },
      tenantEvidenceCID: { type: String, default: null },
      arbitratorNote: { type: String, default: null },
      landlordSharePct: { type: Number, default: null }, // basis points, resolved outcome
      resolvedAt: { type: Date, default: null },
    },

    // Post-completion feedback (feeds trust score reputation signals)
    tenantRatingByLandlord: { type: Number, min: 0, max: 5, default: null },
    landlordRatingByTenant: { type: Number, min: 0, max: 5, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Agreement", agreementSchema);
