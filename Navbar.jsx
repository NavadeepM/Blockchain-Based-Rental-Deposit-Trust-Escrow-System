import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Navbar() {
  const { firebaseUser, profile, wallet, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <nav className="navbar">
      <Link to="/" className="brand">TrustLock</Link>
      <div className="nav-links">
        {firebaseUser && profile && (
          <>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/agreements/new">New Agreement</Link>
            <Link to="/kyc">KYC</Link>
            <span className="wallet-pill">
              {wallet?.address ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}` : "No wallet"}
            </span>
            <button onClick={handleLogout} className="btn-link">Log out</button>
          </>
        )}
        {!firebaseUser && <Link to="/login">Log in</Link>}
      </div>
    </nav>
  );
}
