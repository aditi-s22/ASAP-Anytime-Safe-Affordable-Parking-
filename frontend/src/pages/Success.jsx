import React, { useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import Navbar from '../components/Navbar';
import Button from '../components/ui/Button';

export default function Success() {
  const location = useLocation();
  const navigate = useNavigate();
  const summary = location.state;

  useEffect(() => {
    if (!summary) navigate('/');
  }, [summary, navigate]);

  if (!summary) return null;

  const booking = summary.booking;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <Navbar />

      <main className="flex-1 flex items-center justify-center p-6">
         <motion.div
           initial={{ opacity: 0, scale: 0.95 }}
           animate={{ opacity: 1, scale: 1 }}
           className="bg-white border border-slate-200 shadow-sm max-w-lg w-full p-10 rounded-xl text-center"
         >
           <motion.div
             initial={{ scale: 0 }}
             animate={{ scale: 1 }}
             transition={{ delay: 0.2, type: "spring" }}
             className="w-20 h-20 bg-parking-50 text-parking-600 rounded-full flex items-center justify-center mx-auto mb-6"
           >
             <span className="material-symbols-outlined text-[40px]">check_circle</span>
           </motion.div>

           <h1 className="text-2xl font-semibold text-slate-900 mb-2">Booking Confirmed</h1>
           <p className="text-slate-500 mb-8">Your parking spot at <strong className="text-slate-900 font-semibold">{summary.parking?.name || summary.parking?.title}</strong> is secured.</p>

           <div className="bg-slate-50 rounded-lg p-5 mb-6 border border-slate-200 text-left">
              <div className="grid grid-cols-2 gap-4">
                 <div>
                   <p className="text-xs text-slate-500 uppercase font-medium tracking-wider mb-1">Date</p>
                    <p className="font-medium text-slate-900">{summary.date && !isNaN(new Date(summary.date).getTime()) ? new Date(summary.date).toLocaleDateString() : "N/A"}</p>
                 </div>
                 <div>
                   <p className="text-xs text-slate-500 uppercase font-medium tracking-wider mb-1">Arrival Time</p>
                   <p className="font-medium text-slate-900">{summary.time}</p>
                 </div>
                 <div>
                   <p className="text-xs text-slate-500 uppercase font-medium tracking-wider mb-1">Total Paid</p>
                   <p className="font-medium text-slate-900 tabular-nums">₹{summary.finalAmount}</p>
                 </div>
                 <div>
                   <p className="text-xs text-slate-500 uppercase font-medium tracking-wider mb-1">Booking ID</p>
                   <p className="font-medium text-accent-600 truncate">
                     {booking?._id ? `#${booking._id.slice(-8).toUpperCase()}` : "Pending"}
                   </p>
                 </div>
              </div>
           </div>

           {booking?.qrCode && (
             <div className="bg-slate-50 rounded-lg p-5 mb-8 border border-slate-200 flex flex-col items-center">
               <p className="text-xs text-slate-500 uppercase font-medium tracking-wider mb-3">Entry QR Ticket</p>
               <img src={booking.qrCode} alt="Booking QR ticket" className="w-40 h-40 rounded-lg bg-white p-2 border border-slate-200" />
             </div>
           )}

           <div className="flex flex-col gap-3">
             <Link to="/dashboard">
               <Button variant="primary" className="w-full h-12">View Dashboard</Button>
             </Link>
             <Link to="/">
               <Button variant="outline" className="w-full h-12">Back to Home</Button>
             </Link>
           </div>
         </motion.div>
      </main>
    </div>
  );
}
