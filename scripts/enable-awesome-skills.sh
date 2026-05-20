#!/bin/bash
# 一次性啟用選中的 awesome-claude-skills 到 ~/.claude/skills/awesome-<name>/
# 使用 awesome- 前綴避免與 superpowers-zh 衝突（例如 mcp-builder）

set -e

STAGING="C:/Users/baham/Desktop/claude/agency-dashboard/skills-awesome-zh"
TARGET="C:/Users/baham/.claude/skills"

# 21 個要啟用的 skill
SKILLS=(
  canvas-design
  theme-factory
  brand-guidelines
  image-enhancer
  content-research-writer
  internal-comms
  competitive-ads-extractor
  twitter-algorithm-optimizer
  changelog-generator
  mcp-builder
  skill-creator
  webapp-testing
  artifacts-builder
  meeting-insights-analyzer
  lead-research-assistant
  invoice-organizer
  domain-name-brainstormer
  tailored-resume-generator
  developer-growth-analysis
  video-downloader
  raffle-winner-picker
)

enabled=0
skipped=0
for skill in "${SKILLS[@]}"; do
  src="$STAGING/$skill"
  dst="$TARGET/awesome-$skill"

  if [ ! -d "$src" ]; then
    echo "✗ $skill: 來源不存在,跳過"
    skipped=$((skipped+1))
    continue
  fi

  if [ -d "$dst" ]; then
    echo "⚠ $skill: 目標已存在,先移除"
    rm -rf "$dst"
  fi

  cp -r "$src" "$dst"

  # 更新 frontmatter 的 name 欄位為 awesome-<name>
  skill_md="$dst/SKILL.md"
  if [ -f "$skill_md" ]; then
    # 用 sed 改 frontmatter 的 name: 行
    sed -i "s/^name: $skill\$/name: awesome-$skill/" "$skill_md"
    # 確認改成功
    new_name=$(awk '/^name:/{print $2; exit}' "$skill_md")
    if [ "$new_name" = "awesome-$skill" ]; then
      echo "✓ $skill → awesome-$skill"
      enabled=$((enabled+1))
    else
      echo "⚠ $skill: frontmatter 改名失敗,name=$new_name"
    fi
  else
    echo "⚠ $skill: 沒 SKILL.md"
  fi
done

echo ""
echo "=== 統計 ==="
echo "啟用: $enabled / 21"
echo "跳過: $skipped"
