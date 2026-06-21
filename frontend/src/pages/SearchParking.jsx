import React, { useState, useEffect, useContext } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Navbar from "../components/Navbar";
import SearchBar from "../components/SearchBar";
import ParkingCard from "../components/ParkingCard";
import Footer from "../components/Footer";
import MapSection from "../components/MapSection";
import Button from "../components/ui/Button";
import { AuthContext } from "../context/AuthContext";
import {
  getRecommended,
  getDeals,
  getStats,
  getTestimonials,
  getLiveAvailability,
  searchParkings,
  fetchNearbyParkings,
  fetchUserBookings,
  getFavorites,
  submitParkingReview
} from "../services/api";
import { assignDiverseImages, IMAGE_POOLS } from "../utils/imageHelper";

// Destination-centric quick picks instead of generic category words — these match
// the SearchBar's own geocoding fallback dictionary so a tap resolves real coordinates.
const POPULAR_DESTINATIONS = [
  { label: "Airport T2", icon: "flight", coords: { lat: 19.0896, lng: 72.8656 } },
  { label: "R City Mall", icon: "storefront", coords: { lat: 19.0863, lng: 72.9264 } },
  { label: "Phoenix Marketcity", icon: "local_mall", coords: { lat: 19.0886, lng: 72.8890 } },
  { label: "BKC", icon: "apartment", coords: { lat: 19.0607, lng: 72.8634 } },
  { label: "Powai", icon: "location_city", coords: { lat: 19.1176, lng: 72.9060 } },
  { label: "Ghatkopar Station", icon: "train", coords: { lat: 19.0864, lng: 72.9081 } },
];

// "Where are you going?" — parking-type discovery cards, each backed by a
// genuinely verified parking photo from the matching category pool.
const PARKING_TYPES = [
  { label: "Airport Parking", icon: "flight", query: "Airport", image: IMAGE_POOLS.airport[0] },
  { label: "Mall Parking", icon: "local_mall", query: "Mall", image: IMAGE_POOLS.mall[0] },
  { label: "Office Parking", icon: "apartment", query: "Office", image: IMAGE_POOLS.corporate[0] },
  { label: "Station Parking", icon: "train", query: "Station", image: IMAGE_POOLS.garage[1] },
  { label: "Hospital Parking", icon: "local_hospital", query: "Hospital", image: IMAGE_POOLS.garage[2] },
  { label: "Residential Parking", icon: "home", query: "Residential", image: IMAGE_POOLS.residential[0] },
  { label: "EV Charging", icon: "ev_station", query: "EV Charging", image: IMAGE_POOLS.evCharging[0] },
];

const WHY_ASAP = [
  { label: "Verified Hosts", icon: "verified_user", description: "Every listing is reviewed before it goes live." },
  { label: "Live Availability", icon: "sensors", description: "See real-time open spots before you book." },
  { label: "Instant Booking", icon: "bolt", description: "Reserve your spot in seconds, no back-and-forth." },
  { label: "QR Entry", icon: "qr_code_2", description: "Scan in and out — no calls, no waiting." },
  { label: "Secure Payments", icon: "encrypted", description: "Bank-grade checkout powered by Razorpay." },
  { label: "Real Reviews", icon: "rate_review", description: "Ratings from drivers who actually parked there." },
];

const SearchSkeleton = () => (
  <div className="flex flex-col gap-4 w-full">
    {[...Array(3)].map((_, i) => (
      <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row gap-4 animate-pulse h-auto sm:h-44 flex-shrink-0">
        <div className="w-full sm:w-40 h-40 sm:h-full bg-slate-100 rounded-lg flex-shrink-0"></div>
        <div className="flex-1 flex flex-col justify-between py-1">
          <div className="space-y-3">
            <div className="flex justify-between items-start">
              <div className="h-5 bg-slate-100 rounded w-2/3"></div>
              <div className="h-4 bg-slate-100 rounded w-10"></div>
            </div>
            <div className="flex gap-4">
              <div className="h-3.5 bg-slate-100 rounded w-24"></div>
              <div className="h-3.5 bg-slate-100 rounded w-16"></div>
            </div>
          </div>
          <div className="flex justify-between items-end border-t border-slate-100 pt-3 mt-4">
            <div className="space-y-1">
              <div className="h-2.5 bg-slate-100 rounded w-8"></div>
              <div className="h-5 bg-slate-100 rounded w-16"></div>
            </div>
            <div className="flex gap-2">
              <div className="h-8 bg-slate-100 rounded w-20"></div>
              <div className="h-8 bg-slate-100 rounded w-24"></div>
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);

const EmptyState = ({ onSuggestionClick }) => (
  <div className="bg-white border border-slate-200 shadow-sm p-10 text-center rounded-xl flex flex-col items-center justify-center gap-6 max-w-xl mx-auto my-8">
    <span className="material-symbols-outlined text-slate-300 text-5xl">explore_off</span>
    <div className="space-y-2">
      <h3 className="text-xl font-semibold text-slate-900">No parking found nearby</h3>
      <p className="text-slate-500 text-sm max-w-sm mx-auto">
        We couldn't find any parking spaces matching your filters for this location.
      </p>
    </div>

    <div className="border-t border-slate-200 pt-5 w-full">
      <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 mb-3">Popular Locations to Try</p>
      <div className="flex flex-wrap gap-2 justify-center">
        {["Ghatkopar", "Powai", "BKC", "Airport T2"].map((loc) => (
          <button
            key={loc}
            onClick={() => onSuggestionClick(loc)}
            className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[13px] text-slate-400">location_on</span>
            {loc}
          </button>
        ))}
      </div>
    </div>
  </div>
);

export default function SearchParking() {
  const { user } = useContext(AuthContext);
  const [searchParams, setSearchParams] = useSearchParams();

  const [recommended, setRecommended] = useState([]);
  const [deals, setDeals] = useState([]);
  const [stats, setStats] = useState({ totalUsers: 0, totalBookings: 0, avgRating: 0 });
  const [testimonials, setTestimonials] = useState([]);
  const [liveAvailability, setLiveAvailability] = useState(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [searchedLocation, setSearchedLocation] = useState(null);

  const [loading, setLoading] = useState(true);
  const [savedSpots, setSavedSpots] = useState([]);
  const [recentBookedSpots, setRecentBookedSpots] = useState([]);

  const [recentSearches, setRecentSearches] = useState([]);
  const [pendingReviewBooking, setPendingReviewBooking] = useState(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const [sortBy, setSortBy] = useState("distance");
  const [filterDistance, setFilterDistance] = useState("all");
  const [filterPrice, setFilterPrice] = useState("all");
  const [filterRating, setFilterRating] = useState("all");
  const [filterAvailability, setFilterAvailability] = useState("all");

  // Scroll matching card into view when selectedSpot changes
  useEffect(() => {
    if (selectedSpot) {
      const cardEl = document.getElementById(`parking-card-${selectedSpot._id}`);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [selectedSpot]);

  // 1. Fetch static dynamic blocks
  useEffect(() => {
    const fetchHomepageData = async () => {
      try {
        const [recRes, dealsRes, statsRes, testRes] = await Promise.all([
           getRecommended().catch(() => ({ data: [] })),
           getDeals().catch(() => ({ data: [] })),
           getStats().catch(() => ({ data: { totalUsers: 15124, totalBookings: 45290, avgRating: 4.8 } })),
           getTestimonials().catch(() => ({ data: [] }))
        ]);

        setRecommended(recRes.data);
        setDeals(dealsRes.data);
        setStats(statsRes.data);
        setTestimonials(testRes.data);

        // If user logged in, fetch driver context
        if (user) {
          const [favsRes, bookingsRes] = await Promise.all([
            getFavorites().catch(() => ({ data: [] })),
            fetchUserBookings(user._id).catch(() => ({ data: [] }))
          ]);
          setSavedSpots(favsRes.data);

          // Find unreviewed completed booking
          const unreviewed = bookingsRes.data.find(b => b.status === "completed" && !b.reviewed);
          setPendingReviewBooking(unreviewed);

          // Get unique parking spots from driver completed bookings
          const completedBookings = bookingsRes.data.filter(b => b.status === "completed" || new Date(b.endTime) < new Date());
          const spotsMap = {};
          const uniqueSpots = [];
          completedBookings.forEach(b => {
            if (b.parkingId && !spotsMap[b.parkingId._id]) {
              spotsMap[b.parkingId._id] = true;
              uniqueSpots.push(b.parkingId);
            }
          });
          setRecentBookedSpots(uniqueSpots.slice(0, 4));
        }
      } catch (err) {
        console.error("Error fetching homepage data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchHomepageData();
  }, [user]);

  // Load recent searches from localStorage
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("asap_recent_searches") || "[]");
    setRecentSearches(saved);
  }, []);

  // 2. Fetch Geolocation Based Features
  const requestLocation = () => {
    if (navigator.geolocation) {
       navigator.geolocation.getCurrentPosition(async (position) => {
         const { latitude, longitude } = position.coords;
         try {
           const res = await getLiveAvailability(latitude, longitude);
           setLiveAvailability(res.data.availableSpots);
         } catch(e) {}
       }, (error) => {
         console.error("Location denied", error);
       });
    }
  };

  // 3. Search Logic
  const handlePopularSearch = async (query) => {
     if (query === "Near Me") {
        requestLocation();
        return;
     }
     const destination = POPULAR_DESTINATIONS.find(d => d.label === query);
     const params = { q: query };
     if (destination?.coords) {
        params.lat = destination.coords.lat.toString();
        params.lng = destination.coords.lng.toString();
     }
     setSearchParams(params);
  };

  const executeSearch = async (query, coords = null) => {
     try {
       setLoading(true);
       setSearchedLocation(coords);

       let res;
       if (coords && coords.lat && coords.lng) {
          console.log(`[Nearby Query] Frontend executing search at coordinates:`, coords);
          res = await fetchNearbyParkings(coords.lat, coords.lng);
       } else {
          console.log(`[Nearby Query] Frontend executing text fallback search for query: "${query}"`);
          res = await searchParkings(query);
       }

       setSearchResults(res.data || []);

       // Save query to recent searches
       if (query && query.trim() !== "" && query !== "Near Me") {
         const cleaned = query.trim();
         const saved = JSON.parse(localStorage.getItem("asap_recent_searches") || "[]");
         const filtered = [cleaned, ...saved.filter(q => q !== cleaned)].slice(0, 4);
         localStorage.setItem("asap_recent_searches", JSON.stringify(filtered));
         setRecentSearches(filtered);
       }

       if (res.data && res.data.length > 0) {
          setSelectedSpot(res.data[0]);
          console.log(`[Parking Found] Found ${res.data.length} spots near target.`);
       } else {
          setSelectedSpot(null);
          console.log(`[Parking Found] No spots found.`);
       }
     } catch(e) {
       console.error("Search failed", e);
       setSearchResults([]);
       setSelectedSpot(null);
      } finally {
        setLoading(false);
      }
   };

  useEffect(() => {
    const q = searchParams.get("q");
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");

    if (q) {
      const coords = lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null;
      setSearchQuery(q);
      executeSearch(q, coords);
    } else {
      setSearchQuery("");
      setSearchResults(null);
      setSelectedSpot(null);
      setSearchedLocation(null);
    }
  }, [searchParams]);

   const fadeInUp = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } }
  };

  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    if (!user || !pendingReviewBooking) return;
    try {
      const parkingId = pendingReviewBooking.parkingId?._id || pendingReviewBooking.parkingId;
      if (!parkingId) {
        alert("Parking spot details are missing.");
        setPendingReviewBooking(null);
        return;
      }
      setReviewSubmitting(true);
      await submitParkingReview(parkingId, {
        rating: reviewRating,
        feedback: reviewComment,
        bookingId: pendingReviewBooking._id
      });
      setPendingReviewBooking(null);
      alert("Thank you for your review!");
    } catch (err) {
      console.error(err);
      alert("Failed to submit review: " + (err.response?.data?.message || err.message));
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleSkipReview = () => {
    setPendingReviewBooking(null);
  };

  const getSortedAndFilteredResults = () => {
    if (!searchResults) return [];

    let list = [...searchResults];

    // Filter by Distance
    if (filterDistance === "1km") {
      list = list.filter(s => s.distance !== undefined && s.distance <= 1);
    } else if (filterDistance === "3km") {
      list = list.filter(s => s.distance !== undefined && s.distance <= 3);
    }

    // Filter by Price
    if (filterPrice === "100") {
      list = list.filter(s => (s.price || s.pricePerHour || 0) <= 100);
    } else if (filterPrice === "150") {
      list = list.filter(s => (s.price || s.pricePerHour || 0) <= 150);
    }

    // Filter by Rating
    if (filterRating === "4.5") {
      list = list.filter(s => (s.rating || 0) >= 4.5);
    }

    // Filter by Availability (Booked-out locations disappear when capacity reaches zero)
    list = list.filter(s => {
      const slots = s.availableSpots !== undefined ? s.availableSpots : (s.availableSlots || 0);
      return slots > 0;
    });

    // Sorting
    if (sortBy === "distance") {
      list.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    } else if (sortBy === "price_asc") {
      list.sort((a, b) => (a.price || a.pricePerHour || 0) - (b.price || b.pricePerHour || 0));
    } else if (sortBy === "price_desc") {
      list.sort((a, b) => (b.price || b.pricePerHour || 0) - (a.price || a.pricePerHour || 0));
    } else if (sortBy === "rating") {
      list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === "availability") {
      list.sort((a, b) => {
        const slotsA = a.availableSpots !== undefined ? a.availableSpots : (a.availableSlots || 0);
        const slotsB = b.availableSpots !== undefined ? b.availableSpots : (b.availableSlots || 0);
        return slotsB - slotsA;
      });
    }

    return list;
  };

  const sortedResults = getSortedAndFilteredResults();

  // Diversify imagery + apply card index variety once per render pass, per section,
  // so two adjacent cards never show the same stock photo.
  const trendingSpots = assignDiverseImages(recommended.filter(Boolean).slice(0, 4));
  const popularNearYou = assignDiverseImages(deals.filter(Boolean).slice(0, 4));
  const weekendFavorites = assignDiverseImages(
    [...recommended].filter(Boolean).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 4)
  );
  const recentlyBookedDisplay = assignDiverseImages(recentBookedSpots.filter(Boolean));
  const savedSpotsDisplay = assignDiverseImages(savedSpots.filter(Boolean).slice(0, 4));

  return (
    <div className="min-h-screen bg-white flex flex-col font-sans">
      <Navbar />

      <main className="flex-1">
        {/* SECTION 1 — HERO: real parking imagery, no map background, search front and center */}
        <section className="relative border-b border-slate-200">
           {/* overflow-hidden is scoped to just the background image layer — the section
               itself must NOT clip, otherwise the search autocomplete dropdown (which is
               positioned absolute relative to the search bar a few levels down) gets cut
               off at this section's bottom edge regardless of z-index. */}
           <div className="absolute inset-0 overflow-hidden">
              <img
                src="https://images.unsplash.com/photo-1758448721161-7b3df5ec04b3?auto=format&fit=crop&w=1600&q=70"
                alt="Modern multi-level parking garage"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-white via-white/95 to-white/40" />
           </div>

           <div className="relative max-w-6xl mx-auto px-6 pt-14 pb-10">
             {/* LIVE AVAILABILITY BANNER */}
             <AnimatePresence>
                {liveAvailability !== null && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: -20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                    className="mb-4 inline-flex bg-parking-50 border border-parking-100 text-parking-700 px-5 py-2 rounded-full font-semibold text-sm items-center gap-2 cursor-pointer"
                  >
                     <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-parking-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-parking-500"></span>
                     </span>
                     {liveAvailability} spots available near you
                  </motion.div>
                )}
             </AnimatePresence>

             <motion.h1
               initial="hidden" animate="visible" variants={fadeInUp}
               className="text-3xl sm:text-4xl md:text-[2.75rem] font-semibold text-slate-900 tracking-tight mb-3 leading-[1.1] max-w-xl"
             >
               Parking before you arrive.
             </motion.h1>
             <motion.p
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.4 }}
               className="text-slate-600 text-base sm:text-lg mb-6 max-w-lg"
             >
               Search verified parking near malls, airports, offices, stations, and residential areas — book in seconds.
             </motion.p>

             <motion.div
               initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15, duration: 0.4 }}
               className="w-full max-w-3xl sticky top-[88px] z-40"
             >
                <SearchBar
                  onSearch={(q, d, t, coords) => {
                    const params = { q };
                    if (coords && coords.lat && coords.lng) {
                      params.lat = coords.lat.toString();
                      params.lng = coords.lng.toString();
                    }
                    setSearchParams(params);
                  }}
                  initialQuery={searchQuery}
                />
             </motion.div>
           </div>
        </section>

        {/* SECTION 2 — WHERE ARE YOU GOING? destination-type discovery with real imagery */}
        {searchResults === null && (
          <section className="bg-white border-b border-slate-200 pt-10 pb-8 px-6">
            <div className="max-w-6xl mx-auto">
              <h2 className="text-xl font-semibold text-slate-900 mb-1">Where are you going?</h2>
              <p className="text-slate-500 text-sm mb-5">Jump straight to the kind of parking you need.</p>

              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                {PARKING_TYPES.map(type => (
                  <button
                    key={type.label}
                    onClick={() => handlePopularSearch(type.query)}
                    className="group relative rounded-xl overflow-hidden border border-slate-200 hover:border-parking-300 hover:shadow-md transition-all aspect-[4/5] text-left"
                  >
                    <img
                      src={type.image}
                      alt={type.label}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/10 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-2.5">
                      <span className="text-white text-[13px] font-semibold leading-tight flex items-center gap-1">
                        <span className="material-symbols-outlined text-[15px]">{type.icon}</span>
                        {type.label}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* POPULAR DESTINATIONS — named places, immediately below */}
              <div className="flex items-center justify-between mt-8 mb-3">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Popular Destinations</h3>
                <button
                  onClick={() => handlePopularSearch('Near Me')}
                  className="text-xs font-semibold text-parking-600 hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">my_location</span>
                  Use my location
                </button>
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                {POPULAR_DESTINATIONS.map(dest => (
                  <button
                    key={dest.label}
                    onClick={() => handlePopularSearch(dest.label)}
                    className="flex items-center gap-2.5 bg-white hover:border-parking-300 hover:shadow-sm border border-slate-200 text-slate-700 pl-3 pr-4 py-2.5 rounded-xl text-sm font-medium transition-all flex-shrink-0"
                  >
                    <span className="w-8 h-8 rounded-lg bg-parking-50 text-parking-600 flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-[18px]">{dest.icon}</span>
                    </span>
                    {dest.label}
                  </button>
                ))}
              </div>

              {/* RECENTLY SEARCHED */}
              {recentSearches.length > 0 && (
                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider mr-1">Recently Searched</span>
                  {recentSearches.map(q => (
                     <button
                       key={q}
                       onClick={() => handlePopularSearch(q)}
                       className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5"
                     >
                       <span className="material-symbols-outlined text-[14px] text-slate-400">history</span>
                       {q}
                     </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* SECTION 3 — WHY ASAP: trust cards, not KPI tiles */}
        {searchResults === null && (
          <section className="bg-slate-50 border-b border-slate-200 py-12 px-6">
            <div className="max-w-6xl mx-auto">
              <h2 className="text-xl font-semibold text-slate-900 mb-5">Why ASAP</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {WHY_ASAP.map(item => (
                  <div key={item.label} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
                    <span className="w-9 h-9 rounded-lg bg-parking-50 text-parking-600 flex items-center justify-center">
                      <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 leading-tight">{item.label}</p>
                      <p className="text-xs text-slate-500 mt-1 leading-snug">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* SEARCH RESULTS VIEW */}
        {searchResults !== null && (
          <section className="bg-white border-b border-slate-200 py-8 px-6">
              <div className="max-w-screen-2xl mx-auto">
                  {searchResults.length > 0 && searchResults[0].isAlternative && (
                     <div className="mb-4 p-4 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-xs flex items-center gap-3">
                        <span className="material-symbols-outlined text-[20px]">warning</span>
                        <div>
                           <p className="font-semibold">No parking found directly at this location.</p>
                           <p className="text-amber-600 text-[11px] mt-0.5">Showing nearest available alternatives instead.</p>
                        </div>
                     </div>
                  )}

                  {/* STICKY SEARCH HEADER SECTION */}
                  <div className="sticky top-[76px] z-30 bg-white/95 backdrop-blur-sm pt-2 pb-5 border-b border-slate-200 mb-6 flex flex-col gap-4">
                     <div className="flex flex-wrap items-center justify-between gap-4 w-full">
                        {/* Title and stats details */}
                        <div>
                           <h2 className="text-xl font-semibold text-slate-900 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              Search Results
                              <span className="text-slate-400 text-xs font-medium normal-case">
                                 near {searchQuery || (searchedLocation ? "Coordinates" : "Mumbai")}
                              </span>
                           </h2>
                           <p className="text-slate-500 text-[11px] font-medium mt-0.5">
                              {sortedResults.length} {sortedResults.length === 1 ? "spot" : "spots"} found • Sorted by {
                                 sortBy === "distance" ? "Distance"
                                 : sortBy === "price_asc" ? "Price (Low to High)"
                                 : sortBy === "price_desc" ? "Price (High to Low)"
                                 : sortBy === "rating" ? "Rating"
                                 : "Available slots"
                              }
                           </p>
                        </div>

                        {/* Clear Search & Header Actions */}
                        <button
                          onClick={() => {
                            setSearchParams({});
                          }}
                          className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5"
                        >
                          <span className="material-symbols-outlined text-[16px]">close</span>
                          Clear Search
                        </button>
                     </div>

                     {/* Filters Row */}
                     <div className="flex flex-wrap items-center gap-3">
                        {/* Distance Filter */}
                        <div className="relative">
                          <select
                            value={filterDistance}
                            onChange={(e) => setFilterDistance(e.target.value)}
                            className="bg-white hover:bg-slate-50 text-slate-600 px-3 py-1.5 pr-8 rounded-lg text-xs font-medium border border-slate-200 focus:border-parking-500 focus:outline-none transition-all cursor-pointer appearance-none"
                          >
                            <option value="all">Any Distance</option>
                            <option value="1km">Within 1 km</option>
                            <option value="3km">Within 3 km</option>
                          </select>
                          <span className="material-symbols-outlined text-[14px] absolute right-2.5 top-2 pointer-events-none text-slate-400">expand_more</span>
                        </div>

                        {/* Price Filter */}
                        <div className="relative">
                          <select
                            value={filterPrice}
                            onChange={(e) => setFilterPrice(e.target.value)}
                            className="bg-white hover:bg-slate-50 text-slate-600 px-3 py-1.5 pr-8 rounded-lg text-xs font-medium border border-slate-200 focus:border-parking-500 focus:outline-none transition-all cursor-pointer appearance-none"
                          >
                            <option value="all">Any Price</option>
                            <option value="100">Under ₹100/hr</option>
                            <option value="150">Under ₹150/hr</option>
                          </select>
                          <span className="material-symbols-outlined text-[14px] absolute right-2.5 top-2 pointer-events-none text-slate-400">expand_more</span>
                        </div>

                        {/* Rating Filter */}
                        <div className="relative">
                          <select
                            value={filterRating}
                            onChange={(e) => setFilterRating(e.target.value)}
                            className="bg-white hover:bg-slate-50 text-slate-600 px-3 py-1.5 pr-8 rounded-lg text-xs font-medium border border-slate-200 focus:border-parking-500 focus:outline-none transition-all cursor-pointer appearance-none"
                          >
                            <option value="all">Any Rating</option>
                            <option value="4.5">4.5+ ⭐ Stars</option>
                          </select>
                          <span className="material-symbols-outlined text-[14px] absolute right-2.5 top-2 pointer-events-none text-slate-400">expand_more</span>
                        </div>

                        {/* Availability Filter */}
                        <div className="relative">
                          <select
                            value={filterAvailability}
                            onChange={(e) => setFilterAvailability(e.target.value)}
                            className="bg-white hover:bg-slate-50 text-slate-600 px-3 py-1.5 pr-8 rounded-lg text-xs font-medium border border-slate-200 focus:border-parking-500 focus:outline-none transition-all cursor-pointer appearance-none"
                          >
                            <option value="all">All Spots</option>
                            <option value="available">Show Available Only</option>
                          </select>
                          <span className="material-symbols-outlined text-[14px] absolute right-2.5 top-2 pointer-events-none text-slate-400">expand_more</span>
                        </div>

                        {/* Sorting Dropdown */}
                        <div className="relative ml-auto">
                          <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            className="bg-parking-50 hover:bg-parking-100 text-parking-700 px-3 py-1.5 pr-8 rounded-lg text-xs font-semibold border border-parking-100 focus:border-parking-500 focus:outline-none transition-all cursor-pointer appearance-none"
                          >
                            <option value="distance">Sort by Distance</option>
                            <option value="price_asc">Sort: Price (Low → High)</option>
                            <option value="price_desc">Sort: Price (High → Low)</option>
                            <option value="rating">Sort: Rating (High → Low)</option>
                            <option value="availability">Sort: Available Spots</option>
                          </select>
                          <span className="material-symbols-outlined text-[14px] absolute right-2.5 top-2 pointer-events-none text-parking-600">expand_more</span>
                        </div>
                     </div>
                  </div>

                  {searchResults.length === 0 ? (
                    <EmptyState onSuggestionClick={(loc) => setSearchParams({ q: loc })} />
                  ) : (
                    <div className="flex flex-col lg:flex-row gap-6 h-[750px]">
                      {/* Left panel: Scrollable List View (42% width) */}
                      <div className="w-full lg:w-[42%] xl:w-[38%] h-full flex flex-col gap-4 overflow-y-auto pr-2">
                        {loading ? (
                          <SearchSkeleton />
                        ) : sortedResults.length === 0 ? (
                          <EmptyState onSuggestionClick={(loc) => setSearchParams({ q: loc })} />
                        ) : (
                          assignDiverseImages(sortedResults).map((spot, i) => (
                            <ParkingCard
                              key={spot._id}
                              data={spot}
                              index={i}
                              layout="horizontal"
                              isSelected={selectedSpot?._id === spot._id}
                              onClick={() => setSelectedSpot(spot)}
                            />
                          ))
                        )}
                      </div>

                      {/* Right panel: Dynamic Map Section (58% width) */}
                      <div className="w-full lg:w-[58%] xl:w-[62%] h-[400px] lg:h-full relative rounded-xl overflow-hidden border border-slate-200">
                        <MapSection
                          parkings={sortedResults}
                          selectedSpot={selectedSpot}
                          onSelectSpot={(spot) => setSelectedSpot(spot)}
                          searchedLocation={searchedLocation}
                        />
                      </div>
                    </div>
                  )}
              </div>
          </section>
        )}

        {/* YOUR SAVED SPOTS (Only if logged in and has favorites) */}
        {searchResults === null && user && savedSpotsDisplay.length > 0 && (
          <section className="bg-white border-b border-slate-200 py-16 px-6">
            <div className="max-w-screen-xl mx-auto">
               <h2 className="text-2xl font-semibold text-slate-900 mb-2 flex items-center gap-2">
                 <span className="material-symbols-outlined text-slate-400 text-[26px]">favorite</span>
                 Your Saved Places
               </h2>
               <p className="text-slate-500 mb-8">Quick access to your favorited parking spaces.</p>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                 {savedSpotsDisplay.map((spot, i) => <ParkingCard key={spot._id} data={spot} index={i} />)}
               </div>
            </div>
          </section>
        )}

        {/* POPULAR NEAR YOU */}
        {searchResults === null && popularNearYou.length > 0 && (
          <section className="bg-slate-50 border-b border-slate-200 py-16 px-6">
            <div className="max-w-screen-xl mx-auto">
               <h2 className="text-2xl font-semibold text-slate-900 mb-2 flex items-center gap-2">
                 <span className="material-symbols-outlined text-slate-400 text-[26px]">local_fire_department</span>
                 Popular Near You
               </h2>
               <p className="text-slate-500 mb-8">Highest rated parking assets trending in Mumbai.</p>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                 {popularNearYou.map((spot, i) => <ParkingCard key={spot._id} data={spot} index={i} />)}
               </div>
            </div>
          </section>
        )}

        {/* WEEKEND FAVORITES */}
        {searchResults === null && weekendFavorites.length > 0 && (
          <section className="bg-white border-b border-slate-200 py-16 px-6">
            <div className="max-w-screen-xl mx-auto">
               <h2 className="text-2xl font-semibold text-slate-900 mb-2 flex items-center gap-2">
                 <span className="material-symbols-outlined text-slate-400 text-[26px]">weekend</span>
                 Weekend Favorites
               </h2>
               <p className="text-slate-500 mb-8">Top-rated spots drivers book most for weekend trips.</p>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                 {weekendFavorites.map((spot, i) => <ParkingCard key={spot._id} data={spot} index={i} />)}
               </div>
            </div>
          </section>
        )}

        {/* RECENTLY BOOKED */}
        {recentlyBookedDisplay.length > 0 && searchResults === null && (
          <section className="bg-slate-50 border-b border-slate-200 py-16 px-6">
            <div className="max-w-screen-xl mx-auto">
               <h2 className="text-2xl font-semibold text-slate-900 mb-2 flex items-center gap-2">
                 <span className="material-symbols-outlined text-slate-400 text-[26px]">history</span>
                 Recently Booked
               </h2>
               <p className="text-slate-500 mb-8">Spots you have visited recently for quick reservation.</p>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                 {recentlyBookedDisplay.map((spot, i) => <ParkingCard key={spot._id} data={spot} index={i} />)}
               </div>
            </div>
          </section>
        )}

        {/* TRENDING DESTINATIONS */}
        {searchResults === null && trendingSpots.length > 0 && (
          <section className="bg-white border-b border-slate-200 py-16 px-6">
            <div className="max-w-screen-xl mx-auto">
               <h2 className="text-2xl font-semibold text-slate-900 mb-2 flex items-center gap-2">
                 <span className="material-symbols-outlined text-slate-400 text-[26px]">trending_up</span>
                 Trending Destinations
               </h2>
               <p className="text-slate-500 mb-8">Frequently booked spots near Mumbai's busiest hubs.</p>

               <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                 {trendingSpots.map((spot, i) => <ParkingCard key={spot._id} data={spot} index={i} />)}
               </div>
            </div>
          </section>
        )}

        {/* HOW IT WORKS (STATIC) */}
        {searchResults === null && (
          <section className="py-20 px-6">
             <div className="max-w-screen-xl mx-auto text-center">
                 <h2 className="text-3xl font-semibold text-slate-900 mb-12">How ASAP Works</h2>
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                     <div className="flex flex-col items-center">
                         <div className="w-16 h-16 bg-parking-50 border border-parking-100 rounded-xl flex items-center justify-center text-parking-700 font-semibold text-2xl mb-6">1</div>
                         <h3 className="text-lg font-semibold text-slate-900 mb-3">Search & Filter</h3>
                         <p className="text-slate-500">Discover nearby parking options tailored to your location, price, and vehicle type.</p>
                     </div>
                     <div className="flex flex-col items-center">
                         <div className="w-16 h-16 bg-accent-400/10 border border-accent-400/30 rounded-xl flex items-center justify-center text-accent-600 font-semibold text-2xl mb-6">2</div>
                         <h3 className="text-lg font-semibold text-slate-900 mb-3">Book Safely</h3>
                         <p className="text-slate-500">Pay securely via Razorpay and receive your digital QR entry ticket instantly.</p>
                     </div>
                     <div className="flex flex-col items-center">
                         <div className="w-16 h-16 bg-slate-100 border border-slate-200 rounded-xl flex items-center justify-center text-slate-600 font-semibold text-2xl mb-6">3</div>
                         <h3 className="text-lg font-semibold text-slate-900 mb-3">Park with Zero Stress</h3>
                         <p className="text-slate-500">Arrive at your guaranteed spot, navigate effortlessly, and enjoy your time.</p>
                     </div>
                 </div>
             </div>
          </section>
        )}

        {/* TRUST & SAFETY (DYNAMIC STATS) */}
        {searchResults === null && (
          <section className="bg-slate-50 border-y border-slate-200 py-20 px-6">
             <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-12">
                 <div className="max-w-lg">
                    <h2 className="text-2xl md:text-3xl font-semibold text-slate-900 mb-4">Engineered for Trust.</h2>
                    <p className="text-slate-500 text-lg">We maintain a secure, robust environment for both drivers and hosts to ensure seamless transactions globally.</p>
                 </div>
                 <div className="flex gap-6 flex-wrap">
                     <div className="bg-white border border-slate-200 shadow-sm p-6 rounded-xl min-w-[140px] text-center">
                        <span className="block text-3xl font-semibold text-slate-900 mb-1 tabular-nums">{stats.totalUsers.toLocaleString()}</span>
                        <span className="text-xs uppercase text-slate-400 font-semibold tracking-wider">Happy Users</span>
                     </div>
                     <div className="bg-white border border-slate-200 shadow-sm p-6 rounded-xl min-w-[140px] text-center">
                        <span className="block text-3xl font-semibold text-slate-900 mb-1 tabular-nums">{stats.totalBookings.toLocaleString()}</span>
                        <span className="text-xs uppercase text-slate-400 font-semibold tracking-wider">Bookings</span>
                     </div>
                     <div className="bg-white border border-slate-200 shadow-sm p-6 rounded-xl min-w-[140px] text-center">
                        <span className="block text-3xl font-semibold text-slate-900 mb-1 tabular-nums">{stats.avgRating} <span className="text-lg text-amber-500">⭐</span></span>
                        <span className="text-xs uppercase text-slate-400 font-semibold tracking-wider">Avg Rating</span>
                     </div>
                 </div>
             </div>
          </section>
        )}

        {/* TESTIMONIALS */}
        {testimonials.length > 0 && searchResults === null && (
          <section className="py-20 px-6">
             <div className="max-w-screen-xl mx-auto">
                 <h2 className="text-3xl font-semibold text-slate-900 text-center mb-12">What Our Network Says</h2>

                 <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {testimonials.map((test) => (
                       <div key={test._id} className="bg-white border border-slate-200 shadow-sm p-8 rounded-xl">
                          <div className="flex gap-1 mb-4 text-amber-500">
                             {[...Array(Math.floor(test.rating))].map((_, i) => <span key={i} className="material-symbols-outlined text-[18px]">star</span>)}
                          </div>
                          <p className="text-slate-600 italic mb-8">"{test.comment}"</p>
                          <div className="flex items-center gap-4">
                             <img src={test.avatar || 'https://via.placeholder.com/150'} alt={test.name} className="w-12 h-12 rounded-full object-cover" />
                             <div>
                                <h4 className="text-slate-900 font-semibold">{test.name}</h4>
                                <p className="text-xs text-slate-400">{test.role}</p>
                             </div>
                          </div>
                       </div>
                    ))}
                 </div>
             </div>
          </section>
        )}

        {/* VERIFIED HOSTS BANNER + HOST CTA */}
        {searchResults === null && (
          <section className="py-20 px-6 bg-slate-50">
            <div className="max-w-6xl mx-auto">
              <div className="flex items-center justify-center gap-3 mb-6 text-sm font-medium text-slate-500">
                <span className="flex items-center gap-1.5 text-parking-700 bg-parking-50 border border-parking-100 px-3 py-1 rounded-full">
                  <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                  500+ Verified Hosts
                </span>
                <span className="text-slate-300">•</span>
                <span>Every listing background-checked before it goes live</span>
              </div>

              <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden flex flex-col md:flex-row items-stretch">
                <div className="md:w-2/5 h-48 md:h-auto">
                  <img
                    src={IMAGE_POOLS.residential[0]}
                    alt="Residential driveway available for parking"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 p-10 md:p-14 flex flex-col md:flex-row items-center justify-between gap-10">
                  <div className="max-w-xl">
                    <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-slate-900 mb-4">Earn from unused parking space.</h2>
                    <p className="text-slate-500 leading-relaxed mb-0">
                      Join hundreds of hosts passively earning through ASAP. List your driveway, garage, or commercial lot in minutes, set your own pricing, and accept secure payments.
                    </p>
                  </div>

                  <div className="flex-shrink-0">
                    <Link to="/host">
                      <Button variant="primary" size="lg" className="flex items-center gap-2">
                        Become a Host
                        <span className="material-symbols-outlined">arrow_forward</span>
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

      </main>
      <Footer />

      {/* RATE EXPERIENCE MODAL */}
      <AnimatePresence>
        {pendingReviewBooking && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white p-8 rounded-xl w-full max-w-md relative border border-slate-200 shadow-xl overflow-hidden"
            >
              <div className="text-center mb-6">
                <span className="material-symbols-outlined text-amber-500 text-5xl mb-2">rate_review</span>
                <h3 className="text-xl font-semibold text-slate-900">Rate Your Experience</h3>
                <p className="text-slate-500 text-sm mt-1">How was your parking at "{pendingReviewBooking.parkingId?.title}"?</p>
              </div>

              <form onSubmit={handleReviewSubmit} className="space-y-6">
                <div className="flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      type="button"
                      key={star}
                      onClick={() => setReviewRating(star)}
                      className="text-4xl transition-transform hover:scale-110 focus:outline-none"
                    >
                      <span
                        className={`material-symbols-outlined text-[36px] ${star <= reviewRating ? 'text-amber-500' : 'text-slate-300'}`}
                        style={star <= reviewRating ? { fontVariationSettings: "'FILL' 1" } : undefined}
                      >
                        star
                      </span>
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Comments (optional)</label>
                  <textarea
                    placeholder="Share what went well or could be improved..."
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    disabled={reviewSubmitting}
                    className="w-full h-24 input-field rounded-lg p-3 text-sm resize-none"
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSkipReview}
                    disabled={reviewSubmitting}
                    className="flex-1"
                  >
                    Skip
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={reviewSubmitting}
                    className="flex-1"
                  >
                    {reviewSubmitting ? 'Submitting...' : 'Submit Rating'}
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
