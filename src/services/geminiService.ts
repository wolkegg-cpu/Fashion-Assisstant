import { GoogleGenAI, Type } from "@google/genai";
import { ClothingItem, UserPreferences } from "../types";

const getAI = () => {
  const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
  return new GoogleGenAI({ apiKey });
};

const withRetry = async <T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const isRateLimit = error.message?.includes("429") || error.message?.toLowerCase().includes("rate limit") || error.message?.toLowerCase().includes("quota");
    if (retries > 0 && isRateLimit) {
      console.warn(`Rate limit hit, retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return withRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

export const tagClothingItem = async (base64Image: string): Promise<Partial<ClothingItem>> => {
  return withRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: "Analyze this clothing item and return its type, color, vibe, category (top, bottom, shoes, outerwear, accessory), and a brief, catchy description (max 15 words) in JSON format." },
            { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING },
            color: { type: Type.STRING },
            vibe: { type: Type.STRING },
            category: { type: Type.STRING, enum: ["top", "bottom", "shoes", "outerwear", "accessory"] },
            description: { type: Type.STRING }
          },
          required: ["type", "color", "vibe", "category", "description"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  });
};

export const generateOutfit = async (
  wardrobe: ClothingItem[],
  preferences: UserPreferences,
  occasion: string,
  weather: string
): Promise<{ itemIds: string[]; explanation: string; upliftAdvice: string }> => {
  return withRetry(async () => {
    const ai = getAI();
    const wardrobeDescription = wardrobe.map(item => 
      `ID: ${item.id}, Type: ${item.type}, Color: ${item.color}, Vibe: ${item.vibe}, Category: ${item.category}`
    ).join("\n");

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        You are a personal stylist.
        User Wardrobe:
        ${wardrobeDescription}

        User Preferences:
        Style: ${preferences.style}
        Favorite Colors: ${preferences.favoriteColors.join(", ")}
        Fit Preference: ${preferences.fitPreference}

        Occasion: ${occasion}
        Weather: ${weather}

        Create a clean outfit using items from the wardrobe. 
        Return the IDs of the items, an explanation of why it works, and specific "uplift advice" on how to take the outfit to the next level (e.g., accessories to add, how to tuck the shirt, or grooming tips) in JSON format.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            itemIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            explanation: { type: Type.STRING },
            upliftAdvice: { type: Type.STRING }
          },
          required: ["itemIds", "explanation", "upliftAdvice"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  });
};

export const rateOutfit = async (
  base64Image: string,
  preferences: UserPreferences
): Promise<{ rating: number; feedback: string }> => {
  return withRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            { text: `Rate this outfit from 1-10 and provide feedback based on the user's style preference: ${preferences.style}. Focus on fit, color balance, and style. Return in JSON format.` },
            { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rating: { type: Type.NUMBER },
            feedback: { type: Type.STRING }
          },
          required: ["rating", "feedback"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  });
};

export const updatePreferencesFromItem = async (
  currentPrefs: UserPreferences,
  newItem: Partial<ClothingItem>
): Promise<UserPreferences> => {
  return withRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        Current User Preferences:
        Style: ${currentPrefs.style}
        Favorite Colors: ${currentPrefs.favoriteColors.join(", ")}
        Fit Preference: ${currentPrefs.fitPreference}

        New Clothing Item Added:
        Type: ${newItem.type}
        Color: ${newItem.color}
        Vibe: ${newItem.vibe}
        Category: ${newItem.category}

        Based on this new item, should the user's style preferences be updated? 
        If the new item represents a shift or addition to their style, update the preferences.
        Return the updated UserPreferences in JSON format.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            style: { type: Type.STRING },
            favoriteColors: { type: Type.ARRAY, items: { type: Type.STRING } },
            fitPreference: { type: Type.STRING }
          },
          required: ["style", "favoriteColors", "fitPreference"]
        }
      }
    });

    return JSON.parse(response.text || "{}");
  });
};

export const magicCutClothingItem = async (
  base64Image: string,
  selectionPath: { x: number; y: number }[]
): Promise<string> => {
  return withRetry(async () => {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [
        {
          parts: [
            { 
              text: `I have selected an area in this image. Please identify the clothing item within or near the selection and "cut it out" by removing the background completely. 
              Return ONLY the isolated clothing item as a sticker on a plain, solid white background. 
              Do not include any other objects or people.
              The selection path coordinates (normalized 0-1000) are: ${JSON.stringify(selectionPath)}` 
            },
            { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
          ]
        }
      ],
      config: {
        imageConfig: {
          aspectRatio: "3:4"
        }
      }
    });

    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }

    throw new Error("Gemini failed to generate the cut-out image. Please try selecting the item more clearly.");
  });
};
