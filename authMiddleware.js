const admin = require("../config/firebase");
const User = require("../models/User");

/**
 * Verifies the Firebase ID token sent from the client after OTP sign-in.
 * On success, attaches `req.firebaseUser` (decoded token) and `req.user`
 * (our Mongo user document, if one exists) to the request.
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUser = decoded;

    const user = await User.findOne({ firebaseUid: decoded.uid });
    if (user) req.user = user;

    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token", details: err.message });
  }
}

/** Requires that req.user (Mongo profile) already exists, i.e. onboarding is complete. */
function requireProfile(req, res, next) {
  if (!req.user) return res.status(403).json({ error: "Complete onboarding before accessing this resource" });
  next();
}

/** Requires KYC to be verified before allowing sensitive actions (e.g. funding escrow). */
function requireVerifiedKYC(req, res, next) {
  if (!req.user || req.user.kyc?.status !== "verified") {
    return res.status(403).json({ error: "KYC verification required for this action" });
  }
  next();
}

module.exports = { requireAuth, requireProfile, requireVerifiedKYC };
