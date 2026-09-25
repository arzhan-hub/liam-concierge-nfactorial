// Shared by booking enforcement and read-only planning tools.
export const DELIVERY_LIMITS = {
  parcels: 20,
  weight_lbs: 150,
  parcels_per_resident: 3,
} as const;
