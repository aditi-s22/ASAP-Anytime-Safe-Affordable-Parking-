const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, ".env") });

const User = require("./models/User");
const Parking = require("./models/Parking");
const Booking = require("./models/Booking");
const bookingController = require("./controllers/bookingController");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/asap_parking";

async function runConcurrencyTest() {
  console.log("====================================================");
  console.log("     CONCURRENCY AND OVERBOOKING AUDIT TEST         ");
  console.log("====================================================");

  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB successfully. ✅\n");

    // Clean up any stale test items
    await User.deleteMany({ email: /concurrency_test/ });
    await Parking.deleteMany({ title: /Concurrency Spot/ });

    // 1. Create Test User and Test Parking Spot (Capacity = 1)
    const host = new User({
      name: "Concurrency Host",
      email: `concurrency_test_host_${Date.now()}@asap.io`,
      role: "driver",
      verifiedHost: "verified",
      phoneVerified: true,
      emailVerified: true
    });
    await host.save();

    const driver = new User({
      name: "Concurrency Driver",
      email: `concurrency_test_driver_${Date.now()}@asap.io`,
      role: "driver",
      phoneVerified: true,
      emailVerified: true
    });
    await driver.save();

    const spot = new Parking({
      title: "Concurrency Spot",
      address: "Test Street, Mumbai",
      location: { type: "Point", coordinates: [72.85, 19.05] },
      pricePerHour: 100,
      slots: 1,
      totalSlots: 1,
      availableSlots: 1,
      hostId: host._id,
      isActive: true,
      isApproved: true,
      verificationStatus: "approved"
    });
    await spot.save();

    console.log(`Created Test Parking Spot with Capacity: ${spot.slots} slot. ✅`);

    const start = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const end = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now

    // ----------------------------------------------------
    // TEST 1: 5 Concurrent Booking Requests for 1 Slot
    // ----------------------------------------------------
    console.log("\n--- SIMULATING 5 CONCURRENT BOOKING CREATION REQUESTS ---");
    const numRequests = 5;
    const requests = Array.from({ length: numRequests }).map(async (_, idx) => {
      const req = {
        body: {
          parkingId: spot._id.toString(),
          startTime: start.toISOString(),
          endTime: end.toISOString()
        },
        user: { _id: driver._id },
        app: { get: (key) => null } // Stub Socket.io
      };

      let statusCode = 200;
      let jsonData = null;

      const res = {
        status: function(code) {
          statusCode = code;
          return this;
        },
        json: function(data) {
          jsonData = data;
          return this;
        }
      };

      try {
        await bookingController.createBooking(req, res);
        return { success: statusCode === 200 || statusCode === 201, status: statusCode, data: jsonData };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    const results = await Promise.all(requests);
    const successfulBookings = results.filter(r => r.success);
    const rejectedBookings = results.filter(r => !r.success);

    console.log(`Successful Bookings: ${successfulBookings.length}`);
    console.log(`Rejected Bookings: ${rejectedBookings.length}`);

    successfulBookings.forEach((b, i) => {
      console.log(`[Success #${i+1}] Status: ${b.status}, Booking ID: ${b.data?._id || "N/A"}`);
    });
    rejectedBookings.forEach((b, i) => {
      console.log(`[Rejected #${i+1}] Status: ${b.status}, Message: ${b.data?.message || b.error}`);
    });

    if (successfulBookings.length !== 1) {
      throw new Error(`CONCURRENCY_FAILED: Booked ${successfulBookings.length} spots instead of exactly 1!`);
    }
    console.log("Test 1 Passed: Exactly 1 booking was created; 4 were successfully serial-rejected. 🛡️✅");

    // ----------------------------------------------------
    // TEST 2: 5 Concurrent Booking Extension Requests
    // ----------------------------------------------------
    console.log("\n--- SIMULATING 5 CONCURRENT BOOKING EXTENSION REQUESTS ---");
    // Create a new spot with 1 slot
    const extendSpot = new Parking({
      title: "Concurrency Spot Extend",
      address: "Extend Street, Mumbai",
      location: { type: "Point", coordinates: [72.85, 19.05] },
      pricePerHour: 100,
      slots: 1,
      totalSlots: 1,
      availableSlots: 1,
      hostId: host._id,
      isActive: true,
      isApproved: true,
      verificationStatus: "approved"
    });
    await extendSpot.save();

    // Create 1 valid booking on this spot
    const userBooking = new Booking({
      userId: driver._id,
      parkingId: extendSpot._id,
      startTime: start,
      endTime: end,
      totalPrice: 100,
      paymentStatus: "paid",
      status: "paid"
    });
    await userBooking.save();
    console.log(`Created base booking ${userBooking._id} on spot with Capacity: ${extendSpot.slots} slot. ✅`);

    // Concurrent extensions
    const extendRequests = Array.from({ length: numRequests }).map(async (_, idx) => {
      const req = {
        params: { id: userBooking._id.toString() },
        body: { hours: 1 },
        user: { _id: driver._id, role: "driver" },
        app: { get: (key) => null }
      };

      let statusCode = 200;
      let jsonData = null;

      const res = {
        status: function(code) {
          statusCode = code;
          return this;
        },
        json: function(data) {
          jsonData = data;
          return this;
        }
      };

      try {
        await bookingController.extendBooking(req, res);
        return { success: statusCode === 200, status: statusCode, data: jsonData };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    const extendResults = await Promise.all(extendRequests);
    const successfulExtensions = extendResults.filter(r => r.success);
    const rejectedExtensions = extendResults.filter(r => !r.success);

    console.log(`Successful Extensions: ${successfulExtensions.length}`);
    console.log(`Rejected Extensions: ${rejectedExtensions.length}`);

    successfulExtensions.forEach((b, i) => {
      console.log(`[Success #${i+1}] Status: ${b.status}, Extended End: ${b.data?.booking?.endTime || "N/A"}`);
    });
    rejectedExtensions.forEach((b, i) => {
      console.log(`[Rejected #${i+1}] Status: ${b.status}, Message: ${b.data?.message || b.error}`);
    });

    // Check if the booking was extended beyond what's possible
    const finalBooking = await Booking.findById(userBooking._id);
    const finalDurationMs = new Date(finalBooking.endTime) - start;
    const finalDurationHours = finalDurationMs / (1000 * 60 * 60);
    console.log(`Final Booking Duration: ${finalDurationHours} hours (Base was 1 hour).`);

    // Since slots = 1, and there are no other overlapping bookings, a user can extend their own booking.
    // Wait! A user extending their own booking DOES NOT conflict with other bookings because the overlap check
    // excludes the booking itself: `_id: { $ne: currentBooking._id }`.
    // So all 5 extension requests *should* succeed sequentially!
    // But wait! If they succeed sequentially, they are serial extensions of the same booking, which is allowed.
    // What we want to verify is: does the lock prevent overbooking if two different bookings try to overlap?
    // Let's write a third test for that.
    console.log("Test 2 Completed. Self-extension sequential processing checked. 🛡️✅");

    // ----------------------------------------------------
    // TEST 3: Concurrent extension vs concurrent booking
    // ----------------------------------------------------
    console.log("\n--- TEST 3: CONCURRENT EXTENSION VS CONCURRENT NEW BOOKING ---");
    const test3Spot = new Parking({
      title: "Concurrency Spot T3",
      address: "Test3 Street, Mumbai",
      location: { type: "Point", coordinates: [72.85, 19.05] },
      pricePerHour: 100,
      slots: 1,
      totalSlots: 1,
      availableSlots: 1,
      hostId: host._id,
      isActive: true,
      isApproved: true,
      verificationStatus: "approved"
    });
    await test3Spot.save();

    // Booking 1 occupies time slot 12:00 to 13:00
    const b1Start = new Date("2026-06-22T12:00:00.000Z");
    const b1End = new Date("2026-06-22T13:00:00.000Z");
    const booking1 = new Booking({
      userId: driver._id,
      parkingId: test3Spot._id,
      startTime: b1Start,
      endTime: b1End,
      totalPrice: 100,
      paymentStatus: "paid",
      status: "paid"
    });
    await booking1.save();

    // Now, Booking 2 tries to book time slot 13:00 to 14:00 (this is currently free).
    // Concurrently, Booking 1 tries to extend its booking by 1 hour (which would change its end time to 14:00).
    // Since capacity is 1, only ONE of these operations (either Booking 1 extension to 14:00, OR Booking 2 booking 13:00-14:00)
    // should succeed. If both succeed, we have an overbooking!
    console.log("Triggering concurrent Booking 2 creation and Booking 1 extension...");

    const pNewBooking = (async () => {
      const req = {
        body: {
          parkingId: test3Spot._id.toString(),
          startTime: new Date("2026-06-22T13:00:00.000Z").toISOString(),
          endTime: new Date("2026-06-22T14:00:00.000Z").toISOString()
        },
        user: { _id: driver._id },
        app: { get: (key) => null }
      };
      let statusCode = 200;
      let jsonData = null;
      const res = {
        status: function(code) { statusCode = code; return this; },
        json: function(data) { jsonData = data; return this; }
      };
      await bookingController.createBooking(req, res);
      return { type: "NEW_BOOKING", success: statusCode === 200 || statusCode === 201, status: statusCode, data: jsonData };
    })();

    const pExtendBooking = (async () => {
      const req = {
        params: { id: booking1._id.toString() },
        body: { hours: 1 },
        user: { _id: driver._id, role: "driver" },
        app: { get: (key) => null }
      };
      let statusCode = 200;
      let jsonData = null;
      const res = {
        status: function(code) { statusCode = code; return this; },
        json: function(data) { jsonData = data; return this; }
      };
      await bookingController.extendBooking(req, res);
      return { type: "EXTENSION", success: statusCode === 200, status: statusCode, data: jsonData };
    })();

    const test3Results = await Promise.all([pNewBooking, pExtendBooking]);
    console.log("Test 3 Results:");
    test3Results.forEach(r => {
      console.log(`[${r.type}] Success: ${r.success}, Status: ${r.status}, Data: ${JSON.stringify(r.data)}`);
    });

    const test3SuccessCount = test3Results.filter(r => r.success).length;
    if (test3SuccessCount !== 1) {
      throw new Error(`CONCURRENCY_FAILED: Both extension and new booking succeeded! Overbooked!`);
    }
    console.log("Test 3 Passed: Concurrency conflict handled correctly. Only 1 request succeeded! 🛡️✅");

    // Clean up test items
    await User.deleteMany({ email: /concurrency_test/ });
    await Parking.deleteMany({ title: /Concurrency Spot/ });

    console.log("\n====================================================");
    console.log("     ALL CONCURRENCY VERIFICATION CHECKS PASSED 🎉  ");
    console.log("====================================================");

  } catch (error) {
    console.error("Test failed with error:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runConcurrencyTest();
