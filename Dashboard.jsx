import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import TrustScoreBadge from "../components/TrustScoreBadge.jsx";

const STATUS_COLORS = {
  draft: "#9ca3af",
  awaiting_deposit: "#f59e0b",
  funded: "#3b82f6",
  completed: "#16a34a",
  disputed: "#dc2626",
  resolved: "#0d9488",
  cancelled: "#6b7280",
};

export default function Dashboard() {
  const { profile, refreshProfile } = useAuth();
  const [agreements, setAgreements] = useState([]);
  const [trustScore, setTrustScore] = useState(profile?.trustScore);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [agRes, trustRes] = await Promise.all([
        api.get("/escrow/agreements"),
        api.get("/trust/me"),
      ]);
      setAgreements(agRes.data.agreements);
      setTrustScore(trustRes.data.trustScore);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="page-center">Loading dashboard...</div>;

  return (
    <div className="container">
      <div className="dashboard-header">
        <div>
          <h2>Welcome back, {profile?.fullName}</h2>
          <p className="muted">
            KYC status: <strong>{profile?.kyc?.status}</strong>
          </p>
        </div>
        <div className="trust-card">
          <TrustScoreBadge trustScore={trustScore} size="lg" />
          <div>
            <p><strong>{trustScore?.breakdown?.kyc}</strong> KYC</p>
            <p><strong>{trustScore?.breakdown?.liveness}</strong> Liveness</p>
            <p><strong>{trustScore?.breakdown?.history}</strong> History</p>
            <p><strong>{trustScore?.breakdown?.reputation}</strong> Reputation</p>
          </div>
        </div>
      </div>

      <div className="section-header">
        <h3>Your agreements</h3>
        <Link to="/agreements/new" className="btn-primary-link">+ New agreement</Link>
      </div>

      {agreements.length === 0 && <p className="muted">No agreements yet.</p>}

      <div className="agreement-list">
        {agreements.map((a) => (
          <Link to={`/agreements/${a._id}`} key={a._id} className="agreement-row">
            <div>
              <strong>{a.assetDescription}</strong>
              <p className="muted">{a.assetType} · ₹{a.depositAmountINR.toLocaleString("en-IN")}</p>
            </div>
            <span className="status-pill" style={{ background: STATUS_COLORS[a.status] }}>
              {a.status.replace("_", " ")}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
