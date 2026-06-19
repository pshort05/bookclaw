# Genre Extraction Summary
**Extraction Date:** June 19, 2026  
**Total Genres:** 15  
**Source Files:** 26 DOCX documents  
**Output File:** `genres-extracted.json` (58 KB)

---

## Extracted Genres

### 1. Family Saga Romance
- **Essence:** Multi-generational family dynamics with romantic central relationships
- **Key Trope:** The Prodigal Returns, Conditional Will, Rival Families
- **Core Theme:** Roots vs. Wings, Generational Trauma, Family Loyalty
- **Iconic Beat:** The Dinner Table (conflict arena), The Heirloom (legacy symbol)

### 2. Farce Fiction
- **Essence:** Physical comedy, escalating complications, mistaken identities
- **Key Trope:** The Idiot Plot, The Door Slam, The Disguise
- **Core Theme:** Order vs. Entropy, Deception as Survival, Murphy's Law on Steroids
- **Iconic Beat:** Synchronized doors, character chases, visual double-takes

### 3. Flintlock Fantasy
- **Essence:** Gunpowder-era fantasy blending magic with military logistics
- **Key Trope:** Powder Mage, The Revolutionary, Common Soldier POV
- **Core Theme:** Technology transforms society, Fog of War, Gritty Realism
- **Iconic Beat:** Logistics of war (shoes, powder, bread), Professional soldiers

### 4. Folk Horror
- **Essence:** Isolated communities with dark traditions; anthropological interloper
- **Key Trope:** The Anthropological Interloper, Inheritance Trap, Lost Travelers
- **Core Theme:** Fragility of Civilization, Cycle of Life & Death, Liminality
- **Iconic Beat:** The Arrival, Uncanny Welcome, The Offering/Sacrifice

### 5. Forensic Thriller
- **Essence:** Murder mysteries told through forensic analysis and science
- **Key Trope:** The Forensic Hero, The Puzzle, Expert Pressure
- **Core Theme:** Truth Through Science, Contamination, Body as Text
- **Iconic Beat:** The Peculiarity, Pressure/Rushing, The Breakthrough

### 6. Friends-to-Lovers Romance
- **Essence:** Years of friendship culminating in romantic realization
- **Key Trope:** Idiots in Love (Mutual Pining), There Was Only One Bed
- **Core Theme:** Intimacy vs. Passion, Safety of the Familiar, Vulnerability & Risk
- **Iconic Beat:** The Realization, Fear of Loss, Accidental Intimacy

### 7. Furry Sleuths
- **Essence:** Animal protagonists (or pairs) investigating crimes
- **Key Trope:** The Feline Detective, The Loyal Dog, Witness Animal
- **Core Theme:** Perception & Perspective, Loyalty & Justice, Communication Barriers
- **Iconic Beat:** Unusual Behavior, First Clue, The Breakthrough (interpretation)

### 8. Galactic Empire
- **Essence:** Sprawling multi-system empires with court intrigue and succession crises
- **Key Trope:** The Sprawling Dynasty, Imperial Court, Rival Empire Threat
- **Core Theme:** Power Consolidated & Contested, Distance/Communication, Inevitability of Decline
- **Iconic Beat:** The Throne Established, The Fracture Point, Consolidation or Collapse

### 9. Gangster
- **Essence:** Organized crime narratives emphasizing code, territory, and betrayal
- **Key Trope:** The Kingpin/Don, The Made Guy, The Rat/Informant
- **Core Theme:** Honor Among Thieves (Corrupted), Loyalty & Betrayal, Violence as Language
- **Iconic Beat:** Power Structure Established, Threat/Inciting Incident, The Betrayal Crisis

### 10. Gangster Mystery
- **Essence:** Crime investigation within mob structure; paranoia and omertà
- **Key Trope:** Gangster Retirement Mysteries, The Hit Gone Wrong, Internal Investigation
- **Core Theme:** Trust & Paranoia, Justice Within/Without, Silence/Omertà
- **Iconic Beat:** The Murder, The Summons, Gathering Intelligence, The Power Play

### 11. Generation Ship
- **Essence:** Multi-generational space travel with hidden agendas and existential questions
- **Key Trope:** The Hidden Agenda, The Forgotten Truth, The Stowaway
- **Core Theme:** Community & Isolation, Purpose & Questioning, Sacrifice & Duty
- **Iconic Beat:** Routine Established, Inciting Incident, Crisis, New Normal

### 12. Glitz & Glamor Romance
- **Essence:** High-society luxury settings; class dynamics and social climbing
- **Key Trope:** The Rags-to-Riches Love Interest, The Makeover Moment, Grand Gesture
- **Core Theme:** Authenticity vs. Facade, Power & Vulnerability, Public/Private Tension
- **Iconic Beat:** The Meet-Cute, Wooing in Luxury, Social Trial, The Reckoning

### 13. Gothic Horror
- **Essence:** Atmospheric dread with crumbling estates and psychological decay
- **Key Trope:** The Epistolary Format, The Byronic Hero-Villain, Madwoman in Attic
- **Core Theme:** The Sublime, The Uncanny, Burden of the Past (Ancestral Sin)
- **Iconic Beat:** The Liminal Space, Blood symbolism, Pathetic Fallacy (weather)

### 14. Gothic Romance
- **Essence:** Dark romance blending horror with passion; isolated settings
- **Key Trope:** The Mysterious Stranger, The Isolated Setting, Dark Secret
- **Core Theme:** Fear & Desire, Trust & Betrayal, Isolation & Connection
- **Iconic Beat:** The Arrival, Rules & Restrictions, First Transgression, The Crisis

### 15. Grimdark Fantasy
- **Essence:** Morally compromised protagonists in dark worlds; anti-heroes and betrayal
- **Key Trope:** The Anti-Hero, Deconstructed Hero, Magic Has a Cost
- **Core Theme:** Nature of Power & Corruption, Ruins/Fallen Civilizations, Betrayal
- **Iconic Beat:** Mud/Blood/Filth aesthetic, Chains & Imprisonment, Cycles of Violence

---

## JSON Structure

Each genre entry contains:
```json
{
  "genre": "Genre Name",
  "source_dir": "source-directory-name",
  "files_found": ["File1.docx", "File2.docx"],
  "reader_expectations": "One-liner capturing reader intent",
  "tropes": ["Trope 1 description", "Trope 2 description", ...],
  "themes": ["Theme 1 description", "Theme 2 description", ...],
  "beats": ["Beat 1 description", "Beat 2 description", ...],
  "must_haves": ["Element 1", "Element 2", ...],
  "genre_killers": ["Element to avoid", ...],
  "comps": [
    {"title": "Book Title", "author": "Author Name", "note": "Why it's relevant"}
  ]
}
```

---

## Key Statistics

- **Total Tropes Extracted:** 107 (avg 7 per genre)
- **Total Themes Extracted:** 96 (avg 6 per genre)  
- **Total Plot Beats Extracted:** 109 (avg 7 per genre)
- **Average Comparable Titles:** 4 per genre (64 total)
- **Source Document Count:** 26 DOCX files across 15 directories

---

## Integration Notes

**For BookClaw Genre System:**

1. Load `genres-extracted.json` into `LibraryService`
2. Map genre fields to author prompt templates
3. Use tropes/themes/beats as skill content for project-specific guidance
4. Allow genre selection during book/project creation
5. Inject relevant guidance at pipeline steps (planning, drafting, revision)

**Known Limitations:**

- Some `genre_killers` and `must_haves` fields sparse (limited source doc content)
- Comparable titles mostly structured references (limited actual title/author metadata)
- Some source docs contain AI-generated introductions (generic repeated text)

---

## File Metadata

- **Location:** `/home/paul/data/dev/bookclaw/library/genres-extracted.json`
- **Format:** Valid JSON array
- **Size:** 58 KB
- **Encoding:** UTF-8
- **Lines of Code:** ~950
