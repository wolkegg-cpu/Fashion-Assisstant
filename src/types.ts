export interface ClothingItem {
  id: string;
  type: string;
  color: string;
  vibe: string;
  imageUrl: string;
  category: 'top' | 'bottom' | 'shoes' | 'outerwear' | 'accessory';
  description?: string;
}

export interface Outfit {
  id: string;
  items: ClothingItem[];
  rating?: number;
  notes?: string;
  occasion: string;
  weather: string;
  date: string;
  explanation?: string;
  upliftAdvice?: string;
}

export interface UserPreferences {
  style: string;
  favoriteColors: string[];
  fitPreference: string;
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
