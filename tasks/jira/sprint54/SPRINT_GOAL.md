# Sprint 54 Goal

**Front/Backend Full Wiring: Markers + Friends + Auth token alignment**

Wire the real backend into every screen that still uses mock data or disconnected local state.
After this Sprint, every core user action (plant marker, view markers, add friend, accept friend) touches the real database.

## Stories

### STORY-00180: MapScreen — real markers from /api/markers
Replace MOCK_MARKERS with useMarkerStore hydrated from backend.
- Load markers from GET /api/markers on screen mount (with auth token)
- Plant marker → POST /api/markers
- Delete marker → DELETE /api/markers/:id
- Edit marker → PUT /api/markers/:id
- Local store stays as write-through cache (offline tolerance)

### STORY-00181: useFriendStore — use authenticatedFetch, align token
- Replace raw fetch + separate API_BASE with authenticatedFetch from apiService
- Wire sendFriendRequest / fetchFriendRequests / acceptFriendRequest into FriendsScreen UI buttons
- FriendsScreen Add Friend modal → calls sendFriendRequest

### STORY-00182: useMarkerStore sync layer
- Add syncToBackend() action: POST/PUT new or updated markers
- Add loadFromBackend() action: GET /api/markers, merge with local
- Wire hydrate() to call loadFromBackend() after auth
- Conflict: backend wins on load, local wins on create (optimistic)

### STORY-00183: Per-page functional + visual review pass
- Page-by-page walkthrough: HomeScreen, MapScreen, HikingScreen, RoutesScreen, FriendsScreen, SettingsScreen, MapHistoryScreen
- Each page: verify glass styling looks right + functional features work
- File bugs for anything broken or visually off
