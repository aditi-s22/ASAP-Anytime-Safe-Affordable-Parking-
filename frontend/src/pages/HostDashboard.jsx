import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from '../components/Navbar';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';
import { AuthContext } from '../context/AuthContext';
import { socketService } from '../services/socket';
import { normalizeImageUrl } from '../utils/imageHelper';
import { geocodeAddress } from '../utils/geocode';
import {
  fetchHostParkings,
  fetchHostMetrics,
  deleteParkingListing,
  updateParkingListing,
  createParking,
  fetchUserBookings,
  manualCheckIn,
  startSession,
  checkOutBooking
} from '../services/api';

// Derives the 4 listing statuses (Pending Approval / Approved / Rejected / Suspended)
// from the existing isApproved/verificationStatus/isActive fields — no schema change needed.
const getListingStatus = (spot) => {
  if (spot.verificationStatus === 'rejected') {
    return { label: 'Rejected', color: 'bg-red-50 text-red-600 border-red-200' };
  }
  if (spot.isApproved && spot.verificationStatus === 'approved') {
    if (!spot.isActive) {
      return { label: 'Suspended', color: 'bg-slate-100 text-slate-600 border-slate-200' };
    }
    return { label: 'Approved', color: 'bg-parking-50 text-parking-700 border-parking-100' };
  }
  return { label: 'Pending Approval', color: 'bg-amber-50 text-amber-700 border-amber-200' };
};

export default function HostDashboard() {
  const { user, loading } = useContext(AuthContext);
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState('overview');
  const [hostParkings, setHostParkings] = useState([]);

  // Add Parking Space (Workflow 2) — creates a listing directly. Never calls
  // applyForHost / host onboarding; only requires the host to already be verified.
  const [showAddSpaceModal, setShowAddSpaceModal] = useState(false);
  const [addSpaceForm, setAddSpaceForm] = useState({
    title: '', address: '', pricePerHour: '', vehicleType: 'car', slots: '1', startTime: '00:00', endTime: '23:59'
  });
  const [addSpaceError, setAddSpaceError] = useState('');
  const [addSpaceLoading, setAddSpaceLoading] = useState(false);
  const [addSpacePlaceId, setAddSpacePlaceId] = useState(null);
  const [hostMetrics, setHostMetrics] = useState({
    activeNodes: 0,
    netRevenue: 0,
    totalBookings: 0,
    occupancyRate: 0,
    mostBookedSpot: "N/A"
  });
  const [allBookings, setAllBookings] = useState([]);
  const [hostLoading, setHostLoading] = useState(true);
  const [activeSpotFilter, setActiveSpotFilter] = useState('all');

  // Check-In Form State
  const [qrTokenInput, setQrTokenInput] = useState("");
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInResult, setCheckInResult] = useState(null);
  const [checkInError, setCheckInError] = useState(null);

  // Active Sessions Actions State
  const [actionLoading, setActionLoading] = useState(false);

  const handleManualCheckIn = async (e) => {
    if (e) e.preventDefault();
    if (!qrTokenInput.trim()) return;
    try {
      setCheckInLoading(true);
      setCheckInError(null);
      setCheckInResult(null);
      
      const res = await manualCheckIn(qrTokenInput.trim());
      setCheckInResult(res.data.booking);
      setQrTokenInput("");
      alert("Driver checked in successfully!");
      loadHostData(); // Refresh bookings and metrics
    } catch (err) {
      setCheckInError(err.response?.data?.message || "Invalid QR token or expired booking.");
    } finally {
      setCheckInLoading(false);
    }
  };

  const handleStartSession = async (bookingId) => {
    try {
      setActionLoading(true);
      await startSession(bookingId);
      alert("Parking session is now active!");
      loadHostData();
    } catch (err) {
      alert("Failed to start session: " + (err.response?.data?.message || err.message));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckOut = async (bookingId) => {
    try {
      setActionLoading(true);
      const res = await checkOutBooking(bookingId);
      alert(`Check-out completed! Duration: ${res.data.durationHours} hr(s).`);
      loadHostData();
    } catch (err) {
      alert("Failed to check-out booking: " + (err.response?.data?.message || err.message));
    } finally {
      setActionLoading(false);
    }
  };

  // Bind Google Places Autocomplete to the Add Parking Space address field whenever
  // that modal is open — same pattern as HostOnboarding's address input.
  useEffect(() => {
    if (!showAddSpaceModal) return;
    let autocomplete = null;
    const inputElement = document.getElementById("add-space-address-input");

    if (window.google && window.google.maps && window.google.maps.places && inputElement) {
      autocomplete = new window.google.maps.places.Autocomplete(inputElement, {
        componentRestrictions: { country: "in" },
        fields: ["formatted_address", "geometry", "place_id"],
      });

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (place && place.formatted_address) {
          setAddSpacePlaceId(place.place_id || null);
          setAddSpaceForm((prev) => ({ ...prev, address: place.formatted_address }));
        }
      });
    }

    return () => {
      if (autocomplete && window.google && window.google.maps) {
        window.google.maps.event.clearInstanceListeners(autocomplete);
      }
    };
  }, [showAddSpaceModal]);

  useEffect(() => {
    if (user) {
      if (user.role !== 'host' && user.verifiedHost !== 'verified') {
        // Not a verified host yet, redirect to onboarding / explanation
        navigate('/host');
        return;
      }
      loadHostData();
    }
  }, [user]);

  // Real-time sync — previously HostDashboard only ever fetched once on mount, so a
  // driver booking/checking-in/checking-out while the host already had this page
  // open never showed up until a manual full page reload. The driver-side dashboard
  // and Navbar already do this; the host dashboard did not.
  useEffect(() => {
    if (!user) return;
    socketService.connect(user._id);

    const refresh = () => loadHostData();
    socketService.subscribe("new_booking", refresh);
    socketService.subscribe("booking_status_changed", refresh);

    return () => {
      socketService.unsubscribe("new_booking", refresh);
      socketService.unsubscribe("booking_status_changed", refresh);
    };
  }, [user]);

  const loadHostData = async () => {
    try {
      setHostLoading(true);
      
      const [parkingsRes, metricsRes] = await Promise.all([
        fetchHostParkings(user._id).catch(() => ({ data: [] })),
        fetchHostMetrics(user._id).catch(() => ({
          data: { activeNodes: 0, netRevenue: 0, totalBookings: 0, occupancyRate: 0, mostBookedSpot: "N/A" }
        }))
      ]);

      setHostParkings(parkingsRes.data);
      setHostMetrics(metricsRes.data);

      // Fetch bookings for calendar and arrivals tables
      // For host we can gather bookings across all their spots
      const spotIds = parkingsRes.data.map(p => p._id);
      const bookingsPromises = spotIds.map(id => 
        // We can use a mock or fetch bookings for each spot
        // Since we don't have a bulk host-bookings fetch, we can aggregate bookings locally or use fetchUserBookings.
        // Wait, the backend has getParkingBookings(parkingId)! Let's import that.
        import('../services/api').then(m => m.api.get(`/bookings/parking/${id}`).catch(() => ({ data: [] })))
      );
      
      const bookingsResults = await Promise.all(bookingsPromises);
      const combinedBookings = bookingsResults.flatMap(res => res.data);
      // Sort bookings by start time
      combinedBookings.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      setAllBookings(combinedBookings);

    } catch (err) {
      console.error("Failed to load host dashboard data", err);
    } finally {
      setHostLoading(false);
    }
  };

  const handleAddSpaceSubmit = async (e) => {
    e.preventDefault();
    setAddSpaceError('');
    const { title, address, pricePerHour, vehicleType, slots, startTime, endTime } = addSpaceForm;
    if (!title || !address || !pricePerHour || !slots) {
      setAddSpaceError('Please fill in all required fields.');
      return;
    }
    setAddSpaceLoading(true);
    try {
      // Real Google Geocoding first (falls back to the shared keyword dictionary
      // internally only if geocoding fails or Maps JS isn't loaded) — this is what
      // was missing before and caused listings to save at the wrong coordinates.
      const geo = await geocodeAddress(address, { placeId: addSpacePlaceId });
      await createParking({
        title,
        address: geo.formattedAddress || address,
        latitude: geo.lat,
        longitude: geo.lng,
        pricePerHour: parseFloat(pricePerHour),
        vehicleType,
        slots: parseInt(slots, 10),
        availableSlots: parseInt(slots, 10),
        totalSlots: parseInt(slots, 10),
        startTime,
        endTime,
        images: []
      });
      setShowAddSpaceModal(false);
      setAddSpaceForm({ title: '', address: '', pricePerHour: '', vehicleType: 'car', slots: '1', startTime: '00:00', endTime: '23:59' });
      setAddSpacePlaceId(null);
      loadHostData();
    } catch (err) {
      setAddSpaceError(err.response?.data?.message || err.message || 'Failed to create listing.');
    } finally {
      setAddSpaceLoading(false);
    }
  };

  const handleDeleteListing = async (parkingId) => {
    if (window.confirm("Are you sure you want to delete this parking listing?")) {
      try {
        await deleteParkingListing(parkingId);
        loadHostData();
      } catch (err) {
        alert("Failed to delete listing: " + (err.response?.data?.message || err.message));
      }
    }
  };

  const handleToggleActive = async (spot) => {
    try {
      await updateParkingListing(spot._id, { isActive: !spot.isActive });
      setHostParkings(prev => prev.map(p => p._id === spot._id ? { ...p, isActive: !p.isActive } : p));
    } catch (err) {
      alert("Failed to toggle listing state.");
    }
  };

  // Health Rating Badge calculation helper
  const getListingHealth = (spot) => {
    if (spot.reports > 0) return { label: "Needs Attention", color: "bg-red-50 text-red-600 border-red-200" };
    if (spot.rating >= 4.5) return { label: "Excellent", color: "bg-parking-50 text-parking-700 border-parking-100" };
    if (spot.rating < 3.5 && spot.rating > 0) return { label: "Needs Attention", color: "bg-red-50 text-red-600 border-red-200" };
    return { label: "Good", color: "bg-amber-50 text-amber-700 border-amber-200" };
  };

  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'monitoring' },
    { id: 'listings', label: 'My Listings', icon: 'location_on' },
    { id: 'checkin', label: 'Arrival Check-In', icon: 'qr_code_scanner' },
    { id: 'calendar', label: 'Calendar', icon: 'calendar_today' },
    { id: 'bookings', label: 'Bookings & Sessions', icon: 'book_online' },
    { id: 'reviews', label: 'Reviews', icon: 'star' },
    { id: 'earnings', label: 'Earnings & Payouts', icon: 'payments' },
    { id: 'settings', label: 'Settings', icon: 'settings' }
  ];

  const upcomingArrivals = allBookings.filter(b =>
    b.status === 'paid' && !b.checkedIn
  );

  // Driver checked in (gate arrival logged) or session actively started — distinct
  // from Upcoming Arrivals, and previously had no dedicated panel on Overview at all.
  const activeSessions = allBookings.filter(b => ['checked_in', 'active'].includes(b.status));

  if (loading || hostLoading) {
    return (
      <div className="min-h-screen bg-white flex flex-col font-sans text-slate-700">
        <Navbar />
        <div className="flex-1 flex items-center justify-center text-parking-600">
          <span className="material-symbols-outlined animate-spin text-4xl">autorenew</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-700">
      <Navbar />

      <main className="max-w-screen-xl mx-auto w-full px-6 py-12 flex-1 flex flex-col lg:flex-row gap-10">

        {/* Sidebar */}
        <aside className="w-full lg:w-64 flex-shrink-0">
          <div className="bg-white border border-slate-200 shadow-sm p-4 rounded-xl lg:sticky lg:top-28">
            <div className="mb-6 px-4">
              <h2 className="text-xl font-semibold text-slate-900 tracking-tight">Aditi Host</h2>
              <p className="text-xs text-parking-600 mt-1 flex items-center gap-1 font-semibold uppercase tracking-wider">
                <span className="material-symbols-outlined text-[14px]">verified</span>
                Verified Partner
              </p>
            </div>

            <nav className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all font-semibold text-xs whitespace-nowrap lg:w-full ${
                    activeTab === tab.id
                    ? 'bg-parking-50 text-parking-700 border border-parking-100'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 border border-transparent'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Content Area */}
        <section className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {/* OVERVIEW TAB */}
              {activeTab === 'overview' && (
                <div className="space-y-10">
                  {/* Earnings summary strip */}
                  <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-6 sm:gap-10">
                    <div>
                      <span className="text-xs uppercase font-semibold text-slate-500 block mb-1">This Month</span>
                      <span className="text-2xl font-semibold text-slate-900 tabular-nums">₹{hostMetrics.revenueThisMonth?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0}</span>
                    </div>
                    <div className="hidden sm:block w-px bg-slate-200 self-stretch"></div>
                    <div>
                      <span className="text-xs uppercase font-semibold text-slate-500 block mb-1">Today</span>
                      <span className="text-2xl font-semibold text-slate-900 tabular-nums">₹{hostMetrics.revenueToday?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0}</span>
                    </div>
                    <div className="hidden sm:block w-px bg-slate-200 self-stretch"></div>
                    <div>
                      <span className="text-xs uppercase font-semibold text-slate-500 block mb-1">Occupancy</span>
                      <span className="text-2xl font-semibold text-parking-600 tabular-nums">{hostMetrics.occupancyRate}%</span>
                    </div>
                    <div className="hidden sm:block w-px bg-slate-200 self-stretch"></div>
                    <div>
                      <span className="text-xs uppercase font-semibold text-slate-500 block mb-1">Average Rating</span>
                      <span className="text-2xl font-semibold text-amber-500 tabular-nums">{hostMetrics.averageRating || 5.0} ⭐</span>
                    </div>
                  </div>

                  {/* Upcoming Arrivals Section */}
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 mb-4">Upcoming Arrivals</h3>
                    <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                              <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Driver Details</th>
                              <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Location</th>
                              <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Time Slot</th>
                              <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {upcomingArrivals.length === 0 ? (
                              <tr>
                                <td colSpan="4" className="p-8 text-center text-slate-500 text-sm">No upcoming arrivals expected.</td>
                              </tr>
                            ) : (
                              upcomingArrivals.slice(0, 5).map(b => (
                                <tr key={b._id} className="border-b border-slate-100 hover:bg-slate-50">
                                  <td className="p-4">
                                    <div className="font-semibold text-slate-900 text-sm">{b.userId?.name}</div>
                                    <div className="text-slate-500 text-xs">{b.userId?.phone}</div>
                                  </td>
                                  <td className="p-4 text-sm font-medium text-slate-700">
                                    {b.parkingId?.title}
                                  </td>
                                  <td className="p-4 text-xs text-slate-500">
                                    <div>{new Date(b.startTime).toLocaleDateString()}</div>
                                    <div className="mt-0.5 text-slate-400">{new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                  </td>
                                  <td className="p-4">
                                    <span className="text-[10px] bg-parking-50 text-parking-700 border border-parking-100 px-2 py-0.5 rounded uppercase font-semibold tracking-wider">Booked</span>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Active Sessions / Active Vehicles Section */}
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 mb-4">Active Vehicles</h3>
                    <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50">
                              <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Driver Details</th>
                              <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Location</th>
                              <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Checked In At</th>
                              <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Status</th>
                              <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeSessions.length === 0 ? (
                              <tr>
                                <td colSpan="5" className="p-8 text-center text-slate-500 text-sm">No vehicles currently on-site.</td>
                              </tr>
                            ) : (
                              activeSessions.map(b => (
                                <tr key={b._id} className="border-b border-slate-100 hover:bg-slate-50">
                                  <td className="p-4">
                                    <div className="font-semibold text-slate-900 text-sm">{b.userId?.name}</div>
                                    <div className="text-slate-500 text-xs">{b.userId?.phone}</div>
                                  </td>
                                  <td className="p-4 text-sm font-medium text-slate-700">
                                    {b.parkingId?.title}
                                  </td>
                                  <td className="p-4 text-xs text-slate-500">
                                    {(b.checkInTime || b.checkedInAt) ? new Date(b.checkInTime || b.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "N/A"}
                                  </td>
                                  <td className="p-4">
                                    <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-semibold tracking-wider border ${
                                      b.status === 'active'
                                        ? 'bg-accent-400/10 text-accent-600 border-accent-400/20'
                                        : 'bg-slate-100 text-slate-600 border-slate-200'
                                    }`}>
                                      {b.status === 'active' ? 'Active' : 'Checked In'}
                                    </span>
                                  </td>
                                  <td className="p-4 text-right">
                                    {b.status === 'checked_in' && (
                                      <Button onClick={() => handleStartSession(b._id)} disabled={actionLoading} variant="primary" size="sm">
                                        Start Session
                                      </Button>
                                    )}
                                    {b.status === 'active' && (
                                      <Button onClick={() => handleCheckOut(b._id)} disabled={actionLoading} variant="primary" size="sm">
                                        Check-Out
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* MY LISTINGS TAB */}
              {activeTab === 'listings' && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-semibold text-slate-900">Listing Assets</h2>
                    <Button variant="primary" size="sm" onClick={() => setShowAddSpaceModal(true)}>Add Parking Space</Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {hostParkings.length === 0 ? (
                      <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-12 text-center text-slate-500 col-span-full">
                        <p>No listings registered under your account yet.</p>
                      </div>
                    ) : (
                      hostParkings.map(spot => {
                        const health = getListingHealth(spot);
                        const listingStatus = getListingStatus(spot);
                        const occupancyPct = spot.slots > 0
                          ? Math.round((((spot.slots - (spot.availableSlots ?? spot.slots)) / spot.slots) * 100))
                          : 0;
                        return (
                          <div key={spot._id} className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow">
                            {spot.images?.[0]?.url && (
                              <img src={normalizeImageUrl(spot.images[0])} alt={spot.title} className="w-full h-44 object-cover" />
                            )}
                            <div className="p-5 space-y-4 flex-1 flex flex-col">
                              <div>
                                <div className="flex justify-between items-start gap-2">
                                  <h3 className="font-semibold text-slate-900 text-base truncate">{spot.title}</h3>
                                  <span className={`text-[9px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded border whitespace-nowrap ${health.color}`}>
                                    {health.label}
                                  </span>
                                </div>
                                <p className="text-slate-500 text-xs truncate mt-0.5">{spot.address}</p>
                              </div>

                              {/* Inline occupancy & earnings, Airbnb-card style */}
                              <div className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-1 text-slate-600">
                                  <span className="material-symbols-outlined text-[16px]">local_parking</span>
                                  <span className="font-medium tabular-nums">{occupancyPct}% occupied</span>
                                </div>
                                <div className="flex items-center gap-1 text-slate-900 font-semibold tabular-nums">
                                  ₹{spot.pricePerHour}/hr
                                </div>
                              </div>

                              <div className="flex items-center gap-4 text-xs text-slate-500">
                                <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">star</span>{spot.rating || "N/A"}</span>
                                <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">grid_view</span>{spot.slots} slots</span>
                                {spot.reports > 0 && (
                                  <span className="flex items-center gap-1 text-red-600"><span className="material-symbols-outlined text-[14px]">flag</span>{spot.reports} reports</span>
                                )}
                              </div>

                              <div className="flex justify-between items-center mt-auto pt-3 border-t border-slate-100">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase border ${listingStatus.color}`}>
                                  {listingStatus.label}
                                </span>

                                <div className="flex items-center gap-3">
                                  <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={spot.isActive}
                                      onChange={() => handleToggleActive(spot)}
                                      className="sr-only peer"
                                    />
                                    <div className="w-8 h-4 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-parking-500"></div>
                                  </label>
                                  <button
                                    onClick={() => handleDeleteListing(spot._id)}
                                    className="w-7 h-7 rounded bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors flex items-center justify-center"
                                  >
                                    <span className="material-symbols-outlined text-[16px]">delete</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* CHECK-IN / ARRIVALS TAB */}
              {activeTab === 'checkin' && (
                <div className="space-y-6">
                  <h2 className="text-2xl font-semibold text-slate-900">Driver Gate Check-In</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column: QR Code Simulator Scan */}
                    <div className="bg-white border border-slate-200 shadow-sm p-6 rounded-xl space-y-6 flex flex-col justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 mb-2">Scan Digital Ticket QR</h3>
                        <p className="text-slate-500 text-xs leading-relaxed">
                          Scan the driver's QR ticket from their ASAP dashboard to instantly verify the reservation and approve access to the lot.
                        </p>
                      </div>

                      {/* Mock Scanner Visualization */}
                      <div className="relative border border-slate-200 rounded-xl aspect-[4/3] bg-slate-50 flex flex-col items-center justify-center overflow-hidden">
                        {/* Scanner target box */}
                        <div className="w-28 h-28 border-2 border-slate-300 rounded-xl relative flex items-center justify-center">
                          <span className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-parking-500"></span>
                          <span className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-parking-500"></span>
                          <span className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-parking-500"></span>
                          <span className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-parking-500"></span>
                          <span className="material-symbols-outlined text-slate-300 text-5xl">qr_code_scanner</span>
                        </div>

                        <p className="text-[10px] text-slate-400 font-medium tracking-widest mt-4 uppercase">Camera Feed Standby</p>
                      </div>

                      <Button
                        onClick={() => {
                          const token = prompt("Enter a booking QR token / ID to simulate scan:");
                          if (token) {
                            setQrTokenInput(token);
                            setTimeout(() => {
                              const btn = document.getElementById("trigger-checkin-btn");
                              if (btn) btn.click();
                            }, 50);
                          }
                        }}
                        variant="primary"
                        className="w-full flex items-center justify-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[16px]">videocam</span>
                        Simulate Camera Scan
                      </Button>
                    </div>

                    {/* Right Column: Manual Entry Form */}
                    <div className="bg-white border border-slate-200 shadow-sm p-6 rounded-xl space-y-6">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 mb-2">Manual Ticket Lookup</h3>
                        <p className="text-slate-500 text-xs">
                          If camera scanning is unavailable, enter the driver's ticket QR token or ID code below to complete check-in manually.
                        </p>
                      </div>

                      {checkInError && (
                        <div className="p-4 bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg flex items-start gap-2">
                          <span className="material-symbols-outlined text-[16px]">error</span>
                          <div>
                            <p className="font-semibold">Check-In Failed</p>
                            <p className="mt-0.5 text-red-500">{checkInError}</p>
                          </div>
                        </div>
                      )}

                      {checkInResult && (
                        <div className="p-4 bg-parking-50 border border-parking-100 text-parking-700 text-xs rounded-lg space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px]">verified</span>
                            <span className="font-semibold">Verification Successful</span>
                          </div>
                          <div className="text-slate-600 space-y-1">
                            <p><strong className="text-slate-900">Driver Name:</strong> {checkInResult.userId?.name || "N/A"}</p>
                            <p><strong className="text-slate-900">Spot:</strong> {checkInResult.parkingId?.title || "N/A"}</p>
                            <p><strong className="text-slate-900">Schedule:</strong> {new Date(checkInResult.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - {new Date(checkInResult.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                            <p><strong className="text-slate-900">Checked In:</strong> {new Date(checkInResult.checkInTime || checkInResult.checkedInAt || Date.now()).toLocaleTimeString()}</p>
                            <p><strong className="text-slate-900">Status:</strong> <span className="uppercase text-parking-700 font-semibold">{checkInResult.status}</span></p>
                          </div>
                        </div>
                      )}

                      <form onSubmit={handleManualCheckIn} className="space-y-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Ticket Token / QR ID</label>
                          <input
                            type="text"
                            placeholder="Enter 24-character token e.g. qr_66127..."
                            value={qrTokenInput}
                            onChange={(e) => setQrTokenInput(e.target.value)}
                            className="input-field rounded-lg p-3 text-xs"
                            required
                          />
                        </div>

                        <Button
                          id="trigger-checkin-btn"
                          type="submit"
                          variant="outline"
                          disabled={checkInLoading}
                          className="w-full flex items-center justify-center gap-2"
                        >
                          {checkInLoading ? (
                            <>
                              <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                              Verifying...
                            </>
                          ) : (
                            <>
                              <span className="material-symbols-outlined text-[16px]">check_circle</span>
                              Complete Check-In
                            </>
                          )}
                        </Button>
                      </form>
                    </div>
                  </div>
                </div>
              )}

              {/* CALENDAR TAB */}
              {activeTab === 'calendar' && (
                <div className="space-y-6">
                  <h2 className="text-2xl font-semibold text-slate-900">Booking Calendar</h2>
                  <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-6">
                    <div className="flex justify-between items-center mb-6">
                      <h3 className="font-semibold text-slate-900 text-base">Allocations Ledger</h3>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 bg-parking-500 rounded-full"></span>
                        <span className="text-slate-500 text-xs">Live Active Reservations</span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {allBookings.length === 0 ? (
                        <div className="text-center py-12 text-slate-500 text-sm">No scheduled events logged.</div>
                      ) : (
                        allBookings.map(b => (
                          <div key={b._id} className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex justify-between items-center gap-4">
                            <div>
                              <div className="font-semibold text-slate-900 text-sm">{b.parkingId?.title}</div>
                              <div className="text-xs text-slate-500 mt-1 flex items-center gap-3">
                                <span>Driver: {b.userId?.name}</span>
                                <span>•</span>
                                <span>Date: {new Date(b.startTime).toLocaleDateString()}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-slate-900 font-semibold text-sm tabular-nums">
                                {new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                              <div className="text-[10px] text-slate-500 mt-0.5">₹{b.totalPrice} Revenue</div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* BOOKINGS TAB */}
              {activeTab === 'bookings' && (
                <div className="space-y-6">
                  <h2 className="text-2xl font-semibold text-slate-900">Reservations & Sessions</h2>
                  <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Driver Details</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Parking Spot</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Schedule</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Revenue</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">State</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allBookings.length === 0 ? (
                            <tr>
                              <td colSpan="6" className="p-8 text-center text-slate-500 text-sm">No reservations logged.</td>
                            </tr>
                          ) : (
                            allBookings.map(b => {
                              const checkInDate = b.checkInTime || b.checkedInAt;
                              const checkOutDate = b.checkOutTime;
                              let durationStr = "N/A";
                              if (checkInDate && checkOutDate) {
                                const durationMs = new Date(checkOutDate) - new Date(checkInDate);
                                durationStr = `${parseFloat((durationMs / (1000 * 60 * 60)).toFixed(2))} hr(s)`;
                              }

                              return (
                                <tr key={b._id} className="border-b border-slate-100 hover:bg-slate-50">
                                  <td className="p-4">
                                    <div className="font-semibold text-slate-900 text-sm">{b.userId?.name}</div>
                                    <div className="text-slate-500 text-xs mt-0.5">{b.userId?.email}</div>
                                    <div className="text-slate-500 text-xs">{b.userId?.phone}</div>
                                  </td>
                                  <td className="p-4 font-medium text-slate-700 text-sm">
                                    {b.parkingId?.title || "Deleted Spot"}
                                  </td>
                                  <td className="p-4 text-xs text-slate-500">
                                    <div>{new Date(b.startTime).toLocaleDateString()}</div>
                                    <div className="text-slate-400 mt-0.5">{new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(b.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                  </td>
                                  <td className="p-4 font-semibold text-slate-900 text-sm tabular-nums">
                                    ₹{b.totalPrice}
                                  </td>
                                  <td className="p-4">
                                    <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded border ${
                                      b.status === 'completed'
                                        ? 'bg-parking-50 text-parking-700 border-parking-100'
                                        : b.status === 'active'
                                        ? 'bg-accent-400/10 text-accent-600 border-accent-400/20'
                                        : b.status === 'checked_in'
                                        ? 'bg-slate-100 text-slate-600 border-slate-200'
                                        : b.status === 'cancelled' || b.status === 'refunded'
                                        ? 'bg-red-50 text-red-600 border-red-200'
                                        : 'bg-amber-50 text-amber-700 border-amber-200'
                                    }`}>
                                      {b.status || 'Paid'}
                                    </span>
                                  </td>
                                  <td className="p-4 text-right">
                                    <div className="flex justify-end gap-2">
                                      {b.status === 'checked_in' && (
                                        <Button
                                          onClick={() => handleStartSession(b._id)}
                                          disabled={actionLoading}
                                          variant="primary"
                                          size="sm"
                                          className="flex items-center gap-1"
                                        >
                                          <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                                          Start Session
                                        </Button>
                                      )}
                                      {b.status === 'active' && (
                                        <Button
                                          onClick={() => handleCheckOut(b._id)}
                                          disabled={actionLoading}
                                          variant="primary"
                                          size="sm"
                                          className="flex items-center gap-1"
                                        >
                                          <span className="material-symbols-outlined text-[16px]">logout</span>
                                          Check-Out
                                        </Button>
                                      )}
                                      {b.status === 'completed' && (
                                        <span className="text-xs text-slate-500 font-medium">Duration: {durationStr}</span>
                                      )}
                                      {!['checked_in', 'active', 'completed'].includes(b.status) && (
                                        <span className="text-xs text-slate-400">—</span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* REVIEWS TAB */}
              {activeTab === 'reviews' && (
                <div className="space-y-6">
                  <h2 className="text-2xl font-semibold text-slate-900">Driver Feedback</h2>

                  <div className="bg-white border border-slate-200 shadow-sm rounded-xl divide-y divide-slate-100">
                    {hostParkings.filter(p => p.rating > 0).length === 0 ? (
                      <div className="p-12 text-center text-slate-500 text-sm">
                        No star reviews submitted for your assets yet.
                      </div>
                    ) : (
                      hostParkings.map(spot => {
                        if (spot.rating === 0) return null;
                        return (
                          <div key={spot._id} className="p-5 flex justify-between items-center gap-4">
                            <div>
                              <h4 className="font-semibold text-slate-900 text-sm">{spot.title}</h4>
                              <p className="text-slate-500 text-xs mt-1">{spot.address}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-lg font-semibold text-slate-900 flex items-center gap-1 justify-end tabular-nums">{spot.rating} <span className="text-amber-400">⭐</span></span>
                              <span className="text-[10px] text-slate-500 mt-1 block">Platform Average</span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* EARNINGS TAB */}
              {activeTab === 'earnings' && (
                <div className="space-y-10">
                  <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div>
                      <span className="text-xs uppercase font-semibold text-slate-500 tracking-wider block mb-1">Withdrawable Balance</span>
                      <span className="text-3xl font-semibold text-slate-900 tabular-nums">₹{hostMetrics.netRevenue?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      <p className="text-xs text-slate-500 mt-1">Platform fee deductions included.</p>
                    </div>
                    <Button variant="primary" onClick={() => alert("Payout requested successfully!")}>
                      Request Payout
                    </Button>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 mb-4">Payout Statements</h3>
                    <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Invoice Ref</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Amount</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Type</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="p-4 text-xs font-mono text-slate-500">PAY-INV-00124</td>
                            <td className="p-4 font-semibold text-slate-900 text-sm tabular-nums">₹{hostMetrics.netRevenue?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                            <td className="p-4 text-xs text-slate-500">Direct Deposit</td>
                            <td className="p-4">
                              <span className="text-[10px] bg-parking-50 text-parking-700 border border-parking-100 px-2 py-0.5 rounded uppercase font-semibold tracking-wider">Settled</span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* SETTINGS TAB */}
              {activeTab === 'settings' && (
                <div className="max-w-2xl">
                  <h2 className="text-2xl font-semibold text-slate-900 mb-6">Business Settings</h2>
                  <div className="bg-white border border-slate-200 shadow-sm p-8 rounded-xl space-y-6">
                    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); alert('Saved host configurations.'); }}>
                      <Input label="Business Name" defaultValue="Aditi Garage Hubs" icon="store" required />
                      <Input label="Payout Account Bank" defaultValue="HDFC Bank" icon="account_balance" required />
                      <Input label="Account Number" defaultValue="•••• •••• •••• 9012" icon="credit_card" required />
                      <Input label="IFSC Code" defaultValue="HDFC0000240" icon="code" required />

                      <div className="pt-4 border-t border-slate-200 flex justify-end">
                        <Button variant="primary" type="submit" className="px-6">Save Settings</Button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </section>
      </main>

      {/* ADD PARKING SPACE — Workflow 2 only. Never calls applyForHost / onboarding. */}
      <Modal isOpen={showAddSpaceModal} onClose={() => setShowAddSpaceModal(false)} title="Add Parking Space">
        <form onSubmit={handleAddSpaceSubmit} className="space-y-4">
          {addSpaceError && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{addSpaceError}</div>
          )}
          <Input
            label="Title"
            placeholder="e.g. Covered Garage near Powai"
            value={addSpaceForm.title}
            onChange={(e) => setAddSpaceForm(f => ({ ...f, title: e.target.value }))}
            required
          />
          <Input
            id="add-space-address-input"
            label="Address"
            placeholder="e.g. 14th Main Rd, Powai, Mumbai"
            value={addSpaceForm.address}
            onChange={(e) => { setAddSpacePlaceId(null); setAddSpaceForm(f => ({ ...f, address: e.target.value })); }}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Price per hour (₹)"
              type="number"
              min="1"
              value={addSpaceForm.pricePerHour}
              onChange={(e) => setAddSpaceForm(f => ({ ...f, pricePerHour: e.target.value }))}
              required
            />
            <Input
              label="Slots"
              type="number"
              min="1"
              value={addSpaceForm.slots}
              onChange={(e) => setAddSpaceForm(f => ({ ...f, slots: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Vehicle Type</label>
            <select
              className="w-full input-field rounded-lg px-4 py-3 text-sm"
              value={addSpaceForm.vehicleType}
              onChange={(e) => setAddSpaceForm(f => ({ ...f, vehicleType: e.target.value }))}
            >
              <option value="car">Car</option>
              <option value="bike">Bike</option>
              <option value="rv">RV</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Open Time"
              type="time"
              value={addSpaceForm.startTime}
              onChange={(e) => setAddSpaceForm(f => ({ ...f, startTime: e.target.value }))}
            />
            <Input
              label="Close Time"
              type="time"
              value={addSpaceForm.endTime}
              onChange={(e) => setAddSpaceForm(f => ({ ...f, endTime: e.target.value }))}
            />
          </div>
          <p className="text-xs text-slate-400">Your listing will go live for search and booking once an admin approves it.</p>
          <Button type="submit" variant="primary" className="w-full" disabled={addSpaceLoading}>
            {addSpaceLoading ? 'Submitting…' : 'Submit for Approval'}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
