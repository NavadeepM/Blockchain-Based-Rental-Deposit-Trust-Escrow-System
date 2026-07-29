import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../firebase.js";
import api from "../services/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [wallet, setWallet] = useState(null); // { provider, signer, address }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const { data } = await api.get("/auth/me");
          setProfile(data.user);
        } catch {
          setProfile(null); // not onboarded yet
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  async function refreshProfile() {
    try {
      const { data } = await api.get("/auth/me");
      setProfile(data.user);
    } catch {
      setProfile(null);
    }
  }

  async function logout() {
    await signOut(auth);
    setWallet(null);
  }

  return (
    <AuthContext.Provider
      value={{ firebaseUser, profile, setProfile, refreshProfile, wallet, setWallet, loading, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
