"""Service Pengendali Fase Lampu & Automated Green Corridor (Fitur 9)."""
from typing import Dict, List, Optional
from app.core.timeutil import utcnow

# Menyimpan koridor darurat yang sedang aktif (key: emergency_id)
ACTIVE_CORRIDORS: Dict[str, dict] = {}

# Menyimpan status intervensi lampu per simpang (key: simpang_id)
INTERSECTION_OVERRIDES: Dict[str, dict] = {}


def activate_green_corridor(
    emergency_id: str,
    vehicle_type: str,
    route_intersections: List[str],
    triggered_by: str,
) -> dict:
    """Mengunci lampu lalu lintas menjadi HIJAU di sepanjang rute persimpangan darurat."""
    timestamp = utcnow().isoformat()

    # Jika emergency_id lama masih aktif, bersihkan simpang lamanya dulu sebelum timpa
    if emergency_id in ACTIVE_CORRIDORS:
        release_green_corridor(emergency_id)

    for idx, simpang_id in enumerate(route_intersections):
        clean_id = simpang_id.strip().upper()
        INTERSECTION_OVERRIDES[clean_id] = {
            "mode": "EMERGENCY_OVERRIDE",
            "emergency_id": emergency_id,
            "vehicle_type": vehicle_type,
            "active_phase": "GREEN",
            "cross_street_phase": "RED",
            "sequence_order": idx + 1,
            "updated_at": timestamp,
        }

    corridor_record = {
        "emergency_id": emergency_id,
        "vehicle_type": vehicle_type,
        "route_intersections": [s.strip().upper() for s in route_intersections],
        "status": "ACTIVE",
        "triggered_by": triggered_by,
        "activated_at": timestamp,
    }
    ACTIVE_CORRIDORS[emergency_id] = corridor_record
    return corridor_record


def release_green_corridor(emergency_id: str) -> Optional[dict]:
    """Mengembalikan siklus lampu persimpangan ke mode AI adaptif normal."""
    corridor = ACTIVE_CORRIDORS.pop(emergency_id, None)
    if corridor is None:
        return None

    for simpang_id in corridor["route_intersections"]:
        override = INTERSECTION_OVERRIDES.get(simpang_id)
        if override and override.get("emergency_id") == emergency_id:
            INTERSECTION_OVERRIDES.pop(simpang_id, None)

    corridor["status"] = "RELEASED"
    corridor["released_at"] = utcnow().isoformat()
    return corridor


def get_intersection_override(simpang_id: str) -> Optional[dict]:
    """Helper untuk mengecek apakah suatu simpang sedang dalam mode Green Corridor."""
    return INTERSECTION_OVERRIDES.get(simpang_id.strip().upper())