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
  Star,
  Pencil,
  Heart
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
  const [error, setError] = useState<string | null>(null);
  
  const hasApiKey = !!(process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY);
  
  const [currentOutfit, setCurrentOutfit] = useState<{ items: ClothingItem[], explanation: string, upliftAdvice: string } | null>(null);
  const [feedbackResult, setFeedbackResult] = useState<{ rating: number, feedback: string } | null>(null);
  
  // New States
  const [wardrobeFilter, setWardrobeFilter] = useState<string>('all');
  const [wardrobeSection, setWardrobeSection] = useState<'items' | 'outfits'>('items');
  const [generatorAdviceTab, setGeneratorAdviceTab] = useState<'info' | 'uplift' | null>(null);
  const [selectedOutfitItem, setSelectedOutfitItem] = useState<ClothingItem | null>(null);

  // Crop Modal State
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  
  // Magic Cut State
  const [isMagicCutMode, setIsMagicCutMode] = useState(false);
  const [selectionPath, setSelectionPath] = useState<{ x: number, y: number }[]>([]);
  const [bulkUploadProgress, setBulkUploadProgress] = useState<{ current: number, total: number } | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [outfitPositions, setOutfitPositions] = useState<Record<string, { x: number, y: number }>>({});
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
    
    setIsLoading(true);
    setError(null);
    setBulkUploadProgress({ current: 0, total: files.length });
    
    try {
      // Check if API key is present
      if (!hasApiKey) {
        if (window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
          await window.aistudio.openSelectKey();
        } else {
          throw new Error("Gemini API Key is missing. Please set VITE_GEMINI_API_KEY in your Vercel environment variables and redeploy.");
        }
      }

      const newItems: ClothingItem[] = [];
      
      // Process in sequence to avoid hitting rate limits too hard
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setBulkUploadProgress({ current: i + 1, total: files.length });
        
        const base64WithHeader = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        
        const base64 = base64WithHeader.split(',')[1];
        const tags = await tagClothingItem(base64);
        
        newItems.push({
          id: Math.random().toString(36).substr(2, 9),
          type: tags.type || 'unknown',
          color: tags.color || 'unknown',
          vibe: tags.vibe || 'unknown',
          category: tags.category as any || 'top',
          imageUrl: base64WithHeader
        });

        // Add a small delay between items if more than one
        if (files.length > 1 && i < files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
      
      setWardrobe(prev => [...prev, ...newItems]);
    } catch (err: any) {
      console.error("Upload error:", err);
      if (err.message?.includes("Requested entity was not found") && window.aistudio) {
        setError("API Key issue detected. Opening key selector...");
        await window.aistudio.openSelectKey();
        return;
      }
      setError(err.message || "Failed to process some images.");
    } finally {
      setIsLoading(false);
      setBulkUploadProgress(null);
    }
  };

  const onCropComplete = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const confirmCrop = async () => {
    if (!cropImage || !croppedAreaPixels) return;
    
    setIsLoading(true);
    setError(null);
    const imageToProcess = cropImage;
    setCropImage(null); // Close modal

    try {
      const croppedImage = await getCroppedImg(imageToProcess, croppedAreaPixels);
      const base64 = croppedImage.split(',')[1];
      
      // Check if API key is present
      if (!hasApiKey) {
        throw new Error("Gemini API Key is missing. Please set VITE_GEMINI_API_KEY in your Vercel environment variables and redeploy.");
      }

      const tags = await tagClothingItem(base64);
      
      if (editingItemId) {
        setWardrobe(prev => prev.map(item => 
          item.id === editingItemId 
            ? { ...item, imageUrl: croppedImage, ...tags } 
            : item
        ));
        setEditingItemId(null);
      } else {
        const newItem: ClothingItem = {
          id: Math.random().toString(36).substr(2, 9),
          type: tags.type || 'unknown',
          color: tags.color || 'unknown',
          vibe: tags.vibe || 'unknown',
          category: tags.category as any || 'top',
          imageUrl: croppedImage
        };
        setWardrobe(prev => [...prev, newItem]);
      }

      // Update preferences based on new item
      try {
        const updatedPrefs = await updatePreferencesFromItem(prefs, tags);
        setPrefs(updatedPrefs);
      } catch (err) {
        console.error("Failed to update preferences from item:", err);
      }
    } catch (err: any) {
      console.error("Error processing cropped image:", err);
      setError(err.message || "Failed to process image. Check your internet connection or API key.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicCut = async () => {
    if (!cropImage || selectionPath.length === 0) return;
    
    setIsLoading(true);
    setError(null);
    const imageToProcess = cropImage;
    setCropImage(null);
    setIsMagicCutMode(false);
    setSelectionPath([]);

    const performCut = async () => {
      try {
        const base64 = imageToProcess.split(',')[1];
        
        // Check if API key is present
        if (!hasApiKey) {
          // Check if we need to open the key selector
          if (window.aistudio && !(await window.aistudio.hasSelectedApiKey())) {
            await window.aistudio.openSelectKey();
            // Proceed assuming success as per guidelines
          } else {
            throw new Error("Gemini API Key is missing. Please set VITE_GEMINI_API_KEY in your Vercel environment variables and redeploy.");
          }
        }

        // Normalize coordinates for Gemini (0-1000)
        const normalizedPath = selectionPath.map(p => ({
          x: Math.round(p.x * 1000),
          y: Math.round(p.y * 1000)
        }));

        const cutImage = await magicCutClothingItem(base64, normalizedPath);
        
        // Add a small delay to avoid hitting rate limits on back-to-back AI calls
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const cutBase64 = cutImage.split(',')[1];
        const tags = await tagClothingItem(cutBase64);
        
        if (editingItemId) {
          setWardrobe(prev => prev.map(item => 
            item.id === editingItemId 
              ? { ...item, imageUrl: cutImage, ...tags } 
              : item
          ));
          setEditingItemId(null);
        } else {
          const newItem: ClothingItem = {
            id: Math.random().toString(36).substr(2, 9),
            type: tags.type || 'unknown',
            color: tags.color || 'unknown',
            vibe: tags.vibe || 'unknown',
            category: tags.category as any || 'top',
            imageUrl: cutImage
          };
          setWardrobe(prev => [...prev, newItem]);
        }

        // Update preferences
        try {
          const updatedPrefs = await updatePreferencesFromItem(prefs, tags);
          setPrefs(updatedPrefs);
        } catch (err) {
          console.error("Failed to update preferences:", err);
        }
      } catch (err: any) {
        console.error("Error magic cutting image:", err);
        if (err.message?.includes("Requested entity was not found") && window.aistudio) {
          setError("API Key issue detected. Opening key selector...");
          await window.aistudio.openSelectKey();
          return;
        }
        setError(err.message || "Failed to cut image. Check your internet connection or API key.");
      } finally {
        setIsLoading(false);
      }
    };

    await performCut();
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
      
      // Initialize positions for the canvas
      const newPositions: Record<string, { x: number, y: number }> = {};
      selectedItems.forEach((item, index) => {
        // Spread items out a bit initially
        newPositions[item.id] = { 
          x: (index % 2) * 150 + 20, 
          y: Math.floor(index / 2) * 200 + 20 
        };
      });
      setOutfitPositions(newPositions);
      setGeneratorAdviceTab(null);

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

  const saveOutfit = () => {
    if (!currentOutfit) return;
    const newOutfit: Outfit = {
      id: Math.random().toString(36).substr(2, 9),
      items: currentOutfit.items,
      explanation: currentOutfit.explanation,
      upliftAdvice: currentOutfit.upliftAdvice,
      date: new Date().toISOString(),
      occasion: 'Saved Outfit',
      weather: 'Any'
    };
    setOutfits(prev => [newOutfit, ...prev]);
    setCurrentOutfit(null);
    setActiveTab('wardrobe');
    setWardrobeSection('outfits');
  };

  const deleteOutfit = (id: string) => {
    setOutfits(prev => prev.filter(o => o.id !== id));
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-6 right-6 z-[110] md:left-auto md:right-6 md:w-96"
          >
            <div className="bg-red-500 text-white p-4 rounded-2xl shadow-2xl flex items-center gap-3">
              <X className="w-5 h-5 shrink-0 cursor-pointer" onClick={() => setError(null)} />
              <p className="text-sm font-medium">{error}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
                  
                  <div className="flex flex-col gap-3">
                    <div className="flex gap-3">
                      <button 
                        onClick={() => {
                          setCropImage(null);
                          setEditingItemId(null);
                        }}
                        className="flex-1 px-6 py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 font-bold transition-all active:scale-95"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={() => setIsMagicCutMode(true)}
                        className="flex-1 px-6 py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                      >
                        <Camera className="w-5 h-5 text-indigo-400" />
                        Magic Cut
                      </button>
                    </div>
                    <button 
                      onClick={confirmCrop}
                      className="w-full px-6 py-5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 font-bold flex items-center justify-center gap-2 transition-all shadow-xl shadow-indigo-600/20 active:scale-95"
                    >
                      <CheckCircle2 className="w-6 h-6" />
                      {editingItemId ? 'Save Changes' : 'Confirm & Add to Closet'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 mb-2">
                    <p className="text-xs text-indigo-300 text-center font-medium">Trace around the clothing item with your finger to isolate it!</p>
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => {
                        setIsMagicCutMode(false);
                        setSelectionPath([]);
                      }}
                      className="flex-1 px-6 py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 font-bold transition-all active:scale-95"
                    >
                      Back
                    </button>
                    <button 
                      onClick={() => setSelectionPath([])}
                      className="flex-1 px-6 py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 font-bold transition-all active:scale-95"
                    >
                      Clear
                    </button>
                  </div>
                  <button 
                    onClick={handleMagicCut}
                    disabled={selectionPath.length < 3}
                    className="w-full px-6 py-5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-bold flex items-center justify-center gap-2 transition-all shadow-xl shadow-indigo-600/20 active:scale-95"
                  >
                    <Sparkles className="w-6 h-6" />
                    {editingItemId ? 'Save Cut' : 'Magic Cut & Add'}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Item Detail Modal */}
      <AnimatePresence>
        {selectedOutfitItem && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
            onClick={() => setSelectedOutfitItem(null)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-zinc-900 w-full max-w-md rounded-[2.5rem] overflow-hidden border border-zinc-800 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative aspect-[3/4]">
                <img 
                  src={selectedOutfitItem.imageUrl} 
                  className="w-full h-full object-cover" 
                  referrerPolicy="no-referrer"
                />
                <button 
                  onClick={() => setSelectedOutfitItem(null)}
                  className="absolute top-4 right-4 p-2 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-zinc-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-8 space-y-6">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-2xl font-bold text-white capitalize">{selectedOutfitItem.type}</h2>
                    <span className="px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-bold uppercase tracking-widest">
                      {selectedOutfitItem.category}
                    </span>
                  </div>
                  <p className="text-zinc-400 text-sm leading-relaxed">
                    {selectedOutfitItem.description || `A ${selectedOutfitItem.color} ${selectedOutfitItem.type} with a ${selectedOutfitItem.vibe} vibe.`}
                  </p>
                </div>
                
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="p-4 rounded-2xl bg-zinc-800/50 border border-zinc-800">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Color</p>
                    <p className="text-sm font-medium text-zinc-200 capitalize">{selectedOutfitItem.color}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-zinc-800/50 border border-zinc-800">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-1">Vibe</p>
                    <p className="text-sm font-medium text-zinc-200 capitalize">{selectedOutfitItem.vibe}</p>
                  </div>
                </div>

                <button 
                  onClick={() => setSelectedOutfitItem(null)}
                  className="w-full py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold transition-all active:scale-95"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar / Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900/90 backdrop-blur-2xl border-t border-zinc-800/50 md:top-0 md:bottom-0 md:left-0 md:w-24 md:border-r md:border-t-0 flex md:flex-col items-center justify-around md:justify-center gap-4 md:gap-10 p-2 md:p-4 pb-safe shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.5)]">
        <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Calendar />} label="Home" />
        <NavButton active={activeTab === 'wardrobe'} onClick={() => setActiveTab('wardrobe')} icon={<Shirt />} label="Closet" />
        <NavButton active={activeTab === 'generator'} onClick={() => setActiveTab('generator')} icon={<Sparkles />} label="Style" />
        <NavButton active={activeTab === 'feedback'} onClick={() => setActiveTab('feedback')} icon={<Camera />} label="Rate" />
        <NavButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings />} label="Prefs" />
      </nav>

      {/* Main Content */}
      <main className={cn(
        "pb-32 md:pb-8 md:pl-24 mx-auto transition-all duration-500",
        currentOutfit && activeTab === 'generator' 
          ? "max-w-none p-0 md:p-0 pt-0 md:pt-0" 
          : "max-w-5xl p-4 md:p-8 pt-6 md:pt-10"
      )}>
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              <header>
                <h1 className="text-4xl font-bold tracking-tight text-zinc-50">Good morning, Style.</h1>
                <p className="text-zinc-400 mt-2">Your wardrobe has {wardrobe.length} items ready for today.</p>
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-6 rounded-[2rem] bg-indigo-600/10 border border-indigo-500/20 flex flex-col justify-between h-44 group cursor-pointer hover:bg-indigo-600/20 transition-all active:scale-[0.98]" onClick={() => setActiveTab('generator')}>
                  <div className="flex justify-between items-start">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center">
                      <Sparkles className="w-6 h-6 text-indigo-400" />
                    </div>
                    <ChevronRight className="w-5 h-5 text-indigo-400 group-hover:translate-x-1 transition-transform" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-indigo-100">Generate Outfit</h2>
                    <p className="text-indigo-400/70 text-sm font-medium">AI-curated looks for today</p>
                  </div>
                </div>

                <div className="p-6 rounded-[2rem] bg-zinc-900 border border-zinc-800 flex flex-col justify-between h-44 group cursor-pointer hover:border-zinc-700 transition-all active:scale-[0.98]" onClick={() => setActiveTab('wardrobe')}>
                  <div className="flex justify-between items-start">
                    <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center">
                      <Shirt className="w-6 h-6 text-zinc-400" />
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-500 group-hover:translate-x-1 transition-transform" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-zinc-100">My Closet</h2>
                    <p className="text-zinc-500 text-sm font-medium">{wardrobe.length} items collected</p>
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
                <div className="space-y-4">
                  <div>
                    <h1 className="text-3xl font-bold">My Closet</h1>
                    <p className="text-zinc-400">Manage your collection and saved looks</p>
                  </div>
                  
                  <div className="flex bg-zinc-900 p-1 rounded-2xl border border-zinc-800 w-fit">
                    <button
                      onClick={() => setWardrobeSection('items')}
                      className={cn(
                        "px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2",
                        wardrobeSection === 'items' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      <Shirt className="w-4 h-4" />
                      Items
                    </button>
                    <button
                      onClick={() => setWardrobeSection('outfits')}
                      className={cn(
                        "px-6 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2",
                        wardrobeSection === 'outfits' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      <Heart className="w-4 h-4" />
                      Outfits
                    </button>
                  </div>
                </div>
                
                {wardrobeSection === 'items' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex bg-zinc-900 p-1.5 rounded-2xl border border-zinc-800 overflow-x-auto no-scrollbar max-w-full">
                      {['all', 'top', 'bottom', 'shoes', 'accessory'].map((cat) => (
                        <button
                          key={cat}
                          onClick={() => setWardrobeFilter(cat)}
                          className={cn(
                            "px-5 py-2.5 rounded-xl text-xs font-bold capitalize transition-all whitespace-nowrap",
                            wardrobeFilter === cat 
                              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" 
                              : "text-zinc-500 hover:text-zinc-300"
                          )}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                    
                    <div className="relative">
                      <input type="file" multiple accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileChange} />
                      <button className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-2 transition-all shadow-xl shadow-indigo-600/20 active:scale-95">
                        <Plus className="w-5 h-5" />
                        Add Items
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {wardrobeSection === 'items' ? (
                <>
                  {isLoading && (
                    <div className="flex items-center justify-center p-12 bg-zinc-900 rounded-3xl border border-zinc-800 border-dashed">
                      <div className="text-center">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-500 mb-2" />
                        <p className="text-zinc-400">
                          {bulkUploadProgress 
                            ? `AI is tagging item ${bulkUploadProgress.current} of ${bulkUploadProgress.total}...`
                            : "AI is tagging your items..."}
                        </p>
                      </div>
                    </div>
                  )}

                  {wardrobe.length === 0 && !isLoading ? (
                    <div className="p-12 md:p-20 rounded-3xl border-2 border-dashed border-zinc-800 bg-zinc-900/50 flex flex-col items-center justify-center text-center relative overflow-hidden group">
                      <input type="file" multiple accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={handleFileChange} />
                      <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                        <Upload className="w-8 h-8 text-zinc-400" />
                      </div>
                      <h2 className="text-xl font-bold">Your closet is empty</h2>
                      <p className="text-zinc-500 mt-2 max-w-xs text-sm">Tap here to upload photos of your clothes to start building your AI wardrobe.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-6">
                      {wardrobe
                        .filter(item => wardrobeFilter === 'all' || item.category === wardrobeFilter)
                        .map(item => (
                        <motion.div 
                          layout 
                          key={item.id} 
                          onClick={() => setSelectedOutfitItem(item)}
                          className="group relative aspect-[3/4] rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 shadow-lg cursor-pointer"
                        >
                          <img src={item.imageUrl} alt={item.type} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" referrerPolicy="no-referrer" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-3 flex flex-col justify-end">
                            <p className="text-xs font-bold uppercase tracking-wider text-white">{item.type}</p>
                            <p className="text-[10px] text-zinc-300">{item.color} • {item.vibe}</p>
                            <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingItemId(item.id);
                                  setCropImage(item.imageUrl);
                                }} 
                                className="p-2.5 rounded-xl bg-black/50 backdrop-blur-md text-white hover:bg-indigo-600 active:scale-90"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteItem(item.id);
                                }} 
                                className="p-2.5 rounded-xl bg-black/50 backdrop-blur-md text-white hover:bg-red-500 active:scale-90"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-6">
                  {outfits.length === 0 ? (
                    <div className="p-12 md:p-20 rounded-3xl border-2 border-dashed border-zinc-800 bg-zinc-900/50 flex flex-col items-center justify-center text-center">
                      <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center mb-4">
                        <Heart className="w-8 h-8 text-zinc-600" />
                      </div>
                      <h2 className="text-xl font-bold">No saved outfits yet</h2>
                      <p className="text-zinc-500 mt-2 max-w-xs text-sm">Generate an outfit in the Style tab and save it to see it here.</p>
                      <button 
                        onClick={() => setActiveTab('generator')}
                        className="mt-6 px-8 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all active:scale-95"
                      >
                        Go to Style
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {outfits.map((outfit) => (
                        <motion.div 
                          key={outfit.id}
                          layout
                          className="bg-zinc-900 border border-zinc-800 rounded-[2.5rem] overflow-hidden group hover:border-zinc-700 transition-all flex flex-col"
                        >
                          <div className="p-6 flex-1 space-y-4">
                            <div className="flex justify-between items-start">
                              <div>
                                <h3 className="font-bold text-lg">{outfit.occasion}</h3>
                                <p className="text-xs text-zinc-500">{new Date(outfit.date).toLocaleDateString()}</p>
                              </div>
                              <button 
                                onClick={() => deleteOutfit(outfit.id)}
                                className="p-2 rounded-xl bg-zinc-800 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                            
                            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                              {outfit.items.map((item) => (
                                <div key={item.id} className="w-16 h-20 shrink-0 rounded-lg overflow-hidden border border-zinc-800">
                                  <img src={item.imageUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                </div>
                              ))}
                            </div>

                            {outfit.explanation && (
                              <p className="text-xs text-zinc-400 line-clamp-2 italic">"{outfit.explanation}"</p>
                            )}
                          </div>
                          
                          <button 
                            onClick={() => {
                              setCurrentOutfit({
                                items: outfit.items,
                                explanation: outfit.explanation || '',
                                upliftAdvice: outfit.upliftAdvice || ''
                              });
                              setActiveTab('generator');
                            }}
                            className="w-full py-4 bg-zinc-800/50 hover:bg-indigo-600/10 hover:text-indigo-400 text-zinc-400 text-xs font-bold uppercase tracking-widest border-t border-zinc-800 transition-all"
                          >
                            View on Canvas
                          </button>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'generator' && (
            <motion.div 
              key="generator" 
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: -10 }} 
              className={cn(
                "transition-all duration-500",
                currentOutfit ? "space-y-0 min-h-0" : "space-y-8 min-h-[70vh]"
              )}
            >
              {!currentOutfit ? (
                <>
                  <header>
                    <h1 className="text-3xl font-bold">Outfit Generator</h1>
                    <p className="text-zinc-400">Let AI curate the perfect look from your wardrobe</p>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-1 space-y-6">
                      <div className="p-6 rounded-3xl bg-zinc-900 border border-zinc-800 space-y-4">
                        <div className="space-y-4">
                          <div>
                            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block mb-2 ml-1">Occasion</label>
                            <select id="occasion" className="w-full bg-zinc-800/50 border border-zinc-700 rounded-2xl p-4 text-lg font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none cursor-pointer">
                              <option>Casual Day Out</option>
                              <option>Gym / Workout</option>
                              <option>Formal Event</option>
                              <option>Date Night</option>
                              <option>Office / Work</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block mb-2 ml-1">Weather</label>
                            <select id="weather" className="w-full bg-zinc-800/50 border border-zinc-700 rounded-2xl p-4 text-lg font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none cursor-pointer">
                              <option>Sunny & Warm</option>
                              <option>Cold & Rainy</option>
                              <option>Snowy</option>
                              <option>Mild / Spring</option>
                            </select>
                          </div>
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

                    <div className="md:col-span-2 flex items-center justify-center p-12 border-2 border-dashed border-zinc-800 rounded-[3rem] bg-zinc-900/20">
                      <div className="text-center space-y-4">
                        <div className="w-20 h-20 bg-zinc-800 rounded-full flex items-center justify-center mx-auto">
                          <Shirt className="w-10 h-10 text-zinc-600" />
                        </div>
                        <h3 className="text-xl font-bold text-zinc-400">Ready to Style</h3>
                        <p className="text-zinc-500 max-w-xs mx-auto">Select an occasion and weather to see your AI-curated outfit.</p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className={cn(
                  "relative w-full overflow-hidden bg-zinc-950 transition-all duration-500",
                  "h-[90vh] md:rounded-none border-none shadow-none"
                )}>
                  {/* Canvas Area */}
                  <div className="absolute inset-0 p-4 md:p-8 touch-none">
                    <div className="absolute top-6 left-8 z-50">
                      <button 
                        onClick={() => setCurrentOutfit(null)}
                        className="flex items-center gap-2 px-4 py-2 bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-xl text-xs font-bold uppercase tracking-widest text-zinc-400 hover:text-white transition-colors"
                      >
                        <ChevronRight className="w-4 h-4 rotate-180" />
                        New Outfit
                      </button>
                    </div>

                    <div className="w-full h-full relative">
                      {currentOutfit.items.map((item, index) => (
                        <motion.div
                          key={item.id}
                          drag
                          dragMomentum={false}
                          onTap={() => setSelectedOutfitItem(item)}
                          initial={{ 
                            x: outfitPositions[item.id]?.x || 0, 
                            y: outfitPositions[item.id]?.y || 0,
                            scale: 0.8,
                            opacity: 0
                          }}
                          animate={{ 
                            scale: 1, 
                            opacity: 1,
                            transition: { delay: index * 0.1 }
                          }}
                          className="absolute cursor-grab active:cursor-grabbing z-10"
                          style={{ width: 140 }}
                        >
                          <div className="relative group">
                            <img 
                              src={item.imageUrl} 
                              className="w-full aspect-[3/4] object-cover rounded-2xl shadow-2xl border-2 border-zinc-800/50 group-hover:border-indigo-500/50 transition-colors" 
                              referrerPolicy="no-referrer"
                            />
                            <div className="absolute -bottom-2 -right-2 bg-zinc-900 border border-zinc-800 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider text-zinc-400 shadow-xl">
                              {item.type}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Overlay Buttons & Info */}
                  <div className="absolute bottom-8 left-6 right-6 flex flex-col items-center gap-4 z-50">
                    <div className="flex gap-2 p-1 bg-zinc-900/90 backdrop-blur-xl rounded-2xl border border-zinc-800 shadow-2xl">
                      <button 
                        onClick={() => setGeneratorAdviceTab(generatorAdviceTab === 'info' ? null : 'info')}
                        className={cn(
                          "px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2",
                          generatorAdviceTab === 'info' ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" : "text-zinc-500 hover:text-zinc-300"
                        )}
                      >
                        <Info className="w-4 h-4" />
                        Info
                      </button>
                      <button 
                        onClick={() => setGeneratorAdviceTab(generatorAdviceTab === 'uplift' ? null : 'uplift')}
                        className={cn(
                          "px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2",
                          generatorAdviceTab === 'uplift' ? "bg-amber-500 text-white shadow-lg shadow-amber-500/20" : "text-zinc-500 hover:text-zinc-300"
                        )}
                      >
                        <Sparkles className="w-4 h-4" />
                        Advice
                      </button>
                      <button 
                        onClick={saveOutfit}
                        className="px-6 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center gap-2 text-zinc-500 hover:text-white"
                      >
                        <Heart className="w-4 h-4" />
                        Save
                      </button>
                    </div>

                    <AnimatePresence mode="wait">
                      {generatorAdviceTab && (
                        <motion.div 
                          key={generatorAdviceTab}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 20 }}
                          className="w-full max-w-lg p-6 rounded-3xl bg-zinc-900/90 backdrop-blur-xl border border-zinc-800 shadow-2xl relative"
                        >
                          <button 
                            onClick={() => setGeneratorAdviceTab(null)}
                            className="absolute top-4 right-4 p-1 text-zinc-500 hover:text-white transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                          
                          {generatorAdviceTab === 'info' ? (
                            <>
                              <h3 className="text-sm font-bold text-indigo-400 mb-2 uppercase tracking-widest">Why this works</h3>
                              <p className="text-zinc-300 leading-relaxed text-sm">{currentOutfit.explanation}</p>
                            </>
                          ) : (
                            <>
                              <h3 className="text-sm font-bold text-amber-500 mb-2 uppercase tracking-widest">Pro Styling Tip</h3>
                              <p className="text-zinc-300 leading-relaxed text-sm">{currentOutfit.upliftAdvice}</p>
                            </>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
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
                  <div className="flex items-center justify-between p-4 rounded-2xl bg-zinc-800/50 border border-zinc-700">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-3 h-3 rounded-full", hasApiKey ? "bg-green-500" : "bg-red-500")} />
                      <span className="text-sm font-medium">Gemini API Status</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-zinc-500">
                        {hasApiKey ? "Configured" : "Missing Key"}
                      </span>
                      {window.aistudio && (
                        <button 
                          onClick={() => window.aistudio.openSelectKey()}
                          className="text-[10px] px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded-md text-zinc-300 transition-colors"
                        >
                          Change Key
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div>
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block mb-2 ml-1">Style Vibe</label>
                      <input 
                        type="text" 
                        value={prefs.style} 
                        onChange={(e) => setPrefs(prev => ({ ...prev, style: e.target.value }))}
                        className="w-full bg-zinc-800/50 border border-zinc-700 rounded-2xl p-4 text-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        placeholder="e.g. Minimal Streetwear"
                      />
                    </div>
                    
                    <div>
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block mb-2 ml-1">Fit Preference</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['Oversized', 'Slim Fit', 'Regular', 'Athletic'].map((fit) => (
                          <button
                            key={fit}
                            onClick={() => setPrefs(prev => ({ ...prev, fitPreference: fit }))}
                            className={cn(
                              "py-3 rounded-xl text-sm font-bold transition-all border",
                              prefs.fitPreference === fit 
                                ? "bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/20" 
                                : "bg-zinc-800/50 border-zinc-700 text-zinc-400"
                            )}
                          >
                            {fit}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest block mb-2 ml-1">Favorite Colors</label>
                      <input 
                        type="text" 
                        value={prefs.favoriteColors.join(', ')} 
                        onChange={(e) => setPrefs(prev => ({ ...prev, favoriteColors: e.target.value.split(',').map(s => s.trim()) }))}
                        className="w-full bg-zinc-800/50 border border-zinc-700 rounded-2xl p-4 text-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        placeholder="e.g. Black, White, Navy"
                      />
                    </div>
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
        "flex flex-col items-center gap-1.5 transition-all group min-w-[64px] py-1",
        active ? "text-indigo-400" : "text-zinc-500 hover:text-zinc-300"
      )}
    >
      <div className={cn(
        "p-2.5 rounded-2xl transition-all",
        active ? "bg-indigo-500/10" : "group-hover:bg-zinc-800"
      )}>
        {React.cloneElement(icon as React.ReactElement, { className: "w-6 h-6" })}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}
