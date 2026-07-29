import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function ProtectedRoute({ children, requireProfile = true }) {
  const { firebaseUser, profile, loading } = useAuth();

  if (loading) return <div className="page-center">Loading...</div>;
  if (!firebaseUser) return <Navigate to="/login" replace />;
  if (requireProfile && !profile) return <Navigate to="/onboarding" replace />;

  return children;
}
