import React, { useState, useEffect, useContext } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from '../components/Navbar';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { AuthContext } from '../context/AuthContext';
import { socketService } from '../services/socket';
import {
  fetchUserBookings,
  cancelBooking,
  updateUserProfile,
  submitParkingReview,
  getFavorites,
  toggleFavorite,
  extendBooking,
  createTicket
} from '../services/api';
import { normalizeImageUrl } from '../utils/imageHelper';
const safeFormatDate = (dateVal, options = {}) => {
  if (!dateVal) return "N/A";
  const d = new Date(dateVal);
  return isNaN(d.getTime()) ? "N/A" : d.toLocaleDateString(undefined, options);
};

const safeFormatTime = (dateVal, options = {}) => {
  if (!dateVal) return "N/A";
  const d = new Date(dateVal);
  return isNaN(d.getTime()) ? "N/A" : d.toLocaleTimeString([], options);
};

export default function UserDashboard() {
  const { user, loading, updateUser } = useContext(AuthContext);
  const location = useLocation();
  const navigate = useNavigate();

  // Parse tab from URL
  const searchParams = new URLSearchParams(location.search);
  const tabParam = searchParams.get('tab') || 'dashboard';

  const [activeTab, setActiveTab] = useState(tabParam);
  const [bookings, setBookings] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState(null);

  // Review popup state
  const [reviewBooking, setReviewBooking] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [skippedReviews, setSkippedReviews] = useState([]);

  // Socket notification alert state
  const [socketAlert, setSocketAlert] = useState(null);

  // Profile Form State
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [profileMessage, setProfileMessage] = useState(null);

  // Saved Locations State
  const [favorites, setFavorites] = useState([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);

  // Geolocation & Dashboard states
  const [userCoords, setUserCoords] = useState(null);

  // Extension State
  const [extendingBooking, setExtendingBooking] = useState(null);
  const [extensionHours, setExtensionHours] = useState(1);
  const [extendingLoading, setExtendingLoading] = useState(false);
  const [extensionError, setExtensionError] = useState(null);

  // Issue Reporting State
  const [reportingBooking, setReportingBooking] = useState(null);
  const [reportCategory, setReportCategory] = useState("Parking Full");
  const [reportDescription, setReportDescription] = useState("");
  const [reportingLoading, setReportingLoading] = useState(false);
  const [reportError, setReportError] = useState(null);

  // Sync state with URL if user clicks back/forward
  useEffect(() => {
    setActiveTab(tabParam);
  }, [tabParam]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        (err) => console.log("Geolocation permission denied in dashboard", err)
      );
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadBookings();
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setPhone(user.phone || '');
    }
  }, [user]);

  const loadBookings = async () => {
    try {
      setFetching(true);
      const res = await fetchUserBookings(user._id);
      setBookings(res.data);

      // Auto-trigger review popup if there is a completed, unreviewed booking that isn't skipped yet
      const toReview = res.data.find(b =>
        (b.status === 'completed' || new Date(b.endTime) < new Date()) &&
        !b.reviewed &&
        b.status !== 'cancelled'
      );
      if (toReview && !skippedReviews.includes(toReview._id) && !reviewBooking) {
        setReviewBooking(toReview);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setFetching(false);
    }
  };

  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    navigate(`/dashboard?tab=${tabId}`, { replace: true });
  };

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    try {
      setProfileMessage(null);
      const res = await updateUserProfile({ name, phone });
      updateUser(res.data);
      setProfileMessage({ type: 'success', text: 'Profile updated successfully!' });
    } catch (err) {
      setProfileMessage({ type: 'error', text: err.response?.data?.message || 'Failed to update profile' });
    }
  };

  const handleCancelBooking = async (bookingId) => {
    if (window.confirm("Are you sure you want to cancel this booking?")) {
      try {
        await cancelBooking(bookingId);
        loadBookings();
      } catch (err) {
        alert("Failed to cancel booking: " + (err.response?.data?.message || err.message));
      }
    }
  };

  const loadFavorites = async () => {
    if (!user) return;
    try {
      setFavoritesLoading(true);
      const res = await getFavorites();
      setFavorites(res.data);
    } catch (err) {
      console.error("Failed to load favorites", err);
    } finally {
      setFavoritesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'saved' || activeTab === 'dashboard') {
      loadFavorites();
    }
  }, [activeTab, user]);

  useEffect(() => {
    if (!user) return;

    socketService.connect(user._id);

    const handleNewBooking = (data) => {
      setSocketAlert(data);
      loadBookings();
    };

    socketService.subscribe("new_booking", handleNewBooking);

    return () => {
      socketService.unsubscribe("new_booking", handleNewBooking);
    };
  }, [user]);

  useEffect(() => {
    if (socketAlert) {
      const timer = setTimeout(() => {
        setSocketAlert(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [socketAlert]);

  const handleSubmitReview = async (e) => {
    e.preventDefault();
    if (!reviewBooking) return;
    try {
      setSubmittingReview(true);
      setReviewError(null);
      const parkingId = reviewBooking.parkingId?._id || reviewBooking.parkingId;
      if (!parkingId) {
        setReviewError("Parking spot details are missing.");
        return;
      }
      await submitParkingReview(parkingId, {
        rating: reviewRating,
        feedback: reviewFeedback,
        bookingId: reviewBooking._id
      });
      setReviewBooking(null);
      setReviewRating(5);
      setReviewFeedback("");
      await loadBookings();
    } catch (err) {
      setReviewError(err.response?.data?.message || "Failed to submit review.");
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleSkipReview = () => {
    if (reviewBooking) {
      setSkippedReviews(prev => [...prev, reviewBooking._id]);
      setReviewBooking(null);
      setReviewRating(5);
      setReviewFeedback("");
    }
  };

  const handleUnfavorite = async (parkingId) => {
    try {
      await toggleFavorite(parkingId);
      loadFavorites();
    } catch (err) {
      console.error("Error toggling favorite", err);
    }
  };

  const handleExtendBooking = async (e) => {
    e.preventDefault();
    if (!extendingBooking) return;
    try {
      setExtendingLoading(true);
      setExtensionError(null);
      await extendBooking(extendingBooking._id, Number(extensionHours));
      alert("Booking extended successfully!");
      setExtendingBooking(null);
      setExtensionHours(1);
      loadBookings();
    } catch (err) {
      setExtensionError(err.response?.data?.message || "Failed to extend booking.");
    } finally {
      setExtendingLoading(false);
    }
  };

  const handleReportIssue = async (e) => {
    e.preventDefault();
    if (!reportingBooking) return;
    try {
      setReportingLoading(true);
      setReportError(null);
      await createTicket({
        bookingId: reportingBooking._id,
        category: reportCategory,
        description: reportDescription
      });
      alert("Issue ticket reported successfully. Booking set to Refund Pending.");
      setReportingBooking(null);
      setReportCategory("Parking Full");
      setReportDescription("");
      loadBookings();
    } catch (err) {
      setReportError(err.response?.data?.message || "Failed to report issue.");
    } finally {
      setReportingLoading(false);
    }
  };

  // Find Upcoming / Active Booking
  const upcomingBooking = bookings.find(b =>
    ['paid', 'checked_in', 'active'].includes(b.status) && new Date(b.endTime) > new Date()
  );

  // Get recently completed bookings
  const recentlyCompleted = bookings.filter(b =>
    b.status === 'completed' || (new Date(b.endTime) < new Date() && b.status !== 'cancelled')
  ).slice(0, 3);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'bookings', label: 'My Bookings', icon: 'book_online' },
    { id: 'saved', label: 'Saved Places', icon: 'bookmark' },
    { id: 'payments', label: 'Payments & Receipts', icon: 'payments' },
    { id: 'profile', label: 'Profile', icon: 'person' },
  ];

  const statusPill = (status) => {
    const map = {
      completed: 'bg-slate-100 text-slate-600 border border-slate-200',
      cancelled: 'bg-red-50 text-red-600 border border-red-200',
      paid: 'bg-parking-50 text-parking-700 border border-parking-100',
      checked_in: 'bg-parking-50 text-parking-700 border border-parking-100',
      active: 'bg-parking-50 text-parking-700 border border-parking-100',
    };
    return map[status] || 'bg-amber-50 text-amber-600 border border-amber-200';
  };

  if (loading || fetching) {
    return (
      <div className="min-h-screen bg-white flex flex-col font-sans">
        <Navbar />
        <div className="flex-1 flex items-center justify-center text-parking-600">
          <span className="material-symbols-outlined animate-spin text-4xl">autorenew</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <Navbar />

      {/* ACTION BAR */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-screen-xl mx-auto w-full px-6 py-6">
          <h1 className="text-2xl font-semibold text-slate-900 mb-4">Hi, {user?.name.split(' ')[0]}</h1>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-3 p-4 rounded-lg border border-slate-200 hover:border-parking-400 hover:bg-parking-50/40 transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-parking-50 flex items-center justify-center text-parking-600 flex-shrink-0">
                <span className="material-symbols-outlined text-[20px]">search</span>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Search a new spot</h3>
                <p className="text-xs text-slate-500">Find and pre-book parking</p>
              </div>
            </button>

            <button
              onClick={() => {
                if (upcomingBooking) {
                  setSelectedTicket(upcomingBooking);
                } else {
                  alert("No active booking to navigate to.");
                }
              }}
              className={`flex items-center gap-3 p-4 rounded-lg border border-slate-200 transition-colors text-left ${
                upcomingBooking ? 'hover:border-parking-400 hover:bg-parking-50/40' : 'opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="w-9 h-9 rounded-lg bg-parking-50 flex items-center justify-center text-parking-600 flex-shrink-0">
                <span className="material-symbols-outlined text-[20px]">navigation</span>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Navigate to booking</h3>
                <p className="text-xs text-slate-500">Get directions & ticket QR</p>
              </div>
            </button>

            <button
              onClick={() => {
                if (recentlyCompleted.length > 0 && recentlyCompleted[0].parkingId) {
                  const targetId = recentlyCompleted[0].parkingId._id || recentlyCompleted[0].parkingId;
                  navigate(`/parking/${targetId}`);
                } else {
                  navigate('/');
                }
              }}
              className="flex items-center gap-3 p-4 rounded-lg border border-slate-200 hover:border-parking-400 hover:bg-parking-50/40 transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-lg bg-parking-50 flex items-center justify-center text-parking-600 flex-shrink-0">
                <span className="material-symbols-outlined text-[20px]">history</span>
              </div>
              <div>
                <h3 className="font-semibold text-slate-900 text-sm">Rebook last spot</h3>
                <p className="text-xs text-slate-500">Quickly book again</p>
              </div>
            </button>
          </div>

          {/* SAVED PLACES - horizontally scrollable chips */}
          {favorites.length > 0 && (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs uppercase font-semibold text-slate-400 tracking-wider">Saved Places</h2>
                <button onClick={() => handleTabChange('saved')} className="text-xs text-accent-600 hover:underline font-medium">View All</button>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {favorites.filter(spot => spot && typeof spot === "object").map((spot) => (
                  <button
                    key={spot._id}
                    onClick={() => navigate(`/parking/${spot._id}`)}
                    className="flex items-center gap-3 bg-white border border-slate-200 hover:border-parking-400 rounded-lg p-2 pr-4 flex-shrink-0 transition-colors"
                  >
                    <img
                      src={normalizeImageUrl(spot.images?.[0] || spot.image)}
                      onError={(e) => { e.target.src = normalizeImageUrl(null); }}
                      alt={spot.title}
                      className="w-10 h-10 rounded-md object-cover flex-shrink-0"
                    />
                    <div className="text-left">
                      <p className="font-medium text-slate-900 text-sm truncate max-w-[140px]">{spot.title}</p>
                      <p className="text-xs text-slate-500 truncate max-w-[140px]">{spot.address}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <main className="max-w-screen-xl mx-auto w-full px-6 py-8 flex-1 flex flex-col lg:flex-row gap-10">

        {/* Left rail navigation */}
        <aside className="w-full lg:w-56 flex-shrink-0">
          <nav className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 lg:sticky lg:top-24">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium text-sm whitespace-nowrap lg:w-full text-left ${
                  activeTab === tab.id
                  ? 'bg-parking-50 text-parking-700'
                  : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Dynamic Content Area */}
        <section className="flex-1 min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {/* DASHBOARD HOMEPAGE */}
              {activeTab === 'dashboard' && (
                <div className="space-y-10">
                  {/* Your Next Destination */}
                  <div>
                    <h2 className="text-xs uppercase font-semibold text-slate-400 tracking-wider mb-4">Your Next Destination</h2>
                    {upcomingBooking ? (
                      <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                        <div className="flex-1 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-parking-500"></span>
                            <span className="text-[10px] uppercase font-semibold tracking-widest text-parking-600">Active Reservation</span>
                          </div>
                          <h3 className="text-xl font-semibold text-slate-900">{upcomingBooking.parkingId?.title}</h3>
                          <p className="text-sm text-slate-600 flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[16px] text-slate-400">location_on</span>
                            {upcomingBooking.parkingId?.address}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-slate-500">
                            <div className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">calendar_today</span>
                              {safeFormatDate(upcomingBooking.startTime, { weekday: 'short', month: 'short', day: 'numeric' })}
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">schedule</span>
                              {safeFormatTime(upcomingBooking.startTime, { hour: '2-digit', minute: '2-digit' })} - {safeFormatTime(upcomingBooking.endTime, { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-row md:flex-col items-center md:items-end gap-3 w-full md:w-auto border-t border-slate-100 md:border-t-0 pt-4 md:pt-0">
                          <div className="text-left md:text-right flex-1 md:flex-initial mb-2">
                            <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider block">Price Paid</span>
                            <span className="text-xl font-semibold text-slate-900 tabular-nums">₹{upcomingBooking.totalPrice}</span>
                          </div>
                          <div className="flex flex-wrap gap-2 justify-end w-full md:w-auto">
                            <Button
                              onClick={() => setSelectedTicket(upcomingBooking)}
                              variant="primary"
                              size="sm"
                              className="flex items-center gap-1.5"
                            >
                              <span className="material-symbols-outlined text-[16px]">qr_code</span>
                              View Ticket
                            </Button>
                            <Button
                              onClick={() => setExtendingBooking(upcomingBooking)}
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-1.5"
                            >
                              <span className="material-symbols-outlined text-[16px]">more_time</span>
                              Extend
                            </Button>
                            <Button
                              onClick={() => setReportingBooking(upcomingBooking)}
                              variant="outline"
                              size="sm"
                              className="text-red-600 border-red-200 hover:bg-red-50 flex items-center gap-1.5"
                            >
                              <span className="material-symbols-outlined text-[16px]">report_problem</span>
                              Report
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 flex flex-col items-center">
                        <span className="material-symbols-outlined text-4xl mb-3 text-slate-300">directions_car</span>
                        <p className="text-sm font-medium text-slate-600">No active upcoming bookings</p>
                        <p className="text-xs text-slate-400 mt-0.5">Your active reservation tickets will display here for instant directions.</p>
                      </div>
                    )}
                  </div>

                  {/* Recently Booked */}
                  <div>
                    <h2 className="text-xs uppercase font-semibold text-slate-400 tracking-wider mb-4">Recently Booked</h2>
                    {recentlyCompleted.length === 0 ? (
                      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
                        <p className="text-xs text-slate-400">Your completed parking list will appear here once you finish a ride.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {recentlyCompleted.map(b => {
                          const spot = b.parkingId;
                          if (!spot || typeof spot !== "object") return null;
                          return (
                            <div key={b._id} className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden hover:shadow-md transition-shadow flex flex-col">
                              {spot.images?.[0]?.url && (
                                <img src={normalizeImageUrl(spot.images[0])} alt={spot.title} className="w-full h-32 object-cover" />
                              )}
                              <div className="p-4 flex-1 flex flex-col justify-between">
                                <div>
                                  <h4 className="font-semibold text-slate-900 text-sm truncate">{spot.title}</h4>
                                  <p className="text-slate-500 text-xs truncate mt-0.5">{spot.address}</p>
                                </div>
                                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                                  <span className="font-semibold text-slate-900 text-xs tabular-nums">₹{spot.pricePerHour}/hr</span>
                                  <Link to={`/parking/${spot._id}`} className="text-[10px] uppercase tracking-wider font-semibold text-accent-600 hover:underline">Rebook</Link>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* BOOKINGS TAB — itinerary list */}
              {activeTab === 'bookings' && (
                <div>
                  <h1 className="text-2xl font-semibold text-slate-900 mb-6">Active & Past Bookings</h1>
                  {bookings.length === 0 ? (
                    <div className="bg-white border border-slate-200 p-12 text-center rounded-xl flex flex-col items-center">
                      <span className="material-symbols-outlined text-[48px] text-slate-300 mb-4">event_busy</span>
                      <h3 className="text-lg font-semibold text-slate-900 mb-2">No bookings found</h3>
                      <p className="text-slate-500 mb-6">Looks like you haven't booked any spots yet.</p>
                      <Button variant="primary" onClick={() => navigate('/')}>Explore Parking</Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {bookings.map((b) => (
                        <div key={b._id} className="bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow rounded-xl p-5 flex flex-col md:flex-row justify-between gap-4 items-start md:items-center">
                          <div className="flex-1 w-full">
                            <div className="flex justify-between md:justify-start items-center gap-3 mb-2">
                              <h3 className="font-semibold text-base text-slate-900">{b.parkingId?.title || "Deleted Spot"}</h3>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${statusPill(b.status)}`}>
                                {b.status || 'Active'}
                              </span>
                            </div>
                            <div className="flex items-center text-sm text-slate-500 gap-4 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-[16px]">schedule</span>
                                {safeFormatTime(b.startTime, {hour: '2-digit', minute:'2-digit'})} - {safeFormatTime(b.endTime, {hour: '2-digit', minute:'2-digit'})}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                                {safeFormatDate(b.startTime)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between w-full md:w-auto md:flex-col md:items-end gap-3 border-t border-slate-100 md:border-t-0 pt-4 md:pt-0">
                            <div className="flex flex-col md:items-end">
                              <span className="text-[10px] uppercase text-slate-400 font-semibold mb-0.5 tracking-wider">Total Paid</span>
                              <span className="text-lg font-semibold text-slate-900 tabular-nums">₹{b.totalPrice}</span>
                            </div>
                            <div className="flex flex-wrap gap-2 justify-end">
                              {b.qrCode && !['cancelled', 'refunded'].includes(b.status) && (
                                <Button
                                  onClick={() => setSelectedTicket(b)}
                                  variant="primary"
                                  size="sm"
                                  className="flex items-center gap-1.5"
                                >
                                  <span className="material-symbols-outlined text-[16px]">qr_code</span>
                                  Ticket
                                </Button>
                              )}
                              {['paid', 'checked_in', 'active'].includes(b.status) && (
                                <Button
                                  onClick={() => navigate(`/parking/${b.parkingId?._id}`)}
                                  variant="outline"
                                  size="sm"
                                  className="flex items-center gap-1.5"
                                >
                                  <span className="material-symbols-outlined text-[16px]">navigation</span>
                                  Navigate
                                </Button>
                              )}
                              {['paid', 'checked_in', 'active'].includes(b.status) && (
                                <>
                                  <Button
                                    onClick={() => setExtendingBooking(b)}
                                    variant="outline"
                                    size="sm"
                                    className="flex items-center gap-1"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">more_time</span>
                                    Extend
                                  </Button>
                                  <Button
                                    onClick={() => setReportingBooking(b)}
                                    variant="outline"
                                    size="sm"
                                    className="text-red-600 border-red-200 hover:bg-red-50 flex items-center gap-1"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">report_problem</span>
                                    Report
                                  </Button>
                                </>
                              )}
                              {(b.status === 'paid' || b.status === 'pending') && (
                                <Button
                                  onClick={() => handleCancelBooking(b._id)}
                                  variant="outline"
                                  size="sm"
                                  className="text-red-600 border-red-200 hover:bg-red-50"
                                >
                                  Cancel
                                </Button>
                              )}
                              {(b.status === 'completed' || (new Date(b.endTime) < new Date() && !['cancelled', 'refund_pending', 'refunded'].includes(b.status))) && !b.reviewed && (
                                <Button
                                  onClick={() => setReviewBooking(b)}
                                  variant="outline"
                                  size="sm"
                                >
                                  Rate Experience
                                </Button>
                              )}
                              {b.reviewed && (
                                <span className="text-xs text-slate-400 flex items-center gap-1 px-3">
                                  <span className="material-symbols-outlined text-[16px] text-amber-500" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                                  Reviewed
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SAVED LOCATIONS TAB */}
              {activeTab === 'saved' && (
                <div>
                  <h1 className="text-2xl font-semibold text-slate-900 mb-6">Saved Places</h1>
                  {favoritesLoading ? (
                    <div className="text-slate-500">Loading saved spots...</div>
                  ) : favorites.length === 0 ? (
                    <div className="bg-white border border-slate-200 p-12 text-center rounded-xl flex flex-col items-center">
                      <span className="material-symbols-outlined text-5xl mb-4 text-slate-300">favorite</span>
                      <p className="text-slate-500">Spots you bookmark for quick access will map here.</p>
                      <Button variant="outline" className="mt-6" onClick={() => navigate('/')}>Find Places to Save</Button>
                    </div>
                  ) : (
                    <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                              <th className="p-4 text-xs font-semibold uppercase tracking-wider">Parking spot</th>
                              <th className="p-4 text-xs font-semibold uppercase tracking-wider">Rating</th>
                              <th className="p-4 text-xs font-semibold uppercase tracking-wider">Distance</th>
                              <th className="p-4 text-xs font-semibold uppercase tracking-wider">Last booked</th>
                              <th className="p-4 text-xs font-semibold uppercase tracking-wider">Hourly Rate</th>
                              <th className="p-4 text-xs font-semibold uppercase tracking-wider text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {favorites.filter(spot => spot && typeof spot === "object").map((spot) => {
                              const spotCoords = spot.location?.coordinates;
                              const calculateDistance = (coords) => {
                                if (!userCoords || !coords || coords.length < 2) return "1.2 km";
                                const [lng1, lat1] = coords;
                                const { lat: lat2, lng: lng2 } = userCoords;
                                const R = 6371; // km
                                const dLat = (lat2 - lat1) * Math.PI / 180;
                                const dLon = (lng2 - lng1) * Math.PI / 180;
                                const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                                          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                                          Math.sin(dLon/2) * Math.sin(dLon/2);
                                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                                const d = R * c;
                                return `${d.toFixed(1)} km`;
                              };
                              const getSpotLastBooked = (spotId) => {
                                const spotBookings = bookings.filter(b => b.parkingId?._id === spotId || b.parkingId === spotId);
                                if (spotBookings.length === 0) return "Never";
                                const latest = new Date(Math.max(...spotBookings.map(b => new Date(b.createdAt))));
                                return safeFormatDate(latest, { month: 'short', day: 'numeric', year: 'numeric' });
                              };

                              return (
                                <tr key={spot._id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                  <td className="p-4">
                                    <div className="flex items-center gap-3">
                                      <img
                                        src={normalizeImageUrl(spot.images?.[0] || spot.image)}
                                        onError={(e) => { e.target.src = normalizeImageUrl(null); }}
                                        alt={spot.title}
                                        className="w-12 h-12 object-cover rounded-lg border border-slate-200 flex-shrink-0"
                                      />
                                      <div>
                                        <div className="font-semibold text-slate-900 text-sm">{spot.title}</div>
                                        <div className="text-slate-500 text-xs truncate max-w-xs mt-0.5">{spot.address}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="p-4 text-sm font-medium">
                                    <div className="flex items-center gap-1 text-amber-500">
                                      <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                                      {spot.rating || "5.0"}
                                    </div>
                                  </td>
                                  <td className="p-4 text-sm font-medium text-slate-600">
                                    {calculateDistance(spotCoords)}
                                  </td>
                                  <td className="p-4 text-xs text-slate-500">
                                    {getSpotLastBooked(spot._id)}
                                  </td>
                                  <td className="p-4 font-semibold text-slate-900 text-sm tabular-nums">
                                    ₹{spot.pricePerHour}/hr
                                  </td>
                                  <td className="p-4 text-right">
                                    <div className="flex items-center justify-end gap-3">
                                      <Button
                                        onClick={() => navigate(`/parking/${spot._id}`)}
                                        variant="primary"
                                        size="sm"
                                      >
                                        Quick Rebook
                                      </Button>
                                      <button
                                        onClick={() => handleUnfavorite(spot._id)}
                                        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors flex items-center justify-center"
                                        title="Remove from favorites"
                                      >
                                        <span className="material-symbols-outlined text-[18px]">bookmark_remove</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* PAYMENTS TAB */}
              {activeTab === 'payments' && (
                <div>
                  <h1 className="text-2xl font-semibold text-slate-900 mb-6">Payment Receipts</h1>
                  <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Date</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Spot Details</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Order ID</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Amount</th>
                            <th className="p-4 text-xs font-semibold uppercase text-slate-500 tracking-wider">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bookings.filter(b => b.paymentStatus === 'paid').length === 0 ? (
                            <tr>
                              <td colSpan="5" className="p-8 text-center text-slate-400 text-sm">No payment records found. Only paid bookings will generate receipts here.</td>
                            </tr>
                          ) : (
                            bookings.filter(b => b.paymentStatus === 'paid').map(b => (
                              <tr key={b._id} className="border-b border-slate-100 hover:bg-slate-50">
                                <td className="p-4 text-xs text-slate-500">
                                  {safeFormatDate(b.createdAt, { dateStyle: 'medium' })}
                                </td>
                                <td className="p-4">
                                  <div className="font-medium text-slate-900 text-sm">{b.parkingId?.title || "Deleted Spot"}</div>
                                  <div className="text-slate-500 text-xs mt-0.5 truncate max-w-xs">{b.parkingId?.address}</div>
                                </td>
                                <td className="p-4 text-xs font-mono text-slate-500">
                                  {b.razorpayOrderId || "Simulated_Order"}
                                </td>
                                <td className="p-4 font-semibold text-slate-900 text-sm tabular-nums">
                                  ₹{b.totalPrice}
                                </td>
                                <td className="p-4">
                                  <span className={`text-[10px] uppercase font-semibold px-2.5 py-0.5 rounded-full ${
                                    b.status === 'cancelled'
                                      ? 'bg-red-50 text-red-600 border border-red-200'
                                      : 'bg-parking-50 text-parking-700 border border-parking-100'
                                  }`}>
                                    {b.status === 'cancelled' ? 'Refund Pending' : 'Paid'}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* PROFILE TAB */}
              {activeTab === 'profile' && (
                <div className="max-w-2xl">
                  <h1 className="text-2xl font-semibold text-slate-900 mb-8">Profile Settings</h1>

                  <div className="bg-white border border-slate-200 shadow-sm p-8 rounded-xl space-y-6">
                    <div className="flex items-center gap-6 pb-6 border-b border-slate-200">
                      <div className="w-16 h-16 rounded-full bg-parking-100 flex items-center justify-center font-semibold text-2xl text-parking-700">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 text-base">{user.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{user.email}</p>
                      </div>
                    </div>

                    <form className="space-y-5" onSubmit={handleProfileSubmit}>
                      {profileMessage && (
                        <div className={`p-4 rounded-lg text-sm border ${
                          profileMessage.type === 'success'
                            ? 'bg-parking-50 border-parking-100 text-parking-700'
                            : 'bg-red-50 border-red-200 text-red-600'
                        }`}>
                          {profileMessage.text}
                        </div>
                      )}
                      <Input label="Full Name" value={name} onChange={e => setName(e.target.value)} icon="person" required />
                      <Input label="Email Address" defaultValue={user.email} icon="mail" disabled />
                      <Input label="Phone Number" value={phone} onChange={e => setPhone(e.target.value)} icon="call" required />

                      <div className="pt-4 border-t border-slate-200 flex justify-end">
                        <Button variant="primary" type="submit">Save Changes</Button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </section>
      </main>

      {/* TICKET / QR CODE MODAL */}
      <AnimatePresence>
        {selectedTicket && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xl p-6 text-center select-none"
            >
              {/* Close Button */}
              <button
                onClick={() => setSelectedTicket(null)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 transition-colors"
              >
                <span className="material-symbols-outlined text-[24px]">close</span>
              </button>

              {/* Ticket Design */}
              <div className="mt-4 pb-6 border-b border-dashed border-slate-200">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wider uppercase mb-4 ${
                  selectedTicket.status === 'cancelled'
                    ? 'bg-red-50 text-red-600 border border-red-200'
                    : selectedTicket.status === 'completed'
                    ? 'bg-slate-100 text-slate-600 border border-slate-200'
                    : 'bg-parking-50 text-parking-700 border border-parking-100'
                }`}>
                  {selectedTicket.status === 'cancelled' ? 'Cancelled' : selectedTicket.status === 'completed' ? 'Completed' : 'Booking Confirmed'}
                </span>

                <h3 className="text-xl font-semibold text-slate-900 leading-tight">
                  {selectedTicket.parkingId?.title || "ASAP Parking Spot"}
                </h3>
                <p className="text-slate-500 text-xs mt-1 px-4 truncate">
                  {selectedTicket.parkingId?.address}
                </p>
              </div>

              {/* Ticket Inner Info */}
              <div className="py-6 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-left">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider block">Arrival Date</span>
                    <span className="text-slate-900 font-semibold text-sm">
                      {safeFormatDate(selectedTicket.startTime, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider block">Time Slot</span>
                    <span className="text-slate-900 font-semibold text-sm">
                      {safeFormatTime(selectedTicket.startTime, { hour: '2-digit', minute: '2-digit' })} - {safeFormatTime(selectedTicket.endTime, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-left">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider block">Vehicle Type</span>
                    <span className="text-slate-900 font-semibold text-sm capitalize">
                      {selectedTicket.parkingId?.vehicleType || "Car"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider block">Total Amount</span>
                    <span className="text-parking-700 font-semibold text-base tabular-nums">
                      ₹{selectedTicket.totalPrice}
                    </span>
                  </div>
                </div>
              </div>

              {/* QR Code Segment */}
              <div className="bg-slate-50 border border-slate-200 p-6 rounded-lg flex flex-col items-center justify-center relative">
                {selectedTicket.qrCode ? (
                  <img
                    src={selectedTicket.qrCode}
                    alt="Ticket QR Code"
                    className="w-40 h-40 object-contain rounded-lg border-4 border-white shadow-sm"
                  />
                ) : (
                  <div className="w-40 h-40 bg-white border border-slate-200 rounded-lg flex items-center justify-center text-slate-400">
                    <span className="material-symbols-outlined text-4xl">qr_code</span>
                  </div>
                )}
                <span className="text-[9px] font-mono text-slate-400 mt-3 tracking-widest uppercase">
                  TICKET ID: {selectedTicket._id}
                </span>
              </div>

              <div className="mt-6 flex gap-3">
                <Button
                  onClick={() => window.print()}
                  variant="outline"
                  className="flex-1 flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[18px]">print</span>
                  Print
                </Button>
                <Button
                  onClick={() => setSelectedTicket(null)}
                  variant="primary"
                  className="flex-1"
                >
                  Done
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Real-time Socket Alert Toast */}
      <AnimatePresence>
        {socketAlert && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 16 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4"
          >
            <div className="bg-white border border-slate-200 shadow-md p-4 rounded-xl flex items-start gap-3">
              <span className="material-symbols-outlined text-accent-600">notifications_active</span>
              <div className="flex-1">
                <h4 className="font-semibold text-slate-900 text-xs">{socketAlert.title || "Real-time Notification"}</h4>
                <p className="text-slate-600 text-[11px] mt-1">{socketAlert.message}</p>
              </div>
              <button
                onClick={() => setSocketAlert(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rate Experience Modal */}
      <AnimatePresence>
        {reviewBooking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="relative w-full max-w-sm bg-white border border-slate-200 shadow-xl p-6 rounded-xl text-center"
            >
              <button
                onClick={handleSkipReview}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 transition-colors"
              >
                <span className="material-symbols-outlined text-[24px]">close</span>
              </button>

              <div className="flex flex-col items-center">
                <div className="w-10 h-10 rounded-full bg-accent-400/10 flex items-center justify-center text-accent-600 mb-4">
                  <span className="material-symbols-outlined text-[24px]">rate_review</span>
                </div>

                <h3 className="text-lg font-semibold text-slate-900">Rate Your Experience</h3>
                <p className="text-slate-500 text-xs mt-1">
                  How was your parking at <span className="text-accent-600 font-medium">{reviewBooking.parkingId?.title || "ASAP Parking Spot"}</span>?
                </p>

                {reviewError && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs w-full">
                    {reviewError}
                  </div>
                )}

                {/* Stars Selector */}
                <div className="flex gap-2 my-5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setReviewRating(star)}
                      className="hover:scale-110 transition-transform"
                    >
                      <span className="material-symbols-outlined text-[32px]" style={{
                        fontVariationSettings: star <= reviewRating ? "'FILL' 1" : "'FILL' 0",
                        color: star <= reviewRating ? '#f59e0b' : '#cbd5e1'
                      }}>
                        star
                      </span>
                    </button>
                  ))}
                </div>

                <form onSubmit={handleSubmitReview} className="w-full space-y-4">
                  <div className="text-left">
                    <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider block mb-1">Feedback Comment</label>
                    <textarea
                      value={reviewFeedback}
                      onChange={(e) => setReviewFeedback(e.target.value)}
                      required
                      placeholder="Write your feedback details here (e.g. secure, easy to locate, neat)..."
                      className="w-full input-field rounded-lg p-3 text-xs resize-none h-20"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleSkipReview}
                      className="flex-1"
                    >
                      Skip
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={submittingReview}
                      className="flex-1 flex items-center justify-center gap-1.5"
                    >
                      {submittingReview ? (
                        <>
                          <span className="material-symbols-outlined animate-spin text-[14px]">sync</span>
                          Submitting...
                        </>
                      ) : (
                        "Submit"
                      )}
                    </Button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Extend Booking Modal */}
      <AnimatePresence>
        {extendingBooking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="relative w-full max-w-sm bg-white border border-slate-200 shadow-xl p-6 rounded-xl text-center"
            >
              <button
                onClick={() => setExtendingBooking(null)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 transition-colors"
              >
                <span className="material-symbols-outlined text-[24px]">close</span>
              </button>

              <div className="flex flex-col items-center">
                <div className="w-10 h-10 rounded-full bg-parking-50 flex items-center justify-center text-parking-600 mb-4">
                  <span className="material-symbols-outlined text-[24px]">more_time</span>
                </div>

                <h3 className="text-lg font-semibold text-slate-900">Extend Parking Session</h3>
                <p className="text-slate-500 text-xs mt-1">
                  Add more hours to your booking at <span className="text-accent-600 font-medium">{extendingBooking.parkingId?.title}</span>.
                </p>

                {extensionError && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs w-full">
                    {extensionError}
                  </div>
                )}

                <form onSubmit={handleExtendBooking} className="w-full space-y-4 mt-4">
                  <div className="text-left">
                    <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider block mb-1">Duration (Hours)</label>
                    <select
                      value={extensionHours}
                      onChange={(e) => setExtensionHours(e.target.value)}
                      className="w-full input-field rounded-lg p-3 text-xs"
                    >
                      {[1, 2, 3, 4, 6, 8, 12].map(hr => (
                        <option key={hr} value={hr}>{hr} Hour{hr > 1 ? 's' : ''} (+₹{hr * (extendingBooking.parkingId?.pricePerHour || 0)})</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setExtendingBooking(null)}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={extendingLoading}
                      className="flex-1 flex items-center justify-center gap-1.5"
                    >
                      {extendingLoading ? (
                        <>
                          <span className="material-symbols-outlined animate-spin text-[14px]">sync</span>
                          Processing...
                        </>
                      ) : (
                        "Pay & Extend"
                      )}
                    </Button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Report Issue Modal */}
      <AnimatePresence>
        {reportingBooking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="relative w-full max-w-sm bg-white border border-slate-200 shadow-xl p-6 rounded-xl text-center"
            >
              <button
                onClick={() => setReportingBooking(null)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 transition-colors"
              >
                <span className="material-symbols-outlined text-[24px]">close</span>
              </button>

              <div className="flex flex-col items-center">
                <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-500 mb-4">
                  <span className="material-symbols-outlined text-[24px]">report</span>
                </div>

                <h3 className="text-lg font-semibold text-slate-900">Report Issue</h3>
                <p className="text-slate-500 text-xs mt-1">
                  Report problem at <span className="text-accent-600 font-medium">{reportingBooking.parkingId?.title}</span>. Admin will review for refund.
                </p>

                {reportError && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs w-full">
                    {reportError}
                  </div>
                )}

                <form onSubmit={handleReportIssue} className="w-full space-y-4 mt-4">
                  <div className="text-left">
                    <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider block mb-1">Issue Category</label>
                    <select
                      value={reportCategory}
                      onChange={(e) => setReportCategory(e.target.value)}
                      className="w-full input-field rounded-lg p-3 text-xs"
                    >
                      {["Parking Full", "Wrong Location", "Unsafe Area", "Host Unresponsive", "Other"].map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div className="text-left">
                    <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider block mb-1">Description</label>
                    <textarea
                      value={reportDescription}
                      onChange={(e) => setReportDescription(e.target.value)}
                      required
                      placeholder="Please provide details (e.g. gates locked, fully occupied, host not picking up)..."
                      className="w-full input-field rounded-lg p-3 text-xs resize-none h-20"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setReportingBooking(null)}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="danger"
                      disabled={reportingLoading}
                      className="flex-1 flex items-center justify-center"
                    >
                      {reportingLoading ? (
                        <>
                          <span className="material-symbols-outlined animate-spin text-[14px]">sync</span>
                          Submitting...
                        </>
                      ) : (
                        "Submit Ticket"
                      )}
                    </Button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
