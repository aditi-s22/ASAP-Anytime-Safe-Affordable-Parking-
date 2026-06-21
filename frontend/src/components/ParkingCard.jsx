import React, { useState, useEffect, useContext } from "react";
import { useNavigate } from "react-router-dom";
import Button from "./ui/Button";
import BookingModal from "./BookingModal";
import { AuthContext } from "../context/AuthContext";
import { toggleFavorite } from "../services/api";
import { normalizeImageUrl, inferCategory, getCategoryLabel, getCoveredStatus } from "../utils/imageHelper";

// Light visual variation so a grid of cards doesn't feel stamped from one template —
// rotates which accent color frames the price/rating across every third card.
const ACCENT_VARIANTS = [
  { ring: "ring-parking-100", border: "border-parking-500", price: "text-slate-900", chip: "bg-parking-50 text-parking-700 border-parking-100" },
  { ring: "ring-accent-400/20", border: "border-accent-500", price: "text-slate-900", chip: "bg-accent-400/10 text-accent-600 border-accent-400/20" },
  { ring: "ring-amber-100", border: "border-amber-500", price: "text-slate-900", chip: "bg-amber-50 text-amber-700 border-amber-100" },
];

export default function ParkingCard({ data, isSelected = false, onClick, layout = "vertical", index = 0 }) {
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  const { user, updateUser } = useContext(AuthContext);
  const navigate = useNavigate();
  const [favoriting, setFavoriting] = useState(false);

  const getImageUrl = () => {
    if (data._displayImage) return data._displayImage;
    if (data.image) return data.image;
    if (data.images && data.images.length > 0) {
      const first = data.images[0];
      if (typeof first === "string") return first;
      if (first && typeof first === "object" && first.url) return first.url;
    }
    return null;
  };

  const [imageSrc, setImageSrc] = useState(() => normalizeImageUrl(getImageUrl()));

  useEffect(() => {
    setImageSrc(normalizeImageUrl(getImageUrl()));
  }, [data]);

  const handleImageError = () => {
    setImageSrc(normalizeImageUrl(null));
  };

  const category = data._category || inferCategory(data);
  const categoryLabel = getCategoryLabel(category);
  const coveredStatus = getCoveredStatus(data, category);
  const accent = ACCENT_VARIANTS[index % ACCENT_VARIANTS.length];

  const isFavorited = (user?.favorites || []).some(
    (fav) => (typeof fav === "string" ? fav : fav?._id) === data._id
  );

  const handleToggleFavorite = async (e) => {
    e.stopPropagation();
    if (!user) {
      navigate("/login");
      return;
    }
    if (favoriting) return;
    setFavoriting(true);
    try {
      const res = await toggleFavorite(data._id);
      updateUser({ ...user, favorites: res.data.favorites });
    } catch (err) {
      console.error("Failed to toggle favorite", err);
    } finally {
      setFavoriting(false);
    }
  };

  const handleDirections = (e) => {
    e.stopPropagation();
    const coords = data.location?.coordinates;
    if (coords && coords.length >= 2) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${coords[1]},${coords[0]}`;
      window.open(url, "_blank");
    } else {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(data.address)}`;
      window.open(url, "_blank");
    }
  };

  const availableCount = data.availableSpots !== undefined ? data.availableSpots : (data.availableSlots || 0);
  const isAlmostFull = availableCount > 0 && availableCount <= 2;
  const isFull = availableCount === 0;

  // RENDER HORIZONTAL CARD LAYOUT
  if (layout === "horizontal") {
    return (
      <>
        <div
          id={`parking-card-${data._id}`}
          className={`group bg-white rounded-xl p-4 flex flex-col sm:flex-row gap-4 border transition-all cursor-pointer relative overflow-hidden flex-shrink-0 ${
            isSelected
              ? `${accent.border} shadow-md ring-1 ${accent.ring}`
              : "border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300"
          }`}
          onClick={onClick}
        >
          {/* Left Block: Image */}
          <div className="relative w-full sm:w-32 h-40 sm:h-32 flex-shrink-0 rounded-lg overflow-hidden">
            <img
              src={imageSrc}
              onError={handleImageError}
              alt={data.name || data.title}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 flex-shrink-0"
            />
            <div className="absolute top-2 left-2 bg-white/90 px-2 py-0.5 rounded text-[10px] font-semibold text-slate-700 border border-slate-200 uppercase tracking-wider">
              {categoryLabel}
            </div>
            {data.discountPercentage > 0 && (
              <div className="absolute top-2 right-10 bg-parking-600 px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase tracking-wider">
                {data.discountPercentage}% OFF
              </div>
            )}
            <button
              className={`absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center border border-slate-200 transition-colors z-20 disabled:opacity-50 ${
                isFavorited ? "text-red-500" : "text-slate-500 hover:text-red-500"
              }`}
              onClick={handleToggleFavorite}
              disabled={favoriting}
            >
              <span className="material-symbols-outlined text-[16px]" style={isFavorited ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                favorite
              </span>
            </button>
          </div>

          {/* Right Block: Content */}
          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
            <div>
              <div className="flex justify-between items-start gap-2 mb-1.5">
                <h3 className="font-semibold text-slate-900 text-base leading-snug truncate max-w-[80%]">
                  {data.name || data.title}
                </h3>
                {data.rating > 0 && (
                  <div className="flex items-center gap-0.5 text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-[10px] font-semibold flex-shrink-0">
                    <span className="material-symbols-outlined text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                    {data.rating.toFixed(1)}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 text-xs mb-3">
                <div className="flex items-center min-w-0">
                  <span className="material-symbols-outlined text-[14px] mr-1 text-slate-400 flex-shrink-0">location_on</span>
                  <span className="inline-block truncate max-w-[140px] align-middle" title={data.address}>
                    {data.distance !== undefined ? `${data.distance.toFixed(2)} km away` : data.address}
                  </span>
                </div>
                <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                  <span className="material-symbols-outlined text-[14px] text-slate-400">{coveredStatus === "Covered" ? "garage" : "wb_sunny"}</span>
                  {coveredStatus}
                </span>
                <span className={`flex items-center gap-1 text-[11px] font-semibold ${isFull ? "text-red-500" : isAlmostFull ? "text-amber-600" : "text-parking-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">local_parking</span>
                  {isFull ? "Full" : `${availableCount} left`}
                </span>
              </div>
            </div>

            {/* Price & Actions */}
            <div className="flex flex-wrap justify-between items-center gap-y-2 pt-2.5 border-t border-slate-100 mt-auto">
              <div className="flex flex-col">
                <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Rate / Hr</span>
                <div className="flex items-end gap-1.5">
                  <span className={`font-semibold text-lg leading-none tracking-tight tabular-nums ${accent.price}`}>
                    ₹{Math.round((data.price || data.pricePerHour || 0) * (1 - (data.discountPercentage || 0) / 100))}
                  </span>
                  {data.discountPercentage > 0 && (
                    <span className="text-[10px] text-slate-400 line-through mb-0.5 tabular-nums">₹{data.price || data.pricePerHour}</span>
                  )}
                </div>
              </div>

              <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="outline"
                  size="sm"
                  className="px-2.5 !h-8 text-xs"
                  onClick={handleDirections}
                >
                  Directions
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="px-3.5 !h-8 text-xs"
                  onClick={() => setIsBookingOpen(true)}
                  disabled={isFull}
                >
                  {isFull ? "Full" : "Book Now"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <BookingModal
          isOpen={isBookingOpen}
          onClose={() => setIsBookingOpen(false)}
          parkingData={data}
        />
      </>
    );
  }

  // RENDER VERTICAL CARD LAYOUT (GRID VIEW) — image height alternates slightly per
  // index so a 4-up grid reads as curated rather than machine-stamped.
  const imageHeight = index % 3 === 1 ? "h-48" : "h-40";

  return (
    <>
      <div
        id={`parking-card-${data._id}`}
        className={`group bg-white rounded-xl p-4 flex flex-col gap-4 border transition-all cursor-pointer relative overflow-hidden flex-shrink-0 ${
          isSelected
            ? `${accent.border} shadow-md ring-1 ${accent.ring}`
            : "border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300"
        }`}
        onClick={onClick}
      >
        <div className={`relative w-full ${imageHeight} flex-shrink-0 rounded-lg overflow-hidden`}>
          <img
            src={imageSrc}
            onError={handleImageError}
            alt={data.name || data.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 flex-shrink-0"
          />
          <div className="absolute top-3 left-3 bg-white/90 px-2.5 py-1 rounded text-xs font-semibold text-slate-700 border border-slate-200 uppercase tracking-wider">
            {categoryLabel}
          </div>
          {data.discountPercentage > 0 && (
            <div className="absolute top-3 right-12 bg-parking-600 px-2.5 py-1 rounded text-xs font-bold text-white uppercase tracking-wider">
              {data.discountPercentage}% OFF
            </div>
          )}
          <button
            className={`absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center border border-slate-200 transition-colors z-20 disabled:opacity-50 ${
              isFavorited ? "text-red-500" : "text-slate-500 hover:text-red-500"
            }`}
            onClick={handleToggleFavorite}
            disabled={favoriting}
          >
            <span className="material-symbols-outlined text-[18px]" style={isFavorited ? { fontVariationSettings: "'FILL' 1" } : undefined}>
              favorite
            </span>
          </button>
          {(isFull || isAlmostFull) && (
            <div className={`absolute bottom-3 left-3 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${isFull ? "bg-red-600 text-white" : "bg-amber-500 text-white"}`}>
              {isFull ? "Fully Booked" : "Almost Full"}
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between flex-1 py-1">
          <div>
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-semibold text-slate-900 text-lg leading-tight max-w-[80%]">
                {data.name || data.title}
              </h3>
              {data.rating > 0 && (
                <div className="flex items-center gap-1 text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-xs font-semibold flex-shrink-0">
                  <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                  {data.rating.toFixed(1)}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5 text-slate-500 mb-3">
              <div className="flex items-center gap-4">
                <div className="flex items-center min-w-0">
                  <span className="material-symbols-outlined text-[16px] mr-1 text-slate-400 flex-shrink-0">location_on</span>
                  <span className="text-xs font-medium inline-block truncate max-w-[150px] align-middle" title={data.address}>
                    {data.distance !== undefined ? `${data.distance.toFixed(2)} km away` : data.address}
                  </span>
                </div>
                <div className="flex items-center">
                  <span className="material-symbols-outlined text-[16px] mr-1 text-slate-400">{coveredStatus === "Covered" ? "garage" : "wb_sunny"}</span>
                  <span className="text-xs font-medium">{coveredStatus}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`flex items-center gap-1 text-xs font-semibold ${isFull ? "text-red-500" : isAlmostFull ? "text-amber-600" : "text-parking-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">local_parking</span>
                  {isFull ? "Fully booked" : `${availableCount} left`}
                </span>
                {data.distance !== undefined && (
                  <span className="flex items-center text-[11px] text-slate-400 font-medium">
                    <span className="material-symbols-outlined text-[14px] mr-1">directions_car</span>
                    {Math.max(1, Math.round(data.distance * 2.5 + 1))} min drive
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-between items-end mt-auto pt-4 border-t border-slate-100">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Price / Hr</span>
              <div className="flex items-end gap-2">
                <span className={`font-semibold text-xl leading-none tracking-tight tabular-nums ${accent.price}`}>
                  ₹{Math.round((data.price || data.pricePerHour || 0) * (1 - (data.discountPercentage || 0) / 100))}
                </span>
                {data.discountPercentage > 0 && (
                  <span className="text-xs text-slate-400 line-through mb-0.5 tabular-nums">₹{data.price || data.pricePerHour}</span>
                )}
              </div>
            </div>

            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="outline"
                size="sm"
                className="px-3 md:px-4 !h-9 text-xs"
                onClick={handleDirections}
              >
                Directions
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="px-5 md:px-6 !h-9 text-xs"
                onClick={() => setIsBookingOpen(true)}
                disabled={isFull}
              >
                {isFull ? "Full" : "Book Now"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <BookingModal
        isOpen={isBookingOpen}
        onClose={() => setIsBookingOpen(false)}
        parkingData={data}
      />
    </>
  );
}
