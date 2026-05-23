# NAC OS Platform Layer

Shared intelligence engines and contracts. Prefer importing from here in new dashboard code:

```javascript
import {
  buildIntelligenceRangeContract,
  resolveMenuPlatformStatus,
  reviewConversionPct,
  CANONICAL_BRANCH_IDS,
} from "../platform";
```

Architecture: [docs/NAC_OS_ARCHITECTURE.md](../../docs/NAC_OS_ARCHITECTURE.md)

## Truth validation (operational accuracy)

- `buildTruthValidationPackage` — confidence, integrity, anomalies, health score, checklist
- `window.NAC_DEBUG = true` — analytics integrity panel in Intelligence Hub
- `window.NAC_RECORD_OBSERVATION({ qr_scans_30min: 12 })` — floor counts vs dashboard
- `window.__NAC_TRUTH_VALIDATION__` — last computed validation package
