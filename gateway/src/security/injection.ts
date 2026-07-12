/**
 * BookClaw Injection Detector
 * Detects common prompt injection patterns.
 *
 * ADVISORY defense-in-depth ONLY. This static-regex scanner is trivially
 * evadable (obfuscation, line-splitting, unicode, base64) and prone to false
 * positives, so it must never be the authoritative control. The authoritative
 * control for irreversible/external actions is the ConfirmationGate (see
 * docs/SECURITY.md). Do not increase reliance on this detector or add patterns
 * to gate behaviour on it.
 */

type Severity = 'block' | 'warn';

interface ScanResult {
  detected: boolean;
  type?: string;
  confidence?: number;
  pattern?: string;
  severity?: Severity;
}

export class InjectionDetector {
  // severity: 'warn' = narrative-prose-prone (downgrade to advisory so an author
  // pasting manuscript prose isn't hard-blocked); 'block' = real threat, always
  // hard-blocks regardless of surrounding text. See scan() below for precedence.
  private patterns: Array<{ regex: RegExp; type: string; confidence: number; severity: Severity }> = [
    // Direct injection attempts
    { regex: /ignore\s+(all\s+)?previous\s+instructions/i, type: 'direct_override', confidence: 0.95, severity: 'block' },
    { regex: /ignore\s+(all\s+)?prior\s+(instructions|prompts|rules)/i, type: 'direct_override', confidence: 0.95, severity: 'block' },
    // Role-assignment only ("you are now a/an/the <role>" or "you are now in <mode>"),
    // not any innocuous "you are now …" prose (e.g. "you are now reading chapter two").
    { regex: /you\s+are\s+now\s+(in\s+|(a|an|the)\s+)\w+/i, type: 'role_hijack', confidence: 0.85, severity: 'warn' },
    { regex: /forget\s+(everything|all|your)\s+(you|instructions|rules)/i, type: 'memory_wipe', confidence: 0.9, severity: 'block' },
    { regex: /new\s+instructions?\s*:/i, type: 'instruction_inject', confidence: 0.8, severity: 'warn' },
    { regex: /system\s*:\s*you\s+are/i, type: 'system_prompt_inject', confidence: 0.95, severity: 'block' },
    { regex: /\[SYSTEM\]|\[ADMIN\]|\[OVERRIDE\]/i, type: 'fake_system_tag', confidence: 0.9, severity: 'block' },
    { regex: /maintenance\s+mode/i, type: 'mode_switch', confidence: 0.7, severity: 'warn' },
    { regex: /developer\s+mode/i, type: 'mode_switch', confidence: 0.7, severity: 'warn' },
    { regex: /jailbreak/i, type: 'jailbreak', confidence: 0.95, severity: 'block' },
    { regex: /DAN\s+mode/i, type: 'jailbreak', confidence: 0.95, severity: 'block' },

    // Data exfiltration attempts
    { regex: /send\s+(the|all|my)?\s*(api|keys?|tokens?|password|credential|vault)/i, type: 'data_exfil', confidence: 0.9, severity: 'block' },
    { regex: /read\s+.*\.(env|vault|key|pem|ssh)/i, type: 'sensitive_file_access', confidence: 0.85, severity: 'block' },
    { regex: /curl\s+.*\|.*sh/i, type: 'remote_code_exec', confidence: 0.95, severity: 'block' },
    { regex: /wget\s+.*\|.*bash/i, type: 'remote_code_exec', confidence: 0.95, severity: 'block' },

    // Hidden instruction patterns (in pasted content)
    { regex: /<!--\s*(ignore|forget|override|system)/i, type: 'hidden_html_injection', confidence: 0.9, severity: 'block' },
    { regex: /\u200b.*ignore/i, type: 'zero_width_injection', confidence: 0.85, severity: 'block' },
  ];

  /**
   * Scans for the first 'block'-severity match across all patterns; if none is
   * found, falls back to the first 'warn'-severity match. This means a message
   * containing BOTH a threat pattern and narrative prose always resolves to
   * 'block' \u2014 threats take priority over narrative false-positive scoping.
   */
  scan(input: string): ScanResult {
    let warnMatch: ScanResult | undefined;
    for (const { regex, type, confidence, severity } of this.patterns) {
      if (!regex.test(input)) continue;
      const result: ScanResult = { detected: true, type, confidence, pattern: regex.toString(), severity };
      if (severity === 'block') return result;
      if (!warnMatch) warnMatch = result;
    }
    return warnMatch ?? { detected: false };
  }
}
