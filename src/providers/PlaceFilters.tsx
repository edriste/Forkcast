import React, { createContext, useContext, useState } from 'react';
const Context = createContext<{
  category: string;
  setCategory: (value: string) => void;
  minimum: number;
  setMinimum: (value: number) => void;
} | null>(null);
export function PlaceFiltersProvider({ children }: React.PropsWithChildren) {
  const [category, setCategory] = useState('All');
  const [minimum, setMinimum] = useState(0);
  return (
    <Context.Provider value={{ category, setCategory, minimum, setMinimum }}>
      {children}
    </Context.Provider>
  );
}
export function usePlaceFilters() {
  return useContext(Context)!;
}
