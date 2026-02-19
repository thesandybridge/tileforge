# Remaining Audit Items

Items identified during codebase audit that are deferred for later implementation.

## Architecture

### A-2: Request Validation with Zod
- Add zod schemas for API request/response validation
- Validate incoming request bodies and query params
- Type-safe error responses

## Medium Priority

### M-2: S3 Upload Retry Logic
- Add exponential backoff retry for S3 uploads
- Handle transient network failures gracefully

### M-3: User-Friendly Worker Error Messages
- Map technical WASM errors to user-friendly messages
- Provide actionable guidance (e.g., "Image too large, try reducing dimensions")

### M-6: Request Timeouts
- Add timeout handling for long-running operations
- Show timeout errors to users instead of hanging indefinitely

## Low Priority

### L-2: Magic Numbers
- Extract magic numbers in tile processing to named constants
- Document their meaning and valid ranges

### L-3: Error Message Consistency
- Standardize error message format across API routes
- Use consistent structure: `{ error: string, code?: string, details?: object }`

### L-4: Button Loading States
- Add loading spinners to buttons that trigger async operations
- Disable buttons during loading to prevent double-clicks

### L-6: PWA Manifest
- Add proper favicon set for PWA
- Complete manifest.json with all required icons

## Testing

### T-1: API Route Unit Tests
- Test auth flows (login, logout, token refresh)
- Test Stripe webhook handlers
- Test account deactivation flow

### T-2: Tile Processing Integration Tests
- Test WASM processor with various image sizes
- Test server processor with mocked backend
- Test batch queue processing

### T-3: E2E Tests with Playwright
- Homepage load and WASM initialization
- File upload and processing flow
- Gallery navigation and tileset viewing
- Settings page interactions
