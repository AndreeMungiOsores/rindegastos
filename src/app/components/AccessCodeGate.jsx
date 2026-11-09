'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Pantalla de código de acceso con casillas individuales para cada dígito.
 * Se valida solo al completar todas las casillas; si el código es incorrecto se limpian y se vuelve a la primera.
 * @param {{ title?: string, subtitle?: string, length?: number, expectedCode: string, onUnlock: () => void }} props
 */
export default function AccessCodeGate({ title = 'Ingresar código', subtitle = 'Esta sección está protegida', length = 4, expectedCode, onUnlock }) {
  const [digits, setDigits] = useState(() => Array(length).fill(''));
  const [error, setError] = useState(false);
  const inputs = useRef([]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  const verificar = (valores) => {
    const codigo = valores.join('');
    if (codigo.length < length || valores.some(v => v === '')) return;
    if (codigo === expectedCode) {
      onUnlock();
      return;
    }
    setError(true);
    setTimeout(() => {
      setDigits(Array(length).fill(''));
      setError(false);
      inputs.current[0]?.focus();
    }, 650);
  };

  const escribir = (indice, texto) => {
    const soloDigitos = texto.replace(/\D/g, '');
    if (!soloDigitos) return;
    const siguiente = [...digits];
    // Soporta pegar varios dígitos a la vez: se reparten desde la casilla actual
    soloDigitos.split('').slice(0, length - indice).forEach((d, k) => { siguiente[indice + k] = d; });
    setDigits(siguiente);
    const proxima = Math.min(indice + soloDigitos.length, length - 1);
    inputs.current[proxima]?.focus();
    verificar(siguiente);
  };

  const teclaAbajo = (indice, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const siguiente = [...digits];
      if (siguiente[indice]) {
        siguiente[indice] = '';
        setDigits(siguiente);
      } else if (indice > 0) {
        siguiente[indice - 1] = '';
        setDigits(siguiente);
        inputs.current[indice - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && indice > 0) {
      inputs.current[indice - 1]?.focus();
    } else if (e.key === 'ArrowRight' && indice < length - 1) {
      inputs.current[indice + 1]?.focus();
    }
  };

  return (
    <div className="access-gate" role="region" aria-label={title}>
      <div className="access-gate-card">
        <div className="access-gate-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="access-gate-title">{title}</h2>
        <p className="access-gate-subtitle">{subtitle}</p>

        <div className={`access-gate-boxes ${error ? 'shake' : ''}`} role="group" aria-label="Código de acceso">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => { inputs.current[i] = el; }}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={length}
              value={d}
              aria-label={`Dígito ${i + 1} de ${length}`}
              aria-invalid={error}
              className={`access-gate-box ${error ? 'error' : ''}`}
              onChange={e => escribir(i, e.target.value)}
              onKeyDown={e => teclaAbajo(i, e)}
              onFocus={e => e.target.select()}
            />
          ))}
        </div>

        <p className="access-gate-error" role="alert" aria-live="assertive">{error ? 'Código incorrecto. Inténtalo de nuevo.' : ' '}</p>
      </div>
    </div>
  );
}
