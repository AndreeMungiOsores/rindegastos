// Categorías de servicio de Cabify Empresas, tal como las reporta el Excel mensual ("Tipo de vehículo") y el catálogo de la API.
// Sin dependencias de servidor para poder usarlo en componentes de cliente.

const SERVICE_TYPES = {
  'Cabify Corp': { label: 'Cabify Corp', tone: 'corp' },
  'Cabify Corp*': { label: 'Cabify Corp*', tone: 'corp-star' },
  'Cabify Extra Comfort Corp': { label: 'Extra Comfort Corp', tone: 'comfort' },
  'Cabify Corp Aeropuerto': { label: 'Aeropuerto Corp', tone: 'airport' },
  'Envíos en motos Corp': { label: 'Envío en moto', tone: 'delivery' },
  'Envíos en carro Corp': { label: 'Envío en carro', tone: 'delivery' }
};

/**
 * Etiqueta corta, tono visual y nombre oficial de la categoría de un viaje.
 * @param {string | null | undefined} vehicleType valor de `vehicle_type` (nombre oficial de Cabify)
 * @returns {{ label: string, tone: string, full: string }}
 */
export function describeServiceType(vehicleType) {
  const known = vehicleType ? SERVICE_TYPES[vehicleType] : null;
  if (known) return { ...known, full: vehicleType };
  return { label: vehicleType || 'Sin clasificar', tone: 'unknown', full: vehicleType || 'Sin clasificar' };
}
