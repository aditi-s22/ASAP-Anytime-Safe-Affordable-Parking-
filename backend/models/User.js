const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  // No longer required: Firebase Authentication owns credential verification now.
  // Kept only so any pre-migration accounts/scripts that still set it don't break.
  password: {
    type: String
  },
  firebaseUid: {
    type: String,
    unique: true,
    sparse: true
  },
  role: {
    type: String,
    enum: ["driver", "user", "host", "admin"],
    default: "user"
  },
  favorites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Parking"
  }],
  phone: String,
  verifiedHost: {
    type: String,
    enum: ["none", "pending", "verified", "rejected"],
    default: "none"
  },
  phoneVerified: {
    type: Boolean,
    default: true
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  govIdImage: {
    type: String,
    default: ""
  },
  addressProofImage: {
    type: String,
    default: ""
  },
  profileImage: {
    type: String,
    default: ""
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);