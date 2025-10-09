# Unicode Security Protection

## Overview

This document catalogs all Unicode-based security protections implemented in win-cli-mcp-server v0.4.0+. These protections defend against sophisticated Unicode-based attacks that attempt to bypass security filters or hide malicious commands.

## Validation Pipeline

Commands undergo a 9-step validation process in `validateShellOperators()`:

1. **Unicode Normalization (NFC)**
2. **PowerShell Unicode Quote Detection**
3. **BiDi Control Character Detection (CVE-2021-42574)**
4. **Combining Character Detection**
5. **Invisible Unicode Character Detection**
6. **Dangerous Control Character Detection**
7. **Shell Operator Blocking**
8. **Unicode Operator Homoglyph Detection**
9. **Zero-Width Character Detection**

---

## 1. PowerShell Unicode Quotes

### Threat: Command Injection via Smart Quotes

**CVE/Reference:** https://blog.stmcyber.com/powershell-unicode-quotes-and-command-injection/

PowerShell interprets Unicode quotation marks as string delimiters, allowing attackers to inject commands when input validation only checks for ASCII quotes (U+0022 `"` and U+0027 `'`).

### Blocked Characters

| Codepoint | Character | Name | Appearance |
|-----------|-----------|------|------------|
| U+201C | " | LEFT DOUBLE QUOTATION MARK | `"` |
| U+201D | " | RIGHT DOUBLE QUOTATION MARK | `"` |
| U+2018 | ' | LEFT SINGLE QUOTATION MARK | `'` |
| U+2019 | ' | RIGHT SINGLE QUOTATION MARK | `'` |
| U+2032 | ′ | PRIME | `′` |
| U+2033 | ″ | DOUBLE PRIME | `″` |

### Attack Example

```powershell
# Attacker input using U+201D instead of ASCII quote
Write-Host "Hello" & Get-Process
# Actual bytes: Write-Host "Hello" & Get-Process
# PowerShell sees: Write-Host [string] & Get-Process [command injection!]
```

### Protection

```typescript
detectPowerShellUnicodeQuotes(command: string): { detected: boolean; char?: string; codepoint?: string }
```

**Error Message:**
```
Command contains PowerShell Unicode quote: U+201D (RIGHT DOUBLE QUOTATION MARK)

WHY: PowerShell interprets Unicode quotation marks (U+201C, U+201D, U+2018, U+2019) as string delimiters,
allowing command injection attacks. These "smart quotes" are often inserted by word processors.

TO FIX:
1. Replace the Unicode quote character '"' with a standard ASCII quote (") or (')
2. Retype the command manually instead of copying from Word, email, or web pages
3. Use a plain text editor that doesn't auto-convert quotes
```

---

## 2. Bidirectional (BiDi) Control Characters

### Threat: "Trojan Source" Attack

**CVE:** CVE-2021-42574
**Reference:** https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2021-42574

BiDi override characters reverse the visual display order of text without changing the actual execution order. This allows attackers to hide malicious code in logs, source code, and command strings.

### Blocked Characters

| Codepoint | Abbreviation | Name | Effect |
|-----------|--------------|------|--------|
| U+202E | RLO | RIGHT-TO-LEFT OVERRIDE | Forces following text to display RTL |
| U+202D | LRO | LEFT-TO-RIGHT OVERRIDE | Forces following text to display LTR |
| U+202A | LRE | LEFT-TO-RIGHT EMBEDDING | Embeds LTR text |
| U+202B | RLE | RIGHT-TO-LEFT EMBEDDING | Embeds RTL text |
| U+202C | PDF | POP DIRECTIONAL FORMATTING | Ends BiDi override |
| U+2066 | LRI | LEFT-TO-RIGHT ISOLATE | Isolates LTR text |
| U+2067 | RLI | RIGHT-TO-LEFT ISOLATE | Isolates RTL text |
| U+2068 | FSI | FIRST STRONG ISOLATE | Auto-detects direction |
| U+2069 | PDI | POP DIRECTIONAL ISOLATE | Ends isolate |

### Attack Example

```bash
# What the user sees in logs:
echo "hello" # safe comment

# What actually executes (U+202E between):
echo "hello" ‮ # tnemmoC ; tegralp teem‭ ; rm -rf /
# Actual execution: echo "hello" ; rm -rf / ; safe comment #
```

### Protection

```typescript
detectBidiControlCharacters(command: string): { detected: boolean; char?: string; codepoint?: string }
```

**Error Message:**
```
Command contains Bidirectional (BiDi) control character: U+202E (RIGHT-TO-LEFT OVERRIDE - RLO)

WHY: BiDi override characters (U+202E, U+202D, etc.) can hide malicious code by reversing the
display order of text. This is known as the "Trojan Source" attack (CVE-2021-42574).

TO FIX:
1. Remove the BiDi control character from your command
2. Retype the command manually from a trusted source
3. Inspect the command using a hex editor to identify hidden control characters

WARNING: BiDi text attacks can make malicious code appear legitimate in logs and source code.
This protection cannot be disabled.
```

---

## 3. Combining Characters

### Threat: Visual Homoglyph Attacks

**Reference:** UTS #39 Unicode Security Mechanisms
**Link:** https://www.unicode.org/reports/tr39/

Combining characters overlay or modify the appearance of base characters. Attackers can use them to:
- Hide operators by making them look like innocent text
- Create visual homoglyphs of commands
- Bypass filters looking for specific character sequences

### Blocked Character Ranges

| Range | Name | Count | Purpose |
|-------|------|-------|---------|
| U+0300 - U+036F | Combining Diacritical Marks | 112 | Accents, umlauts, etc. |
| U+20D0 - U+20FF | Combining Marks for Symbols | 48 | Mathematical/symbol modifiers |

### Attack Example

```bash
# Attacker combines | operator with combining marks to hide it
cmd ǀ echo "safe"
# Visual: cmd ǀ echo (looks like lowercase L)
# Actual: cmd | echo (pipe operator U+01C0)
```

### Protection

```typescript
detectSuspiciousCombiningCharacters(command: string): { detected: boolean; position?: number; char?: string }
```

**Note:** Pre-composed characters (like `café` = U+00E9) are normalized and allowed. Only standalone combining marks are blocked.

**Error Message:**
```
Command contains combining diacritical marks or symbol modifiers

WHY: Combining characters can be used to hide or visually modify operators and commands,
bypassing security filters.

TO FIX:
1. Remove any combining characters from your command
2. Use only base ASCII characters for operators and commands
3. Retype the command manually instead of copying from untrusted sources
```

---

## 4. Invisible Unicode Characters

### Threat: Stealth Character Injection

Invisible characters can be used to:
- Split operators to bypass pattern matching
- Hide malicious content in plain sight
- Modify character appearance without visual indication
- Create non-obvious word boundaries

### Blocked Characters

| Codepoint | Name | Category | Purpose |
|-----------|------|----------|---------|
| **Variation Selectors** |
| U+FE00 - U+FE0F | VARIATION SELECTOR 1-16 | Text/Emoji Style | Changes glyph appearance |
| **Format Controls** |
| U+2060 | WORD JOINER | Invisible Separator | Prevents line breaks |
| U+2062 | INVISIBLE TIMES | Math Operator | Invisible multiplication |
| U+2063 | INVISIBLE SEPARATOR | Math Operator | Invisible separator |
| U+2064 | INVISIBLE PLUS | Math Operator | Invisible addition |
| **Arabic Shaping** |
| U+206A | INHIBIT SYMMETRIC SWAPPING | Format Control | Prevents mirroring |
| U+206B | ACTIVATE SYMMETRIC SWAPPING | Format Control | Enables mirroring |
| U+206C | INHIBIT ARABIC FORM SHAPING | Format Control | Disables ligatures |
| U+206D | ACTIVATE ARABIC FORM SHAPING | Format Control | Enables ligatures |
| U+206E | NATIONAL DIGIT SHAPES | Format Control | Uses local digits |
| U+206F | NOMINAL DIGIT SHAPES | Format Control | Uses ASCII digits |
| **Other** |
| U+00AD | SOFT HYPHEN | Invisible Separator | Optional line break |

### Attack Example

```bash
# Invisible separator between cmd and | operator
cmd​|​echo "test"
# Visual: cmd|echo (looks normal)
# Actual: cmd[U+2060]|[U+2060]echo (invisible joiners hide operator)
```

### Protection

```typescript
detectInvisibleUnicodeCharacters(command: string): { detected: boolean; char?: string; codepoint?: string }
```

**Error Message:**
```
Command contains invisible Unicode character: U+2060 (WORD JOINER)

WHY: Invisible characters like variation selectors, word joiners, and formatting controls
can be used to bypass security filters or hide malicious content.

TO FIX:
1. Remove the invisible character from your command
2. Retype the command manually instead of copying
3. Use a text editor with "show invisible characters" enabled to identify them
```

---

## 5. Zero-Width Characters

### Threat: Operator Splitting

**Note:** These were present in v0.3.0 but documented here for completeness.

Zero-width characters are invisible and can split operators or commands to bypass pattern matching.

### Blocked Characters

| Codepoint | Name | Width | Common Use |
|-----------|------|-------|------------|
| U+200B | ZERO WIDTH SPACE | 0px | Line break opportunity |
| U+200C | ZERO WIDTH NON-JOINER | 0px | Prevent ligatures |
| U+200D | ZERO WIDTH JOINER | 0px | Create ligatures |
| U+FEFF | ZERO WIDTH NO-BREAK SPACE | 0px | Byte Order Mark (BOM) |

### Attack Example

```bash
# Zero-width space splitting pipe operator
cmd​|​echo
# Visual: cmd|echo
# Pattern match for "|" fails due to split: cmd[U+200B]|[U+200B]echo
```

---

## 6. Unicode Operator Homoglyphs

### Threat: Visual Lookalikes

**Note:** These were present in v0.3.0 but expanded in v0.4.0.

Unicode contains many characters that look identical or very similar to ASCII operators but have different codepoints, allowing bypass of exact character checks.

### Blocked Homoglyphs

| ASCII | Homoglyphs | Names |
|-------|------------|-------|
| `\|` | ｜ │ ⏐ ∣ ǀ | Fullwidth, Box Drawing, Extension, Divides, Dental Click |
| `;` | ； ᛫ ︔ | Fullwidth, Runic Punctuation, Vertical Form |
| `&` | ＆ ﹠ | Fullwidth, Small Ampersand |
| `>` | ＞ › ❯ | Fullwidth, Quotation Mark, Heavy Quotation |
| `<` | ＜ ‹ ❮ | Fullwidth, Quotation Mark, Heavy Quotation |

### Attack Example

```bash
# Using fullwidth pipe (U+FF5C) instead of ASCII pipe
cmd ｜ echo
# Filter checks for U+007C (|) but finds U+FF5C (｜)
```

---

## 7. Unicode Normalization (NFC)

### Threat: Composed vs. Decomposed Form Bypass

**Reference:** Unicode Normalization Forms (NFD, NFC, NFKD, NFKC)
**Link:** https://unicode.org/reports/tr15/

Unicode allows the same visual character to be represented in multiple ways:
- **Composed:** Single codepoint (e.g., `é` = U+00E9)
- **Decomposed:** Base + combining mark (e.g., `é` = U+0065 + U+0301)

Attackers can use decomposed forms to bypass filters checking for composed forms.

### Implementation

All commands are normalized to **NFC (Normalization Form Canonical Composition)** before validation:

```typescript
function normalizeUnicode(text: string): string {
    return text.normalize('NFC');
}
```

### Effects

- Decomposed characters → Composed equivalents
- Compatibility characters → Canonical equivalents
- Legitimate accented text (café, naïve, etc.) works correctly
- Attack payloads using decomposed forms are normalized before filtering

### Example

```typescript
// Before normalization:
"café" (5 chars: c-a-f-[U+0065]-[U+0301])

// After NFC normalization:
"café" (4 chars: c-a-f-[U+00E9])

// Both forms are now identical for validation
```

---

## Performance Considerations

### Optimization Strategies

1. **Map-based lookups:** O(1) detection using `Map` for character sets
2. **Fail-fast validation:** First detected threat throws immediately
3. **NFC normalization:** Native `String.normalize()` is optimized in V8
4. **Regex minimization:** Limited regex use, prefer exact character checks
5. **Early returns:** Skip validation when no blocked operators configured

### Benchmark Results

Typical command validation performance:
- ASCII command: < 0.1ms
- Unicode command (normalized): < 0.5ms
- Complex command with multiple checks: < 1ms

---

## Validation Order

The specific order is critical for security and user experience:

1. **Normalization** - Must happen first to handle decomposed forms
2. **PowerShell Quotes** - High-impact, common in copy-paste scenarios
3. **BiDi Controls** - Critical for CVE-2021-42574 protection
4. **Combining Chars** - After normalization, only suspicious standalone marks remain
5. **Invisible Chars** - General stealth protection
6. **Control Chars** - Null bytes and non-printable characters
7. **Operators** - Standard shell operator blocking
8. **Homoglyphs** - Visual lookalikes of operators
9. **Zero-Width** - Final check for splitting attempts

---

## Testing

### Test Coverage

The test suite includes:
- **83 total tests** in `tests/validation.test.ts`
- **45+ Unicode-specific tests** in v0.4.0 suite
- Each Unicode category has dedicated test cases
- Integration tests for multiple attack vectors
- Unit tests for each detection function

### Running Tests

```bash
npm test                              # Run all tests
npm test tests/validation.test.ts    # Run validation tests only
npm run test:coverage                 # Generate coverage report
```

---

## References

### CVEs and Security Advisories

- **CVE-2021-42574:** Trojan Source - BiDi Override Characters
  - https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2021-42574
  - https://trojansource.codes/

### Unicode Standards

- **UTS #39:** Unicode Security Mechanisms
  - https://www.unicode.org/reports/tr39/
- **UAX #15:** Unicode Normalization Forms
  - https://unicode.org/reports/tr15/
- **Unicode Standard:** Chapter 23 - Special Areas and Format Characters
  - https://www.unicode.org/versions/Unicode15.0.0/

### Research and Disclosures

- **PowerShell Unicode Quotes:** STM Cyber Blog
  - https://blog.stmcyber.com/powershell-unicode-quotes-and-command-injection/
- **BiDi Swap:** Decade-old browser flaw
  - https://securityonline.info/bidi-swap-a-decade-old-unicode-flaw-still-enables-url-spoofing/
- **Trojan Source Research:** Cambridge University
  - https://www.trojansource.codes/trojan-source.pdf

### OWASP Resources

- **Unicode Encoding Attacks**
  - https://owasp.org/www-community/attacks/Unicode_Encoding
- **Input Validation Cheat Sheet**
  - https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html

---

## Version History

### v0.4.0 (Current)
- ✅ PowerShell Unicode quote detection (6 characters)
- ✅ BiDi control character detection (9 characters - CVE-2021-42574)
- ✅ Combining character detection (160+ characters)
- ✅ Invisible Unicode character detection (15 characters)
- ✅ NFC normalization before validation
- ✅ Comprehensive test suite (45+ new tests)

### v0.3.0
- ✅ Zero-width character detection (4 characters)
- ✅ Unicode operator homoglyphs (15+ variants)
- ✅ Dangerous control character detection
- ✅ Enhanced error messages with remediation guidance

### Future Considerations
- Emoji variation selector handling
- Regional indicator symbol detection
- Tag character (U+E0000 - U+E007F) detection
- Mathematical alphanumeric symbol detection

---

## Frequently Asked Questions

### Why block combining characters?

While legitimate in text, combining characters can be used to hide operators or create visual homoglyphs. Our normalization process allows legitimate pre-composed characters (like `café`) while blocking suspicious standalone combining marks.

### Will this break non-English commands?

No. Pre-composed Unicode characters (like accented letters) are normalized and allowed. We only block:
1. Control characters (invisible formatting)
2. Standalone combining marks (suspicious overlays)
3. Known attack vectors (BiDi, variation selectors)

### Can these protections be disabled?

**No.** Unicode-based attacks are always-on protections because:
1. They defend against documented CVEs (CVE-2021-42574)
2. They prevent stealth attacks that hide in logs
3. They protect against command injection vulnerabilities
4. The performance impact is negligible (< 1ms per command)

### What if I have a legitimate use case?

If you need to use Unicode characters for output (e.g., displaying symbols), consider:
1. Use escape sequences instead of raw Unicode
2. Generate the Unicode in your command logic, not in the command string
3. Use environment variables or files to pass Unicode data

### How are these different from standard input validation?

Traditional input validation checks for specific patterns (like `|` or `&`). Unicode attacks bypass these by:
- Using visually identical but different codepoint characters
- Using invisible characters to split patterns
- Using display manipulation to hide malicious code

Our multi-layered approach catches all of these variants.

---

## Contributing

If you discover a new Unicode-based attack vector:

1. Create an issue with details and proof-of-concept
2. Include the Unicode codepoint(s) involved
3. Describe the attack scenario
4. Reference any CVE or security research if available

Security researchers: Please follow responsible disclosure practices.

---

**Last Updated:** 2025-10-08
**Version:** 0.4.0
**Maintainer:** win-cli-mcp-server team
