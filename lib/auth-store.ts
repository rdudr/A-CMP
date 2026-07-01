import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// Pre-defined users — add more here as needed
// Passwords are stored as plain text for offline use (no server)
const OFFLINE_USERS: Record<string, { displayName: string; password: string }> = {
  "ABHAY": { displayName: "Abhay", password: "IITGN1" },
  "RAHULPATEL": { displayName: "Rahulpatel", password: "IITGN4" },
  "DHRUVIT": { displayName: "DhruvIT", password: "IITGN2" },
  "SAGAR": { displayName: "Sagar", password: "IITGN8" },
  "RISHABH": { displayName: "Rishabh", password: "IITGN9" },
  "FAIZAN": { displayName: "Faizan", password: "IITGN5" },
};

type AuthState = {
  userId: string | null;
  displayName: string | null;
  loggedInAt: number | null;

  login: (username: string, password: string) => boolean;
  logout: () => void;
  isAuthenticated: () => boolean;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      userId: null,
      displayName: null,
      loggedInAt: null,

      login: (username, password) => {
        const user = OFFLINE_USERS[username.trim().toUpperCase()];
        if (!user || user.password !== password.trim()) return false;
        set({ userId: username, displayName: user.displayName, loggedInAt: Date.now() });
        return true;
      },

      logout: () => set({ userId: null, displayName: null, loggedInAt: null }),

      isAuthenticated: () => {
        const { userId, loggedInAt } = get();
        if (!userId || !loggedInAt) return false;
        // 8-hour session expiry
        const eightHours = 8 * 60 * 60 * 1000;
        return Date.now() - loggedInAt < eightHours;
      },
    }),
    {
      name: "a-cmp-auth",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
