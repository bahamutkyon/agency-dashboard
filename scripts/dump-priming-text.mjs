#!/usr/bin/env node
// 直接呼叫 server 的 buildSkillPrimingBlock,印出 agent 啟動時會看到的完整文字
// 這驗證從「資料層 → 邏輯層 → 字串輸出」的整條鏈路

import { buildSkillPrimingBlock } from "../server/src/skillPriming.ts";

const samples = [
  "design-ui-designer",
  "specialized-mcp-builder",
  "finance-invoice-manager",
];

for (const agentId of samples) {
  console.log(`${"═".repeat(70)}`);
  console.log(`Agent: ${agentId}`);
  console.log(`${"═".repeat(70)}`);
  const block = buildSkillPrimingBlock(agentId);
  if (!block) {
    console.log("(無 priming)");
  } else {
    console.log(block);
  }
}
