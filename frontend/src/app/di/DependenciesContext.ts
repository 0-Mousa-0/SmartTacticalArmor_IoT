import { createContext, useContext } from 'react';
import type { Dependencies } from './types';

export const DependenciesContext = createContext<Dependencies | null>(null);

export function useDependencies(): Dependencies {
  const dependencies = useContext(DependenciesContext);
  if (!dependencies) throw new Error('useDependencies must be used inside <DependenciesContext.Provider>');
  return dependencies;
}
