const Parking = require("../models/Parking");

/**
 * Single source of truth for "can this listing currently be booked/paid-for/extended".
 * Used by every booking-creation/modification path (createBooking, extendBooking,
 * payment createOrder) so eligibility can never be checked in only one place and
 * accidentally skipped in another.
 *
 * State model (derived from how adminController actually mutates these fields):
 *   - addParking            -> isApproved:false, isActive:false, verificationStatus:"pending"
 *   - approveParkingListing -> isApproved:true,  isActive:true,  verificationStatus:"approved"
 *   - rejectParkingListing  -> isApproved:false, isActive:false, verificationStatus:"rejected"
 *   - suspendParkingListing -> isActive:false (isApproved/verificationStatus untouched)
 *
 * Returns { ok: true, parking } or { ok: false, status, message }.
 */
const checkListingBookable = async (parkingId) => {
  const parking = await Parking.findById(parkingId).populate("hostId", "isActive");

  if (!parking) {
    return { ok: false, status: 404, message: "Parking listing not found" };
  }

  if (parking.verificationStatus === "rejected") {
    return { ok: false, status: 403, message: "This listing has been rejected and is not available for booking" };
  }

  if (!parking.isApproved) {
    return { ok: false, status: 400, message: "This listing is pending admin approval and is not yet available for booking" };
  }

  if (!parking.isActive) {
    // isApproved:true + isActive:false is only reachable via an admin suspension.
    return { ok: false, status: 403, message: "This listing has been suspended and is not available for booking" };
  }

  if (parking.hostId && parking.hostId.isActive === false) {
    return { ok: false, status: 403, message: "This listing's host account is currently deactivated" };
  }

  return { ok: true, parking };
};

module.exports = { checkListingBookable };
