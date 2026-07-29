import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../services/api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { connectWallet, createAgreementOnChain } from "../services/web3.js";

export default function CreateAgreement() {
  const [tenantId, setTenantId] = useState("");
  const [assetType, setAssetType] = useState("property");
  const [assetDescription, setAssetDescription] = useState("");
  const [depositAmountINR, setDepositAmountINR] = useState("");
  const [rentalStartsAt, setRentalStartsAt] = useState("");
  const [rentalEndsAt, setRentalEndsAt] = useState("");
  const [step, setStep] = useState("form"); // form -> signing -> done
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { wallet, setWallet } = useAuth();
  const navigate = useNavigate();

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // 1. Persist the draft + get on-chain call params from the backend.
      const { data } = await api.post("/escrow/agreements", {
        tenantId,
        assetType,
        assetDescription,
        depositAmountINR: Number(depositAmountINR),
        rentalStartsAt,
        rentalEndsAt,
      });

      // 2. Ensure wallet is connected, then sign createAgreement() on-chain.
      setStep("signing");
      let activeWallet = wallet;
      if (!activeWallet) {
        activeWallet = await connectWallet();
        setWallet(activeWallet);
      }

      const { onChainId, txHash } = await createAgreementOnChain(activeWallet.signer, {
        tenant: data.onChainParams.tenant,
        arbitrator: data.onChainParams.arbitrator,
        depositWei: data.onChainParams.depositAmountWei,
        rentalEndsAtUnix: data.onChainParams.rentalEndsAtUnix,
        disputeWindowSeconds: data.onChainParams.disputeWindowSeconds,
      });

      // 3. Confirm the on-chain id/tx back to the backend.
      await api.patch(`/escrow/agreements/${data.agreement._id}/confirm-created`, { onChainId, txHash });

      setStep("done");
      navigate(`/agreements/${data.agreement._id}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setStep("form");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-center">
      <div className="card" style={{ maxWidth: 520 }}>
        <h2>Create rental agreement</h2>
        <p className="muted">This drafts the agreement, then asks your wallet to sign the on-chain escrow creation.</p>

        <form onSubmit={handleCreate}>
          <label>Tenant's user ID</label>
          <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Mongo user _id of the tenant" required />

          <label>Asset type</label>
          <select value={assetType} onChange={(e) => setAssetType(e.target.value)}>
            <option value="property">Property</option>
            <option value="equipment">Equipment</option>
            <option value="freelance_gig">Freelance gig</option>
          </select>

          <label>Description</label>
          <input value={assetDescription} onChange={(e) => setAssetDescription(e.target.value)} required />

          <label>Deposit amount (INR)</label>
          <input type="number" value={depositAmountINR} onChange={(e) => setDepositAmountINR(e.target.value)} required min="1" />

          <label>Rental start date</label>
          <input type="date" value={rentalStartsAt} onChange={(e) => setRentalStartsAt(e.target.value)} required />

          <label>Rental end date</label>
          <input type="date" value={rentalEndsAt} onChange={(e) => setRentalEndsAt(e.target.value)} required />

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={busy}>
            {step === "signing" ? "Confirm in wallet..." : busy ? "Working..." : "Create agreement"}
          </button>
        </form>
      </div>
    </div>
  );
}
