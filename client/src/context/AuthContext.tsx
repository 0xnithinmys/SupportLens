import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';
import type { AuthResponse, UserRole } from '../types';

interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

interface AuthMeResponse {
  user: AuthUser | (Omit<AuthUser, 'id'> & { sub: string });
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('aq_token'));
  const [isLoading, setIsLoading] = useState<boolean>(() => !!localStorage.getItem('aq_token'));

  // Restore user from stored token on mount
  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    api.get<AuthMeResponse>('/auth/me')
      .then(({ user: u }) => {
        setUser({
          id: 'id' in u ? u.id : u.sub,
          email: u.email,
          role: u.role,
        });
      })
      .catch(() => {
        localStorage.removeItem('aq_token');
        setToken(null);
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const data = await api.post<AuthResponse>('/auth/login', { email, password });
    localStorage.setItem('aq_token', data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback((): void => {
    localStorage.removeItem('aq_token');
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!user, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
