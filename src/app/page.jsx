'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const DashboardContent = dynamic(() => import('./DashboardContent'), {
  ssr: false,
  loading: () => (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      gap: '1rem',
      backgroundColor: '#f8fafc',
      fontFamily: 'sans-serif'
    }}>
      <div style={{
        width: '40px',
        height: '40px',
        border: '3px solid rgba(37, 99, 235, 0.1)',
        borderRadius: '50%',
        borderTopColor: '#2563eb',
        animation: 'spin 1s linear infinite'
      }}></div>
      <p style={{ color: '#64748b', fontSize: '0.95rem' }}>Cargando panel de administración...</p>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
});

export default function Page() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Verificar si el usuario ya está autenticado en localStorage
    const auth = localStorage.getItem('rindegastos_auth');
    if (auth === 'true') {
      setIsAuthenticated(true);
    }
    setCheckingAuth(false);
  }, []);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username === 'contabilidad' && password === 'Bliss$2026') {
      localStorage.setItem('rindegastos_auth', 'true');
      setIsAuthenticated(true);
      setError('');
    } else {
      setError('Credenciales incorrectas. Inténtalo de nuevo.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('rindegastos_auth');
    setIsAuthenticated(false);
    setUsername('');
    setPassword('');
  };

  if (checkingAuth) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#F6F1EA'
      }}>
        <div style={{
          width: '30px',
          height: '30px',
          border: '3px solid rgba(14, 42, 67, 0.1)',
          borderRadius: '50%',
          borderTopColor: '#0E2A43',
          animation: 'spin 1s linear infinite'
        }}></div>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#F6F1EA',
        fontFamily: '"Inter", -apple-system, "Segoe UI", Roboto, sans-serif',
        padding: '1.5rem'
      }}>
        <div style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: '#FFFFFF',
          border: '1px solid #E1DACD',
          borderRadius: '14px',
          padding: '2.5rem 2.25rem',
          boxShadow: '0 12px 32px rgba(14, 42, 67, 0.16)',
          boxSizing: 'border-box'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '2.25rem' }}>
            <div style={{
              width: '60px',
              height: '60px',
              backgroundColor: '#0E2A43',
              color: '#ffffff',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.35rem',
              fontWeight: '700',
              margin: '0 auto 1.25rem',
              letterSpacing: '-0.02em',
              boxShadow: '0 8px 20px -4px rgba(14, 42, 67, 0.35)'
            }}>
              PF
            </div>
            <h2 style={{
              margin: '0 0 0.5rem 0',
              color: '#0E2A43',
              fontSize: '1.4rem',
              fontWeight: '700',
              letterSpacing: '-0.02em'
            }}>
              Portal Finanzas
            </h2>
            <p style={{
              margin: 0,
              color: '#4B5768',
              fontSize: '0.875rem',
              lineHeight: '1.5'
            }}>
              Portal de Administración y Control de Finanzas
            </p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label htmlFor="username" style={{
                fontSize: '0.75rem',
                fontWeight: '700',
                color: '#4B5768',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Usuario (ID)
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="Ingresa tu usuario"
                style={{
                  padding: '0.75rem 1rem',
                  border: '1px solid #E1DACD',
                  borderRadius: '10px',
                  fontSize: '0.95rem',
                  color: '#1A2430',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  backgroundColor: '#FFFFFF'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#0E2A43';
                  e.target.style.boxShadow = '0 0 0 3px rgba(14, 42, 67, 0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#E1DACD';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label htmlFor="password" style={{
                fontSize: '0.75rem',
                fontWeight: '700',
                color: '#4B5768',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{
                  padding: '0.75rem 1rem',
                  border: '1px solid #E1DACD',
                  borderRadius: '10px',
                  fontSize: '0.95rem',
                  color: '#1A2430',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  backgroundColor: '#FFFFFF'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#0E2A43';
                  e.target.style.boxShadow = '0 0 0 3px rgba(14, 42, 67, 0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#E1DACD';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            {error && (
              <div style={{
                backgroundColor: '#FDE7E5',
                border: '1px solid rgba(185, 28, 28, 0.2)',
                borderRadius: '10px',
                padding: '0.75rem 1rem',
                color: '#B91C1C',
                fontSize: '0.85rem',
                textAlign: 'center',
                fontWeight: '500',
                lineHeight: '1.4'
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              style={{
                backgroundColor: '#0E2A43',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '10px',
                padding: '0.85rem',
                fontSize: '0.95rem',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 4px 12px rgba(14, 42, 67, 0.25)',
                marginTop: '0.5rem',
                letterSpacing: '0.01em'
              }}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = '#153A5A';
                e.target.style.boxShadow = '0 6px 16px rgba(14, 42, 67, 0.35)';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = '#0E2A43';
                e.target.style.boxShadow = '0 4px 12px rgba(14, 42, 67, 0.25)';
              }}
            >
              Ingresar al Sistema
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <DashboardContent onLogout={handleLogout} />;
}
