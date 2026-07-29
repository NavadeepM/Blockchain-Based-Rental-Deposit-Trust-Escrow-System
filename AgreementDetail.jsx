import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import {
  connectWallet,
  fundDepositOnChain,
  confirmCompletionOnChain,
  autoReleaseOnChain,
  raiseDisputeOnChain,
} from "../services/web3.js";

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function AgreementDetail() {
  const { id } = useParams();
  const [agreement, setAgreement] = useState(null);
  const [onChain, setOnChain] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState([]);
  const [conditionReport, setConditionReport] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const { profile, wallet, setWallet } = useAuth();

  async function load() {
    const { data } = await api.get(`/escrow/agreements/${id}`);
    setAgreement(data.agreement);
    setOnChain(data.onChain);
  }

  useEffect(() => { load(); }, [id]);

  if (!agreement) return <div className="page-center">Loading...</div>;

  const isTenant = agreement.tenant?._id === profile?._id;
  const isLandlord = agreement.landlord?._id === profile?._id;

  async function ensureWallet() {
    if (wallet) return wallet;
    const w = await connectWallet();
    setWallet(w);
    return w;
  }

  /** Deposit flow: pay via Razorpay (INR), then lock the ETH-equivalent on-chain. */
  async function handlePayDeposit() {
    setBusy(true);
    setError("");
    try {
      const { data: orderData } = await api.post("/payment/create-order", { agreementId: id });
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) throw new Error("Could not load Razorpay checkout");

      const rzp = new window.Razorpay({
        key: orderData.keyId,
        amount: orderData.order.amount,
        currency: orderData.order.currency,
        order_id: orderData.order.id,
        name: "TrustLock Escrow",
        description: agreement.assetDescription,
        handler: async (response) => {
          await api.post("/payment/verify", {
            ...response,
            agreementId: id,
          });

          // Now lock the on-chain equivalent.
          const w = await ensureWallet();
          const { txHash } = await fundDepositOnChain(w.signer, agreement.onChainId, agreement.depositAmountWei);
          await api.patch(`/escrow/agreements/${id}/confirm-funded`, { txHash });
          await load();
        },
        theme: { color: "#0d9488" },
      });
      rzp.open();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmCompletion() {
    setBusy(true);
    setError("");
    try {
      const w = await ensureWallet();
      await confirmCompletionOnChain(w.signer, agreement.onChainId);
      await api.post(`/escrow/agreements/${id}/complete`);
      await load();
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoRelease() {
    setBusy(true);
    setError("");
    try {
      const w = await ensureWallet();
      await autoReleaseOnChain(w.signer, agreement.onChainId);
      await api.post(`/escrow/agreements/${id}/complete`);
      await load();
    } catch (err) {
      setError(err.reason || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRaiseDispute() {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("reason", disputeReason);
      form.append("conditionReport", conditionReport);
      evidenceFiles.forEach((f) => form.append("evidence", f));

      const { data } = await api.post(`/dispute/${id}/raise`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const w = await ensureWallet();
      await raiseDisputeOnChain(w.signer, agreement.onChainId, data.evidenceHash, data.manifestURI);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <h2>{agreement.assetDescription}</h2>
        <p className="muted">{agreement.assetType} · Status: <strong>{agreement.status.replace("_", " ")}</strong></p>

        <div className="detail-grid">
          <div>
            <p><strong>Landlord:</strong> {agreement.landlord?.fullName}</p>
            <p><strong>Tenant:</strong> {agreement.tenant?.fullName}</p>
            <p><strong>Deposit:</strong> ₹{agreement.depositAmountINR?.toLocaleString("en-IN")}</p>
            <p><strong>Rental window:</strong> {new Date(agreement.rentalStartsAt).toLocaleDateString()} – {new Date(agreement.rentalEndsAt).toLocaleDateString()}</p>
          </div>
          <div>
            <p><strong>On-chain ID:</strong> {agreement.onChainId ?? "not yet created"}</p>
            <p><strong>Contract:</strong> {agreement.contractAddress?.slice(0, 10)}...</p>
            {onChain && <p><strong>On-chain status code:</strong> {String(onChain.status)}</p>}
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="action-row">
          {isTenant && agreement.status === "awaiting_deposit" && (
            <button onClick={handlePayDeposit} disabled={busy}>Pay deposit via Razorpay</button>
          )}

          {agreement.status === "funded" && (
            <>
              <button onClick={handleConfirmCompletion} disabled={busy}>Confirm completion (2-of-2 signoff)</button>
              <button onClick={handleAutoRelease} disabled={busy} className="btn-secondary">
                Trigger auto-release (after dispute window)
              </button>
            </>
          )}
        </div>

        {agreement.status === "funded" && (
          <div className="dispute-box">
            <h3>Raise a dispute</h3>
            <textarea
              placeholder="Reason for dispute (e.g. damage found, deposit shortfall)"
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
            />
            <textarea
              placeholder="Condition report notes"
              value={conditionReport}
              onChange={(e) => setConditionReport(e.target.value)}
            />
            <input type="file" multiple accept="image/*,.pdf" onChange={(e) => setEvidenceFiles(Array.from(e.target.files))} />
            <button onClick={handleRaiseDispute} disabled={busy} className="btn-danger">
              Submit evidence & raise dispute
            </button>
          </div>
        )}

        {agreement.status === "disputed" && (
          <div className="dispute-box">
            <h3>Dispute in progress</h3>
            <p>Reason: {agreement.dispute?.reason}</p>
            <p>Landlord evidence: {agreement.dispute?.landlordEvidenceCID ? "submitted" : "pending"}</p>
            <p>Tenant evidence: {agreement.dispute?.tenantEvidenceCID ? "submitted" : "pending"}</p>
            <p className="muted">An arbitrator will review both evidence bundles and issue an on-chain split verdict.</p>
          </div>
        )}

        {agreement.status === "resolved" && (
          <div className="dispute-box">
            <h3>Dispute resolved</h3>
            <p>Landlord share: {(agreement.dispute?.landlordSharePct / 100).toFixed(1)}%</p>
            <p>Tenant share: {(100 - agreement.dispute?.landlordSharePct / 100).toFixed(1)}%</p>
            <p className="muted">{agreement.dispute?.arbitratorNote}</p>
          </div>
        )}
      </div>
    </div>
  );
}
