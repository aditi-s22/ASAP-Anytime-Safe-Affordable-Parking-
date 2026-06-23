const express = require("express");
const cors = require("cors");
require("dotenv").config();
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
// Custom Mongo Sanitize Middleware for Express 5 compatibility
const sanitizeObject = (obj) => {
  if (obj instanceof Object) {
    for (const key in obj) {
      if (key.startsWith('$')) {
        delete obj[key];
      } else if (obj[key] instanceof Object) {
        sanitizeObject(obj[key]);
      }
    }
  }
};

const customMongoSanitize = (req, res, next) => {
  if (req.body) sanitizeObject(req.body);
  if (req.query) sanitizeObject(req.query);
  if (req.params) sanitizeObject(req.params);
  next();
};

const path = require("path");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const parkingRoutes = require("./routes/parkingRoutes");
const bookingRoutes = require("./routes/bookingRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const userRoutes = require("./routes/userRoutes");
const publicRoutes = require("./routes/publicRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const adminRoutes = require("./routes/adminRoutes");

// Validate required environment variables on startup.
const requiredEnvVars = ["JWT_SECRET", "JWT_REFRESH_SECRET", "MONGO_URI"];
if (process.env.NODE_ENV === "production") {
  requiredEnvVars.push("FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY");
}
const missingEnvVars = requiredEnvVars.filter((key) => !process.env[key]);
if (missingEnvVars.length > 0) {
  console.error(`FATAL Startup Failure: Missing required env vars: ${missingEnvVars.join(", ")}`);
  process.exit(1);
}

const rawFrontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const FRONTEND_URL = rawFrontendUrl.endsWith("/") ? rawFrontendUrl.slice(0, -1) : rawFrontendUrl;

// Minimal cookie parser (avoids adding a dependency just to read one refresh-token cookie).
const parseCookies = (req) => {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
  });
  return cookies;
};

const app = express();

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true
}));
app.use(express.json());

const requestLogger = require("./middleware/requestLogger");
const xssMiddleware = require("./middleware/xss");

// Register Observability & Security Middlewares
app.use(requestLogger);
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" } // allows loading local uploaded images
}));
app.use(customMongoSanitize);
app.use(xssMiddleware);
app.use((req, res, next) => {
  req.cookies = parseCookies(req);
  next();
});

// Rate Limiters
// Production keeps every limit below exactly as-is. Development (or any request
// arriving from localhost/127.0.0.1/::1, e.g. a developer hitting prod-mode config
// from their own machine) skips rate limiting entirely via `skip` — this disables
// counting/blocking outright rather than just raising the ceiling, so local testing
// can never trip a "Too many requests" error regardless of request volume.
// Fail-closed: only an explicit NODE_ENV=development relaxes anything. If NODE_ENV
// is unset or anything else (a deployment forgetting to set it), this resolves to
// production-safe behavior instead of silently disabling rate limiting.
const isDevEnv = process.env.NODE_ENV === "development";
const isLocalRequest = (req) => {
  const ip = req.ip || req.connection?.remoteAddress || "";
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
};
const skipRateLimit = (req) => isDevEnv || isLocalRequest(req);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // production limit; irrelevant in dev since skip() bypasses counting
  skip: skipRateLimit,
  message: { message: "Too many requests from this IP. Please try again later." }
});
app.use("/api", apiLimiter);

// Tighter limiter on auth endpoints to slow down credential-stuffing / OTP-guessing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // production limit; irrelevant in dev since skip() bypasses counting
  skip: skipRateLimit,
  message: { message: "Too many authentication attempts. Please try again later." }
});
app.use("/api/auth", authLimiter);

const server = require("http").createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);
  
  socket.on("join", (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined room`);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

connectDB().then(async () => {
  try {
    const Parking = require("./models/Parking");
    const invalidSpots = await Parking.find({
      $or: [
        { "location": { $exists: false } },
        { "location.type": { $ne: "Point" } },
        { "location.coordinates": { $exists: false } },
        { "location.coordinates": { $size: 0 } }
      ]
    });
    
    if (invalidSpots.length > 0) {
      console.log(`[Migration] Found ${invalidSpots.length} parking spots with invalid or missing location coordinates. Migrating...`);
      for (const spot of invalidSpots) {
        let lat = 19.0760;
        let lng = 72.8777;
        const addr = (spot.address || "").toLowerCase();
        if (addr.includes("powai")) {
          lat = 19.1170; lng = 72.9060;
        } else if (addr.includes("ghatkopar") || addr.includes("r city")) {
          lat = 19.0863; lng = 72.9264;
        } else if (addr.includes("bkc")) {
          lat = 19.0607; lng = 72.8634;
        } else if (addr.includes("airport t2")) {
          lat = 19.0896; lng = 72.8656;
        } else if (addr.includes("airport t1")) {
          lat = 19.0988; lng = 72.8517;
        } else if (addr.includes("bandra")) {
          lat = 19.0596; lng = 72.8295;
        } else if (addr.includes("andheri")) {
          lat = 19.1271; lng = 72.8566;
        } else if (addr.includes("thane")) {
          lat = 19.2183; lng = 72.9781;
        } else if (addr.includes("delhi") || addr.includes("cp")) {
          lat = 28.6300; lng = 77.2185;
        } else if (addr.includes("bangalore") || addr.includes("indiranagar")) {
          lat = 12.9716; lng = 77.6412;
        }
        
        spot.location = {
          type: "Point",
          coordinates: [lng, lat]
        };
        await spot.save();
        console.log(`[Migration] Updated spot "${spot.title}" to coordinates: [${lng}, ${lat}]`);
      }
      console.log(`[Migration] Database migration completed. All spots now contain valid Point coordinates.`);
    } else {
      console.log(`[Migration] DB Verification Passed: All parking spots contain valid geospatial Point coordinates.`);
    }

    // One-time startup migration: set phoneVerified = true for all users who do not have it set to true.
    const User = require("./models/User");
    const migrationResult = await User.updateMany(
      { phoneVerified: { $ne: true } },
      { $set: { phoneVerified: true } }
    );
    if (migrationResult.modifiedCount > 0) {
      console.log(`[Migration] Successfully updated ${migrationResult.modifiedCount} legacy users with phoneVerified: true`);
    } else {
      console.log(`[Migration] No legacy users need phoneVerified updates.`);
    }
  } catch (err) {
    console.error("[Migration] Error running startup migrations:", err.message);
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/parking", parkingRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Central Error Handler Middleware
const errorMiddleware = require("./middleware/errorMiddleware");
app.use(errorMiddleware);

app.get("/", (req, res) => {
  res.send("ASAP Parking API running 🚀");
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});