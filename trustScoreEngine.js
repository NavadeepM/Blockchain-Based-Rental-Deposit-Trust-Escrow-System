/**
 * Trust Score Engine
 * ---------------------------------------------------------------------------
 * Produces a 0-100 trust score for a renter/landlord from four weighted
 * signal groups, mirroring an alternative-credit-scoring approach for users
 * who don't have a traditional financial trail:
 *
 *   1. KYC completeness & document confidence      (25%)
 *   2. Selfie liveness / face-match confidence      (15%)
 *   3. Rental & payment history                     (35%)
 *   4. Platform / social reputation                 (25%)
 *
 * Each sub-score is 0-100; the final score is the weighted sum, then mapped
 * to a tier used for UI badges and for gating deposit-flexibility rules
 * (e.g. high-trust tenants could be offered reduced deposits in a v2).
 */

const WEIGHTS = {
  kyc: 0.25,
  liveness: 0.15,
  history: 0.35,
  reputation: 0.25,
};

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

/** 1. KYC sub-score */
function scoreKYC(user) {
  const kyc = user.kyc || {};
  if (kyc.status === "verified") {
    // Stronger ID types score slightly higher (passport/aadhaar > driver's license)
    const idTypeBonus = { aadhaar: 100, passport: 100, pan: 85, drivers_license: 75 };
    return idTypeBonus[kyc.idType] ?? 80;
  }
  if (kyc.status === "pending") return 30;
  if (kyc.status === "rejected") return 5;
  return 0; // not_started
}

/** 2. Liveness sub-score - straight passthrough of the liveness confidence,
 *     with a penalty if the check is stale (> 180 days old). */
function scoreLiveness(user) {
  const kyc = user.kyc || {};
  if (kyc.livenessScore == null) return 0;
  let score = clamp(kyc.livenessScore);
  if (kyc.livenessCheckedAt) {
    const ageDays = (Date.now() - new Date(kyc.livenessCheckedAt).getTime()) / 86400000;
    if (ageDays > 180) score *= 0.7;
  }
  return clamp(score);
}

/** 3. Rental / payment history sub-score */
function scoreHistory(user) {
  const rep = user.reputation || {};
  const totalAgreements = (rep.completedAgreements || 0) + (rep.disputedAgreements || 0);
  const totalPayments = (rep.onTimePayments || 0) + (rep.latePayments || 0);

  if (totalAgreements === 0 && totalPayments === 0) {
    // No history yet - neutral-low starting point so new users aren't blocked,
    // but haven't earned trust either.
    return 20;
  }

  const completionRate = totalAgreements > 0 ? rep.completedAgreements / totalAgreements : 1;
  const punctualityRate = totalPayments > 0 ? rep.onTimePayments / totalPayments : 1;

  // Volume bonus rewards a longer track record, capped so it can't dominate.
  const volumeBonus = clamp(Math.log2(1 + totalAgreements) * 8, 0, 20);

  const base = completionRate * 55 + punctualityRate * 25;
  return clamp(base + volumeBonus);
}

/** 4. Platform / social reputation sub-score */
function scoreReputation(user) {
  const rep = user.reputation || {};
  const ratings = [rep.avgLandlordRating, rep.avgTenantRating].filter((r) => r != null);
  const ratingScore = ratings.length
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length / 5) * 60
    : 20; // neutral default if no ratings yet

  const socialLinkScore = clamp((rep.linkedSocialAccounts || []).length * 10, 0, 20);

  const accountAgeScore = clamp(((rep.accountAgeInDays || 0) / 365) * 20, 0, 20);

  return clamp(ratingScore + socialLinkScore + accountAgeScore);
}

function tierFor(score) {
  if (score >= 85) return "excellent";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  if (score > 0) return "low";
  return "unrated";
}

/**
 * Computes the full trust score breakdown for a user document.
 * Pure function - no DB writes here, caller persists the result.
 */
function computeTrustScore(user) {
  const breakdown = {
    kyc: Math.round(scoreKYC(user)),
    liveness: Math.round(scoreLiveness(user)),
    history: Math.round(scoreHistory(user)),
    reputation: Math.round(scoreReputation(user)),
  };

  const value = Math.round(
    breakdown.kyc * WEIGHTS.kyc +
      breakdown.liveness * WEIGHTS.liveness +
      breakdown.history * WEIGHTS.history +
      breakdown.reputation * WEIGHTS.reputation
  );

  return {
    value: clamp(value),
    breakdown,
    tier: tierFor(value),
    lastComputedAt: new Date(),
  };
}

/**
 * Recommends a deposit adjustment multiplier based on trust tier.
 * e.g. an 'excellent' tenant could be offered a 15% lower suggested deposit;
 * a 'low' tier tenant might see a 10% higher suggested deposit.
 * This is advisory only — landlords set the final deposit amount.
 */
function suggestedDepositMultiplier(tier) {
  const table = {
    excellent: 0.85,
    high: 0.95,
    medium: 1.0,
    low: 1.1,
    unrated: 1.15,
  };
  return table[tier] ?? 1.0;
}

module.exports = {
  computeTrustScore,
  suggestedDepositMultiplier,
  WEIGHTS,
};
