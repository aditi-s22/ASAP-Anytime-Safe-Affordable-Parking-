import React, { useState, useEffect, useContext } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Button from '../components/ui/Button';
import { createOrder, verifyPayment, createBooking, cancelBooking } from '../services/api';
import { AuthContext } from '../context/AuthContext';
import { normalizeImageUrl } from '../utils/imageHelper';

export default function Checkout() {
  const location = useLocation();
  const navigate = useNavigate();
  const orderDetails = location.state;
  const { user } = useContext(AuthContext);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Auth is already enforced by the <PrivateRoute> wrapper in App.jsx — this just
  // handles the case where someone lands here without booking details in nav state.
  useEffect(() => {
    if (!orderDetails) {
      navigate('/');
    }
  }, [orderDetails, navigate]);

  if (!orderDetails || !user) return null;

  const { parking, duration, date, time, totalCost } = orderDetails;
  const taxes = Math.round(totalCost * 0.18); // 18% mock tax
  const finalAmount = totalCost + taxes;

  const [imageSrc, setImageSrc] = useState(() => normalizeImageUrl(parking));

  useEffect(() => {
    setImageSrc(normalizeImageUrl(parking));
  }, [parking]);

  const handleImageError = () => {
    setImageSrc(normalizeImageUrl(null));
  };

  const handlePayment = async () => {
    setError(null);
    setLoading(true);

    // 1. Reserve the slot first (pending payment). The server computes and owns the
    // authoritative price — finalAmount above is only an estimate for display.
    let booking;
    try {
      const bookingRes = await createBooking({
        parkingId: parking._id,
        startTime: new Date(`${date}T${time}`).toISOString(),
        endTime: new Date(new Date(`${date}T${time}`).getTime() + duration * 60 * 60 * 1000).toISOString()
      });
      booking = bookingRes.data;
    } catch (err) {
      setError(err.response?.data?.message || "Could not reserve this slot. It may no longer be available.");
      setLoading(false);
      return;
    }

    // 2. Create a Razorpay order tied to that exact booking (server derives the amount).
    let order;
    try {
      const orderRes = await createOrder(booking._id);
      order = orderRes.data;
    } catch (err) {
      setError(err.response?.data?.message || "Could not start payment. Please try again.");
      await cancelBooking(booking._id).catch(() => {});
      setLoading(false);
      return;
    }

    const releaseReservation = () => {
      cancelBooking(booking._id).catch(() => {});
      setLoading(false);
    };

    const options = {
      key: import.meta.env.VITE_RAZORPAY_KEY_ID || "rzp_test_mockedKey123",
      amount: order.amount,
      currency: order.currency,
      name: "ASAP Parking",
      description: `Booking: ${parking.name || parking.title}`,
      order_id: order.id,
      handler: async function (response) {
        try {
          const verifyRes = await verifyPayment({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            bookingId: booking._id
          });

          if (verifyRes.data.verified) {
            // Pass the real, server-confirmed booking (with its real _id, qrCode, qrToken)
            // through to the success page — never a client-side guess.
            navigate('/success', { state: { parking, duration, date, time, finalAmount, booking: verifyRes.data.booking } });
          } else {
            setError("Payment verification failed.");
            setLoading(false);
          }
        } catch (err) {
          setError(err.response?.data?.message || "Payment verification failed.");
          setLoading(false);
        }
      },
      modal: {
        ondismiss: releaseReservation
      },
      prefill: {
        name: user.name || "ASAP User",
        email: user.email || "user@asapparking.io",
        contact: user.phone || "9999999999"
      },
      theme: {
        color: "#16a34a" // parking-500 brand color
      }
    };

    if (window.Razorpay) {
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', function (response) {
        setError(response.error?.description || "Payment failed.");
        releaseReservation();
      });
      rzp.open();
    } else {
      setError("Razorpay SDK not loaded. Please check your connection.");
      releaseReservation();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <Navbar />

      <main className="max-w-4xl mx-auto w-full px-6 py-12 flex-1">
        <h1 className="text-2xl font-semibold text-slate-900 mb-8">Secure Checkout</h1>

        <div className="flex flex-col md:flex-row gap-8">
            <div className="flex-1 space-y-6">
               <div className="bg-white border border-slate-200 shadow-sm p-6 rounded-xl">
                 <h3 className="text-lg font-semibold text-slate-900 mb-4">Location Summary</h3>
                  <div className="flex gap-4 items-start">
                     <img src={imageSrc} onError={handleImageError} alt={parking.name || parking.title} className="w-24 h-24 rounded-lg object-cover" />
                     <div>
                       <h4 className="font-semibold text-slate-900 text-lg">{parking.name || parking.title}</h4>
                       <p className="text-slate-500 text-sm mt-1">{parking.type || parking.vehicleType} Space • {parking.distance || parking.address}</p>
                     </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-slate-200">
                      <div>
                        <p className="text-xs text-slate-500 uppercase font-medium tracking-wider mb-1">Date</p>
                        <p className="font-medium text-slate-900">{date && !isNaN(new Date(date).getTime()) ? new Date(date).toLocaleDateString() : "N/A"}</p>
                      </div>
                     <div>
                       <p className="text-xs text-slate-500 uppercase font-medium tracking-wider mb-1">Arrival Time</p>
                       <p className="font-medium text-slate-900">{time}</p>
                     </div>
                     <div>
                       <p className="text-xs text-slate-500 uppercase font-medium tracking-wider mb-1">Duration</p>
                       <p className="font-medium text-slate-900">{duration} Hour{duration > 1 ? 's' : ''}</p>
                     </div>
                  </div>
                </div>
            </div>

            <div className="w-full md:w-96 flex-shrink-0">
               <div className="bg-white border border-slate-200 shadow-sm p-6 rounded-xl">
                 <h3 className="text-lg font-semibold text-slate-900 mb-6">Payment Breakdown</h3>

                 <div className="flex justify-between items-center mb-4">
                    <span className="text-slate-500">Base Price (₹{parking.price || parking.pricePerHour} x {duration})</span>
                    <span className="text-slate-900 font-medium tabular-nums">₹{totalCost}</span>
                 </div>
                 <div className="flex justify-between items-center mb-6">
                    <span className="text-slate-500">GST (18%)</span>
                    <span className="text-slate-900 font-medium tabular-nums">₹{taxes}</span>
                 </div>

                 <div className="flex justify-between items-center border-t border-slate-200 pt-4 mb-8">
                    <span className="text-slate-900 font-semibold">Total Amount</span>
                    <span className="text-2xl font-semibold text-slate-900 tabular-nums">₹{finalAmount}</span>
                 </div>

                 {error && (
                   <p className="text-sm text-red-600 mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
                 )}

                 <Button
                   variant="primary"
                   className="w-full h-14 text-base"
                   onClick={handlePayment}
                   disabled={loading}
                 >
                   {loading ? "Processing..." : `Pay ₹${finalAmount}`}
                 </Button>
               </div>
            </div>
        </div>
      </main>
    </div>
  );
}
