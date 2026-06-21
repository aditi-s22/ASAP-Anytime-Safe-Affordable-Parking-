const Parking = require("../models/Parking");
const Booking = require("../models/Booking");
const mongoose = require("mongoose");

const getDynamicAvailableSlots = async (parkingDoc) => {
  const now = new Date();
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const activeBookingsCount = await Booking.countDocuments({
    parkingId: parkingDoc._id,
    startTime: { $lte: now },
    endTime: { $gte: now },
    status: { $nin: ["cancelled", "completed", "refunded"] },
    $or: [
      { paymentStatus: "paid" },
      { createdAt: { $gte: tenMinutesAgo } }
    ]
  });
  const capacity = parkingDoc.slots || parkingDoc.totalSlots || 1;
  return Math.max(0, capacity - activeBookingsCount);
};

const addDynamicSlots = async (parking) => {
  if (!parking) return null;
  const doc = parking.toObject ? parking.toObject() : parking;
  const dynSlots = await getDynamicAvailableSlots(doc);
  doc.availableSlots = dynSlots;
  doc.availableSpots = dynSlots;
  return doc;
};

// ADD PARKING
// Workflow 2 (listing verification) is independent of Workflow 1 (host verification) —
// this only checks that Workflow 1 has been completed once; it never re-triggers it.
exports.addParking = async (req, res) => {
  try {
    if (req.user.verifiedHost !== "verified" && req.user.role !== "admin") {
      return res.status(403).json({ message: "You must complete host verification before creating a listing." });
    }

    const { title, address, latitude, longitude, pricePerHour, vehicleType, slots, startTime, endTime, images } = req.body;

    const parking = await Parking.create({
      title,
      address,
      pricePerHour,
      vehicleType,
      slots,
      totalSlots: slots,
      availableSlots: slots,
      startTime,
      endTime,
      images: images || [],
      hostId: req.user._id, // pulled from auth middleware
      location: {
        type: "Point",
        coordinates: [longitude, latitude]
      },
      isApproved: false,
      verificationStatus: "pending",
      isActive: false
    });

    console.log(`[Listing Created] Storing listing: Title: "${parking.title}", Address: "${parking.address}", Price: ₹${parking.pricePerHour}/hr, Slots: ${parking.slots}, Vehicle: "${parking.vehicleType}", Start: "${parking.startTime}", End: "${parking.endTime}", hostId: ${parking.hostId}, Lng/Lat: [${parking.location.coordinates}], Images: ${JSON.stringify(parking.images)}, isApproved: ${parking.isApproved}, verificationStatus: "${parking.verificationStatus}", isActive: ${parking.isActive}`);

    res.status(201).json(parking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET ALL PARKING
exports.getAllParking = async (req, res) => {
  try {
    // Public endpoint, no auth — never expose host email/phone here.
    const parkings = await Parking.find({ isActive: true, isApproved: true }).populate("hostId", "name verifiedHost");
    const updated = await Promise.all(parkings.map(p => addDynamicSlots(p)));
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET PARKING BY ID
exports.getParkingById = async (req, res) => {
  try {
    // Public endpoint, no auth — never expose host email/phone here.
    const parking = await Parking.findById(req.params.id).populate("hostId", "name verifiedHost");
    if (!parking) return res.status(404).json({ message: "Parking not found" });
    const updated = await addDynamicSlots(parking);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
};

// FIND NEARBY PARKING
exports.getNearbyParking = async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ message: "Latitude and longitude are required parameters" });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    console.log(`[Nearby Query] Lat: ${latitude}, Lng: ${longitude}`);

    // Query 1: 5km radius
    let parkings = await Parking.find({
      isActive: true,
      isApproved: true,
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [longitude, latitude] },
          $maxDistance: 5000 // 5km
        }
      }
    }).populate("hostId", "name verifiedHost");

    let isAlternative = false;

    // Fallback: search alternatives if no spots within 5km
    if (parkings.length === 0) {
      console.log(`[Nearby Query] 0 spots in 5km. Querying alternatives...`);
      parkings = await Parking.find({
        isActive: true,
        isApproved: true,
        location: {
          $near: {
            $geometry: { type: "Point", coordinates: [longitude, latitude] }
            // No maxDistance limit, just find closest ones
          }
        }
      })
      .populate("hostId", "name verifiedHost")
      .limit(5); // suggest up to 5 nearest alternatives
      
      isAlternative = true;
    }

    // Attach distance calculated by Haversine and formatting
    const results = await Promise.all(parkings.map(async (p) => {
      const obj = await addDynamicSlots(p);
      const coords = p.location.coordinates;
      obj.distance = calculateDistance(latitude, longitude, coords[1], coords[0]);
      if (isAlternative) {
        obj.isAlternative = true;
      }
      console.log(`[Host Listing Visible] Spot: "${p.title}" (ID: ${p._id}) is approved and visible in nearby search.`);
      return obj;
    }));

    console.log(`[Listing Search Results] Found ${results.length} spots in nearby search. Lng/Lat: [${longitude}, ${latitude}] | isAlternative: ${isAlternative}`);

    res.json(results);
  } catch (error) {
    console.error("Error in getNearbyParking:", error);
    res.status(500).json({ error: error.message });
  }
};

// GET HOST PARKINGS (owner or admin only — exposes unapproved/draft listings)
exports.getHostParkings = async (req, res) => {
  try {
    if (req.params.hostId !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to view this host's listings" });
    }
    const parkings = await Parking.find({ hostId: req.params.hostId });
    res.json(parkings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Fields a host is allowed to self-edit. Approval/verification/rating/etc. are server/admin-controlled only.
const UPDATABLE_PARKING_FIELDS = [
  "title", "address", "pricePerHour", "vehicleType",
  "slots", "totalSlots", "availableSlots", "startTime", "endTime",
  "images", "isActive"
];

// UPDATE PARKING
exports.updateParking = async (req, res) => {
  try {
    let parking = await Parking.findById(req.params.id);
    if (!parking) return res.status(404).json({ message: "Parking not found" });

    // Ensure user owns this parking
    if (parking.hostId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Not authorized" });
    }

    const updates = {};
    for (const field of UPDATABLE_PARKING_FIELDS) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    parking = await Parking.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    res.json(parking);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// DELETE PARKING
exports.deleteParking = async (req, res) => {
  try {
    let parking = await Parking.findById(req.params.id);
    if (!parking) return res.status(404).json({ message: "Parking not found" });

    if (parking.hostId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Not authorized" });
    }

    await parking.deleteOne();
    res.json({ message: "Parking listing removed" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET HOST METRICS (Aggregation)
exports.getHostMetrics = async (req, res) => {
  try {
    if (req.params.hostId !== req.user._id.toString() && req.user.role !== "admin") {
      return res.status(403).json({ message: "Not authorized to view this host's metrics" });
    }
    const hostId = new mongoose.Types.ObjectId(req.params.hostId);

    // 1. Get all active parking node counts for this host
    const activeNodesCount = await Parking.countDocuments({ hostId, isActive: true });

    // Find all parking IDs this host owns
    const hostParkings = await Parking.find({ hostId });
    const parkingIds = hostParkings.map(p => p._id);
    const totalSlots = hostParkings.reduce((sum, p) => sum + (p.slots || 0), 0);

    // 2. Aggregate Bookings data referencing those parking nodes
    const bookingMetrics = await Booking.aggregate([
      { $match: { parkingId: { $in: parkingIds }, status: { $nin: ["cancelled", "refunded"] } } },
      { 
        $group: { 
          _id: null, 
          totalRevenue: { $sum: "$totalPrice" },
          totalBookings: { $sum: 1 }
        } 
      }
    ]);

    const revenue = bookingMetrics.length > 0 ? bookingMetrics[0].totalRevenue : 0;
    const bookingsCount = bookingMetrics.length > 0 ? bookingMetrics[0].totalBookings : 0;
    const netRevenue = revenue * 0.9;

    // 3. Occupancy calculation
    const now = new Date();
    const activeBookingsCount = await Booking.countDocuments({
      parkingId: { $in: parkingIds },
      status: { $in: ["checked_in", "active"] },
      startTime: { $lte: now },
      endTime: { $gte: now }
    });

    const occupancyRate = totalSlots > 0 ? parseFloat(((activeBookingsCount / totalSlots) * 100).toFixed(1)) : 0;

    // 4. Most Booked Spot
    const bookingsBySpot = await Booking.aggregate([
      { $match: { parkingId: { $in: parkingIds }, status: { $nin: ["cancelled", "refunded"] } } },
      { $group: { _id: "$parkingId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);

    let mostBookedSpot = "N/A";
    if (bookingsBySpot.length > 0) {
      const spot = await Parking.findById(bookingsBySpot[0]._id);
      if (spot) {
        mostBookedSpot = spot.title;
      }
    }

    // 5. Revenue Today & This Month
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const bookingsToday = await Booking.find({
      parkingId: { $in: parkingIds },
      status: { $nin: ["cancelled", "refunded"] },
      createdAt: { $gte: startOfToday, $lte: endOfToday }
    });
    const revenueToday = bookingsToday.reduce((sum, b) => sum + (b.totalPrice || 0), 0) * 0.9;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const bookingsThisMonth = await Booking.find({
      parkingId: { $in: parkingIds },
      status: { $nin: ["cancelled", "refunded"] },
      createdAt: { $gte: startOfMonth }
    });
    const revenueThisMonth = bookingsThisMonth.reduce((sum, b) => sum + (b.totalPrice || 0), 0) * 0.9;

    // 6. Average Rating
    const ratedSpots = hostParkings.filter(p => p.rating > 0);
    const averageRating = ratedSpots.length > 0 
      ? parseFloat((ratedSpots.reduce((sum, p) => sum + p.rating, 0) / ratedSpots.length).toFixed(1))
      : 0;

    // 7. Peak Booking Hours
    const allBookings = await Booking.find({
      parkingId: { $in: parkingIds },
      status: { $nin: ["cancelled", "refunded"] }
    });
    const hoursCount = {};
    allBookings.forEach(b => {
      const hr = new Date(b.startTime).getHours();
      hoursCount[hr] = (hoursCount[hr] || 0) + 1;
    });
    let peakHour = 12;
    let maxCount = -1;
    Object.keys(hoursCount).forEach(hr => {
      if (hoursCount[hr] > maxCount) {
        maxCount = hoursCount[hr];
        peakHour = Number(hr);
      }
    });
    const formatHour = (h) => {
      const ampm = h >= 12 ? "PM" : "AM";
      const displayHour = h % 12 === 0 ? 12 : h % 12;
      return `${displayHour} ${ampm}`;
    };
    const peakBookingHours = allBookings.length > 0 
      ? `${formatHour(peakHour)} - ${formatHour((peakHour + 2) % 24)}`
      : "12:00 PM - 2:00 PM";

    // 8. Health Score calculation
    const totalReports = hostParkings.reduce((sum, p) => sum + (p.reports || 0), 0);
    const ratingFactor = averageRating > 0 ? (averageRating / 5) * 50 : 40;
    const occupancyFactor = (occupancyRate / 100) * 30;
    const reportFactor = Math.max(0, 20 - totalReports * 5);
    const score = ratingFactor + occupancyFactor + reportFactor + 10; // response rate base

    let healthScore = "Good";
    if (score >= 80) {
      healthScore = "Excellent";
    } else if (score < 50 || totalReports > 0) {
      healthScore = "Needs Attention";
    }

    res.json({
      activeNodes: activeNodesCount,
      netRevenue: netRevenue,
      totalBookings: bookingsCount,
      occupancyRate: occupancyRate,
      mostBookedSpot: mostBookedSpot,
      revenueToday: revenueToday,
      revenueThisMonth: revenueThisMonth,
      averageRating: averageRating || 5.0,
      peakBookingHours: peakBookingHours,
      healthScore: healthScore
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// SEARCH PARKING ALONG WITH FALLBACKS
exports.searchParking = async (req, res) => {
  try {
    const { query } = req.query;
    let filter = { isActive: true, isApproved: true };
    if (query) {
       filter.$or = [
         { title: { $regex: query, $options: "i" } },
         { address: { $regex: query, $options: "i" } }
       ];
    }
    const parkings = await Parking.find(filter).populate("hostId", "name verifiedHost").limit(10);
    console.log(`[Listing Search Results] Keyword: "${query || ""}" | Found ${parkings.length} matching spots: ` + JSON.stringify(parkings.map(p => ({ id: p._id, title: p.title }))));
    const updated = await Promise.all(parkings.map(p => addDynamicSlots(p)));
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET LIVE AVAILABILITY
exports.getLiveAvailability = async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.json({ availableSpots: 120 }); // Fallback mock

    const parkings = await Parking.find({
      isActive: true,
      isApproved: true,
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [parseFloat(lng), parseFloat(lat)] },
          $maxDistance: 10000 // 10km
        }
      }
    });

    const updated = await Promise.all(parkings.map(p => addDynamicSlots(p)));
    const sum = updated.reduce((acc, p) => acc + (p.availableSlots || 0), 0);
    res.json({ availableSpots: sum });
  } catch (error) {
    // If geo index fails or DB fails
    res.json({ availableSpots: 34 });
  }
};

// GET RECOMMENDED
exports.getRecommended = async (req, res) => {
  try {
    const parkings = await Parking.find({ isActive: true, isApproved: true }).sort({ rating: -1, totalBookings: -1 }).limit(4);
    const updated = await Promise.all(parkings.map(p => addDynamicSlots(p)));
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET DEALS
exports.getDeals = async (req, res) => {
  try {
    const parkings = await Parking.find({ isActive: true, isApproved: true, discountPercentage: { $gt: 0 } }).sort({ discountPercentage: -1 }).limit(4);
    const updated = await Promise.all(parkings.map(p => addDynamicSlots(p)));
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ADD REVIEW & RECALCULATE AVERAGE RATING
exports.addReview = async (req, res) => {
  try {
    const { rating, feedback, bookingId } = req.body;
    const parkingId = req.params.id;
    const userId = req.user._id;

    const Review = require("../models/Review");
    const Booking = require("../models/Booking");

    if (!bookingId) {
      return res.status(400).json({ message: "Booking ID is required to rate your experience." });
    }

    // 1. Verify booking ownership and completion
    const booking = await Booking.findOne({
      _id: bookingId,
      userId,
      parkingId
    });

    if (!booking) {
      return res.status(400).json({ message: "Booking not found or not owned by user." });
    }

    const isCompleted = booking.status === "completed" || new Date(booking.endTime) < new Date();
    if (!isCompleted) {
      return res.status(400).json({ message: "Reviews are only allowed after booking completion." });
    }

    // 2. Prevent double review submission
    const alreadyReviewed = await Review.findOne({ bookingId });
    if (alreadyReviewed) {
      return res.status(400).json({ message: "You have already reviewed this booking." });
    }

    const newReview = await Review.create({
      userId,
      parkingId,
      bookingId,
      rating: Number(rating),
      feedback
    });

    // 3. Update booking status to completed (if it was marked booked but time has passed)
    booking.reviewed = true;
    if (booking.status !== "completed") {
      booking.status = "completed";
    }
    await booking.save();

    // 4. Recalculate average rating for this parking spot
    const reviews = await Review.find({ parkingId });
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    
    await Parking.findByIdAndUpdate(parkingId, { 
      rating: parseFloat(avgRating.toFixed(1)) 
    });

    res.status(201).json(newReview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET REVIEWS FOR A PARKING SPOT
exports.getReviews = async (req, res) => {
  try {
    const Review = require("../models/Review");
    const reviews = await Review.find({ parkingId: req.params.id })
      .populate("userId", "name profileImage")
      .sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// REPORT LISTING
exports.reportListing = async (req, res) => {
  try {
    const parking = await Parking.findById(req.params.id);
    if (!parking) {
      return res.status(404).json({ message: "Parking spot not found" });
    }

    const userId = req.user._id;
    if (parking.reportedBy.some((id) => id.toString() === userId.toString())) {
      return res.status(400).json({ message: "You have already reported this listing" });
    }

    parking.reportedBy.push(userId);
    parking.reports = parking.reportedBy.length;
    await parking.save();

    res.json({ message: "Listing reported successfully for trust and safety review", reports: parking.reports });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};