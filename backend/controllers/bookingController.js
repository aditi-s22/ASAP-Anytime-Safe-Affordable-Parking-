const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const Parking = require("../models/Parking");
const Payment = require("../models/Payment");
const { checkListingBookable } = require("../utils/listingEligibility");

// Auto-cancel unpaid bookings older than 10 minutes
const autoCancelUnpaidBookings = async () => {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const result = await Booking.updateMany(
      {
        paymentStatus: "pending",
        createdAt: { $lt: tenMinutesAgo },
        status: "pending"
      },
      {
        $set: { status: "cancelled" }
      }
    );
    if (result.modifiedCount > 0) {
      console.log(`Auto-cancelled ${result.modifiedCount} unpaid bookings.`);
    }
  } catch (error) {
    console.error("Error in auto-cancelling unpaid bookings:", error);
  }
};

// Run sweep every 2 minutes
setInterval(autoCancelUnpaidBookings, 2 * 60 * 1000);

// CREATE BOOKING
exports.createBooking = async (req, res) => {
  try {
    const { parkingId, startTime, endTime } = req.body;
    const userId = req.user._id;

    const start = new Date(startTime);
    const end = new Date(endTime);

    if (start >= end) {
      return res.status(400).json({ message: "Start time must be before end time" });
    }

    if (start < new Date()) {
      return res.status(400).json({ message: "Start time cannot be in the past" });
    }

    // Booking eligibility — not found / pending / rejected / suspended / host
    // deactivated are all enforced here, server-side, regardless of what the
    // frontend shows. A client that already knows a parkingId (stale page,
    // bookmark, direct API call) can never book a listing that isn't currently
    // isApproved && isActive with an active host.
    const eligibility = await checkListingBookable(parkingId);
    if (!eligibility.ok) {
      return res.status(eligibility.status).json({ message: eligibility.message });
    }
    const parking = eligibility.parking;

    const hours = Math.max(1, (end - start) / (1000 * 60 * 60));
    const totalPrice = Math.round(hours * parking.pricePerHour);
    const maxSlots = parking.slots || parking.totalSlots || 1;

    // Pending (unpaid) bookings only count against availability while still inside the
    // 10-minute auto-cancel window (see sweep below); paid bookings always count.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const overlapFilter = {
      parkingId,
      status: { $nin: ["cancelled", "completed", "refunded"] },
      startTime: { $lt: end },
      endTime: { $gt: start },
      $or: [
        { paymentStatus: "paid" },
        { createdAt: { $gte: tenMinutesAgo } }
      ]
    };

    let booking;
    const session = await mongoose.startSession();
    try {
      try {
        await session.withTransaction(async () => {
          const overlappingCount = await Booking.countDocuments(overlapFilter).session(session);
          if (overlappingCount >= maxSlots) {
            throw new Error("NO_SLOTS_AVAILABLE");
          }
          // Count-then-insert alone can't be raced out: two concurrent transactions each
          // insert their own independent Booking document, so MongoDB never sees a
          // write-write conflict between them and both can pass the count check for the
          // last slot. Touching the same Parking document inside the transaction gives
          // concurrent attempts on this listing a real shared write to conflict over —
          // one aborts with a TransientTransactionError, which withTransaction retries
          // automatically against a fresh (now-accurate) overlap count.
          await Parking.updateOne({ _id: parkingId }, { $inc: { totalBookings: 1 } }, { session });
          // Model.create() treats a single plain-object first argument as varargs, not a doc — must use array form to pass { session }.
          [booking] = await Booking.create([{ userId, parkingId, startTime: start, endTime: end, totalPrice }], { session });
        });
      } catch (txError) {
        if (txError.message === "NO_SLOTS_AVAILABLE") {
          throw txError;
        }
        const transactionsUnsupported = /Transaction numbers are only allowed|IllegalOperation|Transactions are not supported/i.test(txError.message || "");
        if (!transactionsUnsupported) {
          throw txError;
        }
        // Standalone MongoDB (no replica set) — fall back to a best-effort, non-transactional check.
        console.warn("MongoDB transactions unsupported on this deployment — falling back to best-effort overlap check for booking creation.");
        const overlappingCount = await Booking.countDocuments(overlapFilter);
        if (overlappingCount >= maxSlots) {
          throw new Error("NO_SLOTS_AVAILABLE");
        }
        booking = await Booking.create({ userId, parkingId, startTime: start, endTime: end, totalPrice });
      }
    } finally {
      session.endSession();
    }

    res.status(201).json(booking);
  } catch (error) {
    if (error.message === "NO_SLOTS_AVAILABLE") {
      return res.status(400).json({ message: "No slots available for the selected time range" });
    }
    res.status(500).json({ error: error.message });
  }
};

// VERIFY QR TOKEN (host of this spot, admin, OR the driver who owns this booking —
// the driver checking in with their own ticket is a normal, expected self-service path)
exports.verifyQRToken = async (req, res) => {
  try {
    const { qrToken } = req.params;
    const booking = await Booking.findOne({ qrToken })
      .populate("userId", "name email phone")
      .populate("parkingId", "title address hostId");

    if (!booking) {
      return res.status(404).json({ message: "Invalid QR code ticket" });
    }

    const driverId = booking.userId?._id ? booking.userId._id.toString() : booking.userId.toString();
    const isHost = booking.parkingId?.hostId?.toString() === req.user._id.toString();
    const isOwner = driverId === req.user._id.toString();
    if (!isHost && !isOwner && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to check in this booking" });
    }

    // Expiration check
    if (booking.endTime < new Date() && (booking.status === "paid" || booking.status === "pending")) {
      return res.status(400).json({ message: "Ticket has expired (booking end time passed)" });
    }

    const alreadyCheckedIn = ["checked_in", "active", "completed"].includes(booking.status);
    if (!alreadyCheckedIn) {
      if (booking.status !== "paid") {
        return res.status(400).json({ message: `Cannot check-in booking with status: ${booking.status}` });
      }
      booking.status = "checked_in";
      booking.checkInTime = new Date();
      booking.checkedIn = true;
      booking.checkedInAt = new Date();
      await booking.save();

      const Notification = require("../models/Notification");
      const io = req.app.get("io");

      // Notify the driver. booking.userId is populated above (a User doc, not an
      // ObjectId) — calling .toString() on it directly returns "[object Object]",
      // silently sending the live socket push to a nonexistent room while the
      // Notification document still saves fine, which is why check-ins never
      // showed up in real time. Use the resolved driverId string instead.
      const driverNotification = await Notification.create({
        userId: driverId,
        title: "Checked In via QR Scan",
        message: `You have successfully checked in at "${booking.parkingId.title}".`,
        type: "check_in_reminder"
      });
      if (io) io.to(driverId).emit("notification", driverNotification);

      // Notify the host too — previously only the driver learned about a check-in,
      // so the host dashboard had no signal that a vehicle had arrived.
      const hostId = booking.parkingId?.hostId;
      if (hostId) {
        const hostNotification = await Notification.create({
          userId: hostId,
          title: "Driver Checked In",
          message: `${booking.userId?.name || "A driver"} has checked in at "${booking.parkingId.title}".`,
          type: "host_alert"
        });
        if (io) {
          io.to(hostId.toString()).emit("notification", hostNotification);
          // Dedicated event so dashboards can refetch precisely instead of
          // reacting to every unrelated notification.
          io.to(hostId.toString()).emit("booking_status_changed", { bookingId: booking._id, parkingId: booking.parkingId._id, status: "checked_in" });
        }
        io && io.to(driverId).emit("booking_status_changed", { bookingId: booking._id, parkingId: booking.parkingId._id, status: "checked_in" });
      }
    }

    res.json({
      valid: true,
      alreadyCheckedIn,
      booking
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// GET USER BOOKINGS (own bookings or admin only)
exports.getUserBookings = async (req, res) => {
  try {
    if (req.params.userId !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to view these bookings" });
    }

    const bookings = await Booking.find({ userId: req.params.userId })
      .populate("parkingId")
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


// GET PARKING BOOKINGS (host of this spot or admin only)
exports.getParkingBookings = async (req, res) => {
  try {
    const parking = await Parking.findById(req.params.parkingId);
    if (!parking) {
      return res.status(404).json({ message: "Parking not found" });
    }
    if (parking.hostId.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to view these bookings" });
    }

    const bookings = await Booking.find({ parkingId: req.params.parkingId })
      .populate("userId", "name email phone")
      .populate("parkingId", "title address")
      .sort({ startTime: 1 });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// CANCEL BOOKING (owner or admin only)
exports.cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.userId.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to cancel this booking" });
    }

    if (booking.status === "cancelled" || booking.status === "refunded") {
      return res.status(400).json({ message: "Booking is already cancelled or refunded" });
    }

    if (booking.paymentStatus === "paid") {
      booking.status = "refund_pending";
      booking.refundReason = "User requested cancellation";
      await booking.save();

      // flag the payment records as refund_pending
      await Payment.updateMany({ bookingId: booking._id, status: "captured" }, { status: "refund_pending" });

      // Create notification
      const Notification = require("../models/Notification");
      await Notification.create({
        userId: booking.userId,
        title: "Refund Request Initiated",
        message: `Your refund request for booking at "${booking.parkingId?.title || 'spot'}" is pending admin approval.`,
        type: "cancellation"
      });
    } else {
      booking.status = "cancelled";
      await booking.save();
    }

    res.json({ message: "Booking cancelled successfully", booking });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// MANUAL CHECK-IN
exports.checkInBooking = async (req, res) => {
  try {
    const { qrToken } = req.body;
    if (!qrToken) return res.status(400).json({ message: "QR Token is required" });
    req.params.qrToken = qrToken;
    return exports.verifyQRToken(req, res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// START SESSION BOOKING (PATCH /bookings/:id/start)
exports.startSessionBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate("parkingId");
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    // Host or admin check
    if (booking.parkingId.hostId.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to modify this booking" });
    }

    if (booking.status !== "checked_in") {
      return res.status(400).json({ message: "Booking session can only be started after check-in." });
    }

    booking.status = "active";
    await booking.save();

    // Create user notification
    const Notification = require("../models/Notification");
    const notification = await Notification.create({
      userId: booking.userId,
      title: "Parking Session Active 🚗",
      message: `Your parking session for "${booking.parkingId.title}" is now active.`,
      type: "booking_confirmed"
    });
    const io = req.app.get("io");
    if (io) {
      io.to(booking.userId.toString()).emit("notification", notification);
      io.to(booking.userId.toString()).emit("booking_status_changed", { bookingId: booking._id, parkingId: booking.parkingId._id, status: "active" });
    }

    res.json({ message: "Parking session is now active", booking });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// CHECK OUT BOOKING (PATCH /bookings/:id/check-out)
exports.checkOutBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate("parkingId");
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    // Host or admin check
    if (booking.parkingId.hostId.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to modify this booking" });
    }

    if (!["checked_in", "active"].includes(booking.status)) {
      return res.status(400).json({ message: "Booking must be checked_in or active to check-out" });
    }

    const checkOutDate = new Date();
    booking.status = "completed";
    booking.checkOutTime = checkOutDate;
    await booking.save();

    // Calculate actual parking duration
    const checkInDate = booking.checkInTime || booking.startTime;
    const durationMs = checkOutDate - checkInDate;
    const durationHours = parseFloat((durationMs / (1000 * 60 * 60)).toFixed(2));

    // Create user notification
    const Notification = require("../models/Notification");
    const notification = await Notification.create({
      userId: booking.userId,
      title: "Check-Out Confirmed & Session Complete",
      message: `Your checkout at "${booking.parkingId.title}" is complete. Duration: ${durationHours} hr(s). Please rate your experience!`,
      type: "review_reminder"
    });
    const io = req.app.get("io");
    if (io) {
      io.to(booking.userId.toString()).emit("notification", notification);
      io.to(booking.userId.toString()).emit("booking_status_changed", { bookingId: booking._id, parkingId: booking.parkingId._id, status: "completed" });
    }

    res.json({ message: "Check-out completed successfully", booking, durationHours });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// EXTEND BOOKING (POST /bookings/:id/extend)
exports.extendBooking = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { hours } = req.body;
    if (!hours || isNaN(hours) || Number(hours) <= 0) {
      return res.status(400).json({ message: "Valid positive duration (hours) is required" });
    }

    let booking;
    let extraPrice;

    const currentBooking = await Booking.findById(req.params.id).populate("parkingId");
    if (!currentBooking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // Enforce authorization
    if (currentBooking.userId.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to extend this booking" });
    }

    if (["completed", "cancelled", "refunded"].includes(currentBooking.status)) {
      return res.status(400).json({ message: "Cannot extend a completed, cancelled or refunded booking" });
    }

    // A listing can be suspended/rejected after the original booking was made —
    // re-check current eligibility before allowing more time to be added to it.
    const eligibility = await checkListingBookable(currentBooking.parkingId._id);
    if (!eligibility.ok) {
      return res.status(eligibility.status).json({ message: eligibility.message });
    }

    const addedMs = Number(hours) * 60 * 60 * 1000;
    const currentEnd = new Date(currentBooking.endTime);
    const newEnd = new Date(currentEnd.getTime() + addedMs);

    // Verify slot availability in database for the extension period
    const maxSlots = currentBooking.parkingId.slots || currentBooking.parkingId.totalSlots || 1;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const overlapFilter = {
      parkingId: currentBooking.parkingId._id,
      status: { $nin: ["cancelled", "completed", "refunded"] },
      _id: { $ne: currentBooking._id },
      startTime: { $lt: newEnd },
      endTime: { $gt: currentEnd },
      $or: [
        { paymentStatus: "paid" },
        { createdAt: { $gte: tenMinutesAgo } }
      ]
    };

    try {
      await session.withTransaction(async () => {
        const overlappingCount = await Booking.countDocuments(overlapFilter).session(session);
        if (overlappingCount >= maxSlots) {
          throw new Error("NO_SLOTS_AVAILABLE");
        }

        // Lock writing on the Parking listing to serialize concurrent extensions/bookings
        await Parking.updateOne({ _id: currentBooking.parkingId._id }, { $inc: { totalBookings: 1 } }, { session });

        extraPrice = Math.round(Number(hours) * currentBooking.parkingId.pricePerHour);

        // Fetch & Update booking fields
        booking = await Booking.findById(req.params.id).session(session);
        booking.endTime = newEnd;
        booking.totalPrice = (booking.totalPrice || 0) + extraPrice;
        await booking.save({ session });

        // Create extension Payment record
        const Payment = require("../models/Payment");
        await Payment.create([{
          bookingId: booking._id,
          razorpayOrderId: `ext_order_${booking._id}_${Date.now()}`,
          razorpayPaymentId: `ext_pay_${booking._id}_${Date.now()}`,
          amount: extraPrice,
          status: "captured"
        }], { session });
      });
    } catch (txError) {
      if (txError.message === "NO_SLOTS_AVAILABLE") {
        throw txError;
      }
      const transactionsUnsupported = /Transaction numbers are only allowed|IllegalOperation|Transactions are not supported/i.test(txError.message || "");
      if (!transactionsUnsupported) {
        throw txError;
      }
      // Non-transactional fallback
      console.warn("MongoDB transactions unsupported on this deployment — falling back to best-effort overlap check for booking extension.");
      const overlappingCount = await Booking.countDocuments(overlapFilter);
      if (overlappingCount >= maxSlots) {
        throw new Error("NO_SLOTS_AVAILABLE");
      }

      extraPrice = Math.round(Number(hours) * currentBooking.parkingId.pricePerHour);
      booking = await Booking.findById(req.params.id);
      booking.endTime = newEnd;
      booking.totalPrice = (booking.totalPrice || 0) + extraPrice;
      await booking.save();

      const Payment = require("../models/Payment");
      await Payment.create({
        bookingId: booking._id,
        razorpayOrderId: `ext_order_${booking._id}_${Date.now()}`,
        razorpayPaymentId: `ext_pay_${booking._id}_${Date.now()}`,
        amount: extraPrice,
        status: "captured"
      });
    }

    // Outside transaction, perform non-database updates (Socket.io notification, etc.)
    const Notification = require("../models/Notification");
    const notification = await Notification.create({
      userId: booking.userId,
      title: "Booking Extended Successfully",
      message: `Your booking for "${currentBooking.parkingId.title}" is extended by ${hours} hr(s). Extra charged: ₹${extraPrice}.`,
      type: "booking_confirmed"
    });
    
    const io = req.app.get("io");
    if (io) {
      io.to(booking.userId.toString()).emit("notification", notification);
      io.emit("availability_change", { parkingId: currentBooking.parkingId._id });
    }

    res.json({ message: "Booking extended successfully", booking, extraPrice });

  } catch (error) {
    if (error.message === "NO_SLOTS_AVAILABLE") {
      return res.status(400).json({ message: "No slots available for this extension period" });
    }
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
};