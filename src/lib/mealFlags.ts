export const mealFlags = [
  { id: 'vegetarian', label: 'Vegetarian', icon: 'flower-outline' },
  { id: 'vegan', label: 'Vegan', icon: 'leaf-outline' },
  { id: 'spicy', label: 'Spicy', icon: 'flame-outline' },
  { id: 'gluten_free', label: 'Gluten-free', icon: 'nutrition-outline' },
  { id: 'dairy_free', label: 'Dairy-free', icon: 'cafe-outline' },
] as const;
export type MealFlag = (typeof mealFlags)[number]['id'];
