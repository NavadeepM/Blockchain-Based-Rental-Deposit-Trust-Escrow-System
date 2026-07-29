import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { sendOTP, confirmOTP } from "../firebase.js";

export default function Login() {
  const [phone, setPhone] = useState("+91");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState("phone"); // phone -> otp
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function handleSendOTP(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await sendOTP(phone);
      setStage("otp");
    } catch (err) {
      setError(err.message || "Failed to send OTP");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmOTP(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await confirmOTP(otp);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Invalid OTP");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-center">
      <div className="card" style={{ maxWidth: 380 }}>
        <h2>Sign in</h2>
        <p className="muted">Secure onboarding via phone OTP (Firebase Auth).</p>

        {stage === "phone" && (
          <form onSubmit={handleSendOTP}>
            <label>Phone number</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
            <button type="submit" disabled={busy}>{busy ? "Sending..." : "Send OTP"}</button>
          </form>
        )}

        {stage === "otp" && (
          <form onSubmit={handleConfirmOTP}>
            <label>Enter the 6-digit code</label>
            <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="123456" maxLength={6} />
            <button type="submit" disabled={busy}>{busy ? "Verifying..." : "Verify & continue"}</button>
          </form>
        )}

        {error && <p className="error">{error}</p>}
        <div id="recaptcha-container"></div>
      </div>
    </div>
  );
}
