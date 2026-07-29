import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api.js";
import { connectWallet } from "../services/web3.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function Onboarding() {
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("both");
  const [walletAddress, setWalletAddress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { setProfile, setWallet } = useAuth();
  const navigate = useNavigate();

  async function handleConnectWallet() {
    try {
      const w = await connectWallet();
      setWallet(w);
      setWalletAddress(w.address);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post("/auth/onboard", { fullName, role, walletAddress });
      setProfile(data.user);
      navigate("/kyc");
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-center">
      <div className="card" style={{ maxWidth: 420 }}>
        <h2>Complete your profile</h2>
        <form onSubmit={handleSubmit}>
          <label>Full name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />

          <label>I am a</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="tenant">Tenant / Renter</option>
            <option value="landlord">Landlord</option>
            <option value="both">Both</option>
          </select>

          <label>Ethereum wallet</label>
          {walletAddress ? (
            <p className="muted">Connected: {walletAddress}</p>
          ) : (
            <button type="button" onClick={handleConnectWallet}>Connect MetaMask</button>
          )}

          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy} style={{ marginTop: 12 }}>
            {busy ? "Saving..." : "Continue to KYC"}
          </button>
        </form>
      </div>
    </div>
  );
}
