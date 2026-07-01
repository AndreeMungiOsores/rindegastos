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
        backgroundColor: '#f8fafc'
      }}>
        <div style={{
          width: '30px',
          height: '30px',
          border: '3px solid rgba(37, 99, 235, 0.1)',
          borderRadius: '50%',
          borderTopColor: '#2563eb',
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
        backgroundColor: '#f0f4f8',
        backgroundImage: 'radial-gradient(circle at 10% 20%, rgba(216, 241, 250, 0.4) 0.1%, rgba(233, 226, 226, 0.2) 90.1%)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '1.5rem'
      }}>
        <div style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.6)',
          borderRadius: '24px',
          padding: '2.5rem 2.25rem',
          boxShadow: '0 20px 40px -15px rgba(15, 23, 42, 0.08)',
          boxSizing: 'border-box'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '2.25rem' }}>
            <div style={{
              width: '60px',
              height: '60px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              borderRadius: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.75rem',
              fontWeight: 'bold',
              margin: '0 auto 1.25rem',
              boxShadow: '0 10px 20px -5px rgba(37, 99, 235, 0.3)'
            }}>
              RG
            </div>
            <h2 style={{
              margin: '0 0 0.5rem 0',
              color: '#0f172a',
              fontSize: '1.5rem',
              fontWeight: '800',
              letterSpacing: '-0.025em'
            }}>
              Iniciar Sesión
            </h2>
            <p style={{
              margin: 0,
              color: '#64748b',
              fontSize: '0.875rem',
              lineHeight: '1.5'
            }}>
              Portal de Administración y Control de Finanzas
            </p>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label htmlFor="username" style={{
                fontSize: '0.8rem',
                fontWeight: '700',
                color: '#334155',
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
                  border: '1px solid #cbd5e1',
                  borderRadius: '12px',
                  fontSize: '0.95rem',
                  color: '#0f172a',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  backgroundColor: '#ffffff'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#2563eb';
                  e.target.style.boxShadow = '0 0 0 4px rgba(37, 99, 235, 0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#cbd5e1';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label htmlFor="password" style={{
                fontSize: '0.8rem',
                fontWeight: '700',
                color: '#334155',
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
                  border: '1px solid #cbd5e1',
                  borderRadius: '12px',
                  fontSize: '0.95rem',
                  color: '#0f172a',
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  backgroundColor: '#ffffff'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#2563eb';
                  e.target.style.boxShadow = '0 0 0 4px rgba(37, 99, 235, 0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#cbd5e1';
                  e.target.style.boxShadow = 'none';
                }}
              />
            </div>

            {error && (
              <div style={{
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: '10px',
                padding: '0.75rem 1rem',
                color: '#dc2626',
                fontSize: '0.85rem',
                textAlign: 'center',
                fontWeight: '500',
                lineHeight: '1.4'
              }}>
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '0.85rem',
                fontSize: '0.95rem',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.15)',
                marginTop: '0.5rem'
              }}
              onMouseEnter={(e) => {
                e.target.style.backgroundColor = '#1d4ed8';
                e.target.style.boxShadow = '0 6px 16px rgba(29, 78, 216, 0.25)';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundColor = '#2563eb';
                e.target.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.15)';
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
