export interface ClothingItem {
  id: string;
  type: string;
  color: string;
  vibe: string;
  imageUrl: string;
  category: 'top' | 'bottom' | 'shoes' | 'outerwear' | 'accessory';
}

export interface Outfit {
  id: string;
  items: ClothingItem[];
  rating?: number;
  notes?: string;
  occasion: string;
  weather: string;
  date: string;
}

export interface UserPreferences {
  style: string;
  favoriteColors: string[];
  fitPreference: string;
}
