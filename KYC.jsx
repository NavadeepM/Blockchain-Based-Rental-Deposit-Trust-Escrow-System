import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function KYC() {
  const [idType, setIdType] = useState("aadhaar");
  const [idNumber, setIdNumber] = useState("");
  const [idFile, setIdFile] = useState(null);
  const [status, setStatus] = useState("not_started");
  const [livenessScore, setLivenessScore] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  async function handleSubmitKYC(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("idType", idType);
      form.append("idNumber", idNumber);
      form.append("idDocument", idFile);
      const { data } = await api.post("/kyc/submit", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setStatus(data.kyc.status);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * In production this triggers a face-match SDK (e.g. a liveness challenge:
   * blink / turn head) comparing the live selfie to the ID photo, and the
   * resulting confidence score is what gets posted here. We simulate the
   * capture + scoring step for this demo.
   */
  async function handleRunLivenessCheck() {
    setBusy(true);
    setError("");
    try {
      const simulatedScore = Math.floor(70 + Math.random() * 30); // demo: 70-100
      const { data } = await api.post("/kyc/liveness", { livenessScore: simulatedScore });
      setLivenessScore(data.kyc.livenessScore);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-center">
      <div className="card" style={{ maxWidth: 460 }}>
        <h2>Identity verification</h2>
        <p className="muted">
          Feeds directly into your trust score — verified KYC + a fresh liveness check unlock the highest trust tiers.
        </p>

        <form onSubmit={handleSubmitKYC}>
          <label>ID type</label>
          <select value={idType} onChange={(e) => setIdType(e.target.value)}>
            <option value="aadhaar">Aadhaar</option>
            <option value="pan">PAN</option>
            <option value="passport">Passport</option>
            <option value="drivers_license">Driver's License</option>
          </select>

          <label>ID number</label>
          <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} required />

          <label>Upload ID photo</label>
          <input type="file" accept="image/*" onChange={(e) => setIdFile(e.target.files[0])} required />

          <button type="submit" disabled={busy}>{busy ? "Submitting..." : "Submit for KYC review"}</button>
        </form>

        <hr />

        <h3>Selfie liveness check</h3>
        <p className="muted">Confirms you're a real person and matches your ID photo.</p>
        <button type="button" onClick={handleRunLivenessCheck} disabled={busy}>
          Run liveness scan
        </button>
        {livenessScore != null && <p>Liveness confidence: <strong>{livenessScore}/100</strong></p>}

        {error && <p className="error">{error}</p>}

        <button style={{ marginTop: 16 }} onClick={async () => { await refreshProfile(); navigate("/dashboard"); }}>
          Continue to dashboard
        </button>
      </div>
    </div>
  );
}
