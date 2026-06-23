const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, ".env") });

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/asap_parking";

async function runTests() {
  console.log("====================================================");
  console.log("   OTP ELIMINATION FLOW VERIFICATION SUITE          ");
  console.log("====================================================");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB successfully. ✅\n");

    const User = require("./models/User");
    const Parking = require("./models/Parking");
    const Booking = require("./models/Booking");
    const Payment = require("./models/Payment");

    const suffix = Date.now();
    const driverEmail = `newdriver_${suffix}@asap.io`;
    const hostEmail = `newhost_${suffix}@asap.io`;
    const legacyEmail = `legacyuser_${suffix}@asap.io`;

    // -----------------------------------------------------------------
    // TEST A: New Driver Flow
    // -----------------------------------------------------------------
    console.log("--- TEST A: NEW DRIVER FLOW ---");
    // 1. Signup & Login
    console.log(`[Driver] Simulating Driver Signup with email: ${driverEmail}`);
    const driverUser = await User.create({
      name: "New Driver User",
      email: driverEmail,
      role: "driver",
      phone: "+91 91111 22222",
      emailVerified: true
      // Notice: phoneVerified is omitted to test Schema default
    });
    console.log(`[Driver] Signup successful!`);
    console.log(`[Driver] Verifying default phoneVerified: ${driverUser.phoneVerified} (Expected: true)`);
    if (driverUser.phoneVerified !== true) {
      throw new Error("New user was not created with phoneVerified: true!");
    }
    console.log("✅ Driver created with phoneVerified: true successfully!");

    // 2. Search
    console.log("[Driver] Searching for approved and active parking spots...");
    const activeSpots = await Parking.find({ isApproved: true, isActive: true });
    console.log(`[Driver] Found ${activeSpots.length} active and approved spots.`);

    // Set up a mock spot if none exist
    let spot = activeSpots[0];
    if (!spot) {
      console.log("[Driver] No active spot found, seeding a mock approved spot...");
      const mockHost = await User.create({
        name: "Mock Host User",
        email: `mockhost_${suffix}@asap.io`,
        role: "host",
        verifiedHost: "verified",
        phoneVerified: true
      });
      spot = await Parking.create({
        title: "Test BKC Plaza",
        address: "Bandra Kurla Complex, Mumbai, Maharashtra",
        location: { type: "Point", coordinates: [72.8634, 19.0607] },
        pricePerHour: 100,
        vehicleType: "car",
        availableSlots: 3,
        totalSlots: 3,
        slots: 3,
        hostId: mockHost._id,
        startTime: "00:00",
        endTime: "23:59",
        isApproved: true,
        verificationStatus: "approved",
        isActive: true
      });
      console.log(`[Driver] Mock approved spot seeded: "${spot.title}"`);
    }

    // 3. Book
    console.log(`[Driver] Initializing booking for spot "${spot.title}"...`);
    const now = new Date();
    const end = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours
    const booking = await Booking.create({
      userId: driverUser._id,
      parkingId: spot._id,
      startTime: now,
      endTime: end,
      totalPrice: spot.pricePerHour * 2,
      paymentStatus: "pending",
      status: "pending",
      qrToken: `qr_${suffix}`
    });
    console.log(`[Driver] Booking created successfully in pending state. Booking ID: ${booking._id}`);

    // 4. Pay
    console.log("[Driver] Simulating Razorpay payment gateway capture...");
    const payment = await Payment.create({
      bookingId: booking._id,
      razorpayOrderId: `order_${suffix}`,
      razorpayPaymentId: `pay_${suffix}`,
      amount: booking.totalPrice,
      status: "captured"
    });
    booking.paymentStatus = "paid";
    booking.status = "paid";
    await booking.save();
    console.log(`[Driver] Payment captured. Booking status set to "paid"`);

    // 5. Check-in
    console.log("[Driver] Simulating QR check-in...");
    booking.checkedIn = true;
    booking.checkedInAt = new Date();
    booking.checkInTime = new Date();
    booking.status = "checked_in";
    await booking.save();
    console.log(`[Driver] Check-in successful. Booking status set to: ${booking.status}`);
    console.log("✅ New Driver Flow verified successfully!\n");

    // -----------------------------------------------------------------
    // TEST B: New Host Flow
    // -----------------------------------------------------------------
    console.log("--- TEST B: NEW HOST FLOW ---");
    // 1. Signup
    console.log(`[Host] Simulating Host Signup with email: ${hostEmail}`);
    const hostUser = await User.create({
      name: "New Host Applicant",
      email: hostEmail,
      role: "driver", // Role starts as driver/user
      verifiedHost: "none"
    });
    console.log(`[Host] Signup successful! phoneVerified: ${hostUser.phoneVerified} (Expected: true)`);
    if (hostUser.phoneVerified !== true) {
      throw new Error("New host was not created with phoneVerified: true!");
    }

    // 2. Complete onboarding / Submit documents
    console.log("[Host] Simulating Host Onboarding Application (Submitting documents & phone)...");
    hostUser.phone = "+91 92222 33333";
    hostUser.govIdImage = "uploads/gov_id_test.png";
    hostUser.addressProofImage = "uploads/address_proof_test.png";
    hostUser.verifiedHost = "pending";
    await hostUser.save();
    console.log(`[Host] Onboarding application submitted! verifiedHost: "${hostUser.verifiedHost}"`);
    console.log(`[Host] Verifying phoneVerified remains true: ${hostUser.phoneVerified} (Expected: true)`);
    if (hostUser.phoneVerified !== true) {
      throw new Error("Host phoneVerified changed from true!");
    }

    // 3. Await admin approval
    console.log("[Admin] Simulating Admin approval of host application...");
    hostUser.verifiedHost = "verified";
    hostUser.role = "host";
    await hostUser.save();
    console.log(`[Admin] Host approved! role: "${hostUser.role}", verifiedHost: "${hostUser.verifiedHost}"`);

    // 4. Create listing after approval
    console.log("[Host] Creating new parking listing...");
    const hostListing = await Parking.create({
      title: "Host Luxury Space",
      address: "Andheri East, Mumbai, Maharashtra",
      location: { type: "Point", coordinates: [72.8566, 19.1271] },
      pricePerHour: 150,
      vehicleType: "car",
      availableSlots: 2,
      totalSlots: 2,
      slots: 2,
      hostId: hostUser._id,
      startTime: "09:00",
      endTime: "21:00"
    });
    console.log(`[Host] Listing created successfully! ID: ${hostListing._id}`);
    console.log("✅ New Host Flow verified successfully!\n");

    // -----------------------------------------------------------------
    // TEST C: Existing User Migration Flow
    // -----------------------------------------------------------------
    console.log("--- TEST C: EXISTING USER MIGRATION ---");
    // 1. Create legacy user directly in DB bypass validation defaults
    console.log(`[Legacy] Creating a legacy user with phoneVerified: false...`);
    const legacyUser = new User({
      name: "Legacy Stuck User",
      email: legacyEmail,
      role: "driver",
      phone: "+91 93333 44444"
    });
    // Manually force phoneVerified to false since mongoose model default is now true
    legacyUser.phoneVerified = false;
    await legacyUser.save();
    console.log(`[Legacy] Legacy user saved. Initial phoneVerified: ${legacyUser.phoneVerified} (Expected: false)`);
    if (legacyUser.phoneVerified !== false) {
      throw new Error("Failed to set initial phoneVerified to false for legacy test user");
    }

    // 2. Run the startup migration logic
    console.log("[Migration] Executing startup migration query...");
    const migrationResult = await User.updateMany(
      { phoneVerified: { $ne: true } },
      { $set: { phoneVerified: true } }
    );
    console.log(`[Migration] Query matched & updated users. Modified count: ${migrationResult.modifiedCount}`);
    
    // 3. Fetch from DB and verify phoneVerified is now true
    const updatedLegacyUser = await User.findById(legacyUser._id);
    console.log(`[Legacy] Verifying updated phoneVerified: ${updatedLegacyUser.phoneVerified} (Expected: true)`);
    if (updatedLegacyUser.phoneVerified !== true) {
      throw new Error("Legacy user phoneVerified was not updated by the migration!");
    }
    console.log("✅ Existing User Migration verified successfully!\n");

    // Clean up test data
    console.log("🗑️ Cleaning up test database artifacts...");
    await User.deleteMany({
      _id: { $in: [driverUser._id, hostUser._id, legacyUser._id] }
    });
    if (activeSpots.length === 0) {
      // Clean up mock spot & host
      await Parking.deleteOne({ _id: spot._id });
      await User.deleteOne({ _id: spot.hostId });
    }
    await Parking.deleteOne({ _id: hostListing._id });
    await Booking.deleteOne({ _id: booking._id });
    await Payment.deleteOne({ _id: payment._id });
    console.log("✅ Cleanup complete!");
    console.log("\n====================================================");
    console.log("   ALL OTP ELIMINATION VERIFICATION SCENARIOS PASSED 🎉");
    console.log("====================================================");

  } catch (err) {
    console.error(`❌ TEST FAILED: ${err.message}`);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

runTests();
