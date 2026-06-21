const Razorpay = require("razorpay");
const crypto = require("crypto");
const qrcode = require("qrcode");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Notification = require("../models/Notification");
const { checkListingBookable } = require("../utils/listingEligibility");

const hasRealRazorpayKeys = () =>
  Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

// Dev-only simulated payments are only ever allowed when no real keys are configured
// AND we are not in production — this never silently bypasses payment in a real deployment.
const isDevSimulationAllowed = () =>
  process.env.NODE_ENV !== "production" && !hasRealRazorpayKeys();

const getRazorpayInstance = () => {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

// CREATE ORDER — amount is always derived server-side from the booking's stored
// totalPrice, never from client input, and the order is bound to that one booking.
exports.createOrder = async (req, res) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required" });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    if (booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized for this booking" });
    }
    if (booking.status === "cancelled") {
      return res.status(400).json({ message: "Booking has been cancelled" });
    }
    if (booking.paymentStatus === "paid") {
      return res.status(400).json({ message: "Booking is already paid" });
    }

    // The listing may have been suspended/rejected after this booking was created
    // but before payment — don't let a driver pay for a spot that's no longer eligible.
    const eligibility = await checkListingBookable(booking.parkingId);
    if (!eligibility.ok) {
      return res.status(eligibility.status).json({ message: eligibility.message });
    }

    const amountInPaise = Math.round(booking.totalPrice * 100);
    let order;

    if (hasRealRazorpayKeys()) {
      const razorpay = getRazorpayInstance();
      order = await razorpay.orders.create({
        amount: amountInPaise,
        currency: "INR",
        receipt: `asap_booking_${booking._id}`,
      });
    } else if (isDevSimulationAllowed()) {
      console.warn(`[DEV SIMULATION] No Razorpay keys configured — generating a simulated order for booking ${booking._id}.`);
      order = {
        id: `order_sim_${booking._id}_${Date.now()}`,
        amount: amountInPaise,
        currency: "INR",
      };
    } else {
      return res.status(503).json({ message: "Payment service is not configured" });
    }

    booking.razorpayOrderId = order.id;
    await booking.save();

    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// VERIFY PAYMENT — requires the order id to match the one this server issued for
// this exact booking, then either does real HMAC verification or, only in the dev
// simulation case, trusts that pre-bound match (never a client-fabricated string).
exports.verifyPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingId
    } = req.body;

    if (!bookingId || !razorpay_order_id || !razorpay_payment_id) {
      return res.status(400).json({ message: "Booking ID, order ID and payment ID are required" });
    }

    const booking = await Booking.findById(bookingId).populate("parkingId");
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    if (booking.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized for this booking" });
    }
    if (booking.paymentStatus === "paid") {
      return res.status(400).json({ message: "Booking is already paid" });
    }
    if (!booking.razorpayOrderId || booking.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({ message: "Order ID does not match this booking" });
    }

    let isVerified = false;

    if (hasRealRazorpayKeys()) {
      const generated_signature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(razorpay_order_id + "|" + razorpay_payment_id)
        .digest("hex");
      isVerified = generated_signature === razorpay_signature;
    } else if (isDevSimulationAllowed() && razorpay_order_id.startsWith("order_sim_")) {
      console.warn(`[DEV SIMULATION] Accepting simulated payment for booking ${booking._id}.`);
      isVerified = true;
    } else {
      return res.status(503).json({ message: "Payment service is not configured" });
    }

    if (!isVerified) {
      return res.status(400).json({ message: "Payment verification failed", verified: false });
    }

    booking.paymentStatus = "paid";
    booking.status = "paid";

    // Generate QR Token and Code (data URL image)
    const qrToken = crypto.randomBytes(16).toString("hex");
    const qrCodeDataUrl = await qrcode.toDataURL(qrToken);

    booking.qrToken = qrToken;
    booking.qrCode = qrCodeDataUrl;
    await booking.save();

    // Create Payment record
    await Payment.create({
      bookingId,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      amount: booking.totalPrice,
      status: "captured"
    });

    // Create user notification
    const notification = await Notification.create({
      userId: booking.userId,
      title: "Payment Successful & Booking Confirmed!",
      message: `Your booking for the spot is confirmed. Total: ₹${booking.totalPrice}. Your QR ticket is ready.`,
      type: "payment_success"
    });

    // Push notifications via Socket.io
    const io = req.app.get("io");
    if (io) {
      io.to(booking.userId.toString()).emit("notification", notification);
      io.emit("availability_change", { parkingId: booking.parkingId._id });

      const hostId = booking.parkingId?.hostId;
      if (hostId) {
        io.to(hostId.toString()).emit("new_booking", {
          title: "New Booking Alert!",
          message: `Someone booked your space "${booking.parkingId.title}" for ₹${booking.totalPrice}!`,
          bookingId: booking._id
        });
      }
    }

    res.status(200).json({ message: "Payment verified successfully", verified: true, booking });
  } catch (error) {
    console.error("verifyPayment Error:", error);
    res.status(500).json({ error: error.message });
  }
};
