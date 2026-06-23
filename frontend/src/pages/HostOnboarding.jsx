import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { AuthContext } from '../context/AuthContext';
import { createParking, applyForHost, uploadImages } from '../services/api';
import { geocodeAddress } from '../utils/geocode';

export default function HostOnboarding() {
  const navigate = useNavigate();
  const { user, updateUser } = useContext(AuthContext);
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [addressPlaceId, setAddressPlaceId] = useState(null);
  
  // Form State
  const [formData, setFormData] = useState({
    name: '', phone: '', email: '',
    govIdType: 'Aadhaar Card', govIdNumber: '', govIdImage: '',
    address: '', addressProofType: 'Utility Bill', addressProofImage: '',
    title: '', vehicleType: 'car', slots: '1', pricePerHour: '50',
    startTime: '08:00', endTime: '22:00', parkingImage: ''
  });

  // File Upload State
  const [uploadingId, setUploadingId] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [uploadingParking, setUploadingParking] = useState(false);

  // Auth is already enforced by the <PrivateRoute> wrapper in App.jsx.

  // Pre-fill user data if available
  useEffect(() => {
    if (user) {
      setFormData(prev => ({
        ...prev,
        name: user.name || '',
        phone: user.phone || '',
        email: user.email || ''
      }));
    }
  }, [user]);

  // Bind Google Places Autocomplete to the street address input field
  useEffect(() => {
    let autocomplete = null;
    const inputElement = document.getElementById("host-address-input");

    if (window.google && window.google.maps && window.google.maps.places && inputElement) {
      autocomplete = new window.google.maps.places.Autocomplete(inputElement, {
        componentRestrictions: { country: "in" },
        fields: ["formatted_address", "geometry", "place_id"],
      });

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (place && place.formatted_address) {
          setAddressPlaceId(place.place_id || null);
          setFormData((prev) => ({
            ...prev,
            address: place.formatted_address,
          }));
        }
      });
    }

    return () => {
      if (autocomplete && window.google && window.google.maps) {
        window.google.maps.event.clearInstanceListeners(autocomplete);
      }
    };
  }, [step]);

  const handleChange = (e) => {
    if (e.target.name === 'address') setAddressPlaceId(null);
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const nextStep = () => {
    if (step === 2 && (!formData.govIdNumber || !formData.govIdImage)) {
      setError('Please provide your Government ID number and upload a clear document image.');
      return;
    }
    if (step === 3 && (!formData.address || !formData.addressProofImage)) {
      setError('Please provide your space address and upload a valid Address Proof.');
      return;
    }
    if (step === 4 && (!formData.title || !formData.parkingImage)) {
      setError('Please enter a listing title and upload a photo of the parking space.');
      return;
    }
    setError('');
    setStep(prev => prev + 1);
  };

  const prevStep = () => {
    setError('');
    setStep(prev => prev - 1);
  };

  // File Upload Handlers
  const handleFileUpload = async (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('File size exceeds the limit of 5MB');
      return;
    }

    const fileFormData = new FormData();
    fileFormData.append('images', file);

    if (type === 'govId') setUploadingId(true);
    if (type === 'addressProof') setUploadingProof(true);
    if (type === 'parking') setUploadingParking(true);

    try {
      const res = await uploadImages(fileFormData);
      const url = res.data[0]?.url || '';
      
      setFormData(prev => ({
        ...prev,
        [type === 'govId' ? 'govIdImage' : type === 'addressProof' ? 'addressProofImage' : 'parkingImage']: url
      }));
      setError('');
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Upload failed. Please try again.');
      // No fallback: a browser-local blob URL would be broken for everyone else, so we
      // leave the field empty and let the existing step-validation block progression
      // until a real upload succeeds.
      setFormData(prev => ({
        ...prev,
        [type === 'govId' ? 'govIdImage' : type === 'addressProof' ? 'addressProofImage' : 'parkingImage']: ''
      }));
    } finally {
      if (type === 'govId') setUploadingId(false);
      if (type === 'addressProof') setUploadingProof(false);
      if (type === 'parking') setUploadingParking(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;
    setIsLoading(true);
    setError('');

    // Real Google Geocoding first (shared util falls back to the keyword dictionary
    // internally only if geocoding fails or Maps JS isn't loaded).
    const geo = await geocodeAddress(formData.address, { placeId: addressPlaceId });
    const latitude = geo.lat;
    const longitude = geo.lng;
    console.log(`[Host Listing] Resolved coordinates via ${geo.source}: Lat ${latitude}, Lng ${longitude}`);

    const parkingImages = [
      {
        url: formData.parkingImage || "https://images.unsplash.com/photo-1573348722427-f1d6819fdf98?ixlib=rb-4.0.3&auto=format&fit=crop&w=500&q=60",
        public_id: "host_parking_image"
      }
    ];

    try {
      // Workflow 1 (host verification) and Workflow 2 (listing verification) are
      // independent. A listing can only be created once the host is verified — so
      // a first-time applicant submits ONLY the host application here and waits
      // for admin approval; they add their first listing afterward from the Host
      // Dashboard's "Add Parking Space" action. An already-verified host should
      // never reach this branch at all (never re-applies), and an already-pending
      // host can't create a listing yet either — both just see a status message.
      if (user?.verifiedHost === "verified") {
        // Defensive fallback only — verified hosts are routed to "Add Parking Space"
        // in the dashboard instead of this onboarding form.
        await createParking({
          title: formData.title,
          address: geo.formattedAddress || formData.address,
          latitude,
          longitude,
          pricePerHour: parseFloat(formData.pricePerHour),
          vehicleType: formData.vehicleType,
          slots: parseInt(formData.slots, 10),
          availableSlots: parseInt(formData.slots, 10),
          totalSlots: parseInt(formData.slots, 10),
          startTime: formData.startTime,
          endTime: formData.endTime,
          images: parkingImages
        });
      } else if (user?.verifiedHost === "pending") {
        setError("Your host application is still under review. You'll be able to add a parking space once an admin approves it.");
        setIsLoading(false);
        return;
      } else {
        const updatedUserRes = await applyForHost({
          phone: formData.phone,
          govIdImage: formData.govIdImage,
          addressProofImage: formData.addressProofImage
        });
        updateUser(updatedUserRes.data);
      }

      setIsLoading(false);
      navigate('/dashboard?tab=host');
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || err.message || "Failed to submit host onboarding details");
      setIsLoading(false);
    }
  };

  const progress = (step / 5) * 100;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-700">
      {/* Sticky header */}
      <header className="sticky top-0 bg-white z-50 border-b border-slate-200 py-4 px-6 flex justify-between items-center">
         <span className="text-xl font-semibold text-slate-900 flex items-center">ASAP <span className="text-parking-600 ml-1">Hosting</span></span>
         <button onClick={() => navigate('/dashboard')} className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">Exit Setup</button>
      </header>

      {/* Progress Bar */}
      <div className="w-full h-1 bg-slate-200">
        <motion.div
          className="h-full bg-parking-600"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4 }}
        ></motion.div>
      </div>

      <main className="flex-1 flex items-center justify-center p-6 py-12">
         <div className="w-full max-w-xl bg-white border border-slate-200 shadow-sm p-8 md:p-10 rounded-xl relative">
            <span className="text-parking-600 font-semibold text-sm tracking-widest uppercase mb-4 block">Step {step} of 5</span>

            <form onSubmit={(e) => e.preventDefault()}>
               {error && (
                  <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm flex items-center gap-2">
                     <span className="material-symbols-outlined text-[18px]">error</span>
                     {error}
                  </div>
               )}
              <AnimatePresence mode="wait">
                 
                 {/* STEP 1: CONTACT INFO */}
                 {step === 1 && (
                   <motion.div key="1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                      <h2 className="text-2xl font-semibold text-slate-900">Verification Basics.</h2>
                      <p className="text-slate-500 mb-6">Confirm your contact information to start listing.</p>

                      <Input label="Full Name" name="name" icon="person" placeholder="John Doe" value={formData.name} onChange={handleChange} required />

                      <Input label="Phone Number" name="phone" icon="call" type="tel" placeholder="+91 99999 99999" value={formData.phone} onChange={handleChange} required />

                      <Input label="Email Address" name="email" icon="mail" type="email" placeholder="john@example.com" value={formData.email} onChange={handleChange} required />
                   </motion.div>
                 )}

                 {/* STEP 2: GOV ID VERIFICATION */}
                 {step === 2 && (
                   <motion.div key="2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                      <h2 className="text-2xl font-semibold text-slate-900">Host Identity Verification.</h2>
                      <p className="text-slate-500 mb-6">Upload an official government ID card to establish trust on the ASAP platform.</p>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-slate-700">Government ID Type</label>
                        <select
                          name="govIdType"
                          value={formData.govIdType}
                          onChange={handleChange}
                          className="input-field rounded-lg px-4 py-3 text-sm outline-none appearance-none"
                        >
                          <option value="Aadhaar Card">Aadhaar Card (India)</option>
                          <option value="PAN Card">PAN Card (India)</option>
                          <option value="Driving License">Driving License</option>
                          <option value="Passport">Passport</option>
                        </select>
                      </div>

                      <Input label="ID Number" name="govIdNumber" icon="badge" placeholder="XXXX-XXXX-XXXX" value={formData.govIdNumber} onChange={handleChange} required />

                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-slate-700">Upload ID Card Document Image (Front side)</label>
                        <div className="relative border-2 border-dashed border-slate-300 hover:border-parking-400 rounded-xl p-6 text-center bg-slate-50 transition-colors cursor-pointer group">
                          <input
                            type="file"
                            accept="image/*"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={(e) => handleFileUpload(e, 'govId')}
                          />
                          {uploadingId ? (
                            <div className="flex flex-col items-center gap-2 py-4">
                              <div className="w-8 h-8 border-2 border-parking-200 border-t-parking-600 rounded-full animate-spin"></div>
                              <p className="text-xs text-slate-500">Uploading to server...</p>
                            </div>
                          ) : formData.govIdImage ? (
                            <div className="flex items-center justify-between gap-4">
                              <img src={formData.govIdImage} alt="Gov ID" className="w-16 h-16 rounded object-cover border border-slate-200" />
                              <div className="text-left flex-1">
                                <p className="text-sm text-slate-900 font-semibold">gov_id_document.png</p>
                                <p className="text-xs text-parking-600 flex items-center gap-1 font-semibold mt-0.5">
                                  <span className="material-symbols-outlined text-[14px]">check_circle</span> Document Uploaded
                                </p>
                              </div>
                              <span className="material-symbols-outlined text-slate-400 group-hover:text-slate-600">edit</span>
                            </div>
                          ) : (
                            <div className="py-4">
                              <span className="material-symbols-outlined text-4xl text-parking-600 mb-2">upload_file</span>
                              <h4 className="text-slate-900 font-semibold text-sm mb-0.5">Click to choose image file</h4>
                              <p className="text-xs text-slate-500 font-medium">JPEG, PNG (Max 5MB)</p>
                            </div>
                          )}
                        </div>
                      </div>
                   </motion.div>
                 )}

                 {/* STEP 3: ADDRESS PROOF DETAILS */}
                 {step === 3 && (
                   <motion.div key="3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                      <h2 className="text-2xl font-semibold text-slate-900">Location Details & Proof.</h2>
                      <p className="text-slate-500 mb-6">Enter the exact listing address and verify occupancy proof (utility bill, rental deed, registry).</p>

                      <Input id="host-address-input" label="Street Address" name="address" icon="pin_drop" placeholder="e.g. Plot 15, Block B, Indiranagar, Bengaluru, 560038" value={formData.address} onChange={handleChange} required />

                      <div className="flex flex-col gap-1.5">
                        <label className="text-sm font-medium text-slate-700">Address Proof Document Type</label>
                        <select
                          name="addressProofType"
                          value={formData.addressProofType}
                          onChange={handleChange}
                          className="input-field rounded-lg px-4 py-3 text-sm outline-none appearance-none"
                        >
                          <option value="Utility Bill">Electricity / Water Utility Bill</option>
                          <option value="Rental Agreement">Registered Rental Agreement</option>
                          <option value="Property Registry">Property Possession Deed / Registry</option>
                          <option value="Tax Receipt">Municipal Property Tax Receipt</option>
                        </select>
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-slate-700">Upload Address Proof Document Image</label>
                        <div className="relative border-2 border-dashed border-slate-300 hover:border-parking-400 rounded-xl p-6 text-center bg-slate-50 transition-colors cursor-pointer group">
                          <input
                            type="file"
                            accept="image/*"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={(e) => handleFileUpload(e, 'addressProof')}
                          />
                          {uploadingProof ? (
                            <div className="flex flex-col items-center gap-2 py-4">
                              <div className="w-8 h-8 border-2 border-parking-200 border-t-parking-600 rounded-full animate-spin"></div>
                              <p className="text-xs text-slate-500">Uploading to server...</p>
                            </div>
                          ) : formData.addressProofImage ? (
                            <div className="flex items-center justify-between gap-4">
                              <img src={formData.addressProofImage} alt="Address Proof" className="w-16 h-16 rounded object-cover border border-slate-200" />
                              <div className="text-left flex-1">
                                <p className="text-sm text-slate-900 font-semibold">address_proof.png</p>
                                <p className="text-xs text-parking-600 flex items-center gap-1 font-semibold mt-0.5">
                                  <span className="material-symbols-outlined text-[14px]">check_circle</span> Document Uploaded
                                </p>
                              </div>
                              <span className="material-symbols-outlined text-slate-400 group-hover:text-slate-600">edit</span>
                            </div>
                          ) : (
                            <div className="py-4">
                              <span className="material-symbols-outlined text-4xl text-parking-600 mb-2">upload_file</span>
                              <h4 className="text-slate-900 font-semibold text-sm mb-0.5">Click to choose image file</h4>
                              <p className="text-xs text-slate-500 font-medium">JPEG, PNG (Max 5MB)</p>
                            </div>
                          )}
                        </div>
                      </div>
                   </motion.div>
                 )}

                 {/* STEP 4: PARKING PARAMETERS */}
                 {step === 4 && (
                   <motion.div key="4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                      <h2 className="text-2xl font-semibold text-slate-900">Parking Spot Parameters.</h2>
                      <p className="text-slate-500 mb-6">Configure capacity slots, hourly rates, and photos of your actual space.</p>

                      <Input label="Listing Title" name="title" icon="title" placeholder="Secure driveway in Indiranagar Double Road" value={formData.title} onChange={handleChange} required />

                      <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-sm font-medium text-slate-700">Suitable For</label>
                          <select name="vehicleType" value={formData.vehicleType} onChange={handleChange} className="input-field rounded-lg px-4 py-3 text-sm outline-none appearance-none">
                            <option value="car">Car / SUV</option>
                            <option value="bike">Motorcycle / Bike</option>
                            <option value="rv">Large / RV</option>
                          </select>
                        </div>
                        <Input label="Total Slots" name="slots" type="number" min="1" icon="grid_view" placeholder="1" value={formData.slots} onChange={handleChange} required />
                      </div>

                      <div className="p-5 bg-parking-50 border border-parking-100 rounded-xl flex items-center justify-between mb-2">
                         <span className="text-slate-700 font-semibold">Hourly Base Rate (₹)</span>
                         <input type="number" name="pricePerHour" value={formData.pricePerHour} onChange={handleChange} required className="bg-transparent border-b-2 border-parking-500 text-slate-900 text-2xl font-semibold w-24 text-right focus:outline-none tabular-nums" />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                         <Input label="Open Time" name="startTime" type="time" icon="schedule" value={formData.startTime} onChange={handleChange} required />
                         <Input label="Close Time" name="endTime" type="time" icon="schedule" value={formData.endTime} onChange={handleChange} required />
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium text-slate-700">Upload Parking Space Photos</label>
                        <div className="relative border-2 border-dashed border-slate-300 hover:border-parking-400 rounded-xl p-6 text-center bg-slate-50 transition-colors cursor-pointer group">
                          <input
                            type="file"
                            accept="image/*"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={(e) => handleFileUpload(e, 'parking')}
                          />
                          {uploadingParking ? (
                            <div className="flex flex-col items-center gap-2 py-4">
                              <div className="w-8 h-8 border-2 border-parking-200 border-t-parking-600 rounded-full animate-spin"></div>
                              <p className="text-xs text-slate-500">Uploading to server...</p>
                            </div>
                          ) : formData.parkingImage ? (
                            <div className="flex items-center justify-between gap-4">
                              <img src={formData.parkingImage} alt="Parking" className="w-16 h-16 rounded object-cover border border-slate-200" />
                              <div className="text-left flex-1">
                                <p className="text-sm text-slate-900 font-semibold">parking_space_view.jpg</p>
                                <p className="text-xs text-parking-600 flex items-center gap-1 font-semibold mt-0.5">
                                  <span className="material-symbols-outlined text-[14px]">check_circle</span> Photo Uploaded
                                </p>
                              </div>
                              <span className="material-symbols-outlined text-slate-400 group-hover:text-slate-600">edit</span>
                            </div>
                          ) : (
                            <div className="py-4">
                              <span className="material-symbols-outlined text-4xl text-parking-600 mb-2">add_a_photo</span>
                              <h4 className="text-slate-900 font-semibold text-sm mb-0.5">Click to choose image file</h4>
                              <p className="text-xs text-slate-500 font-medium">JPEG, PNG (Max 5MB)</p>
                            </div>
                          )}
                        </div>
                      </div>
                   </motion.div>
                 )}

                 {/* STEP 5: REVIEW DETAILS & SUBMIT FOR APPROVAL */}
                 {step === 5 && (
                   <motion.div key="5" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                      <h2 className="text-2xl font-semibold text-slate-900">Review Registration.</h2>
                      <p className="text-slate-500 mb-6">Review your host profile and parking details. Submitting locks listings for admin verification.</p>

                      <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 space-y-4 max-h-[300px] overflow-y-auto">
                         <div className="flex justify-between items-start border-b border-slate-200 pb-4">
                            <div>
                              <h4 className="font-semibold text-slate-900 text-lg">{formData.title || 'Untitled Space'}</h4>
                              <p className="text-sm text-slate-500 truncate">{formData.address || 'Address pending'}</p>
                            </div>
                            <span className="bg-amber-50 text-amber-700 text-[10px] font-semibold px-2 py-1 uppercase rounded border border-amber-200 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Verification Pending
                            </span>
                         </div>

                         <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                               <span className="block text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Host Name</span>
                               <span className="text-slate-900 font-semibold">{formData.name}</span>
                            </div>
                            <div>
                               <span className="block text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Phone Number</span>
                               <span className="text-slate-900 font-semibold">{formData.phone}</span>
                            </div>
                            <div>
                               <span className="block text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Gov ID Uploaded</span>
                               <span className="text-slate-900 font-semibold">{formData.govIdType} • Uploaded</span>
                            </div>
                            <div>
                               <span className="block text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Address Proof</span>
                               <span className="text-slate-900 font-semibold">{formData.addressProofType} • Uploaded</span>
                            </div>
                            <div>
                               <span className="block text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Price / Hr</span>
                               <span className="text-slate-900 font-semibold tabular-nums">₹{formData.pricePerHour}/hr</span>
                            </div>
                            <div>
                               <span className="block text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Total Spots</span>
                               <span className="text-slate-900 font-semibold">{formData.slots} Spot({formData.slots > 1 ? 's' : ''})</span>
                            </div>
                            <div>
                               <span className="block text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Vehicle Match</span>
                               <span className="text-slate-900 font-semibold capitalize">{formData.vehicleType}</span>
                            </div>
                            <div>
                               <span className="block text-xs uppercase tracking-wider font-semibold text-slate-500 mb-1">Open Hours</span>
                               <span className="text-slate-900 font-semibold">{formData.startTime} - {formData.endTime}</span>
                            </div>
                         </div>

                         <div className="border-t border-slate-200 pt-4 space-y-3">
                            <span className="block text-xs uppercase tracking-wider font-semibold text-slate-500">Document Upload Previews</span>
                            <div className="flex gap-4">
                              <div className="flex-1 flex flex-col gap-1 items-center bg-white p-2 rounded border border-slate-200">
                                <img src={formData.govIdImage} alt="Gov ID Doc" className="w-full h-16 rounded object-cover" />
                                <span className="text-[10px] text-slate-500">Gov ID Document</span>
                              </div>
                              <div className="flex-1 flex flex-col gap-1 items-center bg-white p-2 rounded border border-slate-200">
                                <img src={formData.addressProofImage} alt="Address Proof Doc" className="w-full h-16 rounded object-cover" />
                                <span className="text-[10px] text-slate-500">Address Proof</span>
                              </div>
                              <div className="flex-1 flex flex-col gap-1 items-center bg-white p-2 rounded border border-slate-200">
                                <img src={formData.parkingImage} alt="Parking Photo" className="w-full h-16 rounded object-cover" />
                                <span className="text-[10px] text-slate-500">Parking Space</span>
                              </div>
                            </div>
                         </div>
                      </div>

                      <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 flex items-start gap-2.5 text-xs text-slate-500">
                        <span className="material-symbols-outlined text-accent-500 text-[18px]">gavel</span>
                        <p>By submitting your listing, you agree to ASAP's Terms & Conditions. Listings undergo physical or document audits and typically approve within 2 hours.</p>
                      </div>
                   </motion.div>
                 )}

              </AnimatePresence>

              {/* Form Navigation */}
              <div className="flex justify-between items-center mt-10 pt-6 border-t border-slate-200">
                 {step > 1 ? (
                   <button type="button" onClick={prevStep} className="text-slate-500 hover:text-slate-900 font-medium flex items-center gap-1 transition-colors">
                     <span className="material-symbols-outlined text-[18px]">arrow_back</span> Back
                   </button>
                 ) : <div></div>}

                 <Button
                   variant="primary"
                   type="button"
                   disabled={isLoading || uploadingId || uploadingProof || uploadingParking}
                   onClick={step === 5 ? handleSubmit : nextStep}
                   className="px-8"
                 >
                   {isLoading ? 'Submitting Application...' : step === 5 ? 'Submit Application' : 'Next Step'}
                   {!isLoading && step !== 5 && <span className="material-symbols-outlined text-[18px] ml-1">arrow_forward</span>}
                 </Button>
              </div>
            </form>

         </div>
      </main>

    </div>
  );
}
