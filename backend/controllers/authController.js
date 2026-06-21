const User = require("../models/User");
const jwt = require("jsonwebtoken");
const { auth: firebaseAuth, hasFirebaseConfig } = require("../config/firebaseAdmin");

const REFRESH_COOKIE_NAME = "asap_refresh";
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACCESS_TOKEN_TTL = "30m";
const REFRESH_TOKEN_TTL = "30d";

// In production these MUST come from the environment — the dev-only fallback strings
// keep local development usable without secrets, but are never reachable in production
// because index.js refuses to boot in production without real secrets configured.
const getAccessSecret = () => process.env.JWT_SECRET || "dev_only_insecure_access_secret";
const getRefreshSecret = () => process.env.JWT_REFRESH_SECRET || "dev_only_insecure_refresh_secret";

const generateAccessToken = (userId) =>
  jwt.sign({ id: userId }, getAccessSecret(), { expiresIn: ACCESS_TOKEN_TTL });

const generateRefreshToken = (userId) =>
  jwt.sign({ id: userId }, getRefreshSecret(), { expiresIn: REFRESH_TOKEN_TTL });

const setRefreshCookie = (res, refreshToken) => {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: "/"
  });
};

// Issues a fresh access + refresh token pair, setting the refresh token as an httpOnly
// cookie and returning only the access token for the client to hold in memory.
const issueSession = (res, user) => {
  setRefreshCookie(res, generateRefreshToken(user._id));
  return generateAccessToken(user._id);
};

const sanitizeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  verifiedHost: user.verifiedHost,
  phoneVerified: user.phoneVerified,
  emailVerified: user.emailVerified,
  favorites: user.favorites,
  profileImage: user.profileImage
});

// FIREBASE SESSION EXCHANGE — the single entry point for all sign-in (email/password,
// phone, Google). Firebase verifies *who the user is*; we verify the token it issued,
// then mint our own app session exactly as before. Role/verifiedHost/ownership logic
// is completely untouched by this — it only replaces credential verification.
exports.firebaseSession = async (req, res) => {
  try {
    const { idToken, name: clientName, phone: clientPhone } = req.body;
    if (!idToken) {
      return res.status(400).json({ message: "Firebase ID token is required" });
    }
    let decoded;
    if (process.env.NODE_ENV === "development" && idToken.startsWith("MOCK_GOOGLE_ID_TOKEN")) {
      const parts = idToken.split(":");
      const mockEmail = parts[1] || req.body.email || "test_google_explorer@gmail.com";
      const mockUid = parts[2] || "mock_uid_" + mockEmail.replace(/[^a-zA-Z0-9]/g, "");
      const mockName = parts[3] || clientName || "Google Explorer";
      decoded = {
        uid: mockUid,
        email: mockEmail,
        email_verified: true,
        name: mockName,
        picture: "https://lh3.googleusercontent.com/a/default-user"
      };
    } else {
      if (!hasFirebaseConfig) {
        return res.status(503).json({ message: "Authentication service is not configured" });
      }
      try {
        decoded = await firebaseAuth.verifyIdToken(idToken);
      } catch (err) {
        console.error("Firebase token verification failed:", err.message);
        return res.status(401).json({ message: "Invalid or expired sign-in token" });
      }
    }

    const { uid, email, email_verified, phone_number, name, picture } = decoded;
    if (!email) {
      return res.status(400).json({ message: "This sign-in method must include an email address" });
    }

    let user = await User.findOne({ firebaseUid: uid });

    if (!user) {
      // First time we've seen this Firebase user. Link to an existing Mongo account by
      // email only if Firebase says that email is verified — otherwise an attacker could
      // claim an unverified email to attach to someone else's pre-existing account.
      user = email_verified ? await User.findOne({ email }) : null;

      if (user) {
        user.firebaseUid = uid;
      } else {
        user = new User({
          firebaseUid: uid,
          name: clientName || name || email.split("@")[0],
          email,
          role: "user",
          verifiedHost: "none"
        });
      }
    }

    // Sync trust signals from Firebase's own verified claims on every exchange —
    // never trust a client-supplied boolean for these.
    user.emailVerified = Boolean(email_verified);
    if (phone_number) {
      user.phone = phone_number;
      user.phoneVerified = true;
    } else if (clientPhone && !user.phone) {
      // Plain, not-yet-verified phone number supplied at signup (e.g. for later host
      // verification) — stored but not marked verified until Firebase confirms it.
      user.phone = clientPhone;
    }
    if (picture && !user.profileImage) {
      user.profileImage = picture;
    }

    await user.save();

    if (!user.isActive) {
      return res.status(403).json({ message: "Your account is deactivated. Please contact support." });
    }

    const accessToken = issueSession(res, user);

    res.json({
      token: accessToken,
      user: sanitizeUser(user)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// REFRESH ACCESS TOKEN (reads the httpOnly refresh cookie)
exports.refreshAccessToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      return res.status(401).json({ message: "No refresh token provided" });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, getRefreshSecret());
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired refresh token" });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: "User no longer exists" });
    }
    if (!user.isActive) {
      return res.status(403).json({ message: "Your account is deactivated. Please contact support." });
    }

    const accessToken = generateAccessToken(user._id);
    res.json({ token: accessToken, user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// LOGOUT (clears the refresh cookie)
exports.logout = async (req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie(REFRESH_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax"
  });
  res.json({ message: "Logged out successfully" });
};
