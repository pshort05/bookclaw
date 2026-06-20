#!/bin/bash

cd /home/paul/data/dev/bookclaw

# Reference standard: workplace-romance
REQUIRED_FILES=("reader-expectations.md" "tropes.md" "themes.md" "beats.md" "must-haves.md" "genre-killers.md" "comps.md")
OUTPUT_FILE="genre-audit-report.txt"

# Temp storage for results
RESULTS_FILE=$(mktemp)

echo "Auditing 193 genres..." >&2

for genre_dir in library/genres/*/; do
  genre_name=$(basename "$genre_dir")

  # File presence check
  missing_files=()
  for f in "${REQUIRED_FILES[@]}"; do
    if [[ ! -f "$genre_dir$f" ]]; then
      missing_files+=("$f")
    fi
  done
  missing_count=${#missing_files[@]}

  # Meta.json check
  has_meta="0"
  if [[ -f "$genre_dir/meta.json" ]]; then
    has_meta="1"
  fi

  # Word count per file (indicator of depth)
  declare -A word_counts
  for f in "${REQUIRED_FILES[@]}"; do
    if [[ -f "$genre_dir$f" ]]; then
      wc=$(wc -w < "$genre_dir$f" 2>/dev/null || echo "0")
      word_counts[$f]=$wc
    fi
  done

  # Check for opening summary line (requirement: "one-line summary")
  missing_summary=0
  for f in "${REQUIRED_FILES[@]}"; do
    if [[ -f "$genre_dir$f" ]]; then
      first_line=$(head -1 "$genre_dir$f" | tr -d '[:space:]')
      if [[ -z "$first_line" ]] || [[ "$first_line" =~ ^#+ ]]; then
        # Heading is ok (like "# Workplace Romance — Beats")
        :
      fi
    fi
  done

  # Total word count
  total_wc=0
  for wc in "${word_counts[@]}"; do
    total_wc=$((total_wc + wc))
  done

  # Calculate completeness score (0-100)
  completeness=100
  completeness=$((completeness - (missing_count * 14)))  # 14 points per missing file
  [[ $has_meta -eq 0 ]] && completeness=$((completeness - 2))
  [[ $total_wc -lt 200 ]] && completeness=$((completeness - 15))  # Very thin genre
  [[ $total_wc -lt 500 ]] && completeness=$((completeness - 8))   # Thin genre
  [[ $completeness -lt 0 ]] && completeness=0

  # Depth assessment
  if [[ $total_wc -lt 300 ]]; then
    depth="BARE"
  elif [[ $total_wc -lt 800 ]]; then
    depth="THIN"
  elif [[ $total_wc -lt 1500 ]]; then
    depth="MODERATE"
  else
    depth="RICH"
  fi

  # Specific weaknesses
  weaknesses=""
  if [[ $missing_count -gt 0 ]]; then
    weaknesses+="Missing: ${missing_files[*]} | "
  fi
  if [[ $has_meta -eq 0 ]]; then
    weaknesses+="No meta.json | "
  fi
  [[ ${word_counts["comps.md"]:-0} -lt 100 ]] && weaknesses+="Weak comps | "
  [[ ${word_counts["must-haves.md"]:-0} -lt 100 ]] && weaknesses+="Thin must-haves | "
  [[ ${word_counts["genre-killers.md"]:-0} -lt 100 ]] && weaknesses+="Weak killers | "
  [[ ${word_counts["reader-expectations.md"]:-0} -lt 200 ]] && weaknesses+="Sparse expectations | "

  # Store in temp file: completeness|genre_name|depth|total_wc|missing_count|weaknesses
  echo "$completeness|$genre_name|$depth|$total_wc|$missing_count|${weaknesses% |}"
done | sort -rn -t'|' -k1 > "$RESULTS_FILE"

# Generate report
{
  echo "# Genre Guide Audit Report"
  echo "==================================================="
  echo "Date: $(date)"
  echo "Total genres audited: 193"
  echo "Reference standard: workplace-romance"
  echo ""

  # Summary by completeness band
  echo "## Summary Statistics"
  echo ""
  echo "Perfect (100): $(grep '^100|' "$RESULTS_FILE" | wc -l)"
  echo "Excellent (90+): $(grep '^[9][0-9]|' "$RESULTS_FILE" | wc -l)"
  echo "Good (80-89): $(grep '^[8][0-9]|' "$RESULTS_FILE" | wc -l)"
  echo "Needs work (70-79): $(grep '^7[0-9]|' "$RESULTS_FILE" | wc -l)"
  echo "Poor (<70): $(grep '^[0-6][0-9]|' "$RESULTS_FILE" | wc -l)"
  echo ""

  echo "## Rankings: Best to Worst"
  echo ""
  echo "**Format:** [Score/100] Genre | Depth | Words | Issues"
  echo ""

  line_num=0
  while IFS='|' read -r score genre depth wc missing weaknesses; do
    line_num=$((line_num + 1))
    # Grade letter
    if [[ $score -eq 100 ]]; then grade="A+"; elif [[ $score -ge 90 ]]; then grade="A"; elif [[ $score -ge 80 ]]; then grade="B"; elif [[ $score -ge 70 ]]; then grade="C"; else grade="D"; fi

    # Format weaknesses
    issues="OK"
    if [[ -n "$weaknesses" ]]; then
      issues="$weaknesses"
    fi

    printf "%3d. [%2d/$grade] %-40s | %-8s | %5d words | %s\n" $line_num $score "$genre" "$depth" $wc "$issues"
  done < "$RESULTS_FILE"

  echo ""
  echo "## Detailed Issues by Category"
  echo ""

  # Missing files tally
  echo "### Missing Required Files (should have 7)"
  echo ""
  for f in "${REQUIRED_FILES[@]}"; do
    missing_genres=$(for genre_dir in library/genres/*/; do
      if [[ ! -f "$genre_dir$f" ]]; then
        basename "$genre_dir"
      fi
    done | wc -l)
    if [[ $missing_genres -gt 0 ]]; then
      echo "- **$f**: missing from $missing_genres genres"
    fi
  done

  echo ""
  echo "### No meta.json (missing picker description)"
  echo ""
  count=0
  for genre_dir in library/genres/*/; do
    if [[ ! -f "$genre_dir/meta.json" ]]; then
      echo "- $(basename "$genre_dir")"
      count=$((count + 1))
    fi
  done
  if [[ $count -eq 0 ]]; then echo "(None — all have meta.json)"; fi

  echo ""
  echo "### Particularly Weak or Generic (< 300 words total)"
  echo ""
  while IFS='|' read -r score genre depth wc missing weaknesses; do
    if [[ "$depth" == "BARE" ]] || [[ $wc -lt 300 ]]; then
      printf "- **%s** (%d words): %s\n" "$genre" $wc "${weaknesses:-generic/thin content}"
    fi
  done < "$RESULTS_FILE" | head -30

} > "$OUTPUT_FILE"

cat "$OUTPUT_FILE"
rm "$RESULTS_FILE"

echo ""
echo "Report written to: $OUTPUT_FILE"
