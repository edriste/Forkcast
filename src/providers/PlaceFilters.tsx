import React, { createContext, useContext, useState } from 'react';
const Context = createContext<{
  category: string;
  setCategory: (value: string) => void;
  maximumDistance: number;
  setMaximumDistance: (value: number) => void;
  sort: 'rating' | 'nearest';
  setSort: (value: 'rating' | 'nearest') => void;
  minimum: number;
  setMinimum: (value: number) => void;
} | null>(null);
export function PlaceFiltersProvider({ children }: React.PropsWithChildren) {
  const [category, setCategory] = useState('All');
  const [minimum, setMinimum] = useState(0);
  const [maximumDistance, setMaximumDistance] = useState(0);
  const [sort, setSort] = useState<'rating' | 'nearest'>('rating');
  return (
    <Context.Provider
      value={{
        category,
        setCategory,
        minimum,
        setMinimum,
        maximumDistance,
        setMaximumDistance,
        sort,
        setSort,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function usePlaceFilters() {
  return useContext(Context)!;
}
