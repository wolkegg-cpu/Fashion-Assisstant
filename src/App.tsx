import React, { useState, useEffect, useCallback } from 'react';
import { 
  Plus, 
  Shirt, 
  Sparkles, 
  Camera, 
  Settings, 
  Trash2, 
  Loader2, 
  CloudSun, 
  Calendar, 
  CheckCircle2,
  ChevronRight,
  Info,
  X,
  Upload,
  Star
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Cropper, { Area } from 'react-easy-crop';
import { getCroppedImg } from './lib/cropImage';
import { ClothingItem, Outfit, UserPreferences } from './types';
import { tagClothingItem, generateOutfit, rateOutfit, updatePreferencesFromItem, magicCutClothingItem } from './services/geminiService';
import { cn } from './lib/utils';
import { get, set } from 'idb-keyval';

const STORAGE_KEY_WARDROBE = 'ai_stylist_wardrobe';
const STORAGE_KEY_OUTFITS = 'ai_stylist_outfits';
const STORAGE_KEY_PREFS = 'ai_stylist_prefs';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'wardrobe' | 'generator' | 'feedback' | 'settings'>('dashboard');
  const [wardrobe, setWardrobe] = useState<ClothingItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [prefs, setPrefs] = useState<UserPreferences>({
    style: 'minimal streetwear',
    favoriteColors: ['black', 'white', 'grey'],
    fitPreference: 'oversized'
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [currentOutfit, setCurrentOutfit] = useState<{ items: ClothingItem[], explanation: string, upliftAdvice: string } | null>(null);
  const [feedbackResult, setFeedbackResult] = useState<{ rating: number, feedback: string } | null>(null);
  
  // New States
  const [wardrobeFilter, setWardrobeFilter] = useState<string>('all');
  const [generatorAdviceTab, setGeneratorAdviceTab] = useState<'info' | 'uplift'>('info');
  const [selectedOutfitItem, setSelectedOutfitItem] = useState<ClothingItem | null>(null);

  // Crop Modal State
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  
  // Magic Cut State
  const [isMagicCutMode, setIsMagicCutMode] = useState(false);
  const [selectionPath, setSelectionPath] = useState<{ x: number, y: number }[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  // Load data from IndexedDB with migration from localStorage
  useEffect(() => {
    const loadData = async () => {
      try {
        // Try to get from IndexedDB first
        let savedWardrobe = await get(STORAGE_KEY_WARDROBE);
        let savedOutfits = await get(STORAGE_KEY_OUTFITS);
        let savedPrefs = await get(STORAGE_KEY_PREFS);

        // Migration from localStorage if IndexedDB is empty
        if (!savedWardrobe) {
          const localWardrobe = localStorage.getItem(STORAGE_KEY_WARDROBE);
          if (localWardrobe) {
            try {
              savedWardrobe = JSON.parse(localWardrobe);
              await set(STORAGE_KEY_WARDROBE, savedWardrobe);
              localStorage.removeItem(STORAGE_KEY_WARDROBE);
            } catch (e) {
              console.error("Failed to migrate wardrobe from localStorage", e);
            }
          }
        }
        if (!savedOutfits) {
          const localOutfits = localStorage.getItem(STORAGE_KEY_OUTFITS);
          if (localOutfits) {
            try {
              savedOutfits = JSON.parse(localOutfits);
              await set(STORAGE_KEY_OUTFITS, savedOutfits);
              localStorage.removeItem(STORAGE_KEY_OUTFITS);
            } catch (e) {
              console.error("Failed to migrate outfits from localStorage", e);
            }
          }
        }
        if (!savedPrefs) {
          const localPrefs = localStorage.getItem(STORAGE_KEY_PREFS);
          if (localPrefs) {
            try {
              savedPrefs = JSON.parse(localPrefs);
              await set(STORAGE_KEY_PREFS, savedPrefs);
              localStorage.removeItem(STORAGE_KEY_PREFS);
            } catch (e) {
              console.error("Failed to migrate prefs from localStorage", e);
            }
          }
        }

        if (savedWardrobe) setWardrobe(savedWardrobe);
        if (savedOutfits) setOutfits(savedOutfits);
        if (savedPrefs) setPrefs(savedPrefs);
      } catch (error) {
        console.error("Failed to load data from storage", error);
      } finally {
        setIsLoaded(true);
      }
    };
    loadData();
  }, []);

  // Save data to IndexedDB
  useEffect(() => {
    if (isLoaded) {
      set(STORAGE_KEY_WARDROBE, wardrobe).catch(err => console.error("Failed to save wardrobe", err));
    }
  }, [wardrobe, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      set(STORAGE_KEY_OUTFITS, outfits).catch(err => console.error("Failed to save outfits", err));
    }
  }, [outfits, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      set(STORAGE_KEY_PREFS, prefs).catch(err => console.error("Failed to save prefs", err));
    }
  }, [prefs, isLoaded]);

  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    
    // For simplicity, we'll crop one image at a time if multiple are selected
    const file = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      setCropImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const confirmCrop = async () => {
    if (!cropImage || !croppedAreaPixels) return;
    
    setIsLoading(true);
    const imageToProcess = cropImage;
    setCropImage(null); // Close modal

    try {
      const croppedImage = await getCroppedImg(imageToProcess, croppedAreaPixels);
      const base64 = croppedImage.split(',')[1];
      const tags = await tagClothingItem(base64);
      
      const newItem: ClothingItem = {
        id: Math.random().toString(36).substr(2, 9),
        type: tags.type || 'unknown',
        color: tags.color || 'unknown',
        vibe: tags.vibe || 'unknown',
        category: tags.category as any || 'top',
        imageUrl: croppedImage
      };
      
      setWardrobe(prev => [...prev, newItem]);

      // Update preferences based on new item
      try {
        const updatedPrefs = await updatePreferencesFromItem(prefs, tags);
        setPrefs(updatedPrefs);
      } catch (err) {
        console.error("Failed to update preferences from item:", err);
      }
    } catch (error) {
      console.error("Error processing cropped image:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicCut = async () => {
    if (!cropImage || selectionPath.length === 0) return;
    
    setIsLoading(true);
    const imageToProcess = cropImage;
    setCropImage(null);
    setIsMagicCutMode(false);
    setSelectionPath([]);

    try {
      const base64 = imageToProcess.split(',')[1];
      // Normalize coordinates for Gemini (0-1000)
      const normalizedPath = selectionPath.map(p => ({
        x: Math.round(p.x * 1000),
        y: Math.round(p.y * 1000)
      }));

      const cutImage = await magicCutClothingItem(base64, normalizedPath);
      const cutBase64 = cutImage.split(',')[1];
      const tags = await tagClothingItem(cutBase64);
      
      const newItem: ClothingItem = {
        id: Math.random().toString(36).substr(2, 9),
        type: tags.type || 'unknown',
        color: tags.color || 'unknown',
        vibe: tags.vibe || 'unknown',
        category: tags.category as any || 'top',
        imageUrl: cutImage
      };
      
      setWardrobe(prev => [...prev, newItem]);

      // Update preferences
      try {
        const updatedPrefs = await updatePreferencesFromItem(prefs, tags);
        setPrefs(updatedPrefs);
      } catch (err) {
        console.error("Failed to update preferences:", err);
      }
    } catch (error) {
      console.error("Error magic cutting image:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isMagicCutMode) return;
    setIsDrawing(true);
    const coords = getCoordinates(e);
    setSelectionPath([coords]);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !isMagicCutMode) return;
    const coords = getCoordinates(e);
    setSelectionPath(prev => [...prev, coords]);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height
    };
  };

  useEffect(() => {
    if (isMagicCutMode && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (selectionPath.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.moveTo(selectionPath[0].x * canvas.width, selectionPath[0].y * canvas.height);
        for (let i = 1; i < selectionPath.length; i++) {
          ctx.lineTo(selectionPath[i].x * canvas.width, selectionPath[i].y * canvas.height);
        }
        ctx.stroke();
        
        // Fill with semi-transparent indigo
        ctx.fillStyle = 'rgba(99, 102, 241, 0.2)';
        ctx.fill();
      }
    }
  }, [selectionPath, isMagicCutMode]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFileUpload(Array.from(e.target.files));
    }
  };

  const handleGenerateOutfit = async (occasion: string, weather: string) => {
    if (wardrobe.length === 0) return;
    setIsLoading(true);
    try {
      const result = await generateOutfit(wardrobe, prefs, occasion, weather);
      const selectedItems = wardrobe.filter(item => result.itemIds.includes(item.id));
      setCurrentOutfit({ 
        items: selectedItems, 
        explanation: result.explanation,
        upliftAdvice: result.upliftAdvice
      });
    } catch (error) {
      console.error("Error generating outfit:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRateOutfit = async (file: File) => {
    setIsLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = (e.target?.result as string).split(',')[1];
        const result = await rateOutfit(base64, prefs);
        setFeedbackResult(result);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Error rating outfit:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteItem = (id: string) => {
    setWardrobe(prev => prev.filter(item => item.id !== id));
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Crop Modal */}
      <AnimatePresence>
        {cropImage && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-6"
          >
            <div className="relative w-full max-w-2xl aspect-square bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-800 shadow-2xl">
              {!isMagicCutMode ? (
                <Cropper
                  image={cropImage}
                  crop={crop}
                  zoom={zoom}
                  aspect={3 / 4}
                  onCropChange={setCrop}
                  onCropComplete={onCropComplete}
                  onZoomChange={setZoom}
                />
              ) : (
                <div className="relative w-full h-full flex items-center justify-center bg-zinc-950">
                  <img src={cropImage} className="max-w-full max-h-full object-contain pointer-events-none" />
                  <canvas
                    ref={canvasRef}
                    width={800}
                    height={800}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
                  />
                  <div className="absolute top-4 left-4 right-4 p-3 bg-indigo-600/90 backdrop-blur rounded-xl text-xs font-medium text-center shadow-lg">
                    Circle the clothing item you want to cut out
                  </div>
                </div>
              )}
            </div>
            
            <div className="mt-8 w-full max-w-2xl space-y-6">
              {!isMagicCutMode ? (
                <>
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-zinc-400">Zoom</span>
                    <input
                      type="range"
                      value={zoom}
                      min={1}
                      max={3}
                      step={0.1}
                      aria-labelledby="Zoom"
                      onChange={(e) => setZoom(Number(e.target.value))}
                      className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                    />
                  </div>
                  
                  <div className="flex gap-4">
                    <button 
                      onClick={() => setCropImage(null)}
                      className="flex-1 px-6 py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 font-semibold transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={() => setIsMagicCutMode(true)}
                      className="flex-1 px-6 py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 font-semibold flex items-center justify-center gap-2 transition-all"
                    >
                      <Camera className="w-5 h-5 text-indigo-400" />
                      Magic Cut
                    </button>
                    <button 
                      onClick={confirmCrop}
                      className="flex-[2] px-6 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/20"
                    >
                      <CheckCircle2 className="w-5 h-5" />
                      Confirm Crop
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                      setIsMagicCutMode(false);
                      setSelectionPath([]);
                    }}
                    className="flex-1 px-6 py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 font-semibold transition-all"
                  >
                    Back to Crop
                  </button>
                  <button 
                    onClick={() => setSelectionPath([])}
                    className="flex-1 px-6 py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 font-semibold transition-all"
                  >
                    Clear Selection
                  </button>
                  <button 
                    onClick={handleMagicCut}
                    disabled={selectionPath.length < 3}
                    className="flex-[2] px-6 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/20"
                  >
                    <Sparkles className="w-5 h-5" />
                    Magic Cut & Add
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar / Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900/80 backdrop-blur-xl border-t border-zinc-800 md:top-0 md:bottom-0 md:left-0 md:w-20 md:border-r md:border-t-0 flex md:flex-col items-center justify-around md:justify-center gap-8 p-4">
        <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Calendar className="w-6 h-6" />} label="Home" />
        <NavButton active={activeTab === 'wardrobe'} onClick={() => setActiveTab('wardrobe')} icon={<Shirt className="w-6 h-6" />} label="Wardrobe" />
        <NavButton active={activeTab === 'generator'} onClick={() => setActiveTab('generator')} icon={<Sparkles className="w-6 h-6" />} label="Style" />
        <NavButton active={activeTab === 'feedback'} onClick={() => setActiveTab('feedback')} icon={<Camera className="w-6 h-6" />} label="Rate" />
        <NavButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings className="w-6 h-6" />} label="Prefs" />
      </nav>

      {/* Main Content */}
      <main className="pb-24 md:pb-8 md:pl-24 max-w-5xl mx-auto p-6 pt-8">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              <header>
                <h1 className="text-4xl font-bold tracking-tight text-zinc-50">Good morning, Style.</h1>
                <p className="text-zinc-400 mt-2">Your wardrobe has {wardrobe.length} items ready for today.</p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 rounded-3xl bg-indigo-600/10 border border-indigo-500/20 flex flex-col justify-between h-48 group cursor-pointer hover:bg-indigo-600/20 transition-all" onClick={() => setActiveTab('generator')}>
                  <div className="flex justify-between items-start">
                    <Sparkles className="w-8 h-8 text-indigo-400" />
                    <ChevronRight className="w-5 h-5 text-indigo-400 group-hover:translate-x-1 transition-transform" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold">Generate Outfit</h2>
                    <p className="text-indigo-400/70 text-sm">Let AI pick your look for today</p>
                  </div>
                </div>

                <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800 flex flex-col justify-between h-48 group cursor-pointer hover:border-zinc-700 transition-all" onClick={() => setActiveTab('wardrobe')}>
                  <div className="flex justify-between items-start">
                    <Shirt className="w-8 h-8 text-zinc-400" />
                    <ChevronRight className="w-5 h-5 text-zinc-500 group-hover:translate-x-1 transition-transform" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold">My Wardrobe</h2>
                    <p className="text-zinc-500 text-sm">Manage your collection of {wardrobe.length} items</p>
                  </div>
                </div>
              </div>

              <section>
                <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                  <Info className="w-4 h-4 text-zinc-500" />
                  Style Preferences
                </h3>
                <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800 flex flex-wrap gap-3">
                  <span className="px-4 py-2 rounded-full bg-zinc-800 text-sm border border-zinc-700">{prefs.style}</span>
                  <span className="px-4 py-2 rounded-full bg-zinc-800 text-sm border border-zinc-700">{prefs.fitPreference}</span>
                  {prefs.favoriteColors.map(color => (
                    <span key={color} className="px-4 py-2 rounded-full bg-zinc-800 text-sm border border-zinc-700 flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color.toLowerCase() }} />
                      {color}
                    </span>
                  ))}
                </div>
              </section>
            </motion.div>
          )}

          {activeTab === 'wardrobe' && (
            <motion.div key="wardrobe" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                  <h1 className="text-3xl font-bold">Wardrobe</h1>
                  <p className="text-zinc-400">Manage your clothing items</p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex bg-zinc-900 p-1 rounded-2xl border border-zinc-800">
                    {['all', 'top', 'bottom', 'shoes', 'accessory'].map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setWardrobeFilter(cat)}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-medium capitalize transition-all",
                          wardrobeFilter === cat 
                            ? "bg-zinc-800 text-white shadow-sm" 
                            : "text-zinc-500 hover:text-zinc-300"
                        )}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  
                  <div className="relative">
                    <input type="file" multiple accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileChange} />
                    <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-2xl font-medium flex items-center gap-2 transition-all shadow-lg shadow-indigo-600/20">
                      <Plus className="w-5 h-5" />
                      Add Items
                    </button>
                  </div>
                </div>
              </div>

              {isLoading && (
                <div className="flex items-center justify-center p-12 bg-zinc-900 rounded-3xl border border-zinc-800 border-dashed">
                  <div className="text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-500 mb-2" />
                    <p className="text-zinc-400">AI is tagging your items...</p>
                  </div>
                </div>
              )}

              {wardrobe.length === 0 && !isLoading ? (
                <div className="p-20 rounded-3xl border-2 border-dashed border-zinc-800 bg-zinc-900/50 flex flex-col items-center justify-center text-center relative">
                  <input type="file" multiple accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileChange} />
                  <Upload className="w-12 h-12 text-zinc-600 mb-4" />
                  <h2 className="text-xl font-medium">Your wardrobe is empty</h2>
                  <p className="text-zinc-500 mt-2 max-w-xs">Click here to upload photos of your clothes to start building your AI wardrobe.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {wardrobe
                    .filter(item => wardrobeFilter === 'all' || item.category === wardrobeFilter)
                    .map(item => (
                    <motion.div layout key={item.id} className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800">
                      <img src={item.imageUrl} alt={item.type} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" referrerPolicy="no-referrer" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-4 flex flex-col justify-end">
                        <p className="text-sm font-medium capitalize">{item.type}</p>
                        <p className="text-xs text-zinc-400 capitalize">{item.color} • {item.vibe}</p>
                        <button onClick={() => deleteItem(item.id)} className="absolute top-2 right-2 p-2 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 transition-colors hover:text-white">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'generator' && (
            <motion.div key="generator" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              <header>
                <h1 className="text-3xl font-bold">Outfit Generator</h1>
                <p className="text-zinc-400">Let AI curate the perfect look from your wardrobe</p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 space-y-6">
                  <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800 space-y-4">
                    <div>
                      <label className="text-sm font-medium text-zinc-400 block mb-2">Occasion</label>
                      <select id="occasion" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all">
                        <option>Casual Day Out</option>
                        <option>Gym / Workout</option>
                        <option>Formal Event</option>
                        <option>Date Night</option>
                        <option>Office / Work</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-zinc-400 block mb-2">Weather</label>
                      <select id="weather" className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all">
                        <option>Sunny & Warm</option>
                        <option>Cold & Rainy</option>
                        <option>Snowy</option>
                        <option>Mild / Spring</option>
                      </select>
                    </div>
                    <button 
                      onClick={() => handleGenerateOutfit(
                        (document.getElementById('occasion') as HTMLSelectElement).value,
                        (document.getElementById('weather') as HTMLSelectElement).value
                      )}
                      disabled={isLoading || wardrobe.length === 0}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all"
                    >
                      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                      Generate Fit
                    </button>
                    {wardrobe.length === 0 && (
                      <p className="text-xs text-amber-400 text-center">Add items to your wardrobe first!</p>
                    )}
                  </div>
                </div>

                <div className="md:col-span-2">
                  {currentOutfit ? (
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        {currentOutfit.items.map(item => (
                          <div 
                            key={item.id} 
                            onClick={() => setSelectedOutfitItem(item)}
                            className="group relative aspect-[3/4] rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 cursor-pointer hover:border-indigo-500/50 transition-all"
                          >
                            <img src={item.imageUrl} alt={item.type} className="w-full h-full object-cover transition-transform group-hover:scale-105" referrerPolicy="no-referrer" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <span className="bg-white/10 backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-medium border border-white/20">View Details</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Interactive Item Details */}
                      <AnimatePresence>
                        {selectedOutfitItem && (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800 flex items-center gap-6 relative">
                              <div className="w-24 h-32 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-800">
                                <img src={selectedOutfitItem.imageUrl} className="w-full h-full object-cover" />
                              </div>
                              <div className="flex-1">
                                <h4 className="text-lg font-semibold capitalize">{selectedOutfitItem.type}</h4>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  <span className="px-2 py-1 rounded-lg bg-zinc-800 text-[10px] uppercase tracking-wider font-bold text-zinc-400 border border-zinc-700">{selectedOutfitItem.color}</span>
                                  <span className="px-2 py-1 rounded-lg bg-zinc-800 text-[10px] uppercase tracking-wider font-bold text-zinc-400 border border-zinc-700">{selectedOutfitItem.vibe}</span>
                                  <span className="px-2 py-1 rounded-lg bg-zinc-800 text-[10px] uppercase tracking-wider font-bold text-zinc-400 border border-zinc-700">{selectedOutfitItem.category}</span>
                                </div>
                                <p className="text-zinc-500 text-sm mt-3">This {selectedOutfitItem.type} is a key piece for your {prefs.style} look.</p>
                              </div>
                              <button 
                                onClick={() => setSelectedOutfitItem(null)}
                                className="absolute top-4 right-4 p-2 text-zinc-500 hover:text-white"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="space-y-4">
                        <div className="flex gap-2 p-1 bg-zinc-900 rounded-2xl border border-zinc-800 w-fit">
                          <button 
                            onClick={() => setGeneratorAdviceTab('info')}
                            className={cn(
                              "px-6 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2",
                              generatorAdviceTab === 'info' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "text-zinc-500 hover:text-zinc-300"
                            )}
                          >
                            <Info className="w-4 h-4" />
                            Outfit Info
                          </button>
                          <button 
                            onClick={() => setGeneratorAdviceTab('uplift')}
                            className={cn(
                              "px-6 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-2",
                              generatorAdviceTab === 'uplift' ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20" : "text-zinc-500 hover:text-zinc-300"
                            )}
                          >
                            <Sparkles className="w-4 h-4" />
                            Uplift Advice
                          </button>
                        </div>

                        <AnimatePresence mode="wait">
                          {generatorAdviceTab === 'info' ? (
                            <motion.div 
                              key="info"
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 10 }}
                              className="p-8 rounded-3xl bg-indigo-600/10 border border-indigo-500/20"
                            >
                              <h3 className="text-lg font-bold text-indigo-400 mb-3">Why this works</h3>
                              <p className="text-zinc-300 leading-relaxed text-lg">{currentOutfit.explanation}</p>
                              <div className="mt-6 flex items-center gap-2 text-xs font-medium text-indigo-400/60 uppercase tracking-widest">
                                <div className="w-1 h-1 rounded-full bg-indigo-400" />
                                Perfect for your style
                              </div>
                            </motion.div>
                          ) : (
                            <motion.div 
                              key="uplift"
                              initial={{ opacity: 0, x: 10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -10 }}
                              className="p-8 rounded-3xl bg-amber-500/10 border border-amber-500/20"
                            >
                              <h3 className="text-lg font-bold text-amber-500 mb-3">Take it to the next level</h3>
                              <p className="text-zinc-300 leading-relaxed text-lg">{currentOutfit.upliftAdvice}</p>
                              <div className="mt-6 flex items-center gap-2 text-xs font-medium text-amber-500/60 uppercase tracking-widest">
                                <div className="w-1 h-1 rounded-full bg-amber-500" />
                                Pro Styling Tip
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full min-h-[400px] rounded-3xl border-2 border-dashed border-zinc-800 flex flex-col items-center justify-center text-zinc-500 p-12 text-center">
                      <Sparkles className="w-12 h-12 mb-4 opacity-20" />
                      <p>Select your occasion and weather to see AI suggestions.</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'feedback' && (
            <motion.div key="feedback" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              <header>
                <h1 className="text-3xl font-bold">Outfit Feedback</h1>
                <p className="text-zinc-400">Upload a photo of your fit to get a professional rating</p>
              </header>

              <div className="max-w-2xl mx-auto space-y-8">
                <div className="p-12 rounded-3xl border-2 border-dashed border-zinc-800 bg-zinc-900/50 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-zinc-900 transition-all relative">
                  <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => e.target.files?.[0] && handleRateOutfit(e.target.files[0])} />
                  <Camera className="w-12 h-12 text-zinc-600 mb-4" />
                  <h2 className="text-xl font-medium">Snap or Upload your fit</h2>
                  <p className="text-zinc-500 mt-2">AI will analyze your silhouette, color palette, and vibe.</p>
                </div>

                {isLoading && (
                  <div className="flex items-center justify-center p-8">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                  </div>
                )}

                {feedbackResult && (
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-8 rounded-3xl bg-zinc-900 border border-zinc-800 space-y-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-bold">AI Stylist Rating</h2>
                      <div className="flex items-center gap-2 bg-indigo-600 px-4 py-2 rounded-2xl">
                        <Star className="w-5 h-5 fill-white" />
                        <span className="text-xl font-bold">{feedbackResult.rating}/10</span>
                      </div>
                    </div>
                    <div className="p-6 rounded-2xl bg-zinc-800/50 border border-zinc-700">
                      <p className="text-zinc-300 leading-relaxed italic">"{feedbackResult.feedback}"</p>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              <header>
                <h1 className="text-3xl font-bold">Preferences</h1>
                <p className="text-zinc-400">Personalize your AI stylist's brain</p>
              </header>

              <div className="max-w-2xl space-y-6">
                <div className="p-8 rounded-3xl bg-zinc-900 border border-zinc-800 space-y-6">
                  <div>
                    <label className="text-sm font-medium text-zinc-400 block mb-2">Style Vibe</label>
                    <input 
                      type="text" 
                      value={prefs.style} 
                      onChange={(e) => setPrefs(prev => ({ ...prev, style: e.target.value }))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      placeholder="e.g. Minimal Streetwear, Dark Academia"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 block mb-2">Fit Preference</label>
                    <select 
                      value={prefs.fitPreference}
                      onChange={(e) => setPrefs(prev => ({ ...prev, fitPreference: e.target.value }))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                      <option>Oversized</option>
                      <option>Slim Fit</option>
                      <option>Regular</option>
                      <option>Athletic</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-zinc-400 block mb-2">Favorite Colors (comma separated)</label>
                    <input 
                      type="text" 
                      value={prefs.favoriteColors.join(', ')} 
                      onChange={(e) => setPrefs(prev => ({ ...prev, favoriteColors: e.target.value.split(',').map(s => s.trim()) }))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      placeholder="e.g. Black, White, Navy"
                    />
                  </div>
                </div>

                <div className="p-6 rounded-3xl bg-amber-500/10 border border-amber-500/20 flex gap-4">
                  <Info className="w-6 h-6 text-amber-500 shrink-0" />
                  <p className="text-sm text-amber-200/80">These preferences directly influence how the AI generates outfits and provides feedback. Be specific for better results!</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-all group",
        active ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300"
      )}
    >
      <div className={cn(
        "p-2 rounded-xl transition-all",
        active ? "bg-indigo-500/10" : "group-hover:bg-zinc-800"
      )}>
        {icon}
      </div>
      <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
    </button>
  );
}
