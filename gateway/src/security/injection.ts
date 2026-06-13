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

interface ScanResult {
  detected: boolean;
  type?: string;
  confidence?: number;
  pattern?: string;
}

export class InjectionDetector {
  private patterns: Array<{ regex: RegExp; type: string; confidence: number }> = [
    // Direct injection attempts
    { regex: /ignore\s+(all\s+)?previous\s+instructions/i, type: 'direct_override', confidence: 0.95 },
    { regex: /ignore\s+(all\s+)?prior\s+(instructions|prompts|rules)/i, type: 'direct_override', confidence: 0.95 },
    // Role-assignment only ("you are now a/an/the <role>" or "you are now in <mode>"),
    // not any innocuous "you are now …" prose (e.g. "you are now reading chapter two").
    { regex: /you\s+are\s+now\s+(in\s+|(a|an|the)\s+)\w+/i, type: 'role_hijack', confidence: 0.85 },
    { regex: /forget\s+(everything|all|your)\s+(you|instructions|rules)/i, type: 'memory_wipe', confidence: 0.9 },
    { regex: /new\s+instructions?\s*:/i, type: 'instruction_inject', confidence: 0.8 },
    { regex: /system\s*:\s*you\s+are/i, type: 'system_prompt_inject', confidence: 0.95 },
    { regex: /\[SYSTEM\]|\[ADMIN\]|\[OVERRIDE\]/i, type: 'fake_system_tag', confidence: 0.9 },
    { regex: /maintenance\s+mode/i, type: 'mode_switch', confidence: 0.7 },
    { regex: /developer\s+mode/i, type: 'mode_switch', confidence: 0.7 },
    { regex: /jailbreak/i, type: 'jailbreak', confidence: 0.95 },
    { regex: /DAN\s+mode/i, type: 'jailbreak', confidence: 0.95 },

    // Data exfiltration attempts
    { regex: /send\s+(the|all|my)?\s*(api|keys?|tokens?|password|credential|vault)/i, type: 'data_exfil', confidence: 0.9 },
    { regex: /read\s+.*\.(env|vault|key|pem|ssh)/i, type: 'sensitive_file_access', confidence: 0.85 },
    { regex: /curl\s+.*\|.*sh/i, type: 'remote_code_exec', confidence: 0.95 },
    { regex: /wget\s+.*\|.*bash/i, type: 'remote_code_exec', confidence: 0.95 },

    // Hidden instruction patterns (in pasted content)
    { regex: /<!--\s*(ignore|forget|override|system)/i, type: 'hidden_html_injection', confidence: 0.9 },
    { regex: /\u200b.*ignore/i, type: 'zero_width_injection', confidence: 0.85 },
  ];

  scan(input: string): ScanResult {
    for (const { regex, type, confidence } of this.patterns) {
      if (regex.test(input)) {
        return { detected: true, type, confidence, pattern: regex.toString() };
      }
    }
    return { detected: false };
  }
}
