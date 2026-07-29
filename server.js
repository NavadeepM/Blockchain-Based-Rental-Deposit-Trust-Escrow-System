require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const connectDB = require("./config/db");

const authRoutes = require("./routes/auth");
const kycRoutes = require("./routes/kyc");
const trustRoutes = require("./routes/trust");
const escrowRoutes = require("./routes/escrow");
const paymentRoutes = require("./routes/payment");
const disputeRoutes = require("./routes/dispute");

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(morgan("dev"));

// Razorpay webhook needs the raw body for signature verification, so it's
// mounted BEFORE the global json() body parser.
app.use("/api/payment/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use("/api", apiLimiter);

app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.use("/api/auth", authRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/trust", trustRoutes);
app.use("/api/escrow", escrowRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/dispute", disputeRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 5000;

async function start() {
  if (process.env.MONGO_URI) {
    await connectDB();
  } else {
    console.warn("[server] MONGO_URI not set - running without DB connection (demo mode)");
  }
  app.listen(PORT, () => console.log(`[server] Rental Escrow API listening on port ${PORT}`));
}

start();

module.exports = app;
