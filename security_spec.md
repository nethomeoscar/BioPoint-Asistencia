# Security Specification - BioPoint SaaS

## Data Invariants
1. An Employee document MUST belong to a valid Company.
2. An Employee document MUST have a `faceDescriptor` which is a List of 128 numbers.
3. Attendance Records MUST be linked to an Employee and a Company.
4. Users can only access data belonging to their assigned `companyId`.
5. Only users with the `owner` role can create or delete employees.

## The Dirty Dozen Payloads

### 1. Identity Spoofing (Employee)
**Target:** `companies/comp_A/employees/emp_1`
**Attacker:** User from `comp_B`
**Payload:** `{ name: "Hacker", companyId: "comp_A", ... }`
**Expected:** `PERMISSION_DENIED`

### 2. Shadow Field Injection
**Target:** `companies/comp_A/employees/emp_1`
**Attacker:** Admin of `comp_A`
**Payload:** `{ name: "John", ..., isVerified: true }` (Ghost Field)
**Expected:** `PERMISSION_DENIED` (via `hasAll` and `size` check)

### 3. Invalid Face Descriptor (Type)
**Target:** `companies/comp_A/employees/emp_1`
**Payload:** `{ faceDescriptor: "not-an-array", ... }`
**Expected:** `PERMISSION_DENIED`

### 4. Invalid Face Descriptor (Size)
**Target:** `companies/comp_A/employees/emp_1`
**Payload:** `{ faceDescriptor: [1, 2, 3], ... }` (Must be 128)
**Expected:** `PERMISSION_DENIED`

### 5. Immortality Violation
**Target:** `companies/comp_A/employees/emp_1` (Update)
**Payload:** `{ createdAt: "2020-01-01" }` (Changing immutable field)
**Expected:** `PERMISSION_DENIED`

### 6. Unauthorized Attendance Injection
**Attacker:** Kiosk user from `comp_B` attempting to write to `comp_A`
**Expected:** `PERMISSION_DENIED`

### 7. Resource Poisoning (ID)
**Payload:** Create employee with ID `........VERY_LONG_ID.......`
**Expected:** `PERMISSION_DENIED` (via `isValidId`)

### 8. PII Leak (User Profiles)
**Attacker:** User A trying to `get` User B's profile.
**Expected:** `PERMISSION_DENIED` (Unless they are in the same company and need it? No, users are private.)

### 9. State Shortcutting (Attendance)
**Payload:** Update an existing attendance record's `timestamp`.
**Expected:** `PERMISSION_DENIED` (Attendance records should be immutable or strictly controlled)

### 10. Role Escalation
**Payload:** User updates their own `role` to `owner` in `/users/{uid}`.
**Expected:** `PERMISSION_DENIED`

### 11. Orphaned Employee
**Payload:** Create employee for a non-existent `companyId`.
**Expected:** `PERMISSION_DENIED` (via `exists()`)

### 12. Denial of Wallet (Large String)
**Payload:** `{ name: "A".repeat(1000000) }`
**Expected:** `PERMISSION_DENIED` (via `.size() <= 128`)
