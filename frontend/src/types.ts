export type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: number;
    email: string;
    role: 'guest' | 'user' | 'admin';
  };
};

export type EmailCodePurpose = 'register' | 'login' | 'reset_password';

export type SendEmailCodeResponse = {
  ok: boolean;
  message: string;
  devCode?: string;
};

export type BodyAnalysisResult = {
  id: string;
  estimatedBodyFat?: number;
  estimatedMuscleMass?: number;
  aiNotes?: string;
};

export type Recommendation = {
  id: string;
  content: {
    summary?: string;
    actions?: string[];
  };
};

export type ChatMessage = {
  id: string;
  userId: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
};

export type FoodRecognitionItem = {
  foodName: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  allergensFound: string[];
  dietaryTags?: string[];
  ingredients?: Array<{ name: string; grams: number }>;
  ingredientsDetailed?: Array<{
    id?: string;
    name: string;
    grams?: number;
    amount?: number;
    unit?: string;
    originalString?: string;
    ingredientId?: string;
  }>;
};

export type FoodPreviewResponse = {
  confidence: number;
  items: FoodRecognitionItem[];
  allergenWarnings: string[];
  hasAllergenMatchInProfile: boolean;
  hasDetectedAllergensInDish: boolean;
  provider: string;
};

export type FoodMealSubmitResponse = {
  mealId: string;
  status: 'pending';
  message: string;
};

export type FoodRecognitionResponse = FoodPreviewResponse & {
  mealId?: string;
  queuedForModeration?: boolean;
  items: Array<FoodRecognitionItem & { id?: string }>;
};

export type BodyForecastResponse = {
  userId: string;
  durationWeeks: number;
  summary: string;
  milestones: Array<{ week: number; note: string }>;
  visualDescription: string;
  disclaimer: string;
  illustrationUrl: string;
  illustrationSource?: 'ai' | 'stock';
  lastAnalysisPhotoUrl: string | null;
};

export type BodyAnalysisPageState = {
  latestAnalysis: { photoUrl: string; analyzedAt: string; aiNotes?: string } | null;
  savedForecast: BodyForecastResponse | null;
  savedForecastWeeks: number | null;
  forecastUpdatedAt: string | null;
};
