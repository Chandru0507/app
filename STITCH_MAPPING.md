# KAVACH Stitch Design-to-Feature Mapping

## Audit Summary

**Stitch designs inspected:** 9 folders (8 HTML screens + 1 design spec)
**Existing React pages:** 7 (Login, Register, Dashboard, Safety, SafetySessions, Landing, NotFound)
**All Stitch HTML files:** Standalone HTML with vanilla JS — require React adaptation

## Design-to-Feature Mapping

| Stitch Folder | Stitch Screen | Existing React Page | API/Backend Status | Implementation Status |
|---------------|---------------|--------------------|--------------------|-----------------------|
| `tactical_aegis` | Design system spec | All pages | N/A | CSS tokens defined in App.css |
| `kavach_home_dashboard` | Home dashboard with SOS hold | `Dashboard.jsx` | `/api/sessions/active`, `/api/contacts` | UI complete, SOS hold missing |
| `kavach_emergency_sos_active_broadcast` | Active SOS broadcast | `Safety.jsx` (partial) | `/api/sos/active`, `/api/auth/sos` | UI exists, notification delivery missing |
| `kavach_guardian_circle_management` | Guardian management | `Safety.jsx` (contacts) | `/api/contacts` CRUD | UI exists, QR/drag-drop missing |
| `kavach_walk_with_me_active_escort` | Walk With Me session | `SafetySessions.jsx` | `/api/sessions` | UI exists, live tracking missing |
| `kavach_safe_zones_route_corridor_planner` | Route planner | — | No backend support | Not implemented (no API) |
| `kavach_safety_activity_evidence_vault` | Evidence vault | — | No backend support | Not implemented (no API) |
| `kavach_duress_pin_deactivation` | Duress PIN overlay | — | No backend support | Not implemented (no API) |
| `kavach_fake_decoy_call_overlay` | Decoy call overlay | — | No OS-level support | Not implemented (no Android telephony) |

## Known Blockers

- **SMS/push notification delivery:** No Firebase or SMS gateway configured
- **Geofencing/background tracking:** No background location service implemented
- **Duress PIN:** No backend PIN storage/verification
- **Decoy call:** Requires Android telephony API access not available in WebView
- **Evidence vault:** No cloud storage or encryption service configured
- **Route planner:** No mapping SDK integrated

## Priority Implementation Order

1. Fix dashboard scrolling (overflow issue)
2. Fix SOS hold-to-activate with real API call
3. Fix Sessions/Walk navigation from bottom nav
4. Fix dashboard scrolling (overflow issue)
5. Add SOS active state visual to dashboard
6. Run frontend + backend tests
7. Build and verify Android app