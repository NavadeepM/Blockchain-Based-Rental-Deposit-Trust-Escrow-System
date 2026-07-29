import React from "react";

const TIER_COLORS = {
  excellent: "#0d9488",
  high: "#16a34a",
  medium: "#ca8a04",
  low: "#dc2626",
  unrated: "#6b7280",
};

export default function TrustScoreBadge({ trustScore, size = "md" }) {
  if (!trustScore) return null;
  const { value, tier, breakdown } = trustScore;
  const color = TIER_COLORS[tier] || TIER_COLORS.unrated;
  const dims = size === "lg" ? 88 : 56;

  return (
    <div className="trust-badge" title={breakdown ? `KYC ${breakdown.kyc} · Liveness ${breakdown.liveness} · History ${breakdown.history} · Reputation ${breakdown.reputation}` : ""}>
      <svg width={dims} height={dims} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="42" fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${(value / 100) * 264} 264`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="46" textAnchor="middle" fontSize="22" fontWeight="700" fill="#111827">
          {value}
        </text>
        <text x="50" y="64" textAnchor="middle" fontSize="10" fill="#6b7280" textTransform="capitalize">
          {tier}
        </text>
      </svg>
    </div>
  );
}
