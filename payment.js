const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const razorpay = require("../config/razorpay");
const Agreement = require("../models/Agreement");
const { requireAuth, requireProfile } = require("../middleware/authMiddleware");

/**
 * Deposit flow (fiat rail alongside the on-chain escrow):
 *  1. Tenant pays the deposit in INR via Razorpay (familiar UX for Indian
 *     users who may not hold ETH).
 *  2. On payment success, the PLATFORM's relay wallet (or the tenant's own
 *     wallet, if they prefer to self-custody) funds the equivalent amount
 *     into the smart contract, so the deposit is provably locked on-chain
 *     even though the user paid in rupees.
 *  3. Refunds mirror the on-chain release: once the contract releases funds
 *     to the tenant, the platform-held equivalent is refunded via Razorpay.
 *
 * This endpoint set only handles the Razorpay leg — see escrow.js / the
 * frontend web3 flow for the on-chain leg.
 */

/** POST /api/payment/create-order */
router.post("/create-order", requireAuth, requireProfile, async (req, res) => {
  const { agreementId } = req.body;
  const agreement = await Agreement.findById(agreementId);
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });
  if (String(agreement.tenant) !== String(req.user._id)) return res.status(403).json({ error: "Not your agreement" });
  if (agreement.status !== "awaiting_deposit") return res.status(400).json({ error: "Agreement not awaiting deposit" });

  const order = await razorpay.orders.create({
    amount: Math.round(agreement.depositAmountINR * 100), // paise
    currency: "INR",
    receipt: `deposit_${agreement._id}`,
    notes: { agreementId: String(agreement._id) },
  });

  agreement.razorpayOrderId = order.id;
  await agreement.save();

  res.json({ order, keyId: process.env.RAZORPAY_KEY_ID });
});

/** POST /api/payment/verify - client posts Razorpay's checkout response here for HMAC verification */
router.post("/verify", requireAuth, requireProfile, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, agreementId } = req.body;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ error: "Payment signature verification failed" });
  }

  const agreement = await Agreement.findById(agreementId);
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });

  agreement.razorpayPaymentId = razorpay_payment_id;
  await agreement.save();

  res.json({
    message: "Payment verified. Proceed to lock the equivalent deposit on-chain.",
    agreement,
  });
});

/** POST /api/payment/refund - triggered once the smart contract confirms release to tenant */
router.post("/refund", requireAuth, requireProfile, async (req, res) => {
  const { agreementId, amountINR } = req.body;
  const agreement = await Agreement.findById(agreementId);
  if (!agreement) return res.status(404).json({ error: "Agreement not found" });
  if (!agreement.razorpayPaymentId) return res.status(400).json({ error: "No captured payment to refund" });

  const refund = await razorpay.payments.refund(agreement.razorpayPaymentId, {
    amount: Math.round((amountINR ?? agreement.depositAmountINR) * 100),
    notes: { agreementId: String(agreement._id), reason: "escrow_release" },
  });

  agreement.razorpayRefundId = refund.id;
  await agreement.save();

  res.json({ refund, agreement });
});

/**
 * POST /api/payment/webhook
 * Razorpay server-to-server webhook (payment.captured, refund.processed, etc.)
 * Verified via the X-Razorpay-Signature header + webhook secret.
 */
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex");

  if (signature !== expected) return res.status(400).json({ error: "Invalid webhook signature" });

  const event = JSON.parse(req.body.toString());
  console.log("[Razorpay webhook]", event.event);
  // Handle event.event cases: payment.captured, refund.processed, payment.failed, etc.

  res.status(200).json({ received: true });
});

module.exports = router;
