---
name: romance-spicy-scene-brief
description: Build a comprehensive 12-section scene brief blueprint for a spicy (Heat Level 4) contemporary beach-read romance chapter
author: BookClaw
version: 1.0.0
triggers:
  - "spicy romance"
  - "steamy romance"
  - "heat level 4"
  - "scene brief"
  - "beach read"
  - "romance chapter brief"
  - "contemporary romance"
permissions:
  - file:write
---

# Romance Spicy Scene Brief Skill

You create a **comprehensive scene brief** for a single chapter that serves as a blueprint for another AI to write the full chapter prose. This is NOT the final chapter — it is a detailed architectural document that ensures narrative consistency, emotional depth, and genre-appropriate pacing.

Work from the book's chapter outline, structure/romance-arc guide, character bible, and world/locations guide provided in your context, plus the previous chapter's text in your context for continuity.

## Critical Context

This is a **contemporary beach-read romance** where the romance arc is the primary driver and plot events serve character/relationship development. Every scene must advance both the external plot AND the internal emotional journey of the romantic relationship.

### Beach-Read Content Floor

This is **escapist, fun, uplifting entertainment**. Your scene brief must ensure:

**Required tone:**
- Light, breezy, fun to read
- Hopeful and uplifting overall (even during conflict)
- Emotionally satisfying and escapist
- Witty banter and chemistry-driven tension
- Professional or personal conflicts that are engaging but not depressing
- The romance is the center — everything else supports it

**Absolutely forbidden:**
- No politics, political themes, or social activism
- No heavy trauma (abuse, assault, PTSD) as central plot points
- No depressing events beyond the standard romance "breakup / dark night"
- No grief, terminal illness, or death of major characters
- No women's-fiction themes (family drama, serious life crises, social issues)
- No literary-fiction techniques (experimental prose, ambiguous endings, bleak realism)
- No substance-abuse storylines
- No infidelity as a core conflict
- No heavy mental-health storylines (depression, self-harm as plot drivers)

**Character conflicts should be:**
- Professional obstacles (workplace rivals, career goals, competing companies)
- Past heartbreak or relationship baggage kept light ("I don't do commitment," not "I was traumatized")
- Misunderstandings and miscommunication
- External circumstances (distance, timing, family expectations handled lightly)
- Personal growth needs (learning to trust, open up, prioritize love) WITHOUT heavy trauma backstories

**Breakup / dark night should be:**
- Emotionally impactful but not devastating
- Based on fear, miscommunication, or external pressures
- Resolved with growth and grand gestures
- Never based on betrayal, abuse, or unforgivable acts

**Overall vibe:** Think Emily Henry, Christina Lauren, Ali Hazelwood, Casey McQuiston. NOT Colleen Hoover, Taylor Jenkins Reid, Kristin Hannah. This is a book someone reads on vacation to ESCAPE and ENJOY, not to cry or contemplate heavy themes.

## Scene Brief Structure

Produce all twelve sections below, in order. This is a blueprint another AI will read and write the chapter from, so prioritize clarity, specificity, and actionable detail over literary flourish.

### Section 1: Chapter Header

Format exactly as shown:

```markdown

---

## Chapter X - [Chapter Title from Outline] (Intimacy)

**[Time] | [Location]**
*[POV Character First Name Only]*

---

```

- Extract chapter title, time, location, and POV character exactly as specified in the outline.
- POV should be **close third-person** for contemporary romance unless the outline specifies otherwise.
- Confirm the POV alternation pattern (typically FMC/MMC alternating or strategic placement).

**Intimacy detection (critical):**
- **IF** this chapter contains an **intimate scene** (on-page physical intimacy, NOT just sexual tension), append **(Intimacy)** to the chapter title — e.g. `## Chapter 15 - Crossing the Line (Intimacy)`.
- **IF NO** intimate scene is present, use the title WITHOUT the marker — e.g. `## Chapter 14 - Board Meeting`.

What qualifies as an "intimate scene":
- On-page physical intimacy (kissing leading to more, explicit content, consummation) — qualifies.
- Steamy or explicit romantic/sexual encounters — qualifies.
- Sexual tension alone (charged moments, near-kisses, interrupted intimacy) — does NOT qualify.
- Romantic moments without physical intimacy — does NOT qualify.

This marker drives downstream branching: a chapter tagged `(Intimacy)` is later routed through a dedicated intimacy-enhancement pass. Tag it accurately, and make the checkboxes in Section 7 mirror this title marker exactly.

### Section 2: Narrative Architecture

Use the structure/romance-arc guide to inform every architectural decision: the overall three-act structure and where this chapter falls; which romance-arc progression phase this chapter occupies; the character-arc stages for both leads (their emotional state at this point); thematic threads to weave in; relationship milestones; and whether tension should build or release here.

- **Scene function:** Define this scene's role in the overall structure:
  - **Story-structure position** (e.g. inciting incident, first plot point, midpoint shift, dark night, climax).
  - **Primary narrative function:** what must happen plot-wise.
  - **Romance-arc function:** where this falls in the romance progression (first meeting, recognition, resistance, surrender, consummation, separation, reunion, etc.).
  - **Emotional turning point:** what shifts internally for the POV character.
  - **Thematic emphasis:** which theme(s) to weave into this chapter.
- **Continuity bridge:**
  - **Where we left off:** the emotional and plot state at the end of the previous chapter's text in your context.
  - **Opening hook:** how this chapter opens — start mid-action, mid-conversation, or with immediate tension; never with waking up or a weather description.
  - **Transition strategy:** how to move from the previous chapter to this one seamlessly.

### Section 3: Plot & Emotional Beats

- **Verbatim plot extraction:** reproduce this chapter's description from the outline word-for-word so the writer cannot drift from the planned plot.
- **Beat breakdown (12-15 beats maximum):** for each beat provide:
  1. **Plot Action** — what physically happens.
  2. **Emotional Undercurrent** — what the POV character feels/realizes.
  3. **Romance Tension Shift** — how this beat affects the relationship dynamic (attraction increases, walls go up, vulnerability moment, power shift, etc.).
  4. **Sensory Anchor** — one specific sensory detail to ground the moment (sound, smell, touch, temperature, taste).
- **Pacing notes:** identify where tension BUILDS (action, argument, revelation, proximity) and where it RELEASES (humor, softness, concession, physical contact). Mark the **chapter climax beat** (highest emotional/plot intensity) and the **resolution/hook beat** (how the chapter ends — typically on a question, revelation, or decision).

### Section 4: Character Dynamics

For each character appearing in this chapter, specify role (POV / romantic lead / antagonist / secondary) and:

- **Physical presence:** clothing/appearance relevant to this scene's context; body language reflecting emotional state; physical positioning relative to others (distance, proximity, power dynamics).
- **Emotional state:** surface emotion (what they show), hidden emotion (what they conceal — vital for the POV character's interior), and the core need/fear active in this scene.
- **Behavioral signature:** speech patterns (formal, blunt, evasive, poetic); distinctive gestures or tics when stressed/aroused/angry; how they move through space. Draw these from the character bible.
- **Relationship status:** current stance toward the romantic lead (hostile, curious, attracted, conflicted, protective, possessive); vulnerability level (fully armored → one wall down → openly vulnerable); power dynamic (dominating, surrendering, negotiating equality).
- **Attraction cues (romantic leads only):** what the POV character notices about the other (specific physical details, gestures, voice qualities); internal physical reactions (elevated heart rate, heat, breathlessness, hyperawareness); thoughts they're trying to suppress.

**New-character naming (mandatory protocol when introducing any named character not already in the bible):**

*Internet research is mandatory.* Research and verify every new name via internet search — check popularity rankings (SSA database or equivalent), cultural appropriateness and authenticity, phonetic diversity against the existing cast, and any unintended association with a famous person or character. Useful queries: "unique [male/female] names ranked 100-200," "[cultural background] traditional names," "uncommon [male/female] names [current year]," "name popularity rankings SSA," "names ranked below 50 [current year]."

*Prohibited names (instant manuscript rejection):*
- **Contemporary AI defaults:** Sarah Chen (the most common AI default), Marcus Chen, Elena, Sarah, Michael, John, David, Rachel, Emily, James, Alex/Alexandra, "Dr. Chen."
- **Overused romance names:** Sebastian, Gabriel, Dominic (alpha-male clichés); Ethan, Liam, Noah (over-trendy); Hannah; Bella, Emma, Olivia, Ava, Luna, Sophie.
- **Top-10 most common US names (avoid completely):** male — James, John, Robert, Michael, William, David, Joseph, Charles, Thomas, Daniel; female — Mary, Patricia, Jennifer, Linda, Barbara, Elizabeth, Susan, Jessica, Sarah, Karen; surnames — Smith, Johnson, Williams, Brown, Jones, Garcia, Miller, Davis, Rodriguez, Martinez.
- **Katherine variants (the whole family tree):** Katherine, Kate, Katie, Caitlin, Katniss.

*Phonetic-diversity requirements (enforce across the entire cast):*
- **The "-a" ending epidemic:** AI generates female names ending in "-a" at 2-3x natural frequency. Maximum **30%** of female names may end in "-a" (natural frequency is ~37%; 40%+ flags the manuscript as AI-generated). Avoid clustering names like Elara, Lyra, Aria, Kira, Sera, Lena, Elena, Sienna, Stella.
- **Rhyming-cascade prevention:** no two character names should rhyme (a clear AI tell). Avoid patterns like Elara/Lyra/Kira or Sera/Thera/Vera. Ensure significant phonetic distance between all names.
- **Initial-consonant diversity:** 70%+ of characters should start with different letters; don't cluster similar sounds.
- **Syllable variation:** mix 1-, 2-, 3-, and 4+-syllable names; don't keep every name at the same count.
- **Avoid sound stereotyping:** don't give all male names hard consonants (Marcus, Kai, Thorne) and all female names soft sounds (Aria, Elara, Lily). Build strong-sounding female names and soft-sounding male names too.

*Cultural-authenticity protocol:* research actual naming conventions for the specific culture/region rather than guessing; avoid "generic Asian"/"generic Hispanic" names; verify name order (family name first vs. last); ensure the name fits the character's age and birth era; reflect specific regions, not broad continents; check name meanings.

*Verification checklist (before finalizing any new name):* internet research completed; ranked 51+ (not top 50); not on any prohibited list; phonetically distinct from all existing names with no rhyming; contributes to cast diversity (checked the "-a" ending percentage and initial-consonant spread); culturally appropriate and authentic; fits the contemporary-romance genre (realistic, current, not fantasy-sounding); no unintended associations; pronounceable and memorable. When introducing 2+ new characters at once, also confirm the new names don't rhyme with each other, use different initial consonants, and vary in syllable count.

### Section 5: Setting & Atmosphere

**Mandatory real-location research:** this is contemporary romance set in real-world places. Supplement the world/locations guide with authentic detail researched via internet search — current, accurate information about the specific location; authentic sensory detail (sounds, smells, visual characteristics unique to this place); local cultural elements, landmarks, atmospheric qualities; time-specific factors (season, time of day, relevant current events). Blend the world-guide information with your research, prioritizing specific authentic detail over generic description. If the world guide contradicts well-known facts, defer to accurate real-world information and note the discrepancy.

- **Physical environment:** the specific real-world place; time of day / season / weather and how they affect lighting, temperature, and mood.
- **Sensory landscape (all five senses, location-authentic):**
  - **Sight:** lighting quality, colors, movement, visual focal points (architecture, scenery, people, traffic).
  - **Sound:** ambient noise specific to this location, punctuating sounds, silence (city traffic, ocean waves, café chatter, regional accents).
  - **Smell:** dominant scents particular to this place and how they shift (sea salt, coffee roasting, subway exhaust, pine, restaurant cuisines).
  - **Touch/Temperature:** air quality, textures, physical sensation, heat/cold (humidity, air conditioning, coastal breeze, urban heat).
  - **Taste:** if relevant (local cuisine, drinks, salt air).
- **Emotional atmosphere:** the mood; how the setting mirrors or contrasts with the POV character's internal state; symbolic environmental details that carry thematic weight.
- **Location integration:** identify 2-3 location-specific details (from the guide and from research) to weave naturally into action/dialogue (never info-dumped); note how the setting creates opportunities or obstacles; note any local customs/social markers that create friction or connection; run an authenticity check (business hours, seasonal factors, local regulations).

### Section 6: Conflict Architecture

- **Primary conflict:** type (internal / interpersonal / professional / societal / environmental — can be multiple); stakes (what happens if the POV character fails or succeeds); escalation (how it intensifies through the chapter).
- **Romance tension:** the **external obstacle** (circumstances keeping them apart — professional boundaries, past relationships, geography, social expectations); the **internal obstacle** (emotional baggage/beliefs — trust issues, fear of vulnerability, past heartbreak; kept light and relatable, NOT heavy trauma); the **magnetic pull** (what draws them together despite the obstacles); the **power dynamic** (who holds power and how it shifts).
- **Conflict resolution:** does the scene end with conflict resolved, escalated, or transformed; what question/tension carries forward.

### Section 7: Intimate Scenes (if applicable)

Mark whether this chapter contains: sexual tension (charged moment, near-kiss, interrupted intimacy) — or — an intimate scene (on-page physical intimacy). **If you mark the on-page intimacy box, you MUST add the `(Intimacy)` marker to the chapter title in Section 1.** The checkboxes here must mirror that title marker exactly.

If intimate content is present, brief the writer on:
- **Emotional precondition:** the emotional breakthrough/vulnerability that enables this physical moment; where the consent negotiation stands (implied, verbal, enthusiastic).
- **Power dynamic:** who initiates, who surrenders, who claims; how this reflects or shifts the overall relationship power balance.
- **Scene function:** how the intimacy advances the romance arc (not just physical release); what emotional revelation or character growth happens through physical connection.
- **Tone / heat level:** Sensual (fade to black), Steamy (moderate detail), or Explicit (full on-page). Write **female-gaze** — emphasize the POV character's subjective experience, pleasure, and agency — with the **emotion-above-physical-mechanics** ratio. Target **Heat Level 4** (explicit but emotionally driven).
- **Integration points:** where the intimate scene begins (what triggers the shift from tension to action); where it ends (interruption, completion, emotional aftermath); the 3-5 key beats within the moment; and the post-intimacy emotional shift (vulnerable, scared, closer, regretful, empowered).

### Section 8: Dialogue Guidance

- **Priorities:** subtext over text (what characters mean vs. what they say); conflict through dialogue (arguments, negotiations, evasions, seductions); character-voice consistency drawn from the character bible.
- **Contemporary strategies:** banter to show intellectual/emotional compatibility; formal/informal register shifts to track relationship evolution and personal-vs-professional context; attraction leaking through word choice, pauses, and voice descriptions; modern, natural dialogue; contemporary references and communication styles (texting, social media) where appropriate.
- **Key conversations:** list 2-4 critical exchanges and their purposes — the topic discussed, the subtext, the power dynamic, the emotional outcome.

### Section 9: Tone, Style & Voice

- **Prose style:** "clear window" prose — simple, evocative, sensory-driven, never purple or ornamental. Specify pacing (fast for action/conflict/panic; medium for conversation/travel; slow for intimacy/realization/processing).
- **POV voice characteristics:** internal-monologue style (analytical / emotional / fragmented / poetic / sarcastic); narrative distance (very close vs. moderate); filtering (what this POV character notices vs. ignores based on personality).
- **Genre requirements:** beach-read tone (light, fun, escapist, hopeful even in conflict); emotional accessibility (realistic, relatable, heightened in romantic moments, never depressing); micro-tension in every scene (attraction, professional conflict, secrets, social dynamics — engaging, not dark); sensory immersion; modern authenticity; an uplifting overall arc where even difficult moments feel temporary and solvable.
- **Foreshadowing:** identify 1-3 subtle details that set up future plot points and how to plant them without drawing attention (off-hand dialogue, background detail, a POV misinterpretation).

### Section 10: Symbolism & Thematic Layers

- **Thematic thread:** what theme is active in this chapter (trust vs. deception, control vs. freedom, identity, transformation, work-life balance, healing) and how plot or dialogue reinforces it.
- **Symbolic elements:** objects, settings, or actions with metaphorical weight; recurring motifs from earlier chapters that reappear here; color, temperature, or environmental symbolism.
- **Archetypal moments:** does this scene contain an archetypal romance beat (first touch, claiming, wound-tending, public declaration, protective rage, sacrifice, grand gesture)?

### Section 11: Continuity & Connections

- **Callbacks:** events, promises, or emotional wounds that resurface; recurring objects/phrases/sensory details that build a pattern; character-growth markers (how behavior now differs from earlier).
- **Foreshadowing future:** seeds for upcoming twists, relationship-evolution hints, setting details that will pay off later.
- **Contemporary-elements continuity:** technology usage (phones, social media, apps, communication methods); professional/career continuity (work obligations, deadlines, business relationships); social connections (friends, family, colleagues who appear or are referenced).
- **Timeline tracking:** what day/time this is in the overall chronology; how much time passes within the chapter; any time-sensitive elements (countdowns, deadlines, business hours).

### Section 12: Structural Notes

- **Opening strategy:** start with action / dialogue / a sensory moment / an internal realization, and specify the hook landing within the first two paragraphs.
- **Closing strategy:** end on a cliffhanger / revelation / decision / intimate moment / unanswered question, and name the emotional note (hope / tension / satisfaction / anticipation).
- **Scene transitions:** if the chapter has multiple scenes, specify white-space break / seamless transition / time jump with a grounding detail.
- **Immersion techniques:** how to make the reader feel present (deep POV, sensory anchors, real-time reactions); avoid filtering language ("she felt," "he saw") in favor of direct experience.

## Quality Checklist

Before considering the brief complete, verify:
- Plot beats from the outline are fully honored.
- This chapter's romance-arc position, the leads' emotional states, the active theme(s), and any relationship milestone all align with the structure/romance-arc guide.
- The POV character's emotional arc has a beginning, middle, and end within the chapter; conflict escalates or transforms (not stagnant).
- At least 3 sensory details per major beat; character voices are distinct and consistent with the bible.
- Real-world location details are authentic and researched; all setting/contemporary details are geographically and culturally accurate and current.
- New character names pass the full naming protocol.
- Foreshadowing is subtle and organic; the chapter has strong opening and closing hooks.
- Intimate scenes (if present) serve character/relationship development.
- The chapter title carries the `(Intimacy)` marker **if and only if** an on-page intimate scene is present.
- Continuity with the previous chapter's text is maintained, and the beach-read content floor is respected.

## Output Format

Output the **scene brief only** — no preamble or commentary — as a structured document with clear section headers, bullet points for beats, and narrative paragraphs for atmosphere/character analysis. Remember you are creating a blueprint, not writing the prose: be prescriptive, detailed, and comprehensive. Always research the real-world location via internet sources before finalizing.

Save to the project's `outline/` folder.
